/**
 * The Response plot's 3-D camera (ResponseSurfaceView): the scene mounted only near the screen,
 * the user's turn and zoom kept across remounts and redraws, and the side it's seen from (which
 * places the drawn axes).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { PlotlyGraphDiv } from 'plotly.js-strict-dist-min'

import { useNearView } from '../../dashboard/useInView'

import { bindSurfaceHover, type SurfaceHover } from './surfaceHover'

/** The side a 3-D camera sees the scene from: the signs of its eye less its centre, as '+-+'
 *  (from +x, −y, above); undefined for something that isn't a camera. */
function sideOf(camera: unknown): string | undefined {
  const c = camera as
    | {
        eye?: Partial<Record<'x' | 'y' | 'z', number>>
        center?: Partial<Record<'x' | 'y' | 'z', number>>
      }
    | undefined
  if (!c?.eye) return undefined
  const sign = (k: 'x' | 'y' | 'z'): string =>
    (c.eye?.[k] ?? 0) - (c.center?.[k] ?? 0) >= 0 ? '+' : '-'
  return sign('x') + sign('y') + sign('z')
}

/** The camera state of a 3-D Response plot: the box to watch, whether it's near the screen, the
 *  camera last seen, the side it's seen from, and the camera to draw from (resume). */
export function useSurfaceCamera(projection: 'perspective' | 'orthographic'): {
  boxRef: RefObject<HTMLDivElement | null>
  near: boolean
  cameraRef: RefObject<Record<string, unknown> | null>
  side: string
  resume: Record<string, unknown> | null
  syncSide: (camera: unknown) => void
  onCamera: (_scene: string, camera: Record<string, unknown>) => void
} {
  // A 3-D scene holds a WebGL context while mounted (Chromium keeps ~16 a page, and a hidden
  // dashboard tab stays mounted), so it's mounted only while near the screen; away, a placeholder
  // of the same size holds its place. The user's last turn / zoom is kept to put back on return.
  const boxRef = useRef<HTMLDivElement>(null)
  const near = useNearView(boxRef)
  const cameraRef = useRef<Record<string, unknown> | null>(null)
  // The side the scene is seen from (the signs of the camera's eye less its centre: '+-+' is
  // from +x, −y, above), which places the drawn axes (see strokeAxes3d) — redrawn when a turn
  // ends on another side.
  const [side, setSide] = useState('+-+')
  const sideRef = useRef(side)
  // The camera it was left at, taken as it goes away (and drawn from when it's back).
  const [resume, setResume] = useState<Record<string, unknown> | null>(null)
  // A camera now on another side: redraw the axes for it — drawn FROM it, so the redraw can't put
  // the scene back to an older camera (Plotly may not have taken the turn as the user's yet, and
  // would then draw the layout's), which the next check would read as a turn back, and so on.
  const syncSide = useCallback((camera: unknown): void => {
    const sd = sideOf(camera)
    if (!sd || sd === sideRef.current) return
    sideRef.current = sd
    setResume(camera as Record<string, unknown>)
    setSide(sd)
  }, [])
  const onCamera = useCallback(
    (_scene: string, camera: Record<string, unknown>): void => {
      cameraRef.current = camera
      syncSide(camera)
    },
    [syncSide]
  )
  useEffect(() => {
    if (!near && cameraRef.current) setResume(cameraRef.current)
  }, [near])
  // A new projection is a new camera to Plotly, which would put the turn and zoom back to the
  // default — so it's drawn from the camera the user left, as a remount is.
  useEffect(() => {
    if (cameraRef.current) setResume(cameraRef.current)
  }, [projection])
  return { boxRef, near, cameraRef, side, resume, syncSide, onCamera }
}

/** The 3-D chart's mount: its surface hover bound (when it has one) and the camera tracked. */
export function useSurfaceMount(
  hlLifted: SurfaceHover | undefined,
  cameraRef: RefObject<Record<string, unknown> | null>,
  syncSide: (camera: unknown) => void
): (el: PlotlyGraphDiv) => (() => void) | undefined {
  // The 3-D surface's hover highlight, bound to each drawn chart (see bindSurfaceHover).
  // …and the drawn axes kept on the side the scene is actually seen from. The turn's end event
  // (onCamera) can miss — a draw from a kept or restored camera, a release outside the window —
  // so the camera on screen is read after every draw, and after every release and wheel over it.
  return useCallback(
    (el: PlotlyGraphDiv): (() => void) | undefined => {
      const unbindHover = hlLifted ? bindSurfaceHover(el, hlLifted) : undefined
      let raf = 0
      const check = (): void => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => {
          const full = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
          const sc = full?.scene as { _scene?: { getCamera?: () => unknown } } | undefined
          const camera = sc?._scene?.getCamera?.() as Record<string, unknown> | undefined
          // The camera as it is now — a wheel zoom sends Plotly no camera event of its own — so a
          // redraw (and a remount) goes on from it, not from the last turn's end.
          if (camera) cameraRef.current = camera
          syncSide(camera)
        })
      }
      check()
      window.addEventListener('mouseup', check)
      el.addEventListener('wheel', check, { passive: true })
      return () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('mouseup', check)
        el.removeEventListener('wheel', check)
        unbindHover?.()
      }
    },
    [hlLifted, cameraRef, syncSide]
  )
}
