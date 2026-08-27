import { BrowserWindow, ipcMain } from 'electron'
import type { AppConfig, RendererInvokeMap, RendererSendMap, SaveConfigResult } from '../shared/types'
import { PANE_ID_PATTERN, isValidUrl, normalizeWeights, saveConfig } from './config'
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
  handler: (
    ...args: RendererInvokeMap[C]['args']
  ) => RendererInvokeMap[C]['result'] | Promise<RendererInvokeMap[C]['result']>,
): void {
  ipcMain.handle(channel, (_event, ...args) => handler(...(args as RendererInvokeMap[C]['args'])))
}

function sanitizeConfig(input: AppConfig): AppConfig | string {
  if (!Array.isArray(input.panes) || input.panes.length < 1) {
    return 'There must be at least one pane.'
  }
  const panes = input.panes.map((pane) => ({
    id: String(pane.id ?? '').trim(),
    label: String(pane.label ?? '').trim(),
    url: String(pane.url ?? '').trim(),
  }))
  const seen = new Set<string>()
  for (const pane of panes) {
    if (!pane.id) return 'Pane ids must not be empty.'
    // The id becomes a session partition (a profile directory name).
    if (!PANE_ID_PATTERN.test(pane.id))
      return 'Pane ids may only contain letters, digits, ".", "_" and "-".'
    if (seen.has(pane.id)) return `Duplicate pane id: "${pane.id}".`
    seen.add(pane.id)
    if (!pane.label) return 'Pane labels must not be empty.'
    if (!isValidUrl(pane.url)) return `Not a valid http(s) URL: "${pane.url}"`
  }
  return { panes, weights: normalizeWeights(input.weights, panes.length) }
}

export function registerIpc(pm: PaneManager, win: BrowserWindow): void {
  onSend('divider:drag-start', (index) => pm.beginDividerDrag(index))
  onSend('divider:set', (x) => pm.setDivider(x))
  onSend('divider:commit', (x) => pm.commitDivider(x))
  onSend('divider:drag-end', () => pm.endDividerDrag())
  onSend('pane:action', (action, index) => pm.paneAction(action, index))
  onSend('pane:add', () => pm.addPane())
  onSend('pane:remove', (index) => pm.removePane(index))
  onSend('pane:move', (index, direction) => pm.movePane(index, direction))
  onSend('pane:solo', (index) => pm.setSolo(index))
  onSend('layout:equalize', () => pm.equalize())
  onSend('settings:open', () => openSettingsWindow(win))
  onSend('settings:close', () => closeSettingsWindow())

  onInvoke('config:get', () => pm.currentConfig())
  onInvoke('config:save', (config): SaveConfigResult => {
    const clean = sanitizeConfig(config)
    if (typeof clean === 'string') return { ok: false, error: clean }
    saveConfig(clean)
    pm.applyConfig(clean)
    return { ok: true }
  })
  onInvoke('session:clear', async (id): Promise<SaveConfigResult> => {
    try {
      await pm.clearSession(id)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not clear session.' }
    }
  })
}
