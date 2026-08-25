import { BrowserWindow, ipcMain } from 'electron'
import type { AppConfig, RendererInvokeMap, RendererSendMap, SaveConfigResult } from '../shared/types'
import { isValidUrl, saveConfig } from './config'
import type { PaneManager } from './panes'
import { closeSettingsWindow, openSettingsWindow } from './settings-window'

function onSend<C extends keyof RendererSendMap>(
  channel: C,
  listener: (...args: RendererSendMap[C]) => void,
): void {
  ipcMain.on(channel, (_event, ...args) => listener(...(args as RendererSendMap[C])))
}

function onInvoke<C extends keyof RendererInvokeMap>(
  channel: C,
  handler: (...args: RendererInvokeMap[C]['args']) => RendererInvokeMap[C]['result'],
): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as RendererInvokeMap[C]['args'])))
}

function sanitizeConfig(input: AppConfig, dividerRatio: number): AppConfig | string {
  const panes = [input.panes[0], input.panes[1]].map((pane) => ({
    id: String(pane.id ?? '').trim(),
    label: String(pane.label ?? '').trim(),
    url: String(pane.url ?? '').trim(),
  }))
  for (const pane of panes) {
    if (!pane.id) return 'Pane ids must not be empty.'
    // The id becomes a session partition (a profile directory name).
    if (!/^[A-Za-z0-9._-]+$/.test(pane.id))
      return 'Pane ids may only contain letters, digits, ".", "_" and "-".'
    if (!pane.label) return 'Pane labels must not be empty.'
    if (!isValidUrl(pane.url)) return `Not a valid http(s) URL: "${pane.url}"`
  }
  if (panes[0].id === panes[1].id) return 'Pane ids must be distinct.'
  return { panes: [panes[0], panes[1]], dividerRatio }
}

export function registerIpc(pm: PaneManager, win: BrowserWindow): void {
  onSend('divider:set-ratio', (ratio) => pm.setRatio(ratio))
  onSend('divider:commit', (ratio) => pm.commitRatio(ratio))
  onSend('divider:drag-start', () => pm.beginDividerDrag())
  onSend('divider:drag-end', () => pm.endDividerDrag())
  onSend('pane:action', (action, slot) => pm.paneAction(action, slot))
  onSend('layout:swap', () => pm.swap())
  onSend('layout:collapse', (slot) => pm.collapse(slot))
  onSend('settings:open', () => openSettingsWindow(win))
  onSend('settings:close', () => closeSettingsWindow())

  onInvoke('config:get', () => pm.currentConfig())
  onInvoke('config:save', (config): SaveConfigResult => {
    const clean = sanitizeConfig(config, pm.currentConfig().dividerRatio)
    if (typeof clean === 'string') return { ok: false, error: clean }
    saveConfig(clean)
    pm.applyConfig(clean)
    return { ok: true }
  })
}
