import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { ConditionKey, HeatmapData } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, CATEGORICAL_ALT, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** Pixel gap between adjacent condition tracks (along the condition axis). */
const TRACK_GAP = 3

/** Monochrome [light, dark] endpoints for the numeric conditions — low value → light,
 *  high value → dark. Both dose and time use the same neutral grey ramp. */
const MONO_RAMP: readonly [string, string] = ['#eeeeee', '#222222']
const SEQ_RAMPS: Partial<Record<ConditionKey, readonly [string, string]>> = {
  dose: MONO_RAMP,
  time: MONO_RAMP
}
/** Keep the ramp off its extremes so the lightest/darkest steps stay visible on the panel. */
const SEQ_LO = 0.2
const SEQ_HI = 0.8

/** Linear interpolate between two #rrggbb hex colours, t clamped to [0,1]. */
function lerpHex(a: string, b: string, t: number): string {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  const ch = (h: string, i: number): number => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  const mix = (i: number): string =>
    Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * u)
      .toString(16)
      .padStart(2, '0')
  return `#${mix(0)}${mix(1)}${mix(2)}`
}

/** m[i][j] → m[j][i] (generic; preserves cell values incl. null). */
function transpose<T>(m: T[][]): T[][] {
  const rows = m.length
  const cols = m[0]?.length ?? 0
  const out: T[][] = Array.from({ length: cols }, () => new Array<T>(rows))
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j][i] = m[i][j]
  return out
}

/** Distinct values of a condition → track colour. Numeric conditions (dose, time) use a
 *  monochrome grey ramp keyed to the sorted value (low = light, high = dark), kept off its
 *  extremes; categorical conditions cycle a palette — strain uses CATEGORICAL, cmpd a distinct
 *  one so the two never read as the same colour scheme. */
function condColours(samples: HeatmapData['samples'], c: ConditionKey): Map<string, string> {
  const ramp = SEQ_RAMPS[c]
  const seen = new Set<string>()
  const vals: string[] = []
  for (const m of samples) {
    const raw = m[c]
    if (raw == null || raw === '') continue
    const key = String(raw)
    if (!seen.has(key)) {
      seen.add(key)
      vals.push(key)
    }
  }
  vals.sort((a, b) => (ramp ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0))
  const map = new Map<string, string>()
  if (ramp) {
    const n = vals.length
    const span = SEQ_HI - SEQ_LO
    vals.forEach((v, i) =>
      map.set(v, lerpHex(ramp[0], ramp[1], SEQ_LO + span * (n <= 1 ? 0.5 : i / (n - 1))))
    )
  } else {
    const palette = c === 'cmpd' ? CATEGORICAL_ALT : CATEGORICAL
    vals.forEach((v, i) => map.set(v, palette[i % palette.length]))
  }
  return map
}

/** Build the condition-track trace (one row per condition, one column per sample) + the axis it
 *  lives on, sharing the sample axis with the main heatmap. Colours are a discrete categorical
 *  scale (a stepped colorscale over a deduped palette; each cell's z is its palette index). */
function buildTracks(
  heatmap: HeatmapData,
  landscape: boolean,
  bg: string
): { trace: Record<string, unknown>; shapes: Record<string, unknown>[] } | null {
  // Portrait stacks the tracks on the y-axis, where Plotly draws row 0 at the BOTTOM — so reverse
  // the order there to read strain→cmpd→dose→time top-to-bottom. Landscape lays them left-to-right
  // (row 0 already leftmost), so keep the natural order.
  const conds = landscape ? heatmap.conds : [...heatmap.conds].reverse()
  if (conds.length === 0) return null
  const nS = heatmap.x.length
  const palette: string[] = []
  const idxOf = new Map<string, number>()
  const colourIndex = (col: string): number => {
    let i = idxOf.get(col)
    if (i == null) {
      i = palette.length
      idxOf.set(col, i)
      palette.push(col)
    }
    return i
  }
  const valColour = new Map<ConditionKey, Map<string, string>>()
  for (const c of conds) valColour.set(c, condColours(heatmap.samples, c))
  // cond-major matrices: z = palette index (+0.5 to land mid-block), customdata = "cond: value",
  // keys = the raw value string per cell ('' = missing), used to find group boundaries.
  const z: Array<Array<number | null>> = []
  const cd: string[][] = []
  const keys: string[][] = []
  for (const c of conds) {
    const zr: Array<number | null> = []
    const cr: string[] = []
    const kr: string[] = []
    for (let s = 0; s < nS; s++) {
      const raw = heatmap.samples[s][c]
      if (raw == null || raw === '') {
        zr.push(null)
        cr.push('')
        kr.push('')
      } else {
        const key = String(raw)
        zr.push(colourIndex(valColour.get(c)!.get(key)!) + 0.5)
        cr.push(`${c}: ${key}`)
        kr.push(key)
      }
    }
    z.push(zr)
    cd.push(cr)
    keys.push(kr)
  }
  const K = palette.length
  const colorscale: Array<[number, string]> = []
  for (let i = 0; i < K; i++) {
    colorscale.push([i / K, palette[i]], [(i + 1) / K, palette[i]])
  }
  // Small gap between adjacent groups: a background-coloured separator at each value change
  // within a track (same value stays joined; a change or a run edge draws a thin gap).
  const shapes: Record<string, unknown>[] = []
  for (let t = 0; t < conds.length; t++) {
    for (let s = 0; s < nS - 1; s++) {
      if (keys[t][s] === keys[t][s + 1]) continue
      shapes.push(
        landscape
          ? {
              type: 'line',
              xref: 'x2',
              yref: 'y',
              x0: t - 0.5,
              x1: t + 0.5,
              y0: s + 0.5,
              y1: s + 0.5,
              line: { color: bg, width: 2 },
              layer: 'above'
            }
          : {
              type: 'line',
              xref: 'x',
              yref: 'y2',
              x0: s + 0.5,
              x1: s + 0.5,
              y0: t - 0.5,
              y1: t + 0.5,
              line: { color: bg, width: 2 },
              layer: 'above'
            }
      )
    }
  }
  const trace: Record<string, unknown> = {
    type: 'heatmap',
    z: landscape ? transpose(z) : z,
    x: landscape ? (conds as string[]) : heatmap.x,
    y: landscape ? heatmap.x : (conds as string[]),
    customdata: landscape ? transpose(cd) : cd,
    hovertemplate: '%{customdata}<extra></extra>',
    colorscale,
    zmin: 0,
    zmax: K,
    showscale: false,
    // Along the sample axis: no cell gap, so consecutive samples with the same value read as one
    // continuous bar (the separator shapes above add gaps only between different groups). Along
    // the condition axis: a small gap so adjacent tracks are visibly separated.
    xgap: landscape ? TRACK_GAP : 0,
    ygap: landscape ? 0 : TRACK_GAP,
    xaxis: landscape ? 'x2' : 'x',
    yaxis: landscape ? 'y' : 'y2'
  }
  return { trace, shapes }
}

