import type { PaneSlot } from '../../shared/types'
import { DIVIDER_GAP } from '../../shared/types'
import { ratioFromX, snapRatio } from './ratio'

const api = window.chromeApi

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing element #${id}`)
  return el as T
}

const divider = byId<HTMLDivElement>('divider')

let ratio = 0.5
let collapsed: PaneSlot | null = null
let dragging = false

function positionDivider(): void {
  if (collapsed !== null) {
    divider.style.display = 'none'
    return
  }
  divider.style.display = ''
  divider.style.left = `${Math.round((window.innerWidth - DIVIDER_GAP) * ratio)}px`
}

function updateGlobalButtons(): void {
  byId<HTMLButtonElement>('collapse-left').classList.toggle('active', collapsed === 'left')
  byId<HTMLButtonElement>('collapse-right').classList.toggle('active', collapsed === 'right')
}

// ---- Divider drag ----
// The strip only receives pointer events while the cursor is over
// renderer-owned pixels; on pointerdown the main process raises a
// transparent full-window "glass" view (see glass.ts) that takes over the
// rest of the drag, so these window-level handlers mostly cover the first
// few frames before the glass appears.

let rafHandle = 0
let pendingX = 0

divider.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || collapsed !== null) return
  event.preventDefault()
  dragging = true
  document.body.classList.add('dragging')
  api.dragStart()
})

window.addEventListener('pointermove', (event) => {
  if (!dragging) return
  pendingX = event.clientX
  if (!rafHandle) {
    rafHandle = requestAnimationFrame(() => {
      rafHandle = 0
      ratio = ratioFromX(pendingX, window.innerWidth)
      positionDivider()
      api.setRatio(ratio)
    })
  }
})

window.addEventListener('pointerup', (event) => {
  if (!dragging) return
  dragging = false
  api.commitRatio(snapRatio(ratioFromX(event.clientX, window.innerWidth)))
  api.dragEnd()
})

api.onDividerDragging((active) => {
  dragging = active
  document.body.classList.toggle('dragging', active)
})

// ---- State from main ----

api.onLayoutState((state) => {
  ratio = state.ratio
  collapsed = state.collapsed
  positionDivider()
  updateGlobalButtons()
})

api.onPaneState((state) => {
  const title = byId<HTMLSpanElement>(`title-${state.slot}`)
  title.textContent = state.title
  title.title = state.currentUrl
  const favicon = byId<HTMLImageElement>(`favicon-${state.slot}`)
  if (state.faviconUrl) {
    favicon.src = state.faviconUrl
    favicon.style.display = 'block'
  } else {
    favicon.style.display = 'none'
  }
  byId<HTMLButtonElement>(`back-${state.slot}`).disabled = !state.canGoBack
  byId<HTMLButtonElement>(`forward-${state.slot}`).disabled = !state.canGoForward
})

// ---- Controls ----

const slots: PaneSlot[] = ['left', 'right']
for (const slot of slots) {
  byId<HTMLButtonElement>(`back-${slot}`).addEventListener('click', () => api.paneAction('back', slot))
  byId<HTMLButtonElement>(`forward-${slot}`).addEventListener('click', () =>
    api.paneAction('forward', slot),
  )
  byId<HTMLButtonElement>(`reload-${slot}`).addEventListener('click', () =>
    api.paneAction('reload', slot),
  )
  byId<HTMLButtonElement>(`external-${slot}`).addEventListener('click', () =>
    api.paneAction('open-external', slot),
  )
}

byId<HTMLButtonElement>('swap').addEventListener('click', () => api.swap())
byId<HTMLButtonElement>('reset').addEventListener('click', () => {
  api.collapse(null)
  api.commitRatio(0.5)
})
byId<HTMLButtonElement>('collapse-left').addEventListener('click', () =>
  api.collapse(collapsed === 'left' ? null : 'left'),
)
byId<HTMLButtonElement>('collapse-right').addEventListener('click', () =>
  api.collapse(collapsed === 'right' ? null : 'right'),
)
byId<HTMLButtonElement>('settings').addEventListener('click', () => api.openSettings())

window.addEventListener('resize', positionDivider)
positionDivider()
console.info('[duopane] chrome renderer ready')
