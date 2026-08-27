# DuoPane

A macOS desktop app that shows AI chat web apps side by side in a single
native window — Claude and Gemini by default, but any number of panes with
any URLs. Add and remove panes on the fly (`⌘T` / the ＋ button); the set of
panes, their order, and their widths are saved and restored on the next
launch.

Built on Electron's `WebContentsView` (not the deprecated `<webview>` tag or
`BrowserView`). The window's own renderer is a thin chrome layer — a top bar
and draggable dividers — while each pane is a native view sibling whose
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
`~/Library/Application Support/DuoPane/config.json`. There can be **one or
more** panes, laid out left to right in array order:

```json
{
  "panes": [
    { "id": "claude", "label": "Claude", "url": "https://claude.ai" },
    { "id": "gemini", "label": "Gemini", "url": "https://gemini.google.com/app" },
    { "id": "chatgpt", "label": "ChatGPT", "url": "https://chatgpt.com" }
  ],
  "weights": [0.4, 0.3, 0.3]
}
```

- `id` names the pane's persistent session partition (`persist:<id>`), so
  cookies and logins survive restarts and panes never share state. Changing
  an `id` starts a fresh login session for that pane; changing it back
  restores the old one. Ids may contain letters, digits, `.`, `_`, and `-`.
- `weights` are the panes' proportional widths (any positive numbers — they
  are normalized). They are written back automatically as you drag the
  dividers. Each pane is kept at least 320px wide, so the window grows its
  minimum width as you add panes.
- A legacy `dividerRatio` from older two-pane configs is still read and
  migrated to `weights` automatically.

You can edit all of this in-app via **DuoPane → Settings…** (`⌘,`) — add,
remove, reorder, rename, and re-point panes, or clear a pane's session. The
file is also safe to edit by hand while the app is closed; invalid configs
fall back to the defaults.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘1` … `⌘9` | Focus pane 1–9 |
| `⌘T` | New pane |
| `⌘⇧W` | Close focused pane |
| `⌘⇧[` / `⌘⇧]` | Move focused pane left / right |
| `⌘0` | Equalize widths / show all panes |
| `⌘R` | Reload focused pane |
| `⌘[` / `⌘]` | Back / forward in focused pane |
| `⌘⇧C` | Copy focused pane's current URL |
| `⌘=` / `⌘-` | Zoom focused pane in / out (Actual Size is in the View menu) |

Each pane's top-bar cluster also has back/forward/reload/open-in-browser, a
"show only this pane" (solo) toggle, and a close button. Dividers between
panes are draggable; each pane refuses to shrink below 320px.

Zoom level is remembered per pane. Window size and position are restored on
the next launch (both stored in
`~/Library/Application Support/DuoPane/window-state.json`, separate from the
pane config). If a pane's sign-in gets stuck, **Settings → Clear session**
wipes that pane's cookies and storage and reloads it.

## The Google login workaround

Google blocks sign-in in browsers it detects as embedded ("This browser or
app may not be secure"). The approach that ships — after empirically
testing what Electron actually sends on the wire — is to present as
**consistent plain Chromium**, which Google accepts from real Chromium
builds (see `src/main/panes.ts` and `src/preload/authshim.ts`):

1. **User agent string.** Every pane session gets a realistic Chrome desktop
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
- `src/main/panes.ts` — `PaneManager`: creates one `WebContentsView` per
  pane, owns all layout math (N panes with min-width-aware weight
  distribution), add/remove/reorder, session/user-agent setup, navigation
  policy, and focus tracking.
- Divider dragging: each visible divider is a 1px line inside a 9px
  renderer-owned gap between two native views. Because native views swallow
  mouse events, a transparent full-window "glass" `WebContentsView`
  (`glass.html`) is raised above the panes for the duration of a drag so
  pointer events keep flowing no matter how fast the cursor moves — the main
  process already knows which divider is active, so the glass only reports
  the cursor x. `setBounds()` updates are throttled to animation frames.
