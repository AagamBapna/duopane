// Transparent full-window overlay shown by the main process only while the
// divider is being dragged. It exists because the native pane views swallow
// pointer events: without it the drag would stall the moment the cursor
// outruns the 9px divider strip owned by the chrome renderer.
import { ratioFromX, snapRatio } from './ratio'

const api = window.chromeApi

let rafHandle = 0
let pendingX = 0

window.addEventListener('pointermove', (event) => {
  pendingX = event.clientX
  if (!rafHandle) {
    rafHandle = requestAnimationFrame(() => {
      rafHandle = 0
      api.setRatio(ratioFromX(pendingX, window.innerWidth))
    })
  }
})

function endDrag(event: PointerEvent): void {
  api.commitRatio(snapRatio(ratioFromX(event.clientX, window.innerWidth)))
  api.dragEnd()
}

window.addEventListener('pointerup', endDrag)
window.addEventListener('pointercancel', endDrag)
window.addEventListener('blur', () => api.dragEnd())
