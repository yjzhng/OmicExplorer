/** Draggable threshold guides: their description (GuideDrag) and the geometry their drag reads. */

/** One draggable guide line/curve. `value` is the field it controls (the drag baseline); `key`
 *  routes the new value back through `onGuide`. */
export interface GuideDrag {
  /** index into `layout.shapes` of the line/path to drag */
  shapeIndex: number
  /** the data axis the value lives on; the drag is constrained to it (so a line can't slant) */
  axis: 'x' | 'y'
  /** 'line' moves x0/x1 (or y0/y1) together; 'path' translates the whole curve along the axis;
   *  'point' is a LOCALIZED handle (a short marker) hit-tested by 2-D proximity, moved along its
   *  axis; 'curve' is a path grabbed ANYWHERE and reshaped so it passes through the current mouse
   *  point (the SAM `b` handle) — `solve` maps the mouse point to the new value, `render` rebuilds the
   *  path for the live preview (re-sampled, so it matches the committed shape exactly). */
  kind: 'line' | 'path' | 'point' | 'curve' | 'corner'
  /** 'curve' only: map the current mouse DATA point to the field's new (cropped) value. */
  solve?: (mouseX: number, mouseY: number) => number
  /** 'curve' only: rebuild the full path for a given value, for the live drag preview. */
  render?: (value: number) => string
  /** 'curve' only, with `syncShapeIndex`: rebuild that partner's path for the same value (a
   *  symmetric band's other edge), so both track together live. */
  syncRender?: (value: number) => string
  /** 'corner' only: a 2-D handle grabbed at the shape's (x0,y0) that adjusts TWO fields at once.
   *  `cornerVisual` returns the relayout updates to move every affected shape live; `cornerCommit`
   *  applies the threshold change on release; `cornerLabel` is the drag tooltip. */
  cornerVisual?: (mouseX: number, mouseY: number) => Record<string, unknown>
  cornerCommit?: (mouseX: number, mouseY: number) => void
  cornerLabel?: (mouseX: number, mouseY: number) => string
  /** CSS cursor while hovering/dragging this guide (e.g. 'ew-resize', 'ns-resize') */
  cursor: string
  /** optional position-dependent cursor (data mouse point → CSS cursor), overriding `cursor` — used
   *  by the SAM curve to show a 45° cursor matching the branch's slope (↘ right, ↗ left). */
  cursorFn?: (mouseX: number, mouseY: number) => string
  /** current value of the field this guide controls — the baseline the drag delta is added to */
  value: number
  /** opaque tag the view uses to route the new value (e.g. the threshold field name) */
  key: string
  /** optional paired shape that mirrors this one about the axis origin (moved to −value while this
   *  guide drags) — used for the symmetric fold-change lines so both track together live. */
  mirrorShapeIndex?: number
  /** optional paired shape moved to the SAME value while this guide drags — used when one logical
   *  line is drawn as two segments (e.g. the volcano's stat line split around the middle gap). */
  syncShapeIndex?: number
  /** 'point' handles only: the CROSS-axis extent is paper-referenced (so the tick can straddle a
   *  plot-edge axis into the margin, which a data-ref shape would clip). The drag-axis coordinate is
   *  still data; only hit-testing the cross-axis centre reads paper. */
  crossPaper?: boolean
  /** label for the drag tooltip previewing the value being set (defaults to the rounded number). */
  format?: (value: number) => string
}

/** Perpendicular pixel distance from point (px,py) to segment (ax,ay)-(bx,by). */
export function distToSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** Parse a Plotly path string ("Mx,yLx,y…") into [x,y] data points. */
export function parseShapePath(d: string): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  const re = /([-\d.eE+]+),([-\d.eE+]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) pts.push([Number(m[1]), Number(m[2])])
  return pts
}
