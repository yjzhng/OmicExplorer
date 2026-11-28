/**
 * Density binning for very dense point clouds. Past ~100k points even WebGL drawing and hover get
 * slow (and the SVG fallback is very slow), so a view's non-interactive BULK — the grey "not
 * significant" background, flagged by the view with `__oeBin: true` — draws as a 2-D histogram
 * (a precomputed `heatmap`, zero bins transparent, opacity rising with the count) in the points'
 * own colour, once that trace holds more than BIN_MIN_POINTS points. The bulk's points that matter
 * stay real markers: the labelled ones (collision-label candidates); everything else that matters
 * already sits in other traces (significant groups, genesets) or the highlight overlay, which is
 * built from the view's FULL traces, so a pinned or hovered gene inside the bulk is still drawn,
 * ringed and named where it lies.
 *
 * Applied once, in PlotlyChart, to the traces it hands Plotly: the view's traces stay the source
 * of truth for the highlight index (positions, ids, colours), and the binned trace keeps its slot
 * (index) as the marker subset, so a restyle of trace i still lands on trace i. The density and an
 * invisible extent trace (the bulk's extreme points, so the autorange is exactly the points') are
 * appended after the view's traces.
 *
 * Below the threshold nothing changes: the input array itself comes back (or, when a view flagged
 * a trace, the traces with only the private flag removed).
 */

/** Points in one flagged trace above which it draws as a density. */
export const BIN_MIN_POINTS = 100_000

/** Histogram size (columns × rows) — about a tile's pixel grid at 2 px per bin. */
export const DENSITY_BINS_X = 300
export const DENSITY_BINS_Y = 200

/** The threshold in force: BIN_MIN_POINTS, or a `localStorage['oe.binMin']` override (testing). */
function binMin(): number {
  try {
    const v = Number(localStorage.getItem('oe.binMin'))
    return v > 0 ? v : BIN_MIN_POINTS
  } catch {
    return BIN_MIN_POINTS
  }
}

/** The view's opt-in: this trace is background bulk and may be drawn as a density. */
export const BIN_FLAG = '__oeBin'
/** On a density trace: the index of the view trace it stands for (the highlight dims it with it). */
export const DENSITY_OF = '__oeDensityOf'
/** On a density trace: the binned points' own positions and sizes (the label layer's obstacles). */
export const BIN_POINTS = '__oeBinPts'
/** On the marker subset left in a binned trace's slot: every id of the full trace (legend pinning). */
export const BIN_IDS = '__oeBinIds'
/** Marks the invisible extent trace. */
export const BIN_EXTENT = '__oeBinExtent'

type Trace = Record<string, unknown> & {
  x?: unknown
  y?: unknown
  customdata?: unknown
  marker?: Record<string, unknown>
}

export interface BinnedTraces {
  /** the traces to draw: the view's (binned ones replaced by their marker subset), then each
   *  binned trace's density and extent */
  traces: unknown[]
  /** view trace index → index (in `traces`) of its density trace */
  density: Map<number, number>
}

/** [r, g, b] of a #rgb / #rrggbb / rgb() / rgba() colour; null for anything else. */
function rgbOf(c: unknown): [number, number, number] | null {
  if (typeof c !== 'string') return null
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim())
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1]
    const n = parseInt(h, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(c.trim())
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

/** The trace without the view's opt-in flag. */
function unflagged(t: Trace): Trace {
  const { [BIN_FLAG]: _drop, ...rest } = t
  void _drop
  return rest
}

/** A copy of `obj` with every per-point array (length n) cut to the kept points. */
function sliceArrays(obj: Record<string, unknown>, n: number, keep: number[]) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj))
    out[k] = Array.isArray(v) && v.length === n ? keep.map((i) => v[i]) : v
  return out
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Whether a trace can bin: flagged, a plain numeric marker cloud in one parseable colour. */
function binnable(t: Trace, min: number): boolean {
  if (!t || typeof t !== 'object' || !t[BIN_FLAG]) return false
  if (((t.type as string | undefined) ?? 'scatter') !== 'scatter' || t.mode !== 'markers')
    return false
  const xs = t.x
  const ys = t.y
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length) return false
  if (xs.length <= min) return false
  return rgbOf(t.marker?.color) != null
}

/** Whether any trace of the plot would draw as a density. */
export function wouldBin(data: unknown[], min = binMin()): boolean {
  return data.some((raw) => binnable(raw as Trace, min))
}

/**
 * The traces with every flagged trace of more than `min` points split into its kept markers (the
 * points whose id is in `keepIds`), a density of the rest and an invisible extent trace. Returns
 * the input array itself when no trace carries the flag.
 */
export function binDenseTraces(
  data: unknown[],
  keepIds: ReadonlySet<string> = new Set(),
  min = binMin(),
  bins: { x: number; y: number } = { x: DENSITY_BINS_X, y: DENSITY_BINS_Y }
): BinnedTraces {
  const density = new Map<number, number>()
  if (!data.some((raw) => raw && (raw as Trace)[BIN_FLAG])) return { traces: data, density }
  const traces: unknown[] = []
  const extra: unknown[] = []
  data.forEach((raw, i) => {
    const t = raw as Trace
    if (!t || !t[BIN_FLAG]) return void traces.push(raw)
    if (!binnable(t, min)) return void traces.push(unflagged(t))
    const parts = splitTrace(unflagged(t), keepIds, bins, i)
    traces.push(parts.markers)
    density.set(i, data.length + extra.length)
    extra.push(parts.density, parts.extent)
  })
  return { traces: [...traces, ...extra], density }
}

