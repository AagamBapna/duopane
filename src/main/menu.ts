import { BrowserWindow, Menu, app } from 'electron'
import type { PaneManager } from './panes'
import { openSettingsWindow } from './settings-window'

export function buildMenu(pm: PaneManager, win: BrowserWindow): void {
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
        {
          label: 'Open in Browser',
          click: () => pm.focusedPaneAction('open-external'),
        },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CommandOrControl+=', click: () => pm.zoomFocused('in') },
        { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: () => pm.zoomFocused('out') },
        // Cmd+0 is Reset Split; Actual Size stays menu-only to avoid the clash.
        { label: 'Actual Size', click: () => pm.zoomFocused('reset') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Panes',
      submenu: [
        { label: 'Focus Left Pane', accelerator: 'Cmd+1', click: () => pm.focusPane('left') },
        { label: 'Focus Right Pane', accelerator: 'Cmd+2', click: () => pm.focusPane('right') },
        { type: 'separator' },
        { label: 'Swap Panes', accelerator: 'Cmd+\\', click: () => pm.swap() },
        { label: 'Reset Split 50/50', accelerator: 'Cmd+0', click: () => pm.resetSplit() },
        { type: 'separator' },
        { label: 'Collapse Left', click: () => pm.collapse('left') },
        { label: 'Collapse Right', click: () => pm.collapse('right') },
        { label: 'Show Both', click: () => pm.collapse(null) },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
