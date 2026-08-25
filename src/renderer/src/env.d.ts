import type { ChromeApi, SettingsApi } from '../../shared/types'

declare global {
  interface Window {
    chromeApi: ChromeApi
    settingsApi: SettingsApi
  }
}

export {}
