/**
 * Vector lines and text for a 3-D scene in an exported SVG.
 *
 * Plotly draws a 3-D scene with WebGL, so its SVG embeds the scene as ONE bitmap — axis lines,
 * gridlines, ticks, labels and data curves included. Here the capture clone draws only the
 * surfaces and markers into that bitmap (prepareSceneClone hides everything else), and the lines
 * and text are written back on top as SVG (sceneOverlays), editable in Illustrator/PowerPoint.
 *
 * "As seen" is the rule: nothing is re-laid out. Every position is projected through the live
 * scene's own camera (gl-plot3d's model/view/projection), from the live gl-axes state — its
 * bounds, ticks, the cube edges it picked for each axis (lastCubeProps), pads, widths and colours
 * — following gl-axes' draw() and its text shader step for step. Lines behind a surface are
 * hidden with a software depth buffer of the surfaces, as WebGL's depth test hid them on screen.
 */

type Vec3 = [number, number, number]
type Mat4 = ArrayLike<number>
type Rgba = ArrayLike<number>

/** The parts of a live gl3d scene this reads (Plotly/gl-plot3d/gl-axes internals). */
interface GlAxes {
  bounds: [Vec3, Vec3]
  ticks: { x: number; text?: string; fontSize?: number; font?: string }[][]
  lastCubeProps: { cubeEdges: Vec3; axis: Vec3 }
  tickEnable: boolean[]
  tickFont: string[]
  tickSize: number[]
  tickAngle: number[]
  tickAlign: (string | number)[]
  tickColor: Rgba[]
  tickPad: number[]
  labels: string[]
  labelEnable: boolean[]
  labelFont: string[]
  labelSize: number[]
  labelAngle: number[]
  labelAlign: (string | number)[]
  labelColor: Rgba[]
  labelPad: number[]
  lineEnable: boolean[]
  lineMirror: boolean[]
  lineWidth: number[]
  lineColor: Rgba[]
  lineTickEnable: boolean[]
  lineTickMirror: boolean[]
  lineTickLength: number[]
  lineTickWidth: number[]
  lineTickColor: Rgba[]
  gridEnable: boolean[]
  gridWidth: number[]
  gridColor: Rgba[]
  zeroEnable: boolean[]
  zeroLineColor: Rgba[]
  zeroLineWidth: number[]
}
interface LiveScene {
  dataScale: Vec3
  fullSceneLayout: Record<'xaxis' | 'yaxis' | 'zaxis', { d2l: (v: unknown) => number }>
  glplot: {
    pixelRatio: number
    gl: { drawingBufferWidth: number; drawingBufferHeight: number }
    cameraParams: { model: Mat4; view: Mat4; projection: Mat4; _ortho?: boolean }
    axes: GlAxes
  }
}
interface FullTrace {
  type?: string
  scene?: string
  visible?: boolean | 'legendonly'
  mode?: string
  opacity?: number
  x?: unknown[]
  y?: unknown[]
  z?: unknown[]
  line?: { color?: unknown; width?: number; dash?: string }
  /** strokeAxes3d's labels, on its text trace (see strokeText) */
  meta?: { oeText?: StrokeText[]; oeRole?: string; oeLayer?: string; oeTextFill?: boolean }
}
/** One label of a stroke-font text trace: its string and alignment, its anchor on the baseline
 *  and the points one font unit along its reading direction and up (data coordinates), and the
 *  cap height in those units. */
interface StrokeText {
  s: string
  align: 'start' | 'middle' | 'end'
  at: [number, number, number]
  dir: [number, number, number]
  up: [number, number, number]
  cap: number
}
/** Cap height / font size of the fonts plots are set in (Arial, Helvetica ≈ 0.716; Times 0.662 —
 *  the difference is a hair at label sizes). */
const CAP_RATIO = 0.716
/** The font size, px, in-plane labels are set at before their matrix scales them (see oeText). */
const TEXT_PX = 100

/** One scene's overlay, in the scene viewport's CSS px (0,0 = its top-left). */
export interface ScenePlan {
  width: number
  height: number
  /** SVG markup: lines, then text */
  body: string
  /** SVG markup drawn UNDER the bitmap: the gridlines and zero lines on the box's back walls and
   *  floor, behind all the data — the bitmap's own (translucent) surfaces then cover them exactly
   *  as WebGL did, no depth test needed */
  back: string
}

const AXES = ['xaxis', 'yaxis', 'zaxis'] as const

/** out = a·b, column-major 4×4 (gl-matrix layout). */
function mul(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = s
    }
  return out
}

/** A scene's projection: world → viewport CSS px, plus view depth (clip w) for occlusion. */
function projector(sc: LiveScene): {
  px: (p: Vec3) => { x: number; y: number; w: number }
  ndc: (p: Vec3) => [number, number]
  width: number
  height: number
} {
  const { model, view, projection } = sc.glplot.cameraParams
  const m = mul(projection, mul(view, model))
  const ratio = sc.glplot.pixelRatio || 1
  const width = sc.glplot.gl.drawingBufferWidth / ratio
  const height = sc.glplot.gl.drawingBufferHeight / ratio
  const clip = (p: Vec3): [number, number, number] => {
    const [x, y, z] = p
    const w = m[3] * x + m[7] * y + m[11] * z + m[15]
    const d = Math.max(w, 0.0001)
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) / d,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) / d,
      w
    ]
  }
  return {
    width,
    height,
    ndc: (p) => {
      const [x, y] = clip(p)
      return [x, y]
    },
    px: (p) => {
      const [x, y, w] = clip(p)
      return { x: ((x + 1) / 2) * width, y: ((1 - y) / 2) * height, w }
    }
  }
}

