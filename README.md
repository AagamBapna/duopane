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
app may not be secure"). The approach that ships — after empirically
testing what Electron actually sends on the wire — is to present as
**consistent plain Chromium**, which Google accepts from real Chromium
builds (see `src/main/panes.ts` and `src/preload/authshim.ts`):

1. **User agent string.** Both pane sessions get a realistic Chrome desktop
   UA via `session.setUserAgent()` — the standard frozen Chrome UA for the
   exact Chromium major version Electron bundles, with the
   `Electron/<version>` and app-name tokens removed
   (`realisticChromeUA()`). This stays consistent with the client-hint
   brands (`"Chromium"`) and, crucially, with the TLS/HTTP2 network
   fingerprint, which is always Chromium's and cannot be spoofed —
   masquerading as Firefox or Safari is detectable at that layer and does
   not survive Google's checks (verified the hard way).
2. **`window.chrome`.** The one JS surface where Electron differs from a
   real Chromium build: real builds expose `chrome.loadTimes`,
   `chrome.csi`, and `chrome.app`, while Electron ships an empty
   `window.chrome` — the classic embedded-browser tell. A tiny session
   preload (`src/preload/authshim.ts`) fills these in, in the page's main
   world, on Google-owned hosts before any site script runs. This is the
   one deliberate deviation from "no preload in third-party panes": it
   does nothing except that, only on Google hosts, and logs one
   diagnostic line.

Sign-in redirects to the auth hosts (`accounts.google.com` and friends)
are kept inside the pane so the flow can complete.

If Google still refuses on your account: a previously failed attempt can
leave the session flagged, so open **Settings** and change the pane's ID
(e.g. `gemini` → `gemini2`) to start a completely fresh session, then try
again. Google also weighs account-level risk signals that no client-side
fix can address; if it persists, file an issue with what the pane showed.

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
