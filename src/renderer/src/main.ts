import type { LayoutState, PaneState } from '../../shared/types'

const api = window.chromeApi

// Leaves room for the macOS traffic lights and the global controls so pane
// clusters never slide under them.
const TRAFFIC_INSET = 88
const GLOBAL_RESERVE = 118

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing element #${id}`)
  return el as T
}

const paneBar = byId<HTMLDivElement>('pane-bar')
const dividersEl = byId<HTMLDivElement>('dividers')

let paneStates: PaneState[] = []
let layout: LayoutState | null = null

// ---- Divider drag ----
// The strip only receives pointer events over renderer-owned pixels; on
// pointerdown the main process raises a transparent full-window glass view
// (see glass.ts) that carries the rest of the drag.
let dragging = false
let rafHandle = 0
let pendingX = 0

function scheduleSet(x: number): void {
  pendingX = x
  if (!rafHandle) {
    rafHandle = requestAnimationFrame(() => {
      rafHandle = 0
      api.setDivider(pendingX)
    })
  }
}

window.addEventListener('pointermove', (event) => {
  if (dragging) scheduleSet(event.clientX)
})
window.addEventListener('pointerup', (event) => {
  if (!dragging) return
  dragging = false
  api.commitDivider(event.clientX)
  api.dragEnd()
})

api.onDividerDragging((active) => {
  dragging = active
  document.body.classList.toggle('dragging', active)
})

function button(text: string, title: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = text
  b.title = title
  b.disabled = disabled
  b.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return b
}

function renderClusters(): void {
  if (!layout) return
  paneBar.replaceChildren()
  const count = layout.columns.length
  const soloed = layout.solo !== null

  layout.columns.forEach((col, index) => {
    if (col.width <= 0) return
    const state = paneStates[index]
    const cluster = document.createElement('div')
    cluster.className = 'pane-cluster' + (index === layout!.focused ? ' focused' : '')

    let left = col.x
    let right = col.x + col.width
    if (index === 0) left = Math.max(left, TRAFFIC_INSET)
    // Keep the right-most cluster clear of the global controls.
    if (index === count - 1 || soloed) right = Math.min(right, window.innerWidth - GLOBAL_RESERVE)
    cluster.style.left = `${left}px`
    cluster.style.width = `${Math.max(0, right - left)}px`
    cluster.addEventListener('click', () => api.paneAction('focus', index))

    const favicon = document.createElement('img')
    favicon.className = 'favicon'
    if (state?.faviconUrl) {
      favicon.src = state.faviconUrl
      favicon.style.display = 'block'
    }
    cluster.appendChild(favicon)

    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = state?.title || state?.label || `Pane ${index + 1}`
    if (state?.currentUrl) title.title = state.currentUrl
    cluster.appendChild(title)

    cluster.appendChild(
      button('‹', 'Back', () => api.paneAction('back', index), !state?.canGoBack),
    )
    cluster.appendChild(
      button('›', 'Forward', () => api.paneAction('forward', index), !state?.canGoForward),
    )
    cluster.appendChild(button('⟳', 'Reload', () => api.paneAction('reload', index)))
    cluster.appendChild(button('↗', 'Open in browser', () => api.paneAction('open-external', index)))
    cluster.appendChild(
      button(soloed ? '❐' : '⤢', soloed ? 'Show all panes' : 'Show only this pane', () =>
        api.solo(soloed ? null : index),
      ),
    )
    if (count > 1) {
      cluster.appendChild(button('✕', 'Close pane', () => api.removePane(index)))
    }
    paneBar.appendChild(cluster)
  })
}

function renderDividers(): void {
  if (!layout) return
  dividersEl.replaceChildren()
  if (layout.solo !== null) return
  const cols = layout.columns
  for (let d = 0; d < cols.length - 1; d++) {
    if (cols[d].width <= 0 || cols[d + 1].width <= 0) continue
    const strip = document.createElement('div')
    strip.className = 'divider'
    const gapStart = cols[d].x + cols[d].width
    strip.style.left = `${gapStart}px`
    strip.style.width = `${layout.gap}px`
    const line = document.createElement('span')
    line.className = 'line'
    strip.appendChild(line)
    strip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      dragging = true
      document.body.classList.add('dragging')
      api.dragStart(d)
    })
    dividersEl.appendChild(strip)
  }
}

function render(): void {
  renderClusters()
  renderDividers()
}

api.onLayoutState((state) => {
  layout = state
  render()
})
api.onPanesState((states) => {
  paneStates = states
  render()
})

byId<HTMLButtonElement>('add-pane').addEventListener('click', () => api.addPane())
byId<HTMLButtonElement>('equalize').addEventListener('click', () => api.equalize())
byId<HTMLButtonElement>('settings').addEventListener('click', () => api.openSettings())

window.addEventListener('resize', render)
console.info('[duopane] chrome renderer ready')
