import type { AppConfig, PaneConfig } from '../../shared/types'

const api = window.settingsApi

function input(id: string): HTMLInputElement {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLInputElement)) throw new Error(`missing input #${id}`)
  return el
}

const form = document.getElementById('form') as HTMLFormElement
const errorEl = document.getElementById('error') as HTMLParagraphElement

let dividerRatio = 0.5

function readPane(index: 0 | 1): PaneConfig {
  return {
    id: input(`id-${index}`).value.trim(),
    label: input(`label-${index}`).value.trim(),
    url: input(`url-${index}`).value.trim(),
  }
}

function fillPane(index: 0 | 1, pane: PaneConfig): void {
  input(`id-${index}`).value = pane.id
  input(`label-${index}`).value = pane.label
  input(`url-${index}`).value = pane.url
}

async function load(): Promise<void> {
  const config = await api.getConfig()
  dividerRatio = config.dividerRatio
  fillPane(0, config.panes[0])
  fillPane(1, config.panes[1])
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const config: AppConfig = { panes: [readPane(0), readPane(1)], dividerRatio }
  void api.save(config).then((result) => {
    if (result.ok) {
      api.close()
    } else {
      errorEl.textContent = result.error ?? 'Could not save settings.'
    }
  })
})

document.getElementById('cancel')?.addEventListener('click', () => api.close())

void load()
