// Registered on every pane session via ses.registerPreloadScript, so it runs
// in every frame before site scripts. The pane sessions present a Firefox
// identity to Google (UA string, no sec-ch-ua headers) to pass Google's
// embedded-browser sign-in check; navigator.userAgentData is the one JS
// surface that would still reveal Chromium (Firefox does not implement it),
// so hide it in the page's main world on Google-owned hosts only.
//
// NOTE: sandboxed preload — must stay a single bundled file with no shared
// runtime imports (see chrome.ts).
import { webFrame } from 'electron'

// Preloads run in a renderer, but this file typechecks under the node
// config (no DOM lib) — declare the one browser global it needs.
declare const window: { location: { hostname: string } }

const host = window.location.hostname
const googleOwned =
  host === 'google.com' ||
  host.endsWith('.google.com') ||
  host.endsWith('.googleusercontent.com') ||
  host.endsWith('.youtube.com')

if (googleOwned) {
  void webFrame
    .executeJavaScript(
      `try {
        Object.defineProperty(Navigator.prototype, 'userAgentData', {
          get: () => undefined,
          configurable: true,
        })
      } catch (e) {}
      String(navigator.userAgentData)`,
    )
    .then((result: unknown) => {
      console.info(`[duopane] authshim on ${host}: userAgentData=${String(result)}`)
    })
}
