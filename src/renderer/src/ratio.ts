import { DIVIDER_GAP, MIN_PANE_WIDTH, SNAP_THRESHOLD } from '../../shared/types'

/** Mirror of PaneManager.clampRatio so the divider visual never overshoots. */
export function clampRatio(ratio: number, contentWidth: number): number {
  const usable = contentWidth - DIVIDER_GAP
  if (usable < MIN_PANE_WIDTH * 2) return 0.5
  const min = MIN_PANE_WIDTH / usable
  return Math.min(1 - min, Math.max(min, ratio))
}

/** Cursor x (centered on the divider strip) to pane ratio. */
export function ratioFromX(x: number, contentWidth: number): number {
  return clampRatio((x - DIVIDER_GAP / 2) / (contentWidth - DIVIDER_GAP), contentWidth)
}

export function snapRatio(ratio: number): number {
  return Math.abs(ratio - 0.5) <= SNAP_THRESHOLD ? 0.5 : ratio
}
