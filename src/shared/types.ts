// Shared IPC contract and config types, imported by main, preload, and renderer.

export type PaneSlot = 'left' | 'right'

export interface PaneConfig {
  /** Stable identifier; also namespaces the pane's persistent session partition. */
  id: string
  label: string
  url: string
}

export interface AppConfig {
  panes: [PaneConfig, PaneConfig]
  dividerRatio: number
}

export interface PaneState {
  slot: PaneSlot
  label: string
  title: string
  faviconUrl: string
  currentUrl: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

export interface LayoutState {
  ratio: number
  collapsed: PaneSlot | null
}

export type PaneAction = 'reload' | 'back' | 'forward' | 'focus' | 'open-external'

export interface SaveConfigResult {
  ok: boolean
  error?: string
}

/** Channels sent renderer -> main via ipcRenderer.send. Payload tuple per channel. */
export interface RendererSendMap {
  'divider:set-ratio': [ratio: number]
  'divider:commit': [ratio: number]
  'divider:drag-start': []
  'divider:drag-end': []
  'pane:action': [action: PaneAction, slot: PaneSlot]
  'layout:swap': []
  'layout:collapse': [slot: PaneSlot | null]
  'settings:open': []
  'settings:close': []
}

/** Channels invoked renderer -> main via ipcRenderer.invoke. */
export interface RendererInvokeMap {
  'config:get': { args: []; result: AppConfig }
  'config:save': { args: [config: AppConfig]; result: SaveConfigResult }
}

/** Channels sent main -> chrome renderer via webContents.send. */
export interface MainSendMap {
  'pane:state': [state: PaneState]
  'layout:state': [state: LayoutState]
  'divider:dragging': [active: boolean]
}

/** API exposed to the chrome renderer (and drag glass) via contextBridge. */
export interface ChromeApi {
  getConfig(): Promise<AppConfig>
  setRatio(ratio: number): void
  commitRatio(ratio: number): void
  dragStart(): void
  dragEnd(): void
  paneAction(action: PaneAction, slot: PaneSlot): void
  swap(): void
  collapse(slot: PaneSlot | null): void
  openSettings(): void
  onPaneState(cb: (state: PaneState) => void): void
  onLayoutState(cb: (state: LayoutState) => void): void
  onDividerDragging(cb: (active: boolean) => void): void
}

/** API exposed to the settings renderer via contextBridge. */
export interface SettingsApi {
  getConfig(): Promise<AppConfig>
  save(config: AppConfig): Promise<SaveConfigResult>
  close(): void
}

// Layout constants shared by main-process geometry and renderer CSS/drag math.
// CHROME_TOPBAR_HEIGHT must match --topbar-h in src/renderer/src/style.css.
export const CHROME_TOPBAR_HEIGHT = 40
export const DIVIDER_GAP = 9
export const MIN_PANE_WIDTH = 320
export const SNAP_THRESHOLD = 0.03
