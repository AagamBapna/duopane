import { BrowserWindow, Menu, app } from 'electron'
import type { PaneManager } from './panes'
import { openSettingsWindow } from './settings-window'

export function buildMenu(pm: PaneManager, win: BrowserWindow): void {
  const focusShortcuts: Electron.MenuItemConstructorOptions[] = []
  for (let i = 0; i < 9; i++) {
    focusShortcuts.push({
      label: `Focus Pane ${i + 1}`,
      accelerator: `Cmd+${i + 1}`,
      click: () => pm.focusPane(i),
    })
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => openSettingsWindow(win) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload Pane', accelerator: 'Cmd+R', click: () => pm.focusedPaneAction('reload') },
        { label: 'Back', accelerator: 'Cmd+[', click: () => pm.focusedPaneAction('back') },
        { label: 'Forward', accelerator: 'Cmd+]', click: () => pm.focusedPaneAction('forward') },
        { type: 'separator' },
        { label: 'Copy Current URL', accelerator: 'Cmd+Shift+C', click: () => pm.copyFocusedUrl() },
        { label: 'Open in Browser', click: () => pm.focusedPaneAction('open-external') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CommandOrControl+=', click: () => pm.zoomFocused('in') },
        { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: () => pm.zoomFocused('out') },
        { label: 'Actual Size', click: () => pm.zoomFocused('reset') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Panes',
      submenu: [
        { label: 'New Pane', accelerator: 'Cmd+T', click: () => pm.addPane() },
        { label: 'Close Pane', accelerator: 'Cmd+Shift+W', click: () => pm.removePane(pm.focusedIndex()) },
        { type: 'separator' },
        ...focusShortcuts,
        { type: 'separator' },
        {
          label: 'Move Pane Left',
          accelerator: 'Cmd+Shift+[',
          click: () => pm.movePane(pm.focusedIndex(), -1),
        },
        {
          label: 'Move Pane Right',
          accelerator: 'Cmd+Shift+]',
          click: () => pm.movePane(pm.focusedIndex(), 1),
        },
        { type: 'separator' },
        { label: 'Show Only This Pane', click: () => pm.setSolo(pm.focusedIndex()) },
        { label: 'Equalize / Show All', accelerator: 'Cmd+0', click: () => pm.equalize() },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
