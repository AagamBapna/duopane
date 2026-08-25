import { BrowserWindow } from 'electron'
import { join } from 'node:path'

let settingsWin: BrowserWindow | null = null

export function openSettingsWindow(parent: BrowserWindow): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus()
    return
  }
  settingsWin = new BrowserWindow({
    width: 540,
    height: 470,
    parent,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Settings',
    webPreferences: {
      preload: join(__dirname, '../preload/settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  settingsWin.on('closed', () => {
    settingsWin = null
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void settingsWin.loadURL(`${devUrl}/settings.html`)
  } else {
    void settingsWin.loadFile(join(__dirname, '../renderer/settings.html'))
  }
}

export function closeSettingsWindow(): void {
  settingsWin?.close()
}
