# DuoPane

A macOS desktop app that shows two AI chat web apps side by side in a single
native window — Claude on the left, Gemini on the right by default, but any
two URLs work.

Built on Electron's `WebContentsView` (not the deprecated `<webview>` tag or
`BrowserView`). The window's own renderer is a thin chrome layer — a top bar
and a draggable divider — while the two panes are native view siblings whose
geometry is controlled entirely by the main process via `setBounds()`.

## Setup

Requires Node 22 (an `.nvmrc` is included) and macOS 12+.

```sh
nvm use          # or: nvm install
npm install
npm run dev      # launch in development
```

Other scripts:

```sh
npm run typecheck   # tsc over main/preload and renderer configs
npm run build       # typecheck + bundle + universal (arm64+x64) ad-hoc-signed .dmg in dist/
```

## Configuration

Panes are defined in a JSON config file at
`~/Library/Application Support/DuoPane/config.json`:

```json
{
  "panes": [
    { "id": "claude", "label": "Claude", "url": "https://claude.ai" },
    { "id": "gemini", "label": "Gemini", "url": "https://gemini.google.com/app" }
  ],
  "dividerRatio": 0.5
}
```

- `id` names the pane's persistent session partition (`persist:<id>`), so
  cookies and logins survive restarts and the two panes never share state.
  Changing an `id` starts a fresh login session for that pane; changing it
  back restores the old one.
- `dividerRatio` is the left pane's share of the width; it is written back
  automatically when you drag the divider.

You can edit all of this in-app via **DuoPane → Settings…** (`⌘,`). The file
is also safe to edit by hand while the app is closed; invalid configs fall
back to the defaults above.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘1` / `⌘2` | Focus left / right pane |
| `⌘\` | Swap panes |
| `⌘0` | Reset divider to 50/50 |
| `⌘R` | Reload focused pane |
| `⌘[` / `⌘]` | Back / forward in focused pane |
| `⌘⇧C` | Copy focused pane's current URL |

The divider snaps to 50/50 when released within 3% of center and refuses to
shrink either pane below 320px.

## The Google login workaround

Google blocks sign-in in browsers it detects as embedded ("This browser or
app may not be secure"). Two layers of detection matter, and DuoPane
handles both (see `src/main/panes.ts`):

1. **User agent string.** Both pane sessions get a realistic Chrome desktop
   UA via `session.setUserAgent()` — the standard Chrome UA for the exact
   Chromium major version Electron bundles, with the `Electron/<version>`
   and app-name tokens removed (`realisticChromeUA()`).
2. **Client-hint headers.** A Chrome UA alone is not enough: Chromium still
   sends `sec-ch-ua` headers whose brand list says `"Chromium"` without
   `"Google Chrome"`, and Google flags the contradiction. Firefox sends no
   client hints at all, so DuoPane presents a **Firefox** identity to
   Google: any pane whose own site is a Google property (like Gemini) uses
   a Firefox UA for its whole session, other panes swap to Firefox on the
   Google auth hosts only, and all `sec-ch-ua*` headers are stripped on
   those requests (`webRequest.onBeforeSendHeaders`).
3. **`navigator.userAgentData`.** Google's sign-in JS also fingerprints the
   engine: Chromium exposes `navigator.userAgentData` (with a bare
   `"Chromium"` brand), which Firefox doesn't implement at all — a fatal
   contradiction with the Firefox UA. A tiny session preload
   (`src/preload/authshim.ts`) hides it in the page's main world on
   Google-owned hosts before any site script runs. This is the one
   deliberate deviation from "no preload in third-party panes": it runs
   nothing except that property override, and only on Google hosts.

The result is a consistent Firefox fingerprint (UA string, no client
hints, no `userAgentData`) end to end for the sign-in flow. Sign-in
redirects to the auth hosts are kept inside the pane so the flow can
complete.

If Google still refuses on your account: a previously failed attempt can
leave the session flagged, so open **Settings** and change the pane's ID
(e.g. `gemini` → `gemini2`) to start a completely fresh session, then try
again. Failing that, file an issue with what the pane showed.

## Limitations

- This app wraps the **web** versions of Claude and Gemini. macOS provides
  no API to reparent another process's window, so embedding the native
  Claude Desktop or Gemini apps is not possible. Consequently, features of
  those native apps — MCP connectors, local filesystem access — are **not
  available** here.
- External links (anything that isn't the pane's own origin or a Google
  auth host) open in your system browser.

## Architecture notes

- `src/shared/types.ts` — the typed IPC channel contract (`RendererSendMap`,
  `RendererInvokeMap`, `MainSendMap`) plus config types and layout
  constants. Imported by main, preload, and renderer; no `any` anywhere in
  the IPC layer.
- `src/main/panes.ts` — `PaneManager`: creates the two `WebContentsView`s,
  owns all layout math, session/user-agent setup, navigation policy, and
  focus tracking.
- Divider dragging: the visible divider is 1px inside a 9px renderer-owned
  gap between the native views. Because native views swallow mouse events,
  a transparent full-window "glass" `WebContentsView` (`glass.html`) is
  raised above both panes for the duration of a drag so pointer events keep
  flowing no matter how fast the cursor moves; `setBounds()` updates are
  throttled to animation frames.
