import { useMemo } from 'react'

import type { MAData, MAPoint, ThresholdConfig } from '../engine'
import { DEFAULT_EFFECT_LABELS, type EffectLabels, type PointStyle } from '../graph/types'
import { useGraph } from '../graph/store'
import { PlotlyChart, type GuideDrag } from './PlotlyChart'
import { legendOn, resolveGroups, resolveHighlight } from './pointStyle'
import { axisBase, guideLine, PALETTES, plotBase } from './theme'
import { matchingGeneSet, useSelection } from './useSelection'
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
  /** upstream compare uses a non-linear (SAM) threshold — hide the fold-change guide lines, which
   *  imply a fixed FC cutoff that SAM doesn't have (SAM depends on the stat, absent from MA axes). */
  samThreshold?: boolean
  /** when set (linear mode only), the fold-change lines drag to update the SHARED compare threshold —
   *  the same fcLow/fcHigh volcano uses — so MA and volcano stay in sync. */
  onThresholdChange?: (partial: Partial<ThresholdConfig>) => void
}) {
  const mode = useUiTheme((s) => s.mode)
  // Pinned genes become their own trace. Subscribe to pinnedIds only (not hoverId),
  // so the plot rebuilds on a click-select, not on every hover.
  const pinnedIds = useSelection((s) => s.pinnedIds)
  // A selection that IS a saved geneset gets a legend entry under that geneset's name; an ad-hoc
  // pick gets none (the overlay already marks and names each pinned gene).
  const geneSets = useGraph((s) => s.geneSets)
  const selSet = matchingGeneSet(pinnedIds, geneSets)
  const selName = selSet?.name ?? null
  // A geneset's own colour (set in the gene selector) replaces the effect colours for its points.
  const selColor = selSet?.color ?? null
  // Resolved once per config change (stable objects, so PlotlyChart doesn't re-render per hover).
  // Memo inputs kept primitive / stable (see VolcanoView): a fresh `effectLabels` object or
  // `onThresholdChange` closure per parent render must not rebuild the traces.
  const upName = effectLabels.up
  const downName = effectLabels.down
  const groups = useMemo(
    () => resolveGroups(style, 'ma', { up: upName, down: downName }),
    [style, upName, downName]
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
    const hover = `${emphasis.label ? '' : '%{text}<br>'}mean log abundance=%{x:.2f}<br>${fcLabel}=%{y:.3f}<extra></extra>`
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
        x: pts.map((pt) => pt.x),
        y: pts.map((pt) => pt.y),
        text: pts.map((pt) => pt.label),
        customdata: pts.map((pt) => pt.uniqID),
        hovertemplate: hover,
        marker: { color: g.color, size: g.size, opacity: g.opacity }
      }
    })
    // Pinned genes → their own trace (kept fully opaque; a legend entry only when they form a saved
    // geneset); their visual emphasis — enlarged, ringed, labelled — is PlotlyChart's shared overlay.
    const sel = ma.points.filter((pt) => pinnedIds.has(pt.uniqID))
    if (sel.length) {
      traces.push({
        type: 'scatter',
        // Markers only — the pinned gene's LABEL comes from the shared selection overlay (which
        // labels each active gene exactly once); `text` here feeds the tooltip's %{text} only.
        mode: 'markers',
        name: selName ? `${selName} (${sel.length})` : `Selected (${sel.length})`,
        showlegend: selName !== null,
        x: sel.map((pt) => pt.x),
        y: sel.map((pt) => pt.y),
        text: sel.map((pt) => pt.label),
        customdata: sel.map((pt) => pt.uniqID),
        hovertemplate: hover,
        // Same size as the cloud's dots: this trace exists for its (geneset) legend entry and to keep
        // the pinned genes fully opaque; the enlarged, ringed emphasis is PlotlyChart's shared overlay.
        marker: {
          color: selColor ?? sel.map((pt) => look(pt.effect).color),
          size: sel.map((pt) => look(pt.effect).size),
          opacity: 1
        }
      })
    }

    const xs = ma.points.map((pt) => pt.x)
    const lo = Math.min(0, ...xs)
    const hi = Math.max(1, ...xs)
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
        title: 'mean log abundance',
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
    // the significant ones), largest |log₂FC| first. PlotlyChart itself leaves out any pinned gene
    // (the selection overlay names it).
    const labels = ma.points
      .filter((pt) => look(pt.effect).label)
      .map((pt) => ({ x: pt.x, y: pt.y, text: pt.label, priority: Math.abs(pt.y), id: pt.uniqID }))
    return { data: traces, layout: lay, labels, guides }
  }, [
    ma,
    title,
    mode,
    pinnedIds,
    selName,
    selColor,
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
