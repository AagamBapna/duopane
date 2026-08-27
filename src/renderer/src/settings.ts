import type { AppConfig } from '../../shared/types'

const api = window.settingsApi

interface Row {
  /** The id this pane had when settings opened; null for a newly added row. */
  originalId: string | null
  id: string
  label: string
  url: string
  weight: number
}

let rows: Row[] = []

const panesEl = document.getElementById('panes') as HTMLDivElement
const errorEl = document.getElementById('error') as HTMLParagraphElement

function field(labelText: string, value: string, onInput: (v: string) => void): HTMLElement[] {
  const label = document.createElement('label')
  label.textContent = labelText
  const inp = document.createElement('input')
  inp.spellcheck = false
  inp.value = value
  inp.addEventListener('input', () => onInput(inp.value))
  return [label, inp]
}

function iconButton(text: string, title: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'icon-btn'
  b.textContent = text
  b.title = title
  b.disabled = disabled
  b.addEventListener('click', onClick)
  return b
}

function render(): void {
  panesEl.replaceChildren()
  rows.forEach((row, index) => {
    const card = document.createElement('div')
    card.className = 'pane'

    const head = document.createElement('div')
    head.className = 'pane-head'
    const num = document.createElement('span')
    num.className = 'num'
    num.textContent = `Pane ${index + 1}`
    head.appendChild(num)
    head.appendChild(iconButton('↑', 'Move up', () => move(index, -1), index === 0))
    head.appendChild(iconButton('↓', 'Move down', () => move(index, 1), index === rows.length - 1))
    head.appendChild(iconButton('✕', 'Remove pane', () => remove(index), rows.length <= 1))
    card.appendChild(head)

    const grid = document.createElement('div')
    grid.className = 'grid'
    grid.append(...field('Label', row.label, (v) => (row.label = v)))
    grid.append(...field('URL', row.url, (v) => (row.url = v)))
    grid.append(...field('ID', row.id, (v) => (row.id = v)))

    const sessionRow = document.createElement('div')
    sessionRow.className = 'session-row'
    const status = document.createElement('span')
    status.className = 'session-status'
    const clearBtn = iconButton(
      'Clear session',
      'Wipe cookies and storage for this pane',
      () => {
        if (!row.originalId) return
        clearBtn.disabled = true
        status.textContent = 'Clearing…'
        void api.clearSession(row.originalId).then((result) => {
          clearBtn.disabled = false
          status.textContent = result.ok ? 'Cleared ✓' : (result.error ?? 'Failed')
        })
      },
      row.originalId === null,
    )
    if (row.originalId === null) status.textContent = 'Save first to create this session'
    sessionRow.append(clearBtn, status)
    grid.appendChild(sessionRow)

    card.appendChild(grid)
    panesEl.appendChild(card)
  })
}

function move(index: number, dir: -1 | 1): void {
  const target = index + dir
  if (target < 0 || target >= rows.length) return
  ;[rows[index], rows[target]] = [rows[target], rows[index]]
  render()
}

function remove(index: number): void {
  if (rows.length <= 1) return
  rows.splice(index, 1)
  render()
}

function add(): void {
  const avg = rows.length ? rows.reduce((a, r) => a + r.weight, 0) / rows.length : 1
  rows.push({ originalId: null, id: '', label: 'New Pane', url: 'https://claude.ai', weight: avg })
  render()
}

async function loadConfig(): Promise<void> {
  const config = await api.getConfig()
  rows = config.panes.map((pane, i) => ({
    originalId: pane.id,
    id: pane.id,
    label: pane.label,
    url: pane.url,
    weight: config.weights[i] ?? 1,
  }))
  render()
}

document.getElementById('add')?.addEventListener('click', add)
document.getElementById('cancel')?.addEventListener('click', () => api.close())
document.getElementById('save')?.addEventListener('click', () => {
  const config: AppConfig = {
    panes: rows.map((r) => ({ id: r.id.trim(), label: r.label.trim(), url: r.url.trim() })),
    weights: rows.map((r) => r.weight),
  }
  void api.save(config).then((result) => {
    if (result.ok) api.close()
    else errorEl.textContent = result.error ?? 'Could not save settings.'
  })
})

void loadConfig()
