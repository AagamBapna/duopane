// NOTE: sandboxed preload — must stay a single bundled file with no shared
// runtime imports (see chrome.ts).
import { contextBridge, ipcRenderer } from 'electron'
import type { RendererInvokeMap, SettingsApi } from '../shared/types'

function invoke<C extends keyof RendererInvokeMap>(
  channel: C,
  ...args: RendererInvokeMap[C]['args']
): Promise<RendererInvokeMap[C]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<RendererInvokeMap[C]['result']>
}

const api: SettingsApi = {
  getConfig: () => invoke('config:get'),
  save: (config) => invoke('config:save', config),
  close: () => ipcRenderer.send('settings:close'),
}

contextBridge.exposeInMainWorld('settingsApi', api)
