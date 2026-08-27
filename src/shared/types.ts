// Shared IPC contract and config types, imported by main, preload, and renderer.
// The app supports N panes (>= 1) laid out left-to-right with N-1 dividers.

export interface PaneConfig {
  /** Stable identifier; also namespaces the pane's persistent session partition. */
  id: string
  label: string
  url: string
}

export interface AppConfig {
  /** One or more panes, in left-to-right order. */
  panes: PaneConfig[]
  /** Proportional widths, same length as panes, normalized to sum 1. */
  weights: number[]
}

export interface PaneState {
  index: number
  id: string
  label: string
  title: string
  faviconUrl: string
  currentUrl: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

/** A pane's on-screen rectangle in CSS pixels (x from the window's left edge). */
export interface Column {
  x: number
  width: number
}

export interface LayoutState {
  columns: Column[]
  gap: number
  topbar: number
  /** When non-null, only this pane index is shown full-width. */
  solo: number | null
  focused: number
}

export type PaneAction = 'reload' | 'back' | 'forward' | 'focus' | 'open-external'

export interface SaveConfigResult {
  ok: boolean
  error?: string
}

/** Channels sent renderer -> main via ipcRenderer.send. Payload tuple per channel. */
export interface RendererSendMap {
  // Divider drag: drag-start names which divider (index d sits between pane d
  // and d+1); set/commit carry the cursor x in CSS px and apply to that divider.
  'divider:drag-start': [index: number]
  'divider:set': [x: number]
  'divider:commit': [x: number]
  'divider:drag-end': []
  'pane:action': [action: PaneAction, index: number]
  'pane:add': []
  'pane:remove': [index: number]
  'pane:move': [index: number, direction: -1 | 1]
  'pane:solo': [index: number | null]
  'layout:equalize': []
  'settings:open': []
  'settings:close': []
}

/** Channels invoked renderer -> main via ipcRenderer.invoke. */
export interface RendererInvokeMap {
  'config:get': { args: []; result: AppConfig }
  'config:save': { args: [config: AppConfig]; result: SaveConfigResult }
  'session:clear': { args: [id: string]; result: SaveConfigResult }
}

/** Channels sent main -> chrome renderer via webContents.send. */
export interface MainSendMap {
  'panes:state': [states: PaneState[]]
  'layout:state': [state: LayoutState]
  'divider:dragging': [active: boolean]
}

/** API exposed to the chrome renderer (and drag glass) via contextBridge. */
export interface ChromeApi {
  getConfig(): Promise<AppConfig>
  dragStart(index: number): void
  setDivider(x: number): void
  commitDivider(x: number): void
  dragEnd(): void
  paneAction(action: PaneAction, index: number): void
  addPane(): void
  removePane(index: number): void
  movePane(index: number, direction: -1 | 1): void
  solo(index: number | null): void
  equalize(): void
  openSettings(): void
  onPanesState(cb: (states: PaneState[]) => void): void
  onLayoutState(cb: (state: LayoutState) => void): void
  onDividerDragging(cb: (active: boolean) => void): void
}

/** API exposed to the settings renderer via contextBridge. */
export interface SettingsApi {
  getConfig(): Promise<AppConfig>
  save(config: AppConfig): Promise<SaveConfigResult>
  clearSession(id: string): Promise<SaveConfigResult>
  close(): void
}

// Layout constants shared by main-process geometry and renderer CSS/drag math.
// CHROME_TOPBAR_HEIGHT must match --topbar-h in src/renderer/src/style.css.
export const CHROME_TOPBAR_HEIGHT = 40
export const DIVIDER_GAP = 9
export const MIN_PANE_WIDTH = 320