/** A software depth buffer of a scene's surfaces (nearest view depth per CSS px). */
class DepthBuffer {
  private readonly buf: Float32Array
  private readonly w: number
  private readonly h: number
  /** `width`×`height` CSS px, held at `res` cells per px — as finely as WebGL resolved coverage
   *  (its pixel ratio), so a line a fraction of a pixel clear of a surface's edge stays clear. */
  constructor(
    width: number,
    height: number,
    private readonly res: number
  ) {
    this.w = Math.ceil(width * res)
    this.h = Math.ceil(height * res)
    this.buf = new Float32Array(this.w * this.h).fill(Infinity)
  }
  /** A triangle, covering every pixel whose centre lies within half a pixel of its INNER edges
   *  (`grow`: b–c, c–a, a–b): closes the sub-pixel gaps between the thin triangles of a surface
   *  seen edge-on, which a line behind would leak through, while the surface's outline stays
   *  exact — a line along it (an axis edge) isn't cut. */
  triangle(
    pa: { x: number; y: number; w: number },
    pb: typeof pa,
    pc: typeof pa,
    grow: [boolean, boolean, boolean] = [true, true, true]
  ): void {
    const r = this.res
    const a = { x: pa.x * r, y: pa.y * r, w: pa.w }
    const b = { x: pb.x * r, y: pb.y * r, w: pb.w }
    const c = { x: pc.x * r, y: pc.y * r, w: pc.w }
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x) - 1))
    const x1 = Math.min(this.w - 1, Math.ceil(Math.max(a.x, b.x, c.x) + 1))
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y) - 1))
    const y1 = Math.min(this.h - 1, Math.ceil(Math.max(a.y, b.y, c.y) + 1))
    const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
    if (!area) return
    // half a pixel, in each barycentric coordinate: 0.5 / (that vertex's altitude)
    const abs = Math.abs(area)
    const t1 = grow[0] ? (0.5 * Math.hypot(c.x - b.x, c.y - b.y)) / abs : 1e-6
    const t2 = grow[1] ? (0.5 * Math.hypot(a.x - c.x, a.y - c.y)) / abs : 1e-6
    const t3 = grow[2] ? (0.5 * Math.hypot(b.x - a.x, b.y - a.y)) / abs : 1e-6
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const l1 = ((b.x - px) * (c.y - py) - (c.x - px) * (b.y - py)) / area
        const l2 = ((c.x - px) * (a.y - py) - (a.x - px) * (c.y - py)) / area
        const l3 = 1 - l1 - l2
        if (l1 < -t1 || l2 < -t2 || l3 < -t3) continue
        const d = l1 * a.w + l2 * b.w + l3 * c.w
        const i = y * this.w + x
        if (d < this.buf[i]) this.buf[i] = d
      }
  }
  /** A flat disc (a marker sprite, which faces the camera) at depth `w`. */
  disc(px: number, py: number, pr: number, w: number): void {
    const cx = px * this.res
    const cy = py * this.res
    const r = pr * this.res
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.h - 1, Math.ceil(cy + r)); y++)
      for (
        let x = Math.max(0, Math.floor(cx - r));
        x <= Math.min(this.w - 1, Math.ceil(cx + r));
        x++
      ) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue
        const i = y * this.w + x
        if (w < this.buf[i]) this.buf[i] = w
      }
  }
  /** The nearest surface depth at (x, y) (Infinity where no surface is drawn). */
  at(x: number, y: number): number {
    return this.cell(Math.floor(x * this.res), Math.floor(y * this.res))
  }
  private cell(xx: number, yy: number): number {
    if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) return Infinity
    return this.buf[yy * this.w + xx]
  }
  /** The FARTHEST of those depths within a CSS px of (x, y): for a line lying on a surface
   *  seen near edge-on, where the depth jumps from one pixel to the next. A surface truly in
   *  front of the line is nearer across the whole neighbourhood, so it still hides it. */
  around(x: number, y: number): number {
    const cx = Math.floor(x * this.res)
    const cy = Math.floor(y * this.res)
    const r = this.res
    let d = -Infinity
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) d = Math.max(d, this.cell(cx + dx, cy + dy))
    return d
  }
}

