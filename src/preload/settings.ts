import { contextBridge } from 'electron'
import type { SettingsApi } from '../shared/types'
import { invoke, send } from './ipc'

const api: SettingsApi = {
  getConfig: () => invoke('config:get'),
  save: (config) => invoke('config:save', config),
  close: () => send('settings:close'),
}

contextBridge.exposeInMainWorld('settingsApi', api)
