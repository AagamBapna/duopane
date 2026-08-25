// Registered on every pane session via ses.registerPreloadScript, so it runs
// in every frame before site scripts.
//
// Google's sign-in check ("This browser or app may not be secure") tells
// embedded browsers apart from real ones. Spoofing a different browser is a
// dead end: Google also fingerprints the TLS/HTTP2 stack, which is always
// Chromium's. So DuoPane presents as what it actually is — plain Chromium
// (Chrome UA matching the engine version, Chromium client-hint brands) —
// which Google accepts from real Chromium builds. The one JS surface where
// Electron differs from real Chromium is window.chrome: real builds expose
// chrome.loadTimes/csi/app, Electron leaves it empty. Fill that in, in the
// page's main world, on Google-owned hosts before any site script runs.
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

const CHROMIUM_MASK = `
  try {
    const c = window.chrome || (window.chrome = {})
    if (!c.loadTimes) {
      const t = performance.timeOrigin / 1000
      c.loadTimes = function loadTimes() {
        return {
          requestTime: t, startLoadTime: t, commitLoadTime: t,
          finishDocumentLoadTime: t, finishLoadTime: t, firstPaintTime: t,
          firstPaintAfterLoadTime: 0, navigationType: 'Other',
          wasFetchedViaSpdy: true, wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        }
      }
    }
    if (!c.csi) {
      c.csi = function csi() {
        return {
          onloadT: Date.now(), startE: Math.round(performance.timeOrigin),
          pageT: performance.now(), tran: 15,
        }
      }
    }
    if (!c.app) {
      c.app = {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails() { return null },
        getIsInstalled() { return false },
      }
    }
  } catch (e) {}
  JSON.stringify({ chrome: Object.keys(window.chrome || {}), vendor: navigator.vendor })`

if (googleOwned) {
  void webFrame.executeJavaScript(CHROMIUM_MASK).then((result: unknown) => {
    console.info(`[duopane] authshim on ${host}: ${String(result)}`)
  })
}
