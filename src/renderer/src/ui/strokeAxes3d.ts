/**
 * A 3-D scene's axes drawn in the scene itself: the axis lines, tick marks and gridlines as line
 * traces, and the tick labels and titles — set in the plot font, rasterised and taken as filled
 * rectangles — lying in the box's planes, so they tilt and recede with the box as the data does. Plotly draws its own 3-D labels flat to the
 * screen, with no way to lay them in a plane; this replaces its axes (hidden) for the Response
 * plot's 3-D views.
 *
 * Plotly hides whatever lies outside a scene's axis ranges, so the ranges are padded to hold the
 * labels, and the scene's aspect set so the data box itself stays a cube.
 *
 * Layout, for the default camera (from +x, −y, above): the dose axis (x) along the front-left
 * floor edge, its labels on the floor in front of it; the time axis (y) along the front-right
 * floor edge, its labels on the floor beside it; the value axis (z) up the left corner, its labels
 * on the front-left face. Gridlines on the floor and the two back walls.
 */

type V3 = [number, number, number]
/** Polylines in the cube's coordinates (the data box is [0, 1]³). */
type Strokes = V3[][]
/** Filled quads (four corners each), in the cube's coordinates. */
type Quads = [V3, V3, V3, V3][]

const add = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]

/** Text is measured and laid out in font units: the cap height is CAP of them. */
const CAP = 6
/** The cap height, px, text is rasterised at: well above any size it's shown at, so the pixel
 *  steps of its outline stay under a screen pixel. */
const RASTER_CAP = 48

/** A text in the plot font as filled rectangles (font units, baseline at 0, y up, the pen's
 *  start at x 0), its advance width and the font's descender depth. */
interface Raster {
  w: number
  desc: number
  rects: [number, number, number, number][]
}
const rasters = new Map<string, Raster>()
let ctx2d: CanvasRenderingContext2D | null = null
const context = (): CanvasRenderingContext2D => {
  if (!ctx2d) {
    const c = document.createElement('canvas')
    ctx2d = c.getContext('2d', { willReadFrequently: true })
    if (!ctx2d) throw new Error('no 2-D canvas')
  }
  return ctx2d
}
/** The font's cap height / size, and its descender (g's depth) / size. */
const metrics = new Map<string, { cap: number; desc: number }>()
function fontMetrics(font: string): { cap: number; desc: number } {
  let m = metrics.get(font)
  if (!m) {
    const c = context()
    c.font = `100px ${font}`
    m = {
      cap: c.measureText('H').actualBoundingBoxAscent / 100 || 0.716,
      desc: c.measureText('g').actualBoundingBoxDescent / 100 || 0.21
    }
    metrics.set(font, m)
  }
  return m
}

/** Rasterise `s` in `font` and take its covered pixels as rectangles: each row's runs, a run
 *  carried down while the next row has the same one (so a stem is one rectangle, not a stack). */
function raster(s: string, font: string): Raster {
  const key = `${font}\u0000${s}`
  const hit = rasters.get(key)
  if (hit) return hit
  const fm = fontMetrics(font)
  const px = RASTER_CAP / fm.cap
  const k = CAP / RASTER_CAP
  const c = context()
  c.font = `${px}px ${font}`
  const m = c.measureText(s)
  const left = Math.ceil(m.actualBoundingBoxLeft) + 2
  const asc = Math.ceil(m.actualBoundingBoxAscent) + 2
  const W = Math.max(1, Math.ceil(left + Math.max(m.width, m.actualBoundingBoxRight)) + 2)
  const H = Math.max(1, asc + Math.ceil(m.actualBoundingBoxDescent) + 2)
  const cv = c.canvas
  if (cv.width < W) cv.width = W
  if (cv.height < H) cv.height = H
  c.clearRect(0, 0, cv.width, cv.height)
  c.font = `${px}px ${font}`
  c.fillStyle = '#000'
  c.textBaseline = 'alphabetic'
  c.fillText(s, left, asc)
  const alpha = c.getImageData(0, 0, W, H).data
  const rects: Raster['rects'] = []
  // open rectangles by run: "x0,x1" → index into rects
  let open = new Map<string, number>()
  for (let r = 0; r < H; r++) {
    const next = new Map<string, number>()
    let x = 0
    while (x < W) {
      if (alpha[(r * W + x) * 4 + 3] < 128) {
        x++
        continue
      }
      const x0 = x
      while (x < W && alpha[(r * W + x) * 4 + 3] >= 128) x++
      const runKey = `${x0},${x}`
      const yBottom = (asc - r - 1) * k
      const at = open.get(runKey)
      if (at != null) {
        rects[at][2] = yBottom
        next.set(runKey, at)
      } else {
        next.set(runKey, rects.push([(x0 - left) * k, (x - left) * k, yBottom, (asc - r) * k]) - 1)
      }
    }
    open = next
  }
  const out: Raster = { w: m.width * k, desc: fm.desc * px * k, rects }
  rasters.set(key, out)
  return out
}

