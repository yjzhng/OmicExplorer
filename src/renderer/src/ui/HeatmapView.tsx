import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  condLabel,
  isNumericCond,
  metaValue,
  type ConditionKey,
  type HeatmapData,
  type NumericConds
} from '../engine'
import { ROLE_DEFAULTS, paletteScale, paletteSeries, type PaletteRef } from './palettes'
import { condTooltip, geneLine, valueLine } from './condTooltip'
import { PlotlyChart } from './PlotlyChart'
import { truncatedTicks } from './plotAxes'
import { bindHeatmapFocus, GENE_TICK_PX, LINK_DELAY } from './heatmapFocus'
import { sampleKey } from './sampleLink'
import { axisBase, CATEGORICAL, PALETTES, plotBase, withAlpha } from './theme'
import { useRolePalette } from './useAppSettings'
import { useUiTheme } from './useUiTheme'

/** Pixel gap between adjacent condition tracks (along the condition axis). */
const TRACK_GAP = 1

/** The numeric conditions' track palettes — their levels in order along a palette role: time's
 *  (Greens by default), dose's (Blues) for dose and any declared numeric condition (app settings →
 *  palettes) — with the dataset's numeric conditions (`numeric`). */
type LevelPalettes = { dose: PaletteRef; time: PaletteRef; numeric: NumericConds }
const levelPalette = (c: ConditionKey, lp: LevelPalettes): PaletteRef | null =>
  isNumericCond(c, lp.numeric) ? (c === 'time' ? lp.time : lp.dose) : null
/** A categorical track's start along the categorical palette, per track: far enough along that the
 *  next track's first levels don't repeat this one's. */
const TRACK_ROTATE = 5

/** How strongly a hovered heatmap veils the cells outside the hovered row and column. */
const HOVER_VEIL = 0.65

/** m[i][j] → m[j][i] (generic; preserves cell values incl. null). */
function transpose<T>(m: T[][]): T[][] {
  const rows = m.length
  const cols = m[0]?.length ?? 0
  const out: T[][] = Array.from({ length: cols }, () => new Array<T>(rows))
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j][i] = m[i][j]
  return out
}

/** Distinct values of a condition → track colour. Numeric conditions (dose, time) run along their
 *  level palette by sorted value (low → high, its pale end skipped — see paletteSeries);
 *  categorical ones cycle the categorical palette, each further track (`catIndex`) starting
 *  TRACK_ROTATE colours on, so no two tracks (cell, cmpd, a custom condition) read alike. */
function condColours(
  samples: HeatmapData['samples'],
  c: ConditionKey,
  catIndex: number,
  levels: LevelPalettes
): Map<string, string> {
  const ramp = levelPalette(c, levels)
  const seen = new Set<string>()
  const vals: string[] = []
  for (const m of samples) {
    const raw = metaValue(m, c)
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
    vals.forEach((v, i) => map.set(v, paletteSeries(ramp, i, vals.length)))
  } else {
    const rot = catIndex * TRACK_ROTATE
    vals.forEach((v, i) => map.set(v, CATEGORICAL[(i + rot) % CATEGORICAL.length]))
  }
  return map
}

/** Build the condition-track trace (one row per condition, one column per sample) + the axis it
 *  lives on, sharing the sample axis with the main heatmap. Colours are a discrete categorical
 *  scale (a stepped colorscale over a deduped palette; each cell's z is its palette index). */
