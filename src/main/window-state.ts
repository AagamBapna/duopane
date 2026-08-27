import { app, screen } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Persists window geometry and per-pane zoom to userData/window-state.json,
// kept separate from config.json so it never risks the pane configuration.

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface WindowState {
  bounds?: Bounds
  zoom: Record<string, number>
}

let state: WindowState = { zoom: {} }
let loaded = false
let saveTimer: NodeJS.Timeout | null = null

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8')) as unknown
    if (raw === null || typeof raw !== 'object') return
    const candidate = raw as Record<string, unknown>
    const zoom: Record<string, number> = {}
    if (candidate.zoom !== null && typeof candidate.zoom === 'object') {
      for (const [key, value] of Object.entries(candidate.zoom as Record<string, unknown>)) {
        if (isNumber(value)) zoom[key] = value
      }
    }
    state = { zoom }
    const b = candidate.bounds
    if (b !== null && typeof b === 'object') {
      const bb = b as Record<string, unknown>
      if (isNumber(bb.x) && isNumber(bb.y) && isNumber(bb.width) && isNumber(bb.height)) {
        state.bounds = { x: bb.x, y: bb.y, width: bb.width, height: bb.height }
      }
    }
  } catch {
    // Missing or corrupt state file falls through to defaults.
  }
}

function writeNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  try {
    const file = statePath()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8')
  } catch {
    // Best-effort; losing window state is not worth crashing over.
  }
}

function persist(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(writeNow, 300)
}

/** Flush any pending write immediately (call on quit). */
export function flushWindowState(): void {
  if (loaded) writeNow()
}

/** Saved bounds, but only if they still intersect a connected display. */
export function savedBounds(): Bounds | null {
  ensureLoaded()
  const b = state.bounds
  if (!b) return null
  const visible = screen.getAllDisplays().some((display) => {
    const wa = display.workArea
    return (
      b.x < wa.x + wa.width && b.x + b.width > wa.x && b.y < wa.y + wa.height && b.y + b.height > wa.y
    )
  })
  return visible ? b : null
}

export function saveBounds(bounds: Bounds): void {
  ensureLoaded()
  state.bounds = bounds
  persist()
}

export function getZoom(paneId: string): number {
  ensureLoaded()
  return state.zoom[paneId] ?? 0
}

export function setZoom(paneId: string, level: number): void {
  ensureLoaded()
  state.zoom[paneId] = level
  persist()
}
