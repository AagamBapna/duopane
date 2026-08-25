import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppConfig, PaneConfig } from '../shared/types'

export const DEFAULT_CONFIG: AppConfig = {
  panes: [
    { id: 'claude', label: 'Claude', url: 'https://claude.ai' },
    { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app' },
  ],
  dividerRatio: 0.5,
}

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
    pane.id.length > 0 &&
    typeof pane.label === 'string' &&
    typeof pane.url === 'string' &&
    isValidUrl(pane.url)
  )
}

export function loadConfig(): AppConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as unknown
    if (typeof raw === 'object' && raw !== null) {
      const candidate = raw as Record<string, unknown>
      const panes = candidate.panes
      if (Array.isArray(panes) && panes.length === 2 && panes.every(isPaneConfig)) {
        const ratio = candidate.dividerRatio
        return {
          panes: [panes[0], panes[1]],
          dividerRatio: typeof ratio === 'number' && ratio > 0 && ratio < 1 ? ratio : 0.5,
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