/** A text's width in font units. */
const measure = (s: string, font: string): number => raster(s, font).w

/** A text laid in the plane spanned by `dir` (its reading direction) and `up`, at `size` cube
 *  units of cap height; `at` is its anchor — horizontally its start, middle or end, vertically its
 *  cap top, middle or bottom (the descender's). Wider than `maxLen` (cube units), it's shrunk to
 *  fit. */
function text(
  s: string,
  at: V3,
  dir: V3,
  up: V3,
  size: number,
  align: 'start' | 'middle' | 'end',
  vAlign: 'top' | 'middle' | 'bottom',
  font: string,
  maxLen = Infinity
): Quads {
  const r = raster(s, font)
  const k = Math.min(size / CAP, r.w > 0 ? maxLen / r.w : Infinity)
  const dx = align === 'start' ? 0 : align === 'middle' ? r.w / 2 : r.w
  const dy = vAlign === 'top' ? CAP : vAlign === 'middle' ? CAP / 2 : -r.desc
  const pt = (x: number, y: number): V3 => add(add(at, dir, (x - dx) * k), up, (y - dy) * k)
  return r.rects.map(([x0, x1, y0, y1]) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)])
}

/** One axis: its title, its ticks (data units) and their labels, its range (data units) and
 *  whether it's a log axis. */
export interface StrokeAxis {
  title: string
  ticks: number[]
  labels: string[]
  range: [number, number]
  log: boolean
}

/** Tick values for a linear range — about `n`, at a 1 / 2 / 5 step — with their labels (a true
 *  minus sign, as many decimals as the step needs). */
export function niceTicks(lo: number, hi: number, n = 5): { ticks: number[]; labels: string[] } {
  const span = hi - lo || Math.abs(hi) || 1
  const raw = span / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const ticks: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step)
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return { ticks, labels: ticks.map((v) => v.toFixed(dec).replace('-', '−')) }
}

/** Sizes, in cube units (the data box's side = 1). */
const TICK = 0.025
const TICK_GAP = 0.02
const LABEL = 0.036
const TITLE = 0.044
const TITLE_GAP = 0.06
/** Room kept clear around the labels inside the padded ranges. */
const EDGE = 0.012

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]]

/** The traces drawing the three axes in the scene, and the scene settings that go with them: the
 *  ranges padded to hold the labels, Plotly's own axes hidden, and the aspect keeping the data box
 *  a cube. Colours: `line` for the axis lines and ticks, `grid` the gridlines, `ink` the text.
 *
 *  `eye` is the side the scene is seen from (the camera's eye less its centre; only the signs
 *  count). As Plotly's own axes do, the dose and time axes take the floor edges facing it, the
 *  value axis the left-hand vertical edge, and the gridlines the floor and walls behind the data;
 *  each label lies on the face it's read from, reading left to right. The ranges are padded the
 *  same on every side, so the box keeps its place whichever side the labels are on. */
