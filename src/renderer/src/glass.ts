// Transparent full-window overlay shown by the main process only while a
// divider is being dragged. It exists because the native pane views swallow
// pointer events: without it the drag would stall the moment the cursor
// outruns the divider strip owned by the chrome renderer. Main already knows
// which divider is active (set on drag-start), so the glass only reports the
// cursor x.
const api = window.chromeApi

let rafHandle = 0
let pendingX = 0

window.addEventListener('pointermove', (event) => {
  pendingX = event.clientX
  if (!rafHandle) {
    rafHandle = requestAnimationFrame(() => {
      rafHandle = 0
      api.setDivider(pendingX)
    })
  }
})

function endDrag(event: PointerEvent): void {
  api.commitDivider(event.clientX)
  api.dragEnd()
}

window.addEventListener('pointerup', endDrag)
window.addEventListener('pointercancel', endDrag)
window.addEventListener('blur', () => api.dragEnd())