/** Interactive heatmap of genes × samples (log₁₀ intensity). Portrait keeps genes down
 *  the y axis (samples across the top); landscape transposes so genes run across x. */
export function HeatmapView({
  heatmap,
  title,
  orient = 'portrait'
}: {
  heatmap: HeatmapData
  title?: string
  orient?: 'landscape' | 'portrait'
}) {
  const mode = useUiTheme((s) => s.mode)
  // Measure the tile so the condition-track band can be JUST tall enough for its row labels: each
  // track needs about one label's height or Plotly drops overlapping tick labels.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [plotH, setPlotH] = useState(0)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPlotH(el.clientHeight))
    ro.observe(el)
    setPlotH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const landscape = orient === 'landscape'
    const tracks = buildTracks(heatmap, landscape, p.panel)
    // Reserve a band for the condition tracks. In portrait the tracks stack vertically, so size the
    // band to ~one label height per track (measured from the tile) — just tall enough that Plotly
    // doesn't drop overlapping row labels, no taller. Landscape lays them out horizontally where
    // labels angle and don't collide, so a modest fixed fraction suffices.
    const nT = heatmap.conds.length
    const PER_TRACK_PX = 16 // ~9px label + line spacing
    const areaH = plotH > 0 ? Math.max(plotH - 75 /* Plotly top+bottom margins */, 80) : 0
    const band =
      nT === 0
        ? 0
        : landscape
          ? Math.min(0.26, nT * 0.05)
          : areaH > 0
            ? Math.min(0.5, (nT * PER_TRACK_PX) / areaH)
            : Math.min(0.26, nT * 0.05)
    const gap = nT > 0 ? 0.028 : 0
    const mainEnd = 1 - band - gap
    const traces: Array<Record<string, unknown>> = [
      {
        type: 'heatmap',
        // Portrait: z[gene][sample] with genes on y. Landscape: transpose so genes are on x.
        z: landscape ? transpose(heatmap.z) : heatmap.z,
        x: landscape ? heatmap.y : heatmap.x,
        y: landscape ? heatmap.x : heatmap.y,
        colorscale: 'Viridis',
        colorbar: { title: { text: 'log₁₀', side: 'right' }, thickness: 12 },
        hovertemplate: landscape
          ? 'gene=%{x}<br>sample=%{y}<br>log₁₀=%{z:.2f}<extra></extra>'
          : 'gene=%{y}<br>sample=%{x}<br>log₁₀=%{z:.2f}<extra></extra>'
      }
    ]
    if (tracks) traces.push(tracks.trace)
    const geneAxis = {
      ...axisBase(p),
      title: 'gene',
      automargin: true,
      tickfont: { size: 9 },
      // Angle the gene ticks only when they sit on the x axis (landscape).
      ...(landscape ? { tickangle: -45 } : {})
    }
    const sampleAxis = {
      ...axisBase(p),
      title: 'sample',
      automargin: true,
      tickfont: { size: 9 },
      ...(landscape ? {} : { tickangle: -45 })
    }
    // The condition-track strips sit on a second axis perpendicular to the sample axis: above the
    // heatmap in portrait (y2), to its right in landscape (x2). Cond names are the tick labels.
    const trackAxis = {
      ...axisBase(p),
      automargin: true,
      showgrid: false,
      zeroline: false,
      tickfont: { size: 9 }
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      ...(tracks && tracks.shapes.length > 0 ? { shapes: tracks.shapes } : {})
    }
    if (landscape) {
      lay.yaxis = { ...sampleAxis }
      lay.xaxis = { ...geneAxis, domain: nT > 0 ? [0, mainEnd] : [0, 1] }
      if (tracks) lay.xaxis2 = { ...trackAxis, domain: [mainEnd + gap, 1], anchor: 'y', tickangle: -45 }
    } else {
      lay.xaxis = { ...sampleAxis }
      lay.yaxis = { ...geneAxis, domain: nT > 0 ? [0, mainEnd] : [0, 1] }
      if (tracks) lay.yaxis2 = { ...trackAxis, domain: [mainEnd + gap, 1], anchor: 'x' }
    }
    return { data: traces, layout: lay }
  }, [heatmap, title, orient, mode, plotH])

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <PlotlyChart data={data} layout={layout} />
    </div>
  )
}
