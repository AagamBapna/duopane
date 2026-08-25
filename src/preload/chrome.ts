import { contextBridge } from 'electron'
import type { ChromeApi } from '../shared/types'
import { invoke, on, send } from './ipc'

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
