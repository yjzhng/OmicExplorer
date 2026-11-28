/**
 * WebGL for dense point clouds. An SVG `scatter` draws one DOM element per point, so a plot of
 * thousands of features pays for every one of them on each zoom, pan and redraw; `scattergl` draws
 * the same markers on the GPU in one canvas. Only plain marker clouds switch (no lines, text or
 * fills — scattergl handles those differently), and only once the plot holds enough of them to be
 * worth a WebGL context: Chromium keeps ~16 per page, so small plots stay SVG.
 *
 * Copy/export swaps them back (toSvgTraces), so a copied or exported plot stays all-vector.
 */

/** Total plain-marker points in one plot at which its marker traces switch to WebGL. */
export const GL_MIN_POINTS = 3000

/** The threshold in force: GL_MIN_POINTS, or a `localStorage['oe.glMin']` override (testing). */
function glMin(): number {
  try {
    const v = Number(localStorage.getItem('oe.glMin'))
    return v > 0 ? v : GL_MIN_POINTS
  } catch {
    return GL_MIN_POINTS
  }
}

interface MaybeTrace {
  type?: string
  mode?: string
  fill?: string
  x?: unknown
  __oeNoGl?: boolean
}

/** A trace that draws as plain markers and can be handed to scattergl unchanged. */
function glEligible(t: MaybeTrace): boolean {
  if (!t || typeof t !== 'object' || t.__oeNoGl) return false
  if ((t.type ?? 'scatter') !== 'scatter') return false
  if (t.fill && t.fill !== 'none') return false
  // An unset mode is Plotly's 'lines' (or 'lines+markers' under 20 points), not a cloud.
  return t.mode === 'markers'
}

const lengthOf = (v: unknown): number =>
  Array.isArray(v) || ArrayBuffer.isView(v) ? (v as ArrayLike<unknown>).length : 0

/** A plain line trace (a guide, a fit) — switched along with a dense cloud so it keeps its place
 *  in the stacking, but never counted toward the threshold. */
function glLine(t: MaybeTrace): boolean {
  if (!t || typeof t !== 'object' || t.__oeNoGl) return false
  if ((t.type ?? 'scatter') !== 'scatter') return false
  if (t.fill && t.fill !== 'none') return false
  return t.mode === 'lines'
}

/** The plot's traces with every plain marker trace switched to `scattergl` when the plot holds at
 *  least `min` such points; otherwise the input array itself. Switching ALL of them (not just the
 *  big one), and plain lines too, keeps their relative stacking — WebGL traces always draw
 *  beneath SVG ones. */
export function toGlTraces(data: unknown[], min = glMin()): unknown[] {
  let n = 0
  for (const raw of data) if (glEligible(raw as MaybeTrace)) n += lengthOf((raw as MaybeTrace).x)
  if (n < min) return data
  return data.map((raw) =>
    glEligible(raw as MaybeTrace) || glLine(raw as MaybeTrace)
      ? { ...(raw as object), type: 'scattergl' }
      : raw
  )
}

/** The highlight overlay for a plot drawn through WebGL. Plotly stacks its WebGL canvas ABOVE every
 *  SVG trace, so an SVG overlay would sit under the cloud (and a cloud point's own outline would
 *  show through it as a ring); drawn in WebGL as the last trace it's on top again. WebGL text takes
 *  only a named weight, so a numeric bold becomes 'bold' — remembered, so toSvgTraces puts the
 *  original back and a copy/export is the SVG plot exactly. */
export function toGlOverlay<T extends object>(t: T): T {
  const tf = (t as { textfont?: { weight?: unknown } }).textfont
  const w = tf?.weight
  const bold = typeof w === 'number' ? w >= 600 : w === 'bold'
  return {
    ...t,
    type: 'scattergl',
    ...(tf ? { textfont: { ...tf, weight: bold ? 'bold' : 'normal' }, [SVG_WEIGHT]: { w } } : {})
  }
}

/** Where toGlOverlay keeps the original text weight (wrapped, so an absent weight survives too). */
const SVG_WEIGHT = '__oeSvgWeight'

/** Whether any trace draws through WebGL. */
export function hasGlTraces(data: unknown[]): boolean {
  return data.some((raw) => (raw as MaybeTrace | null)?.type === 'scattergl')
}

/** The traces with every `scattergl` back to SVG `scatter` — for copy/export, where Plotly would
 *  otherwise embed the WebGL layer as one bitmap (blurry when rasterised at print DPI, and not
 *  editable as vectors). */
export function toSvgTraces(data: unknown[]): unknown[] {
  return data.map((raw) => {
    if ((raw as MaybeTrace | null)?.type !== 'scattergl') return raw
    const t: Record<string, unknown> = { ...(raw as Record<string, unknown>), type: 'scatter' }
    const keep = t[SVG_WEIGHT] as { w?: unknown } | undefined
    if (keep) {
      const tf: Record<string, unknown> = { ...(t.textfont as Record<string, unknown>) }
      if (keep.w === undefined) delete tf.weight
      else tf.weight = keep.w
      t.textfont = tf
      delete t[SVG_WEIGHT]
    }
    return t
  })
}

/** The distinct 3-D scenes a plot's traces draw into. */
const SCENE_TYPES = new Set([
  'scatter3d',
  'surface',
  'mesh3d',
  'isosurface',
  'volume',
  'cone',
  'streamtube'
])
export function sceneCount(data: unknown[]): number {
  const ids = new Set<string>()
  for (const t of data as Array<{ type?: string; scene?: string }>)
    if (t && SCENE_TYPES.has(t.type ?? '')) ids.add(t.scene ?? 'scene')
  return ids.size
}
