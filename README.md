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

Google blocks OAuth sign-in in browsers it detects as embedded, keying off
the `Electron/<version>` and app-name tokens in the user agent. DuoPane sets
a realistic Chrome desktop user agent on **both** pane sessions via
`session.setUserAgent()` — the standard Chrome UA string for the exact
Chromium major version Electron bundles, with the Electron and app-name
tokens removed (see `realisticChromeUA()` in `src/main/panes.ts`). Sign-in
redirects to `accounts.google.com` are kept inside the pane so the OAuth
flow can complete.

This UA-spoofing approach is what ships. If Google still refuses sign-in on
your account (it occasionally tightens detection), the fallback is: sign in
to your Google account in your system browser first is *not* enough, since
sessions aren't shared — instead use the pane's **Open in browser** button
(`↗`), complete sign-in there, and if that still doesn't carry over, watch
for a "browser not secure" page in the pane and file an issue; the next
step would be catching the auth URL and completing it via the system
browser with a custom redirect, which is intentionally not wired up until
the simple approach actually fails.

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
