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

// Every JS surface where Chromium contradicts the Firefox UA the session
// presents. Values mirror real Firefox on macOS.
const FIREFOX_MASK = `
  const def = (obj, name, value) => {
    try {
      Object.defineProperty(obj, name, { get: () => value, configurable: true })
    } catch (e) {}
  }
  def(Navigator.prototype, 'userAgentData', undefined) // Firefox: not implemented
  def(Navigator.prototype, 'vendor', '')               // Chromium: "Google Inc."
  def(Navigator.prototype, 'productSub', '20100101')   // Chromium: "20030107"
  def(Navigator.prototype, 'oscpu', 'Intel Mac OS X 10.15') // Firefox-only
  def(Navigator.prototype, 'buildID', '20181001000000')     // Firefox-only
  try { delete window.chrome } catch (e) {}            // Firefox: absent
  JSON.stringify({
    uad: String(navigator.userAgentData),
    vendor: navigator.vendor,
    chrome: typeof window.chrome,
  })`

if (googleOwned) {
  void webFrame.executeJavaScript(FIREFOX_MASK).then((result: unknown) => {
    console.info(`[duopane] authshim on ${host}: ${String(result)}`)
  })
}
