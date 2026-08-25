import { BrowserWindow, app } from 'electron'
import { join } from 'node:path'
import { CHROME_TOPBAR_HEIGHT, DIVIDER_GAP, MIN_PANE_WIDTH } from '../shared/types'
import { loadConfig } from './config'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { PaneManager } from './panes'

// Must run before 'ready' so userData (and the config file) lands under
// ~/Library/Application Support/DuoPane even in dev.
app.setName('DuoPane')

let mainWin: BrowserWindow | null = null

function createWindow(): void {
  const config = loadConfig()
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: MIN_PANE_WIDTH * 2 + DIVIDER_GAP,
    minHeight: CHROME_TOPBAR_HEIGHT + 400,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'sidebar',
    title: 'DuoPane',
    webPreferences: {
      preload: join(__dirname, '../preload/chrome.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const pm = new PaneManager(win, config)
  registerIpc(pm, win)
  buildMenu(pm, win)
  mainWin = win
  win.on('closed', () => {
    mainWin = null
  })
}

// Two instances would share the same persist: partitions and corrupt the
// session profiles, so hand off to the running instance instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.focus()
    }
  })
  void app.whenReady().then(createWindow)
}

app.on('window-all-closed', () => {
  app.quit()
})
