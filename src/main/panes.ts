import { BrowserWindow, WebContentsView, clipboard, session, shell } from 'electron'
import { join } from 'node:path'
import type {
  AppConfig,
  Column,
  LayoutState,
  MainSendMap,
  PaneAction,
  PaneConfig,
  PaneState,
} from '../shared/types'
import { CHROME_TOPBAR_HEIGHT, DIVIDER_GAP, MIN_PANE_WIDTH } from '../shared/types'
import { normalizeWeights, saveConfig } from './config'
import { getZoom, setZoom } from './window-state'

const MIN_ZOOM_LEVEL = -3
const MAX_ZOOM_LEVEL = 4.5
const ZOOM_STEP = 0.5
const MIN_WINDOW_HEIGHT = CHROME_TOPBAR_HEIGHT + 400

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

/** Common two-part public suffixes, for registrable-domain comparison. */
const TWO_PART_TLDS = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.jp',
  'co.in',
  'co.nz',
  'com.br',
  'com.mx',
  'com.sg',
])

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** eTLD+1, so app.example.com and auth.example.com compare equal. */
function registrableDomain(host: string): string {
  const parts = host.split('.')
  if (parts.length <= 2) return host
  const lastTwo = parts.slice(-2).join('.')
  if (TWO_PART_TLDS.has(lastTwo)) return parts.slice(-3).join('.')
  return lastTwo
}

// A sign-in flow routinely hops to a dedicated auth domain that is NOT the
// site's own domain (chatgpt.com -> auth.openai.com, and on to
// accounts.google.com). These must stay inside the pane or the flow breaks
// with a generic "we ran into an issue signing you in".
const AUTH_FIRST_LABELS = new Set([
  'auth',
  'auth0',
  'login',
  'logon',
  'signin',
  'accounts',
  'account',
  'oauth',
  'openid',
  'sso',
  'idp',
  'id',
  'connect',
  'secure',
])

function looksLikeAuthHost(host: string): boolean {
  if (host.includes('auth0') || host.includes('oauth') || host.includes('okta')) return true
  const first = host.split('.')[0]
  return AUTH_FIRST_LABELS.has(first)
}

type NavPolicy = 'in-pane' | 'popup' | 'external'

function classifyTarget(paneUrl: string, targetUrl: string): NavPolicy {
  const target = hostOf(targetUrl)
  const pane = hostOf(paneUrl)
  if (!target || !pane) return 'external'
  if (registrableDomain(target) === registrableDomain(pane)) return 'in-pane'
  // Auth hosts open as a real child window so OAuth popups can post back to
  // their opener; a top-level auth navigation is handled as 'in-pane'.
  if (looksLikeAuthHost(target)) return 'popup'
  return 'external'
}

/** Session partitions that already have preloads registered. */
const configuredPartitions = new Set<string>()

interface Pane {
  config: PaneConfig
  view: WebContentsView
  faviconUrl: string
  lastCrashRecovery: number
}

/**
 * Distribute `usable` pixels across `weights`, never letting a pane fall below
 * MIN_PANE_WIDTH. Panes that would be too small are pinned to the minimum and
 * the rest re-share the remaining space by weight.
 */
function computeFloatWidths(usable: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []
  if (usable <= n * MIN_PANE_WIDTH) return weights.map(() => usable / n)
  const pinned = new Array<boolean>(n).fill(false)
  for (;;) {
    let pinnedTotal = 0
    let freeWeight = 0
    for (let i = 0; i < n; i++) {
      if (pinned[i]) pinnedTotal += MIN_PANE_WIDTH
      else freeWeight += weights[i]
    }
    const freeSpace = usable - pinnedTotal
    let changed = false
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue
      const w = freeWeight > 0 ? freeSpace * (weights[i] / freeWeight) : 0
      if (w < MIN_PANE_WIDTH) {
        pinned[i] = true
        changed = true
      }
    }
    if (!changed) {
      return weights.map((weight, i) =>
        pinned[i] ? MIN_PANE_WIDTH : freeSpace * (weight / freeWeight),
      )
    }
  }
}

/** Turn float pane widths into integer columns that tile the width exactly. */
function columnsFromWidths(widths: number[], totalWidth: number): Column[] {
  const columns: Column[] = []
  let acc = 0
  for (let i = 0; i < widths.length; i++) {
    const startX = Math.round(acc) + i * DIVIDER_GAP
    acc += widths[i]
    const endX = Math.round(acc) + i * DIVIDER_GAP
    columns.push({ x: startX, width: Math.max(0, endX - startX) })
  }
  // Guard against rounding leaving a sub-pixel sliver on the last pane.
  if (columns.length > 0) {
    const last = columns[columns.length - 1]
    last.width = Math.max(0, totalWidth - last.x)
  }
  return columns
}