function splitTrace(
  t: Trace,
  keepIds: ReadonlySet<string>,
  bins: { x: number; y: number },
  index: number
): { markers: Trace; density: Trace; extent: Trace } {
  const xs = t.x as unknown[]
  const ys = t.y as unknown[]
  const n = xs.length
  const cd = Array.isArray(t.customdata) ? (t.customdata as unknown[]) : []
  const mk = (t.marker ?? {}) as Record<string, unknown>
  const line = (mk.line ?? {}) as Record<string, unknown>
  const group = (t.legendgroup as string | undefined) ?? `__oeBin${index}`

  // Kept points → markers; the rest → bins. The extent spans every finite point.
  const keep: number[] = []
  let xLo = Infinity
  let xHi = -Infinity
  let yLo = Infinity
  let yHi = -Infinity
  const ext = [-1, -1, -1, -1] // indices of the points at xLo, xHi, yLo, yHi
  for (let k = 0; k < n; k++) {
    const id = cd[k]
    if (typeof id === 'string' && keepIds.has(id)) keep.push(k)
    const x = xs[k]
    const y = ys[k]
    if (!finite(x) || !finite(y)) continue
    if (x < xLo) {
      xLo = x
      ext[0] = k
    }
    if (x > xHi) {
      xHi = x
      ext[1] = k
    }
    if (y < yLo) {
      yLo = y
      ext[2] = k
    }
    if (y > yHi) {
      yHi = y
      ext[3] = k
    }
  }
  const kept = new Set(keep)

  // The 2-D histogram over [xLo, xHi] × [yLo, yHi]: cells of dx × dy, the last row/column closed.
  const nx = xHi > xLo ? bins.x : 1
  const ny = yHi > yLo ? bins.y : 1
  const dx = xHi > xLo ? (xHi - xLo) / nx : 1
  const dy = yHi > yLo ? (yHi - yLo) / ny : 1
  const counts = new Uint32Array(nx * ny)
  let peak = 0
  for (let k = 0; k < n; k++) {
    if (kept.has(k)) continue
    const x = xs[k]
    const y = ys[k]
    if (!finite(x) || !finite(y)) continue
    const ix = Math.min(nx - 1, Math.floor((x - xLo) / dx))
    const iy = Math.min(ny - 1, Math.floor((y - yLo) / dy))
    const c = ++counts[iy * nx + ix]
    if (c > peak) peak = c
  }
  // z = 1 + log10(count): a lone point still shows, the core doesn't swamp the wings; an empty
  // bin is null (transparent, no hover).
  const z: (number | null)[][] = []
  for (let r = 0; r < ny; r++) {
    const row: (number | null)[] = new Array(nx)
    for (let c = 0; c < nx; c++) {
      const v = counts[r * nx + c]
      row[c] = v ? 1 + Math.log10(v) : null
    }
    z.push(row)
  }
  const [r, g, b] = rgbOf(mk.color)!
  const alpha = typeof mk.opacity === 'number' ? mk.opacity : 0.85
  const rgba = (a: number): string => `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`
  const axes = { xaxis: t.xaxis, yaxis: t.yaxis }
  const ownAxes = Object.fromEntries(Object.entries(axes).filter(([, v]) => v !== undefined))

  const markers: Trace = {
    ...sliceArrays(t, n, keep),
    marker: {
      ...sliceArrays(mk, n, keep),
      ...(mk.line ? { line: sliceArrays(line, n, keep) } : {})
    },
    legendgroup: group,
    [BIN_IDS]: cd
  }
  const densityTrace: Trace = {
    type: 'heatmap',
    x0: xLo + dx / 2,
    dx,
    y0: yLo + dy / 2,
    dy,
    z,
    zmin: 1,
    zmax: Math.max(1 + Math.log10(Math.max(peak, 1)), 1 + 1e-6),
    zsmooth: false,
    colorscale: [
      [0, rgba(alpha * 0.3)],
      [1, rgba(alpha)]
    ],
    showscale: false,
    showlegend: false,
    hoverinfo: 'skip',
    hoverongaps: false,
    legendgroup: group,
    ...ownAxes,
    [DENSITY_OF]: index,
    [BIN_POINTS]: { x: xs, y: ys, size: mk.size }
  }
  const ex = [...new Set(ext.filter((k) => k >= 0))]
  const pick = (v: unknown): unknown =>
    Array.isArray(v) && v.length === n ? ex.map((k) => v[k]) : v
  const extent: Trace = {
    type: 'scatter',
    mode: 'markers',
    x: ex.map((k) => xs[k]),
    y: ex.map((k) => ys[k]),
    // the points' own sizes and outlines, so the autorange pads exactly as for the full cloud
    marker: {
      size: pick(mk.size),
      opacity: 0,
      ...(mk.line ? { line: { width: pick(line.width) } } : {})
    },
    hoverinfo: 'skip',
    showlegend: false,
    legendgroup: group,
    ...ownAxes,
    [BIN_EXTENT]: true
  }
  return { markers, density: densityTrace, extent }
}

/** Counts per bin of a density trace (inverse of its z) — for tests and diagnostics. */
export function densityCounts(t: { z?: (number | null)[][] }): number[][] {
  return (t.z ?? []).map((row) => row.map((v) => (v == null ? 0 : Math.round(10 ** (v - 1)))))
}
