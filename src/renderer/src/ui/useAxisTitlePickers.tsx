/**
 * Pick-lists on a plot's own axis titles (see AxisTitlePicker): the `onGraphMount` to hand
 * PlotlyChart — it measures where the titles landed after every draw and resize — and the overlay
 * to render over the chart, inside a `position: relative` box that holds both.
 */
import { useCallback, useState, type ReactNode } from 'react'
import type { PlotlyGraphDiv } from 'plotly.js-dist-min'

import { TitleButton, type Axis, type AxisPick, type Box } from './AxisTitlePicker'

export function useAxisTitlePickers<V extends string>(
  picks: Partial<Record<Axis, AxisPick<V>>>
): {
  onGraphMount: (el: PlotlyGraphDiv) => () => void
  overlay: ReactNode
} {
  const [boxes, setBoxes] = useState<Partial<Record<Axis, Box>>>({})
  const onGraphMount = useCallback((el: PlotlyGraphDiv) => {
    let frame = 0
    const measure = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const host = el.getBoundingClientRect()
        const next: Partial<Record<Axis, Box>> = {}
        for (const a of ['x', 'y'] as const) {
          const t = el.querySelector(`.g-${a}title text`)
          const r = t?.getBoundingClientRect()
          if (r && r.width > 0)
            next[a] = {
              left: r.left - host.left,
              top: r.top - host.top,
              width: r.width,
              height: r.height
            }
        }
        setBoxes(next)
      })
    }
    measure()
    // A resize redraws the axes a moment later: measure once it has.
    let timer = 0
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = window.setTimeout(measure, 120)
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [])
  const overlay = (
    <>
      {(['x', 'y'] as const).map((a) => {
        const pick = picks[a]
        const box = boxes[a]
        return pick && box ? <TitleButton key={a} axis={a} box={box} pick={pick} /> : null
      })}
    </>
  )
  return { onGraphMount, overlay }
}
