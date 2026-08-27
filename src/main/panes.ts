import { BrowserWindow, WebContentsView, clipboard, session, shell } from 'electron'
import { join } from 'node:path'
import type {
  AppConfig,
  LayoutState,
  MainSendMap,
  PaneAction,
  PaneConfig,
  PaneSlot,
  PaneState,
} from '../shared/types'
import { CHROME_TOPBAR_HEIGHT, DIVIDER_GAP, MIN_PANE_WIDTH } from '../shared/types'
import { saveConfig } from './config'
import { getZoom, setZoom } from './window-state'

const MIN_ZOOM_LEVEL = -3
const MAX_ZOOM_LEVEL = 4.5
const ZOOM_STEP = 0.5

/**
 * A realistic Chrome desktop user agent. Google refuses OAuth sign-in in
 * browsers it detects as embedded, keying off the Electron/<version> and
 * app-name tokens, so both are dropped and the platform/Chrome tokens mirror
 * a stock Chrome install matching the bundled Chromium major version.
 */
function realisticChromeUA(): string {
  const chromeMajor = process.versions.chrome.split('.')[0]
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`
}

/** Hosts that must stay inside the pane for sign-in flows to complete. */
const AUTH_HOSTS = [
  'accounts.google.com',
  'accounts.youtube.com',
  'myaccount.google.com',
  'accounts.googleusercontent.com',
]

/** Session partitions that already have preloads registered. */
const configuredPartitions = new Set<string>()

interface Pane {
  config: PaneConfig
  view: WebContentsView
  faviconUrl: string
  lastCrashRecovery: number
}

export class PaneManager {
  private readonly win: BrowserWindow
  private slots: { left: Pane; right: Pane }
  private readonly glass: WebContentsView
  private ratio: number
  private collapsed: PaneSlot | null = null
  private focused: PaneSlot = 'left'
  private saveTimer: NodeJS.Timeout | null = null

  constructor(win: BrowserWindow, config: AppConfig) {
    this.win = win
    this.ratio = config.dividerRatio
    this.slots = {
      left: this.createPane(config.panes[0]),
      right: this.createPane(config.panes[1]),
    }
    // Load only after this.slots is assigned: loadURL can emit events
    // synchronously, and their handlers look panes up via slotOf().
    this.loadPane(this.slots.left)
    this.loadPane(this.slots.right)
    this.glass = this.createGlass()
    win.on('resize', () => this.layout())
    win.webContents.on('did-finish-load', () => {
      // Re-sync the chrome UI after initial load or a dev-server reload.
      this.pushLayoutState()
      this.pushPaneState('left')
      this.pushPaneState('right')
    })
    this.layout()
  }

  private createPane(config: PaneConfig): Pane {
    const ses = session.fromPartition(`persist:${config.id}`)
    ses.setUserAgent(realisticChromeUA())
    if (!configuredPartitions.has(config.id)) {
      configuredPartitions.add(config.id)
      // Fills in the window.chrome surface real Chromium has but Electron
      // lacks (see authshim.ts) — the JS tell Google's sign-in check uses
      // to distinguish embedded browsers from a real Chromium.
      ses.registerPreloadScript({
        type: 'frame',
        filePath: join(__dirname, '../preload/authshim.js'),
      })
    }
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    const pane: Pane = { config, view, faviconUrl: '', lastCrashRecovery: 0 }
    this.wireWebContents(pane)
    this.win.contentView.addChildView(view)
    return pane
  }

  private loadPane(pane: Pane): void {
    void pane.view.webContents.loadURL(pane.config.url)
  }

  /**
   * Full-window transparent WebContentsView shown only while the divider is
   * being dragged. The native pane views swallow mouse events, so once the
   * cursor outruns the 9px renderer-owned gap a DOM drag would stall; the
   * glass sits above both panes and keeps pointer events flowing until
   * release.
   */
  private createGlass(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/chrome.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    view.setBackgroundColor('#00000000')
    view.setVisible(false)
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl) {
      void view.webContents.loadURL(`${devUrl}/glass.html`)
    } else {
      void view.webContents.loadFile(join(__dirname, '../renderer/glass.html'))
    }
    this.win.contentView.addChildView(view)
    return view
  }

  private wireWebContents(pane: Pane): void {
    const wc = pane.view.webContents
    const push = (): void => {
      const slot = this.slotOf(pane)
      if (slot) this.pushPaneState(slot)
    }
    wc.on('page-title-updated', push)
    wc.on('page-favicon-updated', (_event, favicons) => {
      pane.faviconUrl = favicons[favicons.length - 1] ?? ''
      push()
    })
    wc.on('did-navigate', push)
    wc.on('did-navigate-in-page', push)
    wc.on('did-start-loading', push)
    wc.on('did-stop-loading', push)
    // Chromium zoom is per-origin and resets on cross-origin loads; reapply
    // the pane's saved level after every load so it stays consistent.
    wc.on('did-finish-load', () => wc.setZoomLevel(getZoom(pane.config.id)))
    // -3 (ERR_ABORTED) fires for cancelled loads during normal navigation.
    wc.on('did-fail-load', (_event, errorCode, _desc, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) push()
    })
    wc.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit' || details.reason === 'killed') return
      // Auto-recover from a crashed site, but never in a tight loop.
      const now = Date.now()
      if (now - pane.lastCrashRecovery < 10_000) return
      pane.lastCrashRecovery = now
      void wc.loadURL(pane.config.url)
    })
    wc.on('focus', () => {
      const slot = this.slotOf(pane)
      if (slot) this.focused = slot
    })

    wc.setWindowOpenHandler(({ url }) => {
      if (this.allowedInPane(pane, url)) {
        void wc.loadURL(url)
      } else {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })
    wc.on('will-navigate', (event, url) => {
      if (!this.allowedInPane(pane, url)) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
  }

  private allowedInPane(pane: Pane, url: string): boolean {
    let target: URL
    let paneOrigin: URL
    try {
      target = new URL(url)
      paneOrigin = new URL(pane.config.url)
    } catch {
      return false
    }
    if (target.origin === paneOrigin.origin) return true
    return AUTH_HOSTS.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`))
  }

  private slotOf(pane: Pane): PaneSlot | null {
    if (!this.slots) return null
    if (this.slots.left === pane) return 'left'
    if (this.slots.right === pane) return 'right'
    return null
  }

  // ---- Layout ----

  layout(): void {
    const [width, height] = this.win.getContentSize()
    const y = CHROME_TOPBAR_HEIGHT
    const paneHeight = Math.max(0, height - CHROME_TOPBAR_HEIGHT)

    if (this.collapsed !== null) {
      const shown = this.collapsed === 'left' ? 'right' : 'left'
      this.slots[this.collapsed].view.setVisible(false)
      const view = this.slots[shown].view
      view.setVisible(true)
      view.setBounds({ x: 0, y, width, height: paneHeight })
    } else {
      this.ratio = this.clampRatio(this.ratio, width)
      const leftWidth = Math.round((width - DIVIDER_GAP) * this.ratio)
      const left = this.slots.left.view
      const right = this.slots.right.view
      left.setVisible(true)
      right.setVisible(true)
      left.setBounds({ x: 0, y, width: leftWidth, height: paneHeight })
      right.setBounds({
        x: leftWidth + DIVIDER_GAP,
        y,
        width: width - leftWidth - DIVIDER_GAP,
        height: paneHeight,
      })
    }
    this.glass.setBounds({ x: 0, y: 0, width, height })
    this.pushLayoutState()
  }

  private clampRatio(ratio: number, contentWidth: number): number {
    const usable = contentWidth - DIVIDER_GAP
    if (usable < MIN_PANE_WIDTH * 2) return 0.5
    const min = MIN_PANE_WIDTH / usable
    return Math.min(1 - min, Math.max(min, ratio))
  }

  setRatio(ratio: number): void {
    if (this.collapsed !== null) return
    this.ratio = this.clampRatio(ratio, this.win.getContentSize()[0])
    this.layout()
  }

  commitRatio(ratio: number): void {
    this.setRatio(ratio)
    this.persistConfig()
  }

  beginDividerDrag(): void {
    if (this.collapsed !== null) return
    // Re-append so the glass stays above panes rebuilt by applyConfig().
    this.win.contentView.removeChildView(this.glass)
    this.win.contentView.addChildView(this.glass)
    const [width, height] = this.win.getContentSize()
    this.glass.setBounds({ x: 0, y: 0, width, height })
    this.glass.setVisible(true)
    this.sendToChrome('divider:dragging', true)
  }

  endDividerDrag(): void {
    this.glass.setVisible(false)
    this.sendToChrome('divider:dragging', false)
    this.slots[this.focused].view.webContents.focus()
  }

  swap(): void {
    const { left, right } = this.slots
    this.slots = { left: right, right: left }
    if (this.collapsed !== null) this.collapsed = this.collapsed === 'left' ? 'right' : 'left'
    this.focused = this.focused === 'left' ? 'right' : 'left'
    this.layout()
    this.pushPaneState('left')
    this.pushPaneState('right')
    this.persistConfig()
  }

  collapse(slot: PaneSlot | null): void {
    this.collapsed = slot
    // Focus-driven shortcuts (Cmd+R etc.) should act on the visible pane.
    if (slot !== null && this.focused === slot) {
      this.focused = slot === 'left' ? 'right' : 'left'
      this.slots[this.focused].view.webContents.focus()
    }
    this.layout()
  }

  resetSplit(): void {
    this.collapsed = null
    this.ratio = 0.5
    this.layout()
    this.persistConfig()
  }

  // ---- Pane actions ----

  paneAction(action: PaneAction, slot: PaneSlot): void {
    const wc = this.slots[slot].view.webContents
    switch (action) {
      case 'reload':
        // A pane whose initial load failed (e.g. launched offline) has no
        // URL to reload; retry the configured one instead.
        if (wc.getURL()) wc.reload()
        else void wc.loadURL(this.slots[slot].config.url)
        break
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
        break
      case 'forward':
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
        break
      case 'focus':
        this.focusPane(slot)
        break
      case 'open-external':
        void shell.openExternal(wc.getURL() || this.slots[slot].config.url)
        break
    }
  }

  focusedPaneAction(action: PaneAction): void {
    this.paneAction(action, this.focused)
  }

  focusPane(slot: PaneSlot): void {
    if (this.collapsed === slot) {
      this.collapsed = null
      this.layout()
    }
    this.focused = slot
    this.slots[slot].view.webContents.focus()
  }

  copyFocusedUrl(): void {
    clipboard.writeText(this.slots[this.focused].view.webContents.getURL())
  }

  zoomFocused(change: 'in' | 'out' | 'reset'): void {
    const pane = this.slots[this.focused]
    const wc = pane.view.webContents
    let level = 0
    if (change !== 'reset') {
      const delta = change === 'in' ? ZOOM_STEP : -ZOOM_STEP
      level = Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, wc.getZoomLevel() + delta))
    }
    wc.setZoomLevel(level)
    setZoom(pane.config.id, level)
  }

  async clearSession(slot: PaneSlot): Promise<void> {
    const pane = this.slots[slot]
    const ses = pane.view.webContents.session
    await ses.clearStorageData()
    await ses.clearCache()
    void pane.view.webContents.loadURL(pane.config.url)
  }

  // ---- Config ----

  currentConfig(): AppConfig {
    return {
      panes: [this.slots.left.config, this.slots.right.config],
      dividerRatio: this.ratio,
    }
  }

  applyConfig(config: AppConfig): void {
    const slotOrder: PaneSlot[] = ['left', 'right']
    slotOrder.forEach((slot, index) => {
      const next = config.panes[index]
      const pane = this.slots[slot]
      if (next.id !== pane.config.id) {
        // A new id means a new session partition: rebuild the view.
        this.win.contentView.removeChildView(pane.view)
        pane.view.webContents.close()
        this.slots[slot] = this.createPane(next)
        this.loadPane(this.slots[slot])
      } else {
        const urlChanged = next.url !== pane.config.url
        pane.config = next
        if (urlChanged) void pane.view.webContents.loadURL(next.url)
      }
      this.pushPaneState(slot)
    })
    this.layout()
  }

  private persistConfig(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      saveConfig(this.currentConfig())
    }, 250)
  }

  // ---- State push ----

  private pushPaneState(slot: PaneSlot): void {
    const pane = this.slots[slot]
    const wc = pane.view.webContents
    if (wc.isDestroyed()) return
    const state: PaneState = {
      slot,
      label: pane.config.label,
      title: wc.getTitle() || pane.config.label,
      faviconUrl: pane.faviconUrl,
      currentUrl: wc.getURL(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    }
    this.sendToChrome('pane:state', state)
  }

  private pushLayoutState(): void {
    const state: LayoutState = { ratio: this.ratio, collapsed: this.collapsed }
    this.sendToChrome('layout:state', state)
  }

  private sendToChrome<C extends keyof MainSendMap>(channel: C, ...args: MainSendMap[C]): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, ...args)
  }
}
