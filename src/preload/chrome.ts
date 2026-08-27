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
  dragStart: (index) => send('divider:drag-start', index),
  setDivider: (x) => send('divider:set', x),
  commitDivider: (x) => send('divider:commit', x),
  dragEnd: () => send('divider:drag-end'),
  paneAction: (action, index) => send('pane:action', action, index),
  addPane: () => send('pane:add'),
  removePane: (index) => send('pane:remove', index),
  movePane: (index, direction) => send('pane:move', index, direction),
  solo: (index) => send('pane:solo', index),
  equalize: () => send('layout:equalize'),
  openSettings: () => send('settings:open'),
  onPanesState: (cb) => on('panes:state', cb),
  onLayoutState: (cb) => on('layout:state', cb),
  onDividerDragging: (cb) => on('divider:dragging', cb),
}

contextBridge.exposeInMainWorld('chromeApi', api)