export class PaneManager {
  private readonly win: BrowserWindow
  private panes: Pane[]
  private weights: number[]
  private readonly glass: WebContentsView
  private focused = 0
  private solo: number | null = null
  private draggingDivider: number | null = null
  private saveTimer: NodeJS.Timeout | null = null

  constructor(win: BrowserWindow, config: AppConfig) {
    this.win = win
    this.panes = config.panes.map((pane) => this.createPane(pane))
    this.weights = normalizeWeights(config.weights, this.panes.length)
    // Load only after this.panes is assigned: loadURL can emit events
    // synchronously, and their handlers look panes up via indexOf.
    for (const pane of this.panes) this.loadPane(pane)
    this.glass = this.createGlass()
    win.on('resize', () => this.layout())
    win.webContents.on('did-finish-load', () => {
      this.pushLayoutState()
      this.pushPanesState()
    })
    this.updateMinSize()
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
   * Full-window transparent WebContentsView shown only while a divider is
   * being dragged. The native pane views swallow mouse events, so once the
   * cursor outruns the divider strip a DOM drag would stall; the glass sits
   * above every pane and keeps pointer events flowing until release.
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
      const index = this.panes.indexOf(pane)
      if (index >= 0) this.pushPanesState()
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
    // -3 (ERR_ABORTED) fires for cancelled loads during normal navigation.
    wc.on('did-fail-load', (_event, errorCode, _desc, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) push()
    })
    // Chromium zoom is per-origin and resets on cross-origin loads; reapply
    // the pane's saved level after every load so it stays consistent.
    wc.on('did-finish-load', () => wc.setZoomLevel(getZoom(pane.config.id)))
    wc.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit' || details.reason === 'killed') return
      const now = Date.now()
      if (now - pane.lastCrashRecovery < 10_000) return
      pane.lastCrashRecovery = now
      void wc.loadURL(pane.config.url)
    })
    wc.on('focus', () => {
      const index = this.panes.indexOf(pane)
      if (index >= 0) this.focused = index
    })

    wc.setWindowOpenHandler(({ url }) => {
      switch (classifyTarget(pane.config.url, url)) {
        case 'popup':
          // A real child window: OAuth popups must post back to window.opener.
          return { action: 'allow' }
        case 'in-pane':
          void wc.loadURL(url)
          return { action: 'deny' }
        default:
          void shell.openExternal(url)
          return { action: 'deny' }
      }
    })
    wc.on('will-navigate', (event, url) => {
      // Top-level navigations to the pane's own site or to an auth domain
      // proceed in place; only genuinely external sites are handed off.
      if (classifyTarget(pane.config.url, url) === 'external') {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
  }

  // ---- Layout ----

  private currentColumns(contentWidth: number): Column[] {
    const n = this.panes.length
    if (this.solo !== null) {
      return this.panes.map((_pane, i) =>
        i === this.solo ? { x: 0, width: contentWidth } : { x: 0, width: 0 },
      )
    }
    const usable = contentWidth - (n - 1) * DIVIDER_GAP
    const widths = computeFloatWidths(Math.max(0, usable), this.weights)
    return columnsFromWidths(widths, contentWidth)
  }

  layout(): void {
    const [width, height] = this.win.getContentSize()
    const y = CHROME_TOPBAR_HEIGHT
    const paneHeight = Math.max(0, height - CHROME_TOPBAR_HEIGHT)
    const columns = this.currentColumns(width)
    this.panes.forEach((pane, i) => {
      const col = columns[i]
      const visible = col.width > 0
      pane.view.setVisible(visible)
      if (visible) pane.view.setBounds({ x: col.x, y, width: col.width, height: paneHeight })
    })
    this.glass.setBounds({ x: 0, y: 0, width, height })
    this.pushLayoutState(columns)
  }

  private updateMinSize(): void {
    const n = this.panes.length
    const minWidth = n * MIN_PANE_WIDTH + (n - 1) * DIVIDER_GAP
    this.win.setMinimumSize(minWidth, MIN_WINDOW_HEIGHT)
    const [width, height] = this.win.getContentSize()
    if (width < minWidth) this.win.setContentSize(minWidth, Math.max(height, MIN_WINDOW_HEIGHT))
  }

  // ---- Divider drag ----

  beginDividerDrag(index: number): void {
    if (this.solo !== null) return
    if (index < 0 || index >= this.panes.length - 1) return
    this.draggingDivider = index
    // Re-append so the glass stays above panes created after it.
    this.win.contentView.removeChildView(this.glass)
    this.win.contentView.addChildView(this.glass)
    const [width, height] = this.win.getContentSize()
    this.glass.setBounds({ x: 0, y: 0, width, height })
    this.glass.setVisible(true)
    this.sendToChrome('divider:dragging', true)
  }

  setDivider(x: number): void {
    const d = this.draggingDivider
    if (d === null) return
    const [width] = this.win.getContentSize()
    const columns = this.currentColumns(width)
    const left = columns[d]
    const right = columns[d + 1]
    if (!left || !right) return
    const pairStart = left.x
    const pairEnd = right.x + right.width
    const pairWidth = pairEnd - pairStart
    const maxLeft = pairWidth - DIVIDER_GAP - MIN_PANE_WIDTH
    if (maxLeft < MIN_PANE_WIDTH) return
    const newLeft = Math.min(maxLeft, Math.max(MIN_PANE_WIDTH, x - pairStart - DIVIDER_GAP / 2))
    const newRight = pairWidth - DIVIDER_GAP - newLeft
    const mass = this.weights[d] + this.weights[d + 1]
    this.weights[d] = (mass * newLeft) / (newLeft + newRight)
    this.weights[d + 1] = mass - this.weights[d]
    this.layout()
  }

  commitDivider(x: number): void {
    this.setDivider(x)
    this.persistConfig()
  }

  endDividerDrag(): void {
    this.draggingDivider = null
    this.glass.setVisible(false)
    this.sendToChrome('divider:dragging', false)
    this.panes[this.focused]?.view.webContents.focus()
  }

  // ---- Pane set operations ----

  addPane(): void {
    const id = this.uniqueId()
    const config: PaneConfig = { id, label: `Pane ${this.panes.length + 1}`, url: 'https://claude.ai' }
    const pane = this.createPane(config)
    this.loadPane(pane)
    this.panes.push(pane)
    // Give the new pane an average share, then renormalize.
    const avg = this.weights.reduce((a, b) => a + b, 0) / this.weights.length
    this.weights.push(avg)
    this.weights = normalizeWeights(this.weights, this.panes.length)
    this.solo = null
    this.focused = this.panes.length - 1
    this.updateMinSize()
    this.layout()
    this.pushPanesState()
    this.persistConfig()
    pane.view.webContents.focus()
  }

  removePane(index: number): void {
    if (this.panes.length <= 1 || index < 0 || index >= this.panes.length) return
    const [removed] = this.panes.splice(index, 1)
    this.win.contentView.removeChildView(removed.view)
    removed.view.webContents.close()
    this.weights.splice(index, 1)
    this.weights = normalizeWeights(this.weights, this.panes.length)
    if (this.solo === index) this.solo = null
    else if (this.solo !== null && this.solo > index) this.solo -= 1
    if (this.focused >= this.panes.length) this.focused = this.panes.length - 1
    this.updateMinSize()
    this.layout()
    this.pushPanesState()
    this.persistConfig()
  }

  movePane(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (index < 0 || index >= this.panes.length || target < 0 || target >= this.panes.length) return
    ;[this.panes[index], this.panes[target]] = [this.panes[target], this.panes[index]]
    ;[this.weights[index], this.weights[target]] = [this.weights[target], this.weights[index]]
    if (this.focused === index) this.focused = target
    else if (this.focused === target) this.focused = index
    if (this.solo === index) this.solo = target
    else if (this.solo === target) this.solo = index
    this.layout()
    this.pushPanesState()
    this.persistConfig()
  }

  setSolo(index: number | null): void {
    if (index !== null && (index < 0 || index >= this.panes.length)) return
    this.solo = this.solo === index ? null : index
    if (this.solo !== null) this.focused = this.solo
    this.layout()
    this.panes[this.focused]?.view.webContents.focus()
  }

  equalize(): void {
    this.solo = null
    this.weights = this.panes.map(() => 1 / this.panes.length)
    this.layout()
    this.persistConfig()
  }

  private uniqueId(): string {
    const existing = new Set(this.panes.map((p) => p.config.id))
    let id = `pane-${Date.now()}`
    let suffix = 1
    while (existing.has(id)) id = `pane-${Date.now()}-${suffix++}`
    return id
  }

  // ---- Pane actions ----

  paneAction(action: PaneAction, index: number): void {
    const pane = this.panes[index]
    if (!pane) return
    const wc = pane.view.webContents
    switch (action) {
      case 'reload':
        // A pane whose initial load failed (e.g. launched offline) has no
        // URL to reload; retry the configured one instead.
        if (wc.getURL()) wc.reload()
        else void wc.loadURL(pane.config.url)
        break
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
        break
      case 'forward':
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
        break
      case 'focus':
        this.focusPane(index)
        break
      case 'open-external':
        void shell.openExternal(wc.getURL() || pane.config.url)
        break
    }
  }

  focusedPaneAction(action: PaneAction): void {
    this.paneAction(action, this.focused)
  }

  focusedIndex(): number {
    return this.focused
  }

  focusPane(index: number): void {
    if (index < 0 || index >= this.panes.length) return
    // A soloed-away pane must become visible before it can take focus.
    if (this.solo !== null && this.solo !== index) {
      this.solo = null
      this.layout()
    }
    this.focused = index
    this.panes[index].view.webContents.focus()
  }

  copyFocusedUrl(): void {
    const url = this.panes[this.focused]?.view.webContents.getURL()
    if (url) clipboard.writeText(url)
  }

  zoomFocused(change: 'in' | 'out' | 'reset'): void {
    const pane = this.panes[this.focused]
    if (!pane) return
    const wc = pane.view.webContents
    let level = 0
    if (change !== 'reset') {
      const delta = change === 'in' ? ZOOM_STEP : -ZOOM_STEP
      level = Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, wc.getZoomLevel() + delta))
    }
    wc.setZoomLevel(level)
    setZoom(pane.config.id, level)
  }

  async clearSession(id: string): Promise<void> {
    const pane = this.panes.find((p) => p.config.id === id)
    if (!pane) return
    const ses = pane.view.webContents.session
    await ses.clearStorageData()
    await ses.clearCache()
    void pane.view.webContents.loadURL(pane.config.url)
  }

  // ---- Config ----

  currentConfig(): AppConfig {
    return {
      panes: this.panes.map((pane) => pane.config),
      weights: this.weights.slice(),
    }
  }

  applyConfig(config: AppConfig): void {
    const existing = new Map<string, Pane>()
    for (const pane of this.panes) existing.set(pane.config.id, pane)
    const used = new Set<string>()
    const next: Pane[] = []
    for (const cfg of config.panes) {
      const reuse = existing.get(cfg.id)
      if (reuse && !used.has(cfg.id)) {
        used.add(cfg.id)
        const urlChanged = reuse.config.url !== cfg.url
        reuse.config = cfg
        if (urlChanged) void reuse.view.webContents.loadURL(cfg.url)
        next.push(reuse)
      } else {
        const pane = this.createPane(cfg)
        this.loadPane(pane)
        next.push(pane)
      }
    }
    for (const pane of this.panes) {
      if (!next.includes(pane)) {
        this.win.contentView.removeChildView(pane.view)
        pane.view.webContents.close()
      }
    }
    this.panes = next
    this.weights = normalizeWeights(config.weights, next.length)
    if (this.focused >= next.length) this.focused = next.length - 1
    if (this.solo !== null && this.solo >= next.length) this.solo = null
    this.updateMinSize()
    this.layout()
    this.pushPanesState()
  }

  private persistConfig(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      saveConfig(this.currentConfig())
    }, 250)
  }

  /** Write any pending config change immediately (call on quit). */
  flushConfig(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      saveConfig(this.currentConfig())
    }
  }

  // ---- State push ----

  private paneState(pane: Pane, index: number): PaneState {
    const wc = pane.view.webContents
    return {
      index,
      id: pane.config.id,
      label: pane.config.label,
      title: wc.isDestroyed() ? pane.config.label : wc.getTitle() || pane.config.label,
      faviconUrl: pane.faviconUrl,
      currentUrl: wc.isDestroyed() ? '' : wc.getURL(),
      canGoBack: !wc.isDestroyed() && wc.navigationHistory.canGoBack(),
      canGoForward: !wc.isDestroyed() && wc.navigationHistory.canGoForward(),
      loading: !wc.isDestroyed() && wc.isLoading(),
    }
  }

  private pushPanesState(): void {
    const states = this.panes.map((pane, i) => this.paneState(pane, i))
    this.sendToChrome('panes:state', states)
  }

  private pushLayoutState(columns?: Column[]): void {
    const cols = columns ?? this.currentColumns(this.win.getContentSize()[0])
    const state: LayoutState = {
      columns: cols,
      gap: DIVIDER_GAP,
      topbar: CHROME_TOPBAR_HEIGHT,
      solo: this.solo,
      focused: this.focused,
    }
    this.sendToChrome('layout:state', state)
  }

  private sendToChrome<C extends keyof MainSendMap>(channel: C, ...args: MainSendMap[C]): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, ...args)
  }
}
