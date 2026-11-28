/**
 * The canvas's view, reachable from the tour: the Workflow canvas registers how to fit its tiles
 * into view and how to pan (it holds the React Flow instance), and the tour uses them — the dimmed
 * layer is over the canvas, so the canvas can't be panned by hand, and a tile placed near an edge
 * must still be brought into sight. Unset while the canvas isn't on screen.
 */
export interface ScreenBox {
  x: number
  y: number
  w: number
  h: number
}
export interface CanvasNav {
  /** set the view: pan (screen pixels) and zoom */
  setView: (v: { x: number; y: number; zoom: number }) => void
  /** the view's zoom */
  zoom: () => number
  /** bring `box` (screen pixels) into `pane` (the canvas's box on screen) at full size: zoomed to
   *  1 (or kept, if closer), panned no more than needed */
  reveal: (box: ScreenBox, pane: ScreenBox) => void
  /** pan the view by screen pixels (as a scroll would) */
  panBy: (dx: number, dy: number) => void
}

let nav: CanvasNav | null = null
export const setCanvasNav = (n: CanvasNav | null): void => {
  nav = n
}
export const canvasNav = (): CanvasNav | null => nav
