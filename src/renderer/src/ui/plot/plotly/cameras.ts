import { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'

/**
 * Each 3-D scene's camera as it is on screen now, for a re-render that keeps the scene's
 * `uirevision`. Plotly keeps a turned or zoomed camera across `react` only when it heard of the
 * change (a turn's mouse-up relayout) and the layout's camera is unchanged; a wheel zoom sends no
 * relayout, and a restyle that keeps cameras (traceFocus.keepCameras) writes the live one into the
 * layout Plotly compares against — either way the next render put the zoom back. The layout's own
 * projection still wins (a perspective / orthographic switch is a deliberate change).
 */
export function liveCameras(
  el: PlotlyGraphDiv,
  layout: Record<string, unknown> | undefined,
  lastAspect: Record<string, Aspect | null>
): Record<string, unknown> {
  const gd = el as unknown as {
    layout?: Record<string, unknown>
    _fullLayout?: Record<string, unknown>
  }
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(layout ?? {})) {
    if (!/^scene\d*$/.test(key) || !v || typeof v !== 'object') continue
    const next = v as {
      uirevision?: unknown
      camera?: { projection?: { type?: string } }
      aspectratio?: Aspect
    }
    const prev = gd.layout?.[key] as { uirevision?: unknown } | undefined
    // the aspect ratio this render asks for, and the one last asked for (not Plotly's copy, which
    // a kept zoom overwrites)
    const asked = next.aspectratio ?? null
    const before = lastAspect[key] ?? null
    lastAspect[key] = asked ? { ...asked } : null
    if (next.uirevision == null || prev?.uirevision !== next.uirevision) continue
    const scene = gd._fullLayout?.[key] as
      { _scene?: { getCamera?: () => unknown }; aspectratio?: Aspect } | undefined
    const camera = scene?._scene?.getCamera?.() as Record<string, unknown> | undefined
    if (!camera) continue
    // An orthographic scroll zoom scales the aspect ratio (all three sides alike) instead of
    // moving the camera. Kept as that scale — the live side over the side last asked for — and
    // put on the aspect asked for now, so a box re-shaped meanwhile (a turn onto another side
    // redraws its axes) keeps the zoom too.
    const ortho = (next.camera?.projection?.type ?? 'perspective') === 'orthographic'
    const live = scene?.aspectratio
    const zoom = ortho && live && before?.x ? live.x / before.x : 1
    const aspect = asked ?? (ortho && live ? live : null)
    out[key] = {
      ...next,
      camera: {
        ...camera,
        ...(next.camera?.projection ? { projection: next.camera.projection } : {})
      },
      ...(ortho && aspect && Number.isFinite(zoom) && zoom > 0
        ? {
            aspectmode: 'manual',
            aspectratio: { x: aspect.x * zoom, y: aspect.y * zoom, z: aspect.z * zoom }
          }
        : null)
    }
  }
  return out
}

/** A 3-D scene's aspect ratio: the box's side along each axis, in scene units. */
export type Aspect = { x: number; y: number; z: number }

/** How much faster a trackpad pinch zooms a 3-D scene than Plotly would (see bindPinchZoom). */
const PINCH_ZOOM_SPEED = 8

/** A trackpad pinch on a 3-D scene zooms at PINCH_ZOOM_SPEED. */
export function bindPinchZoom(el: PlotlyGraphDiv): void {
  // A trackpad pinch reaches a 3-D scene as wheel events with ctrlKey set and a far
  // smaller deltaY than a mouse wheel's, and Plotly zooms in proportion to it — so pinching
  // barely moved. Before the scene's own listener (this one captures), pinch zooms at
  // PINCH_ZOOM_SPEED; the mouse wheel keeps Plotly's speed.
  el.addEventListener(
    'wheel',
    (e) => {
      const full = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
      if (!full) return
      for (const key of Object.keys(full)) {
        if (!/^scene\d*$/.test(key)) continue
        const camera = (full[key] as { _scene?: { camera?: { zoomSpeed?: number } } })._scene
          ?.camera
        if (camera) camera.zoomSpeed = e.ctrlKey ? PINCH_ZOOM_SPEED : 1
      }
    },
    { capture: true, passive: true }
  )
}
