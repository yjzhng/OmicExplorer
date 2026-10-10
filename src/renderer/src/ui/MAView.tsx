import { useMemo } from 'react'

import type { MAData, MAPoint, ThresholdConfig } from '../engine'
import {
  DEFAULT_EFFECT_LABELS,
  type EffectColors,
  type EffectLabels,
  type PointStyle
} from '../graph/types'
import { useGraph } from '../graph/store'
import { PlotlyChart, type GuideDrag } from './PlotlyChart'
import { legendOn, resolveGroups, resolveHighlight } from './pointStyle'
import { axisBase, EFFECT_COLOR, guideLine, PALETTES, plotBase } from './theme'
import { useSelectedGeneSets } from './useSelection'
import { useUiTheme } from './useUiTheme'

type Eff = 'up' | 'down' | 'none'
const ORDER: Eff[] = ['none', 'down', 'up']

/** MA plot: mean log10 abundance (A) vs log2 fold change (M), colored by effect. Selected
 *  (pinned) genes are drawn on top as their own emphasised group, with a legend entry only when
 *  they form a saved geneset (named after it). */
export function MAView({
  ma,
  title,
  samThreshold,
  asymmetric = false,
  onThresholdChange,
  effectLabels = DEFAULT_EFFECT_LABELS,
  effectColors,
  style
}: {
  ma: MAData
  title?: string
  /** per-tile marker / highlight / legend look (unset fields use the MA defaults) */
  style?: PointStyle
  /** independent up/down cutoffs: dragging one line no longer mirrors the other */
  asymmetric?: boolean
  /** display names for the down/up classes (from the Compare config) */
  effectLabels?: EffectLabels
  /** the upstream Compare's effect colours — what each group's automatic colour follows */
  effectColors?: EffectColors
  /** upstream compare uses a non-linear (SAM) threshold — hide the fold-change guide lines, which
   *  imply a fixed FC cutoff that SAM doesn't have (SAM depends on the stat, absent from MA axes). */
  samThreshold?: boolean
  /** when set (linear mode only), the fold-change lines drag to update the SHARED compare threshold —
   *  the same fcLow/fcHigh volcano uses — so MA and volcano stay in sync. */
  onThresholdChange?: (partial: Partial<ThresholdConfig>) => void
}) {
  const mode = useUiTheme((s) => s.mode)
  // The selected saved genesets (each its own trace: legend entry, and its colour if set). An
  // ad-hoc pick gets none — PlotlyChart's shared overlay marks and names each pinned gene, restyled
  // in place — and the sets stay stable across clicks that don't change them, so a click-select
  // elsewhere doesn't rebuild this plot (a full redraw).
  const geneSets = useGraph((s) => s.geneSets)
  const selSets = useSelectedGeneSets(geneSets)
  // Resolved once per config change (stable objects, so PlotlyChart doesn't re-render per hover).
  // Memo inputs kept primitive / stable (see VolcanoView): a fresh `effectLabels` object or
  // `onThresholdChange` closure per parent render must not rebuild the traces.
  const upName = effectLabels.up
  const downName = effectLabels.down
  const noneName = effectLabels.none
  const upColor = effectColors?.up ?? EFFECT_COLOR.up
  const downColor = effectColors?.down ?? EFFECT_COLOR.down
  const noneColor = effectColors?.none ?? EFFECT_COLOR.none
  const groups = useMemo(
    () =>
      resolveGroups(
        style,
        'ma',
        { up: upName, down: downName, none: noneName },
        { up: upColor, down: downColor, none: noneColor }
      ),
    [style, upName, downName, noneName, upColor, downColor, noneColor]
  )
  const editable = !!onThresholdChange
  const emphasis = useMemo(() => resolveHighlight(style), [style])
  const showLegend = legendOn(style)

  const { data, layout, labels, guides } = useMemo(() => {
    const p = PALETTES[mode]
    // The tooltip names the gene only when the highlight's own label is off (else it's a duplicate).
    // Tooltip terms match the axis titles; the fold-change axis names the comparison
    // ("log₂FC · A | B") when the rows share one.
    const fcLabel = ma.comparison ? `log₂FC · ${ma.comparison}` : 'log₂FC'
    const hover = `${emphasis.label ? '' : '%{text}<br>'}${ma.xLabel}=%{x:.2f}<br>${fcLabel}=%{y:.3f}<extra></extra>`
    const look = (eff: Eff) => groups.get(eff)!

    // Always colour EVERY point by effect (up/down/none), so the significance groups stay
    // visible whether or not anything is selected — never grey the cloud out.
    const byEffect: Record<Eff, MAPoint[]> = { up: [], down: [], none: [] }
    for (const pt of ma.points) byEffect[pt.effect].push(pt)
    const traces: Array<Record<string, unknown>> = ORDER.map((eff) => {
      const pts = byEffect[eff]
      const g = look(eff)
      return {
        type: 'scatter',
        mode: 'markers',
        name: `${g.name} (${pts.length})`,
        showlegend: g.legend,
        // This group's own highlight look (see PlotlyChart's EMPH_KEY): the emphasis overlay and
        // the dim read it per trace, so each group can bump/ring/label/fade differently.
        __oeEmph: g.highlight,
        x: pts.map((pt) => pt.x),
        y: pts.map((pt) => pt.y),
        text: pts.map((pt) => pt.label),
        customdata: pts.map((pt) => pt.uniqID),
        hovertemplate: hover,
        marker: {
          color: g.color,
          size: g.size,
          opacity: g.opacity,
          line: { width: g.outline, color: g.outlineColor ?? p.text }
        }
      }
    })
    // Each selected geneset → its own trace (fully opaque, its legend entry and colour); any pinned
    // gene's emphasis — enlarged, ringed, labelled — is PlotlyChart's shared overlay.
    for (const set of selSets) {
      const sel = ma.points.filter((pt) => set.ids.has(pt.uniqID))
      if (!sel.length) continue
      traces.push({
        type: 'scatter',
        // Markers only — the pinned gene's LABEL comes from the shared selection overlay (which
        // labels each active gene exactly once); `text` here feeds the tooltip's %{text} only.
        mode: 'markers',
        name: `${set.name} (${sel.length})`,
        x: sel.map((pt) => pt.x),
        y: sel.map((pt) => pt.y),
        text: sel.map((pt) => pt.label),
        customdata: sel.map((pt) => pt.uniqID),
        hovertemplate: hover,
        // Same size as the cloud's dots: this trace exists for its (geneset) legend entry and to keep
        // the pinned genes fully opaque; the enlarged, ringed emphasis is PlotlyChart's shared overlay.
        marker: {
          color: set.color ?? sel.map((pt) => look(pt.effect).color),
          size: sel.map((pt) => look(pt.effect).size),
          opacity: 1,
          line: {
            width: sel.map((pt) => look(pt.effect).outline),
            color: sel.map((pt) => look(pt.effect).outlineColor ?? p.text)
          }
        }
      })
    }

    // The abundance axis fits the data: 0 log abundance has no meaning here, and forcing it in
    // would squeeze the cloud into the right of the plot.
    let lo = Infinity
    let hi = -Infinity
    for (const pt of ma.points) {
      if (pt.x < lo) lo = pt.x
      if (pt.x > hi) hi = pt.x
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1]
    const guide = (y: number) => ({
      type: 'line',
      x0: lo,
      x1: hi,
      y0: y,
      y1: y,
      line: guideLine(p)
    })
    // Pin explicit axis ranges (with padding) so the range never re-pads on hover — otherwise
    // the enlarged overlay marker on an edge point shifts the whole cloud and bounces the hover.
    const ys = ma.points.map((pt) => pt.y)
    const yLo = Math.min(ma.fcLow, 0, ...ys)
    const yHi = Math.max(ma.fcHigh, 0, ...ys)
    const xPad = (hi - lo || 2) * 0.05
    const yPad = (yHi - yLo || 2) * 0.06

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      // Legend centered ABOVE the plot (horizontal), not on the right: a right-side legend
      // reserves horizontal room that shifts as its content changes, moving the cloud sideways
      // on hover and bouncing the point. A top legend never affects the plot width. Fixed per
      // config (never toggled by the data) so it doesn't appear/disappear and reflow the layout.
      showlegend: showLegend,
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 },
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: {
        ...axisBase(p),
        title: ma.xLabel,
        range: [lo - xPad, hi + xPad],
        autorange: false
      },
      yaxis: {
        ...axisBase(p),
        title: fcLabel,
        zeroline: true,
        range: [yLo - yPad, yHi + yPad],
        autorange: false
      },
      // Guide order: [0]=fcLow, [1]=fcHigh — horizontal log2FC cutoffs. Hidden under SAM.
      shapes: samThreshold ? [] : [guide(ma.fcLow), guide(ma.fcHigh)]
    }
    // Draggable fold-change lines (linear mode only) — they edit the SAME compare threshold as
    // volcano, so both plots move together. Drag vertically (ns-resize). Symmetric: mirrored;
    // asymmetric: each line is its own cutoff.
    const guides: GuideDrag[] | undefined =
      !editable || samThreshold
        ? undefined
        : [
            {
              shapeIndex: 0,
              axis: 'y',
              kind: 'line',
              cursor: 'ns-resize',
              value: ma.fcLow,
              key: asymmetric ? 'fcLow' : 'fc',
              mirrorShapeIndex: asymmetric ? undefined : 1,
              format: (v) =>
                asymmetric ? `log₂FC ≤ ${v.toFixed(2)}` : `|log₂FC| ≥ ${Math.abs(v).toFixed(2)}`
            },
            {
              shapeIndex: 1,
              axis: 'y',
              kind: 'line',
              cursor: 'ns-resize',
              value: ma.fcHigh,
              key: asymmetric ? 'fcHigh' : 'fc',
              mirrorShapeIndex: asymmetric ? undefined : 0,
              format: (v) =>
                asymmetric ? `log₂FC ≥ ${v.toFixed(2)}` : `|log₂FC| ≥ ${Math.abs(v).toFixed(2)}`
            }
          ]
    // Collision-managed labels for the genes of every group whose label switch is on (by default
    // the significant ones), ranked by distance from the y = 0 line — |log₂FC|, largest first (the
    // Manhattan distance to a horizontal line is the vertical one alone). The ranking runs before
    // PlotlyChart's crowding gate and placement. PlotlyChart leaves out any pinned gene (the
    // selection overlay names it).
    const labels = ma.points
      .filter((pt) => look(pt.effect).label)
      .map((pt) => ({ x: pt.x, y: pt.y, text: pt.label, priority: Math.abs(pt.y), id: pt.uniqID }))
    return { data: traces, layout: lay, labels, guides }
  }, [
    ma,
    title,
    mode,
    selSets,
    samThreshold,
    asymmetric,
    editable,
    groups,
    showLegend,
    emphasis.label
  ])

  // Symmetric: whichever line moved, set both cutoffs to ±|value| about 0. Asymmetric: one side.
  const onGuide = (key: string, value: number): void => {
    if (!onThresholdChange) return
    if (key === 'fc') {
      const mag = Math.abs(value)
      onThresholdChange({ fcLow: -mag, fcHigh: mag })
    } else if (key === 'fcLow') {
      onThresholdChange({ fcLow: -Math.abs(value) })
    } else if (key === 'fcHigh') {
      onThresholdChange({ fcHigh: Math.abs(value) })
    }
  }

  return (
    <PlotlyChart
      data={data}
      layout={layout}
      labels={labels}
      labelColor={PALETTES[mode].text}
      emphasis={emphasis}
      guides={guides}
      onGuide={onGuide}
    />
  )
}
