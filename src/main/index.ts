import { BrowserWindow, app, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CHROME_TOPBAR_HEIGHT, DIVIDER_GAP, MIN_PANE_WIDTH } from '../shared/types'
import { loadConfig } from './config'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import type { PaneManager as PaneManagerType } from './panes'
import { PaneManager } from './panes'
import { flushWindowState, saveBounds, savedBounds } from './window-state'

// Must run before 'ready' so userData (and the config file) lands under
// ~/Library/Application Support/DuoPane even in dev.
app.setName('DuoPane')

// In a packaged build the icon comes from the bundle; in dev the process is
// generic Electron, so point the dock at the source icon when it exists.
function setDevDockIcon(): void {
  if (app.isPackaged || !app.dock) return
  const iconPath = join(__dirname, '../../build/icon-1024.png')
  if (!existsSync(iconPath)) return
  const image = nativeImage.createFromPath(iconPath)
  if (!image.isEmpty()) app.dock.setIcon(image)
}

let mainWin: BrowserWindow | null = null
let paneManager: PaneManagerType | null = null

function createWindow(): void {
  const config = loadConfig()
  const restored = savedBounds()
  const win = new BrowserWindow({
    width: restored?.width ?? 1440,
    height: restored?.height ?? 900,
    ...(restored ? { x: restored.x, y: restored.y } : {}),
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

  // getNormalBounds ignores a maximized/fullscreen frame, so a restore always
  // reopens at the last user-sized geometry.
  const rememberBounds = (): void => saveBounds(win.getNormalBounds())
  win.on('resize', rememberBounds)
  win.on('move', rememberBounds)
  // 'close' runs after 'before-quit', so flush here or the final geometry is
  // lost on quit.
  win.on('close', () => {
    saveBounds(win.getNormalBounds())
    flushWindowState()
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
  paneManager = pm
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
  void app.whenReady().then(() => {
    setDevDockIcon()
    createWindow()
  })
}

app.on('before-quit', () => {
  paneManager?.flushConfig()
  flushWindowState()
})

app.on('window-all-closed', () => {
  app.quit()
})
