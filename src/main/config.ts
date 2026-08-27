import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppConfig, PaneConfig } from '../shared/types'

export const DEFAULT_CONFIG: AppConfig = {
  panes: [
    { id: 'claude', label: 'Claude', url: 'https://claude.ai' },
    { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app' },
  ],
  weights: [0.5, 0.5],
}

export const PANE_ID_PATTERN = /^[A-Za-z0-9._-]+$/

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function isPaneConfig(value: unknown): value is PaneConfig {
  if (typeof value !== 'object' || value === null) return false
  const pane = value as Record<string, unknown>
  return (
    typeof pane.id === 'string' &&
    PANE_ID_PATTERN.test(pane.id) &&
    typeof pane.label === 'string' &&
    typeof pane.url === 'string' &&
    isValidUrl(pane.url)
  )
}

/** Coerce any weights array to positive numbers summing to 1, one per pane. */
export function normalizeWeights(weights: unknown, count: number): number[] {
  const raw = Array.isArray(weights) ? weights : []
  const cleaned: number[] = []
  for (let i = 0; i < count; i++) {
    const w = raw[i]
    cleaned.push(typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 1)
  }
  const sum = cleaned.reduce((a, b) => a + b, 0)
  return cleaned.map((w) => w / sum)
}

export function loadConfig(): AppConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as unknown
    if (typeof raw === 'object' && raw !== null) {
      const candidate = raw as Record<string, unknown>
      const panes = candidate.panes
      if (Array.isArray(panes) && panes.length >= 1 && panes.every(isPaneConfig)) {
        // v1 config stored a single dividerRatio for exactly two panes.
        let weightsSource: unknown = candidate.weights
        if (weightsSource === undefined && typeof candidate.dividerRatio === 'number') {
          const r = candidate.dividerRatio
          if (panes.length === 2 && r > 0 && r < 1) weightsSource = [r, 1 - r]
        }
        // Reject duplicate ids (session partitions must be distinct).
        const ids = new Set(panes.map((p) => p.id))
        if (ids.size === panes.length) {
          return { panes, weights: normalizeWeights(weightsSource, panes.length) }
        }
      }
    }
  } catch {
    // Missing or corrupt config falls through to defaults.
  }
  return structuredClone(DEFAULT_CONFIG)
}

export function saveConfig(config: AppConfig): void {
  const file = configPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8')
}