export function strokeAxes3d(
  axes: { x: StrokeAxis; y: StrokeAxis; z: StrokeAxis },
  colors: { line: string; grid: string; ink: string },
  eye: { x: number; y: number; z: number } = { x: 1, y: -1, z: 1 },
  /** the plot font, as a CSS family list (the app's plot font setting) */
  font = 'Arial, Helvetica, sans-serif'
): { traces: Record<string, unknown>[]; scene: Record<string, unknown> } {
  const toAxis = (a: StrokeAxis, v: number): number => (a.log ? Math.log10(v) : v)
  const span = (a: StrokeAxis): [number, number] => [toAxis(a, a.range[0]), toAxis(a, a.range[1])]
  const cube = (a: StrokeAxis, v: number): number => {
    const [lo, hi] = span(a)
    return (toAxis(a, v) - lo) / (hi - lo || 1)
  }
  const inside = (u: number): boolean => u >= -1e-9 && u <= 1 + 1e-9
  const tx = axes.x.ticks.map((v, i) => [cube(axes.x, v), i] as const).filter(([u]) => inside(u))
  const ty = axes.y.ticks.map((v, i) => [cube(axes.y, v), i] as const).filter(([u]) => inside(u))
  const tz = axes.z.ticks.map((v, i) => [cube(axes.z, v), i] as const).filter(([u]) => inside(u))

  const e: V3 = [eye.x, eye.y, eye.z]
  // The faces toward the eye (front) and away from it (back), per axis.
  const x0 = e[0] >= 0 ? 1 : 0
  const y0 = e[1] >= 0 ? 1 : 0
  const xb = 1 - x0
  const yb = 1 - y0
  // the grid's floor: below the data seen from above, above it seen from below
  const zb = e[2] >= 0 ? 0 : 1
  const zt = 1 - zb
  // The screen's right, on the floor: the reading direction of every label that reads across.
  const right: V3 = [-e[1], e[0], 0]
  const facingRight = (d: V3): V3 => (dot(d, right) >= 0 ? d : neg(d))
  // Every label, also as text (for an export to set as real, editable type — see sceneVector):
  // its anchor on the baseline, and one font unit along its reading direction and its up.
  const texts: { s: string; align: 'start' | 'middle' | 'end'; at: V3; dir: V3; up: V3 }[] = []
  const write = (
    s: string,
    at: V3,
    dir: V3,
    up: V3,
    size: number,
    align: 'start' | 'middle' | 'end',
    vAlign: 'top' | 'middle' | 'bottom',
    maxLen = Infinity
  ): Quads => {
    const r = raster(s, font)
    const k = Math.min(size / CAP, r.w > 0 ? maxLen / r.w : Infinity)
    const base = add(
      at,
      up,
      -(vAlign === 'top' ? CAP : vAlign === 'middle' ? CAP / 2 : -r.desc) * k
    )
    texts.push({ s, align, at: base, dir: add(base, dir, k), up: add(base, up, k) })
    return text(s, at, dir, up, size, align, vAlign, font, maxLen)
  }
  // A label on the face with normal `n` (toward the eye), reading along `along` (flipped to read
  // left to right), set out from the box along `out` — its edge nearest the box at `at`.
  const label = (
    s: string,
    at: V3,
    along: V3,
    n: V3,
    out: V3,
    size: number,
    align: 'start' | 'middle' | 'end' | 'outward',
    maxLen?: number
  ): Quads => {
    const dir = facingRight(along)
    const up = cross(n, dir)
    const a = align === 'outward' ? (dot(dir, out) > 0 ? 'start' : 'end') : align
    // The text's side nearest the box at `at`: its top when its up points back at the box.
    return write(s, at, dir, up, size, a, dot(up, out) < 0 ? 'top' : 'bottom', maxLen)
  }
  // A label at one end of an axis whose other axis's labels meet it at the front corner: set
  // back from the corner (extending away from it) rather than centred on its tick.
  const awayFrom = (corner: number, along: V3, axis: 0 | 1): 'start' | 'end' => {
    const inward = corner === 1 ? -1 : 1
    return facingRight(along)[axis] * inward > 0 ? 'start' : 'end'
  }

  const grid: Strokes = []
  const lines: Strokes = []
  const ink: Quads = []
  for (const [u] of tx)
    grid.push([
      [u, y0, zb],
      [u, yb, zb],
      [u, yb, zt]
    ])
  for (const [v] of ty)
    grid.push([
      [x0, v, zb],
      [xb, v, zb],
      [xb, v, zt]
    ])
  for (const [w] of tz)
    grid.push([
      [xb, y0, w],
      [xb, yb, w],
      [x0, yb, w]
    ])
  // Value up the left-hand side corner (placed below). Of the side corners (front x with back y,
  // back x with front y), the left is the one less far along the screen's right.
  const sideA: [number, number] = [xb, y0]
  const sideB: [number, number] = [x0, yb]
  const along2 = (c: [number, number]): number => (c[0] - 0.5) * right[0] + (c[1] - 0.5) * right[1]
  const [cx, cy] = along2(sideA) <= along2(sideB) ? sideA : sideB
  // the floor axis whose back end is that corner: its end label is set back from it, clear of the
  // value labels coming off the corner toward the eye
  const zOnX = cy === y0
  const off = TICK + TICK_GAP
  const titleAt = off + LABEL * 1.4 + TITLE_GAP
  const floor: V3 = [0, 0, e[2] >= 0 ? 1 : -1]
  // Dose along the front floor edge across x, its labels on the floor beyond it.
  const oy: V3 = [0, y0 ? 1 : -1, 0]
  lines.push([
    [0, y0, 0],
    [1, y0, 0]
  ])
  for (const [u, i] of tx) {
    lines.push([[u, y0, 0], add([u, y0, 0], oy, TICK)])
    const align =
      Math.abs(u - x0) < 1e-9
        ? awayFrom(x0, [1, 0, 0], 0)
        : zOnX && Math.abs(u - cx) < 1e-9
          ? awayFrom(cx, [1, 0, 0], 0)
          : 'middle'
    ink.push(
      ...label(axes.x.labels[i], add([u, y0, 0], oy, off), [1, 0, 0], floor, oy, LABEL, align)
    )
  }
  ink.push(
    ...label(
      axes.x.title,
      add([0.5, y0, 0], oy, titleAt),
      [1, 0, 0],
      floor,
      oy,
      TITLE,
      'middle',
      1.1
    )
  )
  // Time along the front floor edge across y.
  const ox: V3 = [x0 ? 1 : -1, 0, 0]
  lines.push([
    [x0, 0, 0],
    [x0, 1, 0]
  ])
  for (const [v, i] of ty) {
    lines.push([[x0, v, 0], add([x0, v, 0], ox, TICK)])
    const align =
      Math.abs(v - y0) < 1e-9
        ? awayFrom(y0, [0, 1, 0], 1)
        : !zOnX && Math.abs(v - cy) < 1e-9
          ? awayFrom(cy, [0, 1, 0], 1)
          : 'middle'
    ink.push(
      ...label(axes.y.labels[i], add([x0, v, 0], ox, off), [0, 1, 0], floor, ox, LABEL, align)
    )
  }
  ink.push(
    ...label(
      axes.y.title,
      add([x0, 0.5, 0], ox, titleAt),
      [0, 1, 0],
      floor,
      ox,
      TITLE,
      'middle',
      1.1
    )
  )
  // The labels come off the corner toward the eye: out along its front coordinate (y at the
  // front-y corner, else x), on the face through the corner across that, read from the eye's side.
  const n: V3 = zOnX ? [x0 ? 1 : -1, 0, 0] : [0, y0 ? 1 : -1, 0]
  const oz: V3 = zOnX ? [0, cy ? 1 : -1, 0] : [cx ? 1 : -1, 0, 0]
  const across: V3 = zOnX ? [0, 1, 0] : [1, 0, 0]
  const zW = Math.max(0, ...tz.map(([, i]) => (measure(axes.z.labels[i], font) * LABEL) / CAP))
  lines.push([
    [cx, cy, 0],
    [cx, cy, 1]
  ])
  for (const [w, i] of tz) {
    lines.push([[cx, cy, w], add([cx, cy, w], oz, TICK)])
    // read across the face, vertically centred on the tick
    const dir = facingRight(across)
    ink.push(
      ...write(
        axes.z.labels[i],
        add([cx, cy, w], oz, off),
        dir,
        cross(n, dir),
        LABEL,
        dot(dir, oz) > 0 ? 'start' : 'end',
        'middle'
      )
    )
  }
  ink.push(
    ...label(
      axes.z.title,
      add([cx, cy, 0.5], oz, off + zW + TITLE_GAP),
      [0, 0, 1],
      n,
      oz,
      TITLE,
      'middle',
      1.1
    )
  )

  // Pad the ranges to hold everything drawn: the two floor axes alike (either one's labels, or
  // the value axis's, may be on any side), the value axis by its own; the same each side.
  let padH = 0
  let padZ = 0
  for (const st of [...grid, ...lines, ...ink] as V3[][])
    for (const p of st) {
      padH = Math.max(padH, -p[0], p[0] - 1, -p[1], p[1] - 1)
      padZ = Math.max(padZ, -p[2], p[2] - 1)
    }
  const lo: V3 = [-padH - EDGE, -padH - EDGE, -padZ - EDGE]
  const hi: V3 = [1 + padH + EDGE, 1 + padH + EDGE, 1 + padZ + EDGE]
  const all = [axes.x, axes.y, axes.z]
  const toData = (a: StrokeAxis, u: number): number => {
    const [l, h] = span(a)
    const v = l + u * (h - l)
    return a.log ? 10 ** v : v
  }
  const toDataPt = (p: V3): number[] => [
    toData(axes.x, p[0]),
    toData(axes.y, p[1]),
    toData(axes.z, p[2])
  ]
  // Strokes as one trace's x/y/z, each polyline ended by a gap.
  const trace = (
    st: Strokes,
    color: string,
    width: number,
    extraMeta: Record<string, unknown> = {}
  ): Record<string, unknown> => {
    const xs: Array<number | null> = []
    const ys: Array<number | null> = []
    const zs: Array<number | null> = []
    for (const s of st) {
      for (const p of s) {
        xs.push(toData(axes.x, p[0]))
        ys.push(toData(axes.y, p[1]))
        zs.push(toData(axes.z, p[2]))
      }
      xs.push(null)
      ys.push(null)
      zs.push(null)
    }
    return {
      type: 'scatter3d',
      mode: 'lines',
      x: xs,
      y: ys,
      z: zs,
      line: { color, width },
      connectgaps: false,
      showlegend: false,
      hoverinfo: 'skip',
      // takes no part in a legend or hover focus, and no hover role
      meta: { oeRole: 'axes', oeGroup: '', ...extraMeta }
    }
  }
  const hidden = { visible: false, showspikes: false }
  const sceneAxis = (a: StrokeAxis, d: number): Record<string, unknown> => {
    const [l, h] = span(a)
    return {
      ...hidden,
      type: a.log ? 'log' : 'linear',
      autorange: false,
      range: [l + lo[d] * (h - l), l + hi[d] * (h - l)]
    }
  }
  // The labels, filled: two triangles a rectangle, in flat colour — unlit, a print, not a solid.
  const fill = (): Record<string, unknown> => {
    const xs: number[] = []
    const ys: number[] = []
    const zs: number[] = []
    const i: number[] = []
    const j: number[] = []
    const kk: number[] = []
    for (const q of ink) {
      const v = xs.length
      for (const p of q) {
        xs.push(toData(axes.x, p[0]))
        ys.push(toData(axes.y, p[1]))
        zs.push(toData(axes.z, p[2]))
      }
      i.push(v, v)
      j.push(v + 1, v + 2)
      kk.push(v + 2, v + 3)
    }
    return {
      type: 'mesh3d',
      x: xs,
      y: ys,
      z: zs,
      i,
      j,
      k: kk,
      color: colors.ink,
      flatshading: true,
      lighting: { ambient: 1, diffuse: 0, specular: 0, roughness: 1, fresnel: 0 },
      showscale: false,
      showlegend: false,
      hoverinfo: 'skip',
      // drawn labels: an export sets them as text instead (oeText, below) and leaves these out
      meta: { oeRole: 'axes', oeGroup: '', oeTextFill: true }
    }
  }
  return {
    traces: [
      // the gridlines: behind all the data (an export layers them under the scene's bitmap)
      trace(grid, colors.grid, 1, { oeLayer: 'back' }),
      trace(lines, colors.line, 1.5),
      fill(),
      // The labels as text, for an export to set as real, editable type (see sceneVector): a line
      // trace that draws nothing on screen.
      // (one gap point: a trace with no points at all is dropped by Plotly as invisible)
      trace([[]], colors.ink, 1.4, {
        // in data coordinates; CAP font units = the cap height
        oeText: texts.map((t) => ({
          s: t.s,
          align: t.align,
          at: toDataPt(t.at),
          dir: toDataPt(t.dir),
          up: toDataPt(t.up),
          cap: CAP
        }))
      })
    ],
    scene: {
      xaxis: sceneAxis(all[0], 0),
      yaxis: sceneAxis(all[1], 1),
      zaxis: sceneAxis(all[2], 2),
      aspectmode: 'manual',
      aspectratio: { x: hi[0] - lo[0], y: hi[1] - lo[1], z: hi[2] - lo[2] }
    }
  }
}