/** Depth-buffer cells per CSS px (see DepthBuffer). */
const DEPTH_RES = 3

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString()
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** An rgba array (0–1, gl-axes' colour form) as a CSS colour, through `sub` (dark → light). */
function cssColor(c: Rgba, sub: Map<string, string>): { color: string; opacity: number } {
  const hex =
    '#' +
    [c[0], c[1], c[2]]
      .map((v) =>
        Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  return { color: sub.get(hex) ?? hex, opacity: c[3] ?? 1 }
}

/** How far a colour is from white, 0–1 (by luminance; 1 for a colour it can't read). The export
 *  ground is white or transparent — over a slide or page, near enough white too. */
function contrastWithWhite(color: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  const rgb = m
    ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
    : /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color)?.slice(1, 4).map(Number)
  if (!rgb) return 1
  return 1 - (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
}

/** Plotly's rich-text subset in 3-D labels (<sub>, <sup>, <b>, <i>, <br>, entities) as tspans. */
function richText(raw: string, size: number): string {
  const decode = (s: string): string =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, '&')
  let out = ''
  let shift = 0
  let bold = false
  let italic = false
  let sub = 0
  for (const part of raw.split(/(<\/?(?:sub|sup|b|i)>|<br\s*\/?>)/i)) {
    if (!part) continue
    const tag = part.toLowerCase().replace(/\s/g, '')
    if (tag === '<sub>' || tag === '<sup>' || tag === '</sub>' || tag === '</sup>') {
      sub = tag === '<sub>' ? 1 : tag === '<sup>' ? -1 : 0
      continue
    }
    if (tag === '<b>' || tag === '</b>') {
      bold = tag === '<b>'
      continue
    }
    if (tag === '<i>' || tag === '</i>') {
      italic = tag === '<i>'
      continue
    }
    if (tag.startsWith('<br')) {
      out += ' '
      continue
    }
    const target = sub * 0.3 * size
    const dy = target - shift
    shift = target
    const attrs = [
      dy ? `dy="${fmt(dy)}"` : '',
      sub ? `font-size="${fmt(size * 0.7)}px"` : '',
      bold ? 'font-weight="bold"' : '',
      italic ? 'font-style="italic"' : ''
    ]
      .filter(Boolean)
      .join(' ')
    out += attrs ? `<tspan ${attrs}>${esc(decode(part))}</tspan>` : esc(decode(part))
  }
  return out
}

// gl-axes text shader (lib/shaders/textVert.glsl), ported: the rotation a label is drawn at.
const HALF_PI = Math.PI / 2
const modPi = (a: number): number => ((a % Math.PI) + Math.PI) % Math.PI
const positiveAngle = (a: number): number => modPi(a < 0 ? a + 2 * Math.PI : a)
const lookUpwards = (a: number): number => {
  const b = positiveAngle(a)
  return b > HALF_PI && b <= 3 * HALF_PI ? b - Math.PI : b
}
function applyAlignOption(option: number, raw: number, delta: number, ratio: number): number {
  if (option > 2) {
    const div = (2 * Math.PI) / option
    const b = positiveAngle(raw + delta)
    return lookUpwards(div * Math.floor((b + 0.5 * div) / div))
  }
  if (option === 2) {
    const b = positiveAngle(raw + delta)
    return b < ratio * HALF_PI
      ? 0
      : b < (2 - ratio) * HALF_PI
        ? -HALF_PI
        : b < (2 + ratio) * HALF_PI
          ? 0
          : b < (4 - ratio) * HALF_PI
            ? HALF_PI
            : 0
  }
  if (option === 1) return raw + delta
  if (option === 0) return lookUpwards(raw)
  if (option === -1) return 0
  return raw
}

/**
 * Hide what the overlay redraws from a capture clone's data/layout, in place: the scene's axis
 * chrome (lines, grid, ticks, labels), strokeAxes3d's drawn labels and the line traces that will
 * be drawn as vector. The
 * clone's axis ranges and aspect are pinned to the live scene's first, so hiding a trace can't
 * re-fit the box. Returns the indices of the hidden traces (the ones the overlay draws).
 */
export function prepareSceneClone(
  liveLayout: Record<string, unknown>,
  fullData: FullTrace[],
  layout: Record<string, unknown>,
  data: Record<string, unknown>[]
): Set<number> {
  const drawn = new Set<number>()
  // Hiding a trace can drop the legend, which would re-size the plot area under the scene.
  if (typeof liveLayout.showlegend === 'boolean') layout.showlegend = liveLayout.showlegend
  for (const [key, flRaw] of Object.entries(liveLayout)) {
    if (!/^scene\d*$/.test(key)) continue
    const fl = flRaw as Record<string, unknown> & { aspectratio?: unknown }
    const scene = { ...((layout[key] as Record<string, unknown>) ?? {}) }
    for (const ax of AXES) {
      const flAx = (fl[ax] ?? {}) as { range?: unknown[] }
      scene[ax] = {
        ...((scene[ax] as Record<string, unknown>) ?? {}),
        ...(Array.isArray(flAx.range) ? { range: [...flAx.range], autorange: false } : {}),
        showgrid: false,
        zeroline: false,
        showline: false,
        showticklabels: false,
        ticks: '',
        showspikes: false,
        title: { text: '' }
      }
    }
    if (fl.aspectratio) {
      scene.aspectmode = 'manual'
      scene.aspectratio = { ...(fl.aspectratio as object) }
    }
    layout[key] = scene
  }
  fullData.forEach((t, i) => {
    // strokeAxes3d's drawn labels: the overlay sets them as text (oeText), so not in the bitmap too
    if (t.meta?.oeTextFill) {
      if (data[i]) data[i] = { ...data[i], visible: false }
      return
    }
    if (t.type !== 'scatter3d' || t.visible !== true || !t.mode?.includes('lines')) return
    // A colour-mapped line stays in the bitmap: one CSS colour can't stand in for it.
    if (typeof t.line?.color !== 'string') return
    drawn.add(i)
    const d = data[i]
    if (!d) return
    if (t.mode.includes('markers') || t.mode.includes('text'))
      data[i] = { ...d, mode: t.mode.replace(/\+?lines\+?/, '') || 'markers' }
    else data[i] = { ...d, visible: false }
  })
  return drawn
}

/** One live scene's overlay: its axis chrome and the given line traces, as SVG. */
function scenePlan(
  sceneId: string,
  sc: LiveScene,
  fullData: FullTrace[],
  drawn: Set<number>,
  sub: Map<string, string>
): ScenePlan {
  const P = projector(sc)
  const ax = sc.glplot.axes
  const { model, view, projection, _ortho } = sc.glplot.cameraParams
  const bounds = ax.bounds
  const { cubeEdges, axis } = ax.lastCubeProps
  const scale = sc.dataScale
  const toWorld = (v: [unknown, unknown, unknown]): Vec3 | null => {
    const out: number[] = []
    for (let i = 0; i < 3; i++) {
      if (v[i] == null) return null
      const l = sc.fullSceneLayout[AXES[i]].d2l(v[i])
      if (!Number.isFinite(l)) return null
      out.push(l * scale[i])
    }
    return out as Vec3
  }

  // ── Occluders: every visible surface, as projected triangles ──
  const W = Math.ceil(P.width)
  const H = Math.ceil(P.height)
  type Px = { x: number; y: number; w: number }
  const surfaces: {
    index: number
    opacity: number
    tris: { v: [Px, Px, Px]; grow: [boolean, boolean, boolean] }[]
    discs?: { p: Px; r: number }[]
  }[] = []
  fullData.forEach((t, index) => {
    if (t.type !== 'surface' || t.scene !== sceneId || t.visible !== true) return
    const z = Array.from((t.z ?? []) as ArrayLike<unknown>[], (r) => Array.from(r ?? []))
    const xs = (t.x ?? []) as unknown[]
    const ys = (t.y ?? []) as unknown[]
    const at = (i: number, j: number): unknown[] => {
      const xv = Array.isArray(xs[i]) ? (xs[i] as unknown[])[j] : (xs[j] ?? j)
      const yv = Array.isArray(ys[i]) ? (ys[i] as unknown[])[j] : (ys[i] ?? i)
      return [xv, yv, z[i]?.[j]]
    }
    const grid = z.map((row, i) =>
      Array.from(row ?? [], (_, j) => {
        const w = toWorld(at(i, j) as [unknown, unknown, unknown])
        return w ? P.px(w) : null
      })
    )
    const tris: { v: [Px, Px, Px]; grow: [boolean, boolean, boolean] }[] = []
    // An edge is inner when a cell lies on its other side too (no grid border, no missing value).
    const cell = (i: number, j: number): boolean =>
      !!grid[i]?.[j] && !!grid[i]?.[j + 1] && !!grid[i + 1]?.[j] && !!grid[i + 1]?.[j + 1]
    for (let i = 0; i + 1 < grid.length; i++)
      for (let j = 0; j + 1 < grid[i].length; j++) {
        const a = grid[i][j]
        const b = grid[i][j + 1]
        const c = grid[i + 1][j]
        const d = grid[i + 1][j + 1]
        const full = !!(a && b && c && d)
        // grow flags are per edge opposite each vertex: [v1–v2, v2–v0, v0–v1]
        if (a && b && c)
          tris.push({
            v: [a, b, c],
            grow: [full, j > 0 && cell(i, j - 1), i > 0 && cell(i - 1, j)]
          })
        if (b && c && d)
          tris.push({
            v: [b, d, c],
            grow: [
              i + 2 < grid.length && cell(i + 1, j),
              full,
              j + 2 < grid[i].length && cell(i, j + 1)
            ]
          })
      }
    surfaces.push({ index, opacity: t.opacity ?? 1, tris })
  })
  // Markers hide what's behind them too (they stay in the bitmap): discs ~1.78 × marker.size
  // across, as gl-scatter3d draws them (measured).
  fullData.forEach((t, index) => {
    const m = (t as { marker?: { size?: unknown; opacity?: unknown } }).marker
    if (t.type !== 'scatter3d' || t.scene !== sceneId || t.visible !== true) return
    if (!t.mode?.includes('markers') || !m) return
    const n = Math.max(t.x?.length ?? 0, t.y?.length ?? 0, t.z?.length ?? 0)
    const discs: { p: Px; r: number }[] = []
    for (let j = 0; j < n; j++) {
      const w = toWorld([t.x?.[j], t.y?.[j], t.z?.[j]])
      const size = Array.isArray(m.size) ? Number(m.size[j]) : Number(m.size ?? 8)
      if (w && size > 0) discs.push({ p: P.px(w), r: 0.888 * size })
    }
    const mo = typeof m.opacity === 'number' ? m.opacity : 1
    surfaces.push({ index, opacity: (t.opacity ?? 1) * mo, tris: [], discs })
  })
  /** What hides a line, by gl-plot3d's passes (checked against Plotly's own render): an opaque
   *  surface hides it; a translucent one lets it show through at (1 − opacity) — except that a
   *  translucent LINE drawn after a translucent surface is blended over it, unoccluded. */
  interface Occluders {
    hard: DepthBuffer
    soft: DepthBuffer
    /** how much of a line behind `soft` shows through */
    through: number
  }
  const occCache = new Map<string, Occluders>()
  const occluders = (line: { index: number; opacity: number } | null): Occluders => {
    const translucent = !!line && line.opacity < 1
    const key = translucent ? `t${line.index}` : 'opaque'
    const hit = occCache.get(key)
    if (hit) return hit
    const hard = new DepthBuffer(W, H, DEPTH_RES)
    const soft = new DepthBuffer(W, H, DEPTH_RES)
    let softOpacity = 0
    for (const sf of surfaces) {
      const into = (buf: DepthBuffer): void => {
        for (const t of sf.tris) buf.triangle(...t.v, t.grow)
        for (const d of sf.discs ?? []) buf.disc(d.p.x, d.p.y, d.r, d.p.w)
      }
      if (sf.opacity >= 1) into(hard)
      else if (!translucent || sf.index > line.index) {
        softOpacity = Math.max(softOpacity, sf.opacity)
        into(soft)
      }
    }
    const occ = { hard, soft, through: 1 - softOpacity }
    occCache.set(key, occ)
    return occ
  }
  // Depth slack, as a share of the box's depth: a data curve drawn ON the surface sits at the
  // surface's own depth (give it room); axis chrome lies on the box, and where a surface meets
  // it (a gridline under the surface's edge) the surface wins, as it does on screen.
  const corners: number[] = []
  for (let i = 0; i < 8; i++)
    corners.push(P.px([bounds[i & 1][0], bounds[(i >> 1) & 1][1], bounds[(i >> 2) & 1][2]]).w)
  const boxDepth = Math.max(...corners) - Math.min(...corners) || 1
  const CHROME_EPS = -0.002 * boxDepth
  const CURVE_EPS = 0.04 * boxDepth

  /** A world-space polyline as path data, split into visible and hidden runs. Each segment is
   *  tested every ~1 CSS px; flickers shorter than MIN_RUN px (a line grazing a surface edge-on)
   *  take their neighbours' state. A straight 3-D segment projects straight, so a run needs a
   *  point only at the polyline's vertices and where the visibility changes. */
  const MIN_RUN = 3
  const polyline = (
    pts: (Vec3 | null)[],
    occ: Occluders,
    onSurface = false
  ): { shown: string; hidden: string } => {
    const eps = onSurface ? CURVE_EPS : CHROME_EPS
    const behind = (buf: DepthBuffer, p: Px): boolean =>
      p.w > (onSurface ? buf.around(p.x, p.y) : buf.at(p.x, p.y)) + eps
    const runs = { shown: '', hidden: '' }
    const lerp = (a: Vec3, b: Vec3, f: number): Vec3 => [
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f
    ]
    const pt = (p: { x: number; y: number }): string => `${fmt(p.x)},${fmt(p.y)}`
    // One chain of consecutive non-null points at a time.
    const chain = (c: Vec3[]): void => {
      if (c.length < 2) return
      // samples: the start point of each ~1 px step, its state, and whether its end is a vertex
      const at: { x: number; y: number }[] = []
      // 0 shown, 1 behind a translucent surface, 2 behind an opaque one (not drawn)
      const state: number[] = []
      const vertexEnd: boolean[] = []
      for (let k = 0; k + 1 < c.length; k++) {
        const pa = P.px(c[k])
        const pb = P.px(c[k + 1])
        const n = Math.max(1, Math.ceil(Math.hypot(pb.x - pa.x, pb.y - pa.y)))
        for (let s = 0; s < n; s++) {
          at.push(s === 0 ? pa : P.px(lerp(c[k], c[k + 1], s / n)))
          const mid = P.px(lerp(c[k], c[k + 1], (s + 0.5) / n))
          state.push(behind(occ.hard, mid) ? 2 : behind(occ.soft, mid) ? 1 : 0)
          vertexEnd.push(s === n - 1)
        }
      }
      at.push(P.px(c[c.length - 1]))
      for (let i = 0; i < state.length;) {
        let j = i
        while (j < state.length && state[j] === state[i]) j++
        if (j - i < MIN_RUN && (i > 0 || j < state.length)) {
          const to = i > 0 ? state[i - 1] : state[j]
          for (let q = i; q < j; q++) state[q] = to
        }
        i = j
      }
      const put = (st: number, d: string): void => {
        if (st === 0) runs.shown += d
        else if (st === 1) runs.hidden += d
      }
      let d = ''
      for (let i = 0; i < state.length; i++) {
        if (i === 0 || state[i] !== state[i - 1]) {
          if (i > 0) {
            d += `L${pt(at[i])}`
            put(state[i - 1], d)
          }
          d = `M${pt(at[i])}`
        }
        if (vertexEnd[i] || i === state.length - 1) d += `L${pt(at[i + 1])}`
      }
      put(state[state.length - 1], d)
    }
    let cur: Vec3[] = []
    for (const p of pts) {
      if (p) cur.push(p)
      else {
        chain(cur)
        cur = []
      }
    }
    chain(cur)
    return runs
  }

  const lines: string[] = []
  const chromeOcc = occluders(null)
  const stroke = (
    d: { shown: string; hidden: string },
    color: { color: string; opacity: number },
    width: number,
    extra = '',
    through = chromeOcc.through
  ): void => {
    const base = `fill="none" stroke="${color.color}" stroke-width="${fmt(width)}"${extra}`
    if (d.shown)
      lines.push(
        `<path d="${d.shown}" ${base}${color.opacity < 1 ? ` stroke-opacity="${fmt(color.opacity)}"` : ''}/>`
      )
    // Behind a translucent surface, WebGL blends the line UNDER the surface: what shows through is
    // the line's difference from the ground behind it, (1 − α)·(line − ground). Drawn on top of
    // the bitmap instead, it's scaled by that difference — so a pale gridline behind the surface
    // all but vanishes, as on screen, while a dark curve still shows faintly.
    const k = through * contrastWithWhite(color.color)
    if (d.hidden && k > 0.005)
      lines.push(`<path d="${d.hidden}" ${base} stroke-opacity="${fmt(color.opacity * k)}"/>`)
  }

  /** A world-space polyline whole, for the layer under the bitmap (no occlusion). */
  const back: string[] = []
  const backStroke = (
    pts: (Vec3 | null)[],
    color: { color: string; opacity: number },
    width: number
  ): void => {
    let d = ''
    let open = false
    for (const p of pts) {
      if (!p) {
        open = false
        continue
      }
      const q = P.px(p)
      d += `${open ? 'L' : 'M'}${fmt(q.x)},${fmt(q.y)}`
      open = true
    }
    if (d)
      back.push(
        `<path d="${d}" fill="none" stroke="${color.color}" stroke-width="${fmt(width)}"` +
          `${color.opacity < 1 ? ` stroke-opacity="${fmt(color.opacity)}"` : ''}/>`
      )
  }

  // ── Axis chrome, as gl-axes draw() lays it out ──
  // (Its line widths, like gl-line3d's, come out half as wide in CSS px — measured.)
  // Per axis: where its line, ticks and labels sit on the cube (primal) and which way is out.
  const offsets = [0, 1, 2].map((e) => {
    const primalOffset: Vec3 = [0, 0, 0]
    const mirrorOffset: Vec3 = [0, 0, 0]
    const primalMinor: Vec3 = [0, 0, 0]
    const mirrorMinor: Vec3 = [0, 0, 0]
    for (let u = 0; u < 3; u++) {
      if (u === e) continue
      let h = primalOffset
      let f = mirrorOffset
      let p = primalMinor
      let d = mirrorMinor
      if (cubeEdges[e] & (1 << u)) {
        h = mirrorOffset
        f = primalOffset
        p = mirrorMinor
        d = primalMinor
      }
      h[u] = bounds[0][u]
      f[u] = bounds[1][u]
      if (axis[u] > 0) {
        p[u] = -1
        d[u] = 0
      } else {
        p[u] = 0
        d[u] = 1
      }
    }
    return { primalOffset, mirrorOffset, primalMinor, mirrorMinor }
  })
  // World units per CSS px at the view centre (gl-axes' pixel → world factor).
  const k =
    ((_ortho ? 2 : 1) *
      (projection[3] * view[12] +
        projection[7] * view[13] +
        projection[11] * view[14] +
        projection[15] * view[15])) /
    P.height
  const range = (a: number, at: Vec3): Vec3[] => {
    const p0 = [...at] as Vec3
    const p1 = [...at] as Vec3
    p0[a] = bounds[0][a]
    p1[a] = bounds[1][a]
    return [p0, p1]
  }

  for (let A = 0; A < 3; A++) {
    const face: Vec3 = [0, 0, 0]
    face[A] = axis[A] > 0 ? bounds[1][A] : bounds[0][A]
    for (let s = 0; s < 2; s++) {
      const z = (A + 1 + s) % 3
      const o = (A + 1 + (1 ^ s)) % 3
      if (ax.gridEnable[z])
        for (const t of ax.ticks[z]) {
          const at = [...face] as Vec3
          at[z] = t.x
          backStroke(range(o, at), cssColor(ax.gridColor[z], sub), ax.gridWidth[z] / 2)
        }
    }
    for (let s = 0; s < 2; s++) {
      const z = (A + 1 + s) % 3
      const o = (A + 1 + (1 ^ s)) % 3
      if (
        ax.zeroEnable[o] &&
        Math.min(bounds[0][o], bounds[1][o]) <= 0 &&
        Math.max(bounds[0][o], bounds[1][o]) >= 0
      )
        backStroke(range(z, face), cssColor(ax.zeroLineColor[o], sub), ax.zeroLineWidth[o] / 2)
    }
  }
  for (let A = 0; A < 3; A++) {
    const off = offsets[A]
    if (ax.lineEnable[A])
      stroke(
        polyline(range(A, off.primalOffset), chromeOcc),
        cssColor(ax.lineColor[A], sub),
        ax.lineWidth[A] / 2
      )
    if (ax.lineMirror[A])
      stroke(
        polyline(range(A, off.mirrorOffset), chromeOcc),
        cssColor(ax.lineColor[A], sub),
        ax.lineWidth[A] / 2
      )
    const tickMarks = (offset: Vec3, minor: Vec3): void => {
      const D = minor.map((m, P2) => (m * ax.lineTickLength[P2] * k) / model[5 * P2]) as Vec3
      for (const t of ax.ticks[A]) {
        const p0 = [...offset] as Vec3
        p0[A] = t.x
        const p1: Vec3 = [p0[0] + D[0], p0[1] + D[1], p0[2] + D[2]]
        stroke(
          polyline([p0, p1], chromeOcc),
          cssColor(ax.lineTickColor[A], sub),
          ax.lineTickWidth[A] / 2
        )
      }
    }
    if (ax.lineTickEnable[A]) tickMarks(off.primalOffset, off.primalMinor)
    if (ax.lineTickMirror[A]) tickMarks(off.mirrorOffset, off.mirrorMinor)
  }

  // ── Data lines ──
  const texts: string[] = []
  fullData.forEach((t, i) => {
    if (!drawn.has(i) || t.scene !== sceneId) return
    // A stroke-font text trace (strokeAxes3d's labels) is set as real text instead, each label
    // mapped onto the plane it lies in: its reading direction and up, projected, as the matrix.
    const labels = t.meta?.oeText
    if (Array.isArray(labels)) {
      const raw = String(t.line?.color)
      const color = sub.get(raw.toLowerCase()) ?? raw
      for (const l of labels) {
        const a = toWorld(l.at)
        const d = toWorld(l.dir)
        const u = toWorld(l.up)
        if (!a || !d || !u || !l.s) continue
        const o = P.px(a)
        const dx = P.px(d)
        const ux = P.px(u)
        // Set at TEXT_PX and scaled down by the matrix: under a shear, Chromium's PDF output (the
        // clipboard's PDF, which Illustrator pastes) sets small, hinted, kerned type as one
        // positioned run per glyph or pair, and Illustrator imports each run as its own text.
        const k = l.cap / CAP_RATIO / TEXT_PX
        const fine = (n: number): string => (Math.round(n * 1e5) / 1e5).toString()
        const m = [
          fine((dx.x - o.x) * k),
          fine((dx.y - o.y) * k),
          fine(-(ux.x - o.x) * k),
          fine(-(ux.y - o.y) * k),
          fmt(o.x),
          fmt(o.y)
        ]
        texts.push(
          `<text x="0" y="0" text-anchor="${l.align}" transform="matrix(${m.join(' ')})"` +
            ` style="font-family: sans-serif; font-size: ${TEXT_PX}px; fill: ${color};` +
            ` text-rendering: geometricPrecision; font-kerning: none; font-variant-ligatures: none;` +
            ` fill-opacity: ${fmt(t.opacity ?? 1)}; white-space: pre;">${esc(l.s)}</text>`
        )
      }
      return
    }
    const n = Math.max(t.x?.length ?? 0, t.y?.length ?? 0, t.z?.length ?? 0)
    const pts: (Vec3 | null)[] = []
    for (let j = 0; j < n; j++) pts.push(toWorld([t.x?.[j], t.y?.[j], t.z?.[j]]))
    // A line trace marked as the back layer (strokeAxes3d's gridlines) goes under the bitmap.
    if (t.meta?.oeLayer === 'back') {
      const raw = String(t.line?.color)
      backStroke(
        pts,
        { color: sub.get(raw.toLowerCase()) ?? raw, opacity: t.opacity ?? 1 },
        (t.line?.width ?? 2) / 2
      )
      return
    }
    // gl-line3d draws a `width` line half that wide in CSS px (measured).
    const width = (t.line?.width ?? 2) / 2
    const dash =
      t.line?.dash === 'dot'
        ? `${fmt(width)},${fmt(width * 2)}`
        : t.line?.dash === 'dash' || t.line?.dash === 'longdash'
          ? `${fmt(width * 4)},${fmt(width * 2)}`
          : t.line?.dash === 'dashdot'
            ? `${fmt(width * 4)},${fmt(width * 2)},${fmt(width)},${fmt(width * 2)}`
            : ''
    const raw = String(t.line?.color)
    const occ = occluders({ index: i, opacity: t.opacity ?? 1 })
    stroke(
      // drawn axes (strokeAxes3d: gridlines, axis lines) lie on the box, not on a surface
      polyline(pts, occ, t.meta?.oeRole !== 'axes'),
      { color: sub.get(raw.toLowerCase()) ?? raw, opacity: t.opacity ?? 1 },
      width,
      ` stroke-linejoin="round" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}`,
      occ.through
    )
  })

  // ── Text: tick labels and axis titles, as gl-axes' text pass places them ──
  const viewAngle = (a: Vec3, b: Vec3): number => {
    const A2 = P.ndc(a)
    const B2 = P.ndc(b)
    return Math.atan2((B2[1] - A2[1]) * P.height, (B2[0] - A2[0]) * P.width)
  }
  const unit = (i: number): Vec3 => {
    const v: Vec3 = [0, 0, 0]
    v[i] = 1
    return v
  }
  /** One text, as the shader rotates it: `axisVec` (0 for a title), `alignDir`, `align`. */
  const text = (
    raw: string,
    at: Vec3,
    axisVec: Vec3,
    alignDir: Vec3,
    align: [number, number, number],
    angle: number,
    size: number,
    font: string,
    color: Rgba
  ): void => {
    if (!raw) return
    let beta = angle
    if (align[2] !== 0) {
      const isTitle = !axisVec[0] && !axisVec[1] && !axisVec[2]
      let axisAngle = isTitle
        ? HALF_PI
        : viewAngle(at, [at[0] + axisVec[0], at[1] + axisVec[1], at[2] + axisVec[2]])
      let clipAngle = viewAngle(at, [at[0] + alignDir[0], at[1] + alignDir[1], at[2] + alignDir[2]])
      if (!alignDir[0] && !alignDir[1] && !alignDir[2]) clipAngle = 0
      if (Math.sin(axisAngle) < 0) axisAngle += Math.PI
      if (Math.sin(clipAngle) < 0) clipAngle += Math.PI
      const flip =
        Math.cos(axisAngle) * Math.sin(clipAngle) + Math.sin(axisAngle) * -Math.cos(clipAngle) > 0
          ? 1
          : 0
      beta += applyAlignOption(align[0], clipAngle, flip * Math.PI, align[1])
    }
    const p = P.px(at)
    const c = cssColor(color, sub)
    const deg = (-beta * 180) / Math.PI
    texts.push(
      `<text x="${fmt(p.x)}" y="${fmt(p.y)}" dy="0.35em" text-anchor="middle"` +
        (Math.abs(deg) > 0.01 ? ` transform="rotate(${fmt(deg)} ${fmt(p.x)} ${fmt(p.y)})"` : '') +
        ` style="font-family: ${esc(font)}; font-size: ${fmt(size)}px; fill: ${c.color}; fill-opacity: ${fmt(c.opacity)}; white-space: pre;">` +
        richText(raw, size) +
        '</text>'
    )
  }
  const alignOf = (v: string | number): number => (v === 'auto' ? 0 : parseInt(String(v), 10) || 0)
  for (let A = 0; A < 3; A++) {
    const U = offsets[A].primalMinor
    const V = offsets[A].mirrorMinor
    const q = [...offsets[A].primalOffset] as Vec3
    for (let P2 = 0; P2 < 3; P2++)
      if (ax.lineTickEnable[A])
        q[P2] += (k * U[P2] * Math.max(ax.lineTickLength[P2], 0)) / model[5 * P2]
    if (ax.tickEnable[A]) {
      // gl-axes' j(): which neighbouring axis the tick text aligns along
      let C: Vec3 = [0, 0, 0]
      const n = (A + 1) % 3
      const i = (A + 2) % 3
      if (U[n] && V[i]) C = unit(n)
      else if (U[i] && V[n]) C = unit(i)
      for (let P2 = 0; P2 < 3; P2++) q[P2] += (k * U[P2] * ax.tickPad[P2]) / model[5 * P2]
      // On a redraw gl-axes keeps an 'auto' tick angle as align -1 (horizontal), as it drew it.
      const align: [number, number, number] =
        ax.tickAngle[A] === -3600 ? [0, 0.5, 1] : [alignOf(ax.tickAlign[A]), 0.5, 1]
      const angle = ax.tickAngle[A] === -3600 ? 0 : ax.tickAngle[A]
      for (const t of ax.ticks[A]) {
        if (!t.text) continue
        const at = [...q] as Vec3
        at[A] += t.x
        text(
          t.text,
          at,
          unit(A),
          C,
          align,
          angle,
          ax.tickSize[A] * ((t.fontSize ?? 12) / 12),
          t.font ?? ax.tickFont[A],
          ax.tickColor[A]
        )
      }
    }
    if (ax.labelEnable[A] && ax.labels[A]) {
      const long = ax.labels[A].length > 4
      for (let P2 = 0; P2 < 3; P2++) q[P2] += (k * U[P2] * ax.labelPad[P2]) / model[5 * P2]
      q[A] += 0.5 * (bounds[0][A] + bounds[1][A])
      text(
        ax.labels[A],
        q,
        [0, 0, 0],
        long ? unit(A) : [0, 0, 0],
        [alignOf(ax.labelAlign[A]), 0.5, long ? 1 : 0],
        ax.labelAngle[A],
        ax.labelSize[A],
        ax.labelFont[A],
        ax.labelColor[A]
      )
    }
  }

  return {
    width: P.width,
    height: P.height,
    body: lines.join('') + texts.join(''),
    back: back.join('')
  }
}

/** Every 3-D scene's overlay, read from the LIVE graph div (its camera, axes and data); null if
 *  any scene's state can't be read. */
export function sceneOverlays(
  gd: Element,
  drawn: Set<number>,
  sub: Map<string, string>
): ScenePlan[] | null {
  const live = gd as unknown as {
    _fullLayout?: Record<string, unknown> & { _subplots?: { gl3d?: string[] } }
    _fullData?: FullTrace[]
  }
  const fl = live._fullLayout ?? {}
  const ids = fl._subplots?.gl3d ?? Object.keys(fl).filter((k) => /^scene\d*$/.test(k))
  const plans: ScenePlan[] = []
  for (const id of ids) {
    const sc = (fl[id] as { _scene?: LiveScene } | undefined)?._scene
    if (!sc?.glplot?.axes?.lastCubeProps || !sc.glplot.cameraParams) return null
    plans.push(scenePlan(id, sc, live._fullData ?? [], drawn, sub))
  }
  return plans.length ? plans : null
}

/** Put each plan around its scene's bitmap in Plotly's SVG — its back layer just before the n-th
 *  embedded image, the rest just after — mapped onto that image's box. */
export function insertSceneOverlays(svg: string, plans: ScenePlan[]): string {
  if (!plans.length) return svg
  let n = 0
  return svg.replace(/<image\b[^>]*?(?:\/>|>\s*<\/image>)/g, (img) => {
    const plan = plans[n++]
    if (!plan) return img
    const num = (a: string): number =>
      parseFloat(new RegExp(`\\s${a}="([-\\d.e]+)"`).exec(img)?.[1] ?? '0')
    const x = num('x')
    const y = num('y')
    const w = num('width') || plan.width
    const h = num('height') || plan.height
    const sx = w / plan.width
    const sy = h / plan.height
    const xf =
      Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3
        ? `translate(${fmt(x)},${fmt(y)})`
        : `translate(${fmt(x)},${fmt(y)}) scale(${sx},${sy})`
    // Clipped to the scene's box, as the WebGL canvas clipped the same lines and text on screen.
    const layer = (cls: string, id: string, body: string): string =>
      body
        ? `<g class="${cls}" transform="${xf}">` +
          `<clipPath id="${id}"><rect width="${fmt(plan.width)}" height="${fmt(plan.height)}"/></clipPath>` +
          `<g clip-path="url(#${id})">${body}</g></g>`
        : ''
    return (
      layer('oe-scene-back', `oe-scene-back-${n}`, plan.back) +
      img +
      layer('oe-scene-vector', `oe-scene-clip-${n}`, plan.body)
    )
  })
}