function buildTracks(
  heatmap: HeatmapData,
  landscape: boolean,
  bg: string,
  /** each sample's tooltip identity (condTooltip), aligned with `heatmap.x` */
  idents: string[],
  levels: LevelPalettes
): { trace: Record<string, unknown>; shapes: Record<string, unknown>[] } | null {
  // Portrait stacks the tracks on the y-axis, where Plotly draws row 0 at the BOTTOM — so reverse
  // the order there to read cell→cmpd→dose→time top-to-bottom. Landscape lays them left-to-right
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
  // Numbered in the data's own condition order (not the reversed draw order) so a portrait and a
  // landscape heatmap of the same data give each track the same palette.
  let catIndex = 0
  for (const c of heatmap.conds)
    valColour.set(
      c,
      condColours(heatmap.samples, c, isNumericCond(c, levels.numeric) ? 0 : catIndex++, levels)
    )
  // cond-major matrices: z = palette index (+0.5 to land mid-block), cd = the sample's
  // identity (the same block every Clean data plot's tooltip opens with),
  // keys = the raw value string per cell ('' = missing), used to find group boundaries.
  const z: Array<Array<number | null>> = []
  const cd: string[][] = []
  const keys: string[][] = []
  for (const c of conds) {
    const zr: Array<number | null> = []
    const cr: string[] = []
    const kr: string[] = []
    for (let s = 0; s < nS; s++) {
      const raw = metaValue(heatmap.samples[s], c)
      cr.push(idents[s])
      if (raw == null || raw === '') {
        zr.push(null)
        kr.push('')
      } else {
        const key = String(raw)
        zr.push(colourIndex(valColour.get(c)!.get(key)!) + 0.5)
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
  // Each track's group per sample for the hover focus: its value with every outer track's (in the
  // data's condition order — cell, cmpd, dose, time), so a hover lights the sample's nested group in
  // each track — all of its cmpd, then that cmpd at its dose, … — not every sample sharing a value.
  const group = new Map<ConditionKey, string[]>()
  heatmap.conds.forEach((c, d) => {
    const outer = d > 0 ? group.get(heatmap.conds[d - 1])! : null
    const own = keys[conds.indexOf(c)]
    group.set(
      c,
      own.map((k, s) => (outer ? `${outer[s]}\u0001${k}` : k))
    )
  })
  const focusKeys = conds.map((c) => group.get(c)!)
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
    x: landscape ? conds.map(condLabel) : heatmap.x,
    y: landscape ? heatmap.x : conds.map(condLabel),
    // the identity as text, not customdata: a string customdata reads as a gene id (PlotlyChart)
    text: landscape ? transpose(cd) : cd,
    hovertemplate: '%{text}<extra></extra>',
    // each cell's nested group, so a hover lights the sample's group per track (heatmapFocus)
    meta: { focusKeys: landscape ? transpose(focusKeys) : focusKeys },
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

/** Interactive heatmap of genes × samples, on the scale Clean data presents its values on (see
 *  HeatmapTile). Portrait keeps genes down the y axis (samples across the top); landscape
 *  transposes so genes run across x. */
export function HeatmapView({
  heatmap,
  title,
  orient = 'portrait',
  valueLabel = 'log abundance',
  condBar = true,
  palette = ROLE_DEFAULTS.data,
  numeric
}: {
  heatmap: HeatmapData
  /** the dataset's numeric conditions (numericOf its Clean data): their tracks are ordered */
  numeric: NumericConds
  title?: string
  orient?: 'landscape' | 'portrait'
  /** the colour bar's title — the value scale, e.g. "log₂ abundance" (see abundanceLabel) */
  valueLabel?: string
  /** draw the condition tracks along the samples (off: the heatmap takes their room) */
  condBar?: boolean
  /** the value palette (the plot's own, else viridis) */
  palette?: PaletteRef
}) {
  const mode = useUiTheme((s) => s.mode)
  // The dose / time tracks' palettes: their roles' global defaults.
  const dosePalette = useRolePalette('dose')
  const timePalette = useRolePalette('time')
  // Measure the tile so the condition-track band can be JUST tall enough for its row labels: each
  // track needs about one label's height or Plotly drops overlapping tick labels.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [plotH, setPlotH] = useState(0)
  // …and its width, for how many gene labels fit along a landscape x axis
  const [plotW, setPlotW] = useState(0)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setPlotH(el.clientHeight)
      setPlotW(el.clientWidth)
    })
    ro.observe(el)
    setPlotH(el.clientHeight)
    setPlotW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const landscape = orient === 'landscape'
    // Each sample's identity for the tooltips (cells and tracks alike), its label when it has none.
    const idents = heatmap.samples.map(
      (m, s) => condTooltip(m, heatmap.conds, p.textMuted) || heatmap.x[s]
    )
    const levels = { dose: dosePalette, time: timePalette, numeric }
    const tracks = condBar ? buildTracks(heatmap, landscape, p.panel, idents, levels) : null
    // Reserve a band for the condition tracks. In portrait the tracks stack vertically, so size the
    // band to ~one label height per track (measured from the tile) — just tall enough that Plotly
    // doesn't drop overlapping row labels, no taller. Landscape lays them out horizontally where
    // labels angle and don't collide, so a modest fixed fraction suffices.
    // No band (and no gap) while the condition bar is hidden — the heatmap takes the room.
    const nT = tracks ? heatmap.conds.length : 0
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
    // Hover: "log=2.31" on a logged scale; a linear value's size varies too much for fixed decimals.
    const logged = valueLabel.startsWith('log')
    const valueKey = logged ? valueLabel.split(' ')[0] : 'value'
    const zDigits = logged ? '2f' : '4~g'
    const traces: Array<Record<string, unknown>> = [
      {
        type: 'heatmap',
        // Portrait: z[gene][sample] with genes on y. Landscape: transpose so genes are on x.
        z: landscape ? transpose(heatmap.z) : heatmap.z,
        x: landscape ? heatmap.y : heatmap.x,
        y: landscape ? heatmap.x : heatmap.y,
        colorscale: paletteScale(palette),
        colorbar: {
          title: { text: valueLabel, side: 'right' },
          thickness: 12
        },
        // The gene, the sample's identity, the value — as every Clean data plot's tooltip. One
        // shared identity row per gene (portrait) costs nothing; landscape needs a row per sample.
        text: landscape ? idents.map((id) => heatmap.y.map(() => id)) : heatmap.y.map(() => idents),
        // each cell's gene uniqID: PlotlyChart's linked hover and click-to-pin read it
        customdata: landscape
          ? heatmap.x.map(() => heatmap.geneIds)
          : heatmap.geneIds.map((id) => heatmap.x.map(() => id)),
        hovertemplate: `${geneLine(landscape ? '%{x}' : '%{y}')}<br>%{text}<br>${valueLine(valueKey, `%{z:.${zDigits}}`)}<extra></extra>`
      }
    ]
    if (tracks) traces.push(tracks.trace)
    const geneAxis = {
      ...axisBase(p),
      title: 'gene',
      automargin: true,
      tickfont: { size: 9 },
      // Gene names cut short like every plot's (the full name is in the hover) — as many as fit
      // along the axis: a first guess at its length (its share of the tile, less the margins),
      // which heatmapFocus redraws to the axis as laid out.
      ...truncatedTicks(
        heatmap.y,
        landscape ? (plotW - 140) * mainEnd : areaH * mainEnd,
        GENE_TICK_PX
      ),
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
      if (tracks)
        lay.xaxis2 = { ...trackAxis, domain: [mainEnd + gap, 1], anchor: 'y', tickangle: -45 }
    } else {
      lay.xaxis = { ...sampleAxis }
      // Reverse so the FIRST gene row renders at the TOP (Plotly puts index 0 at the bottom by
      // default) — the intuitive reading order, and it puts the highest-value group on top.
      lay.yaxis = {
        ...geneAxis,
        autorange: 'reversed',
        domain: nT > 0 ? [0, mainEnd] : [0, 1]
      }
      if (tracks) lay.yaxis2 = { ...trackAxis, domain: [mainEnd + gap, 1], anchor: 'x' }
    }
    return { data: traces, layout: lay }
  }, [
    heatmap,
    title,
    orient,
    mode,
    plotH,
    plotW,
    valueLabel,
    condBar,
    palette,
    dosePalette,
    timePalette,
    numeric
  ])

  // each sample's link key, for the sample link with the other plots
  const sampleKeys = useMemo(
    () => heatmap.samples.map((m) => sampleKey(m, m.rep)),
    [heatmap.samples]
  )

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <PlotlyChart
        data={data}
        layout={layout}
        // the other plots follow a hover once it rests (a sweep down the rows redraws none)
        linkDelay={LINK_DELAY}
        // the lit genes and samples (hovered here or elsewhere, pinned) — see heatmapFocus
        onGraphMount={(el) =>
          bindHeatmapFocus(el, withAlpha(PALETTES[mode].panel, HOVER_VEIL), {
            landscape: orient === 'landscape',
            geneLabels: heatmap.y,
            tickPx: GENE_TICK_PX,
            labelInk: PALETTES[mode].text,
            labelBg: PALETTES[mode].panel,
            geneIds: heatmap.geneIds,
            sampleKeys
          })
        }
      />
    </div>
  )
}
