// NOTE: this preload runs in a sandboxed renderer, which only supports a
// single bundled file — it must not import runtime code from other modules,
// or the bundler emits a shared chunk that require() cannot load there.
import { contextBridge, ipcRenderer } from 'electron'
import type { ChromeApi, MainSendMap, RendererInvokeMap, RendererSendMap } from '../shared/types'

function send<C extends keyof RendererSendMap>(channel: C, ...args: RendererSendMap[C]): void {
  ipcRenderer.send(channel, ...args)
}

function invoke<C extends keyof RendererInvokeMap>(
  channel: C,
  ...args: RendererInvokeMap[C]['args']
): Promise<RendererInvokeMap[C]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<RendererInvokeMap[C]['result']>
}

function on<C extends keyof MainSendMap>(
  channel: C,
  listener: (...args: MainSendMap[C]) => void,
): void {
  ipcRenderer.on(channel, (_event, ...args) => listener(...(args as MainSendMap[C])))
}

const api: ChromeApi = {
  getConfig: () => invoke('config:get'),
  setRatio: (ratio) => send('divider:set-ratio', ratio),
  commitRatio: (ratio) => send('divider:commit', ratio),
  dragStart: () => send('divider:drag-start'),
  dragEnd: () => send('divider:drag-end'),
  paneAction: (action, slot) => send('pane:action', action, slot),
  swap: () => send('layout:swap'),
  collapse: (slot) => send('layout:collapse', slot),
  openSettings: () => send('settings:open'),
  onPaneState: (cb) => on('pane:state', cb),
  onLayoutState: (cb) => on('layout:state', cb),
  onDividerDragging: (cb) => on('divider:dragging', cb),
}

contextBridge.exposeInMainWorld('chromeApi', api)
