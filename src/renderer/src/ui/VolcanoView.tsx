import { useEffect, useMemo, useRef } from 'react'

import type { ThresholdConfig, VolcanoData, VolcanoPoint } from '../engine'
import { DEFAULT_EFFECT_LABELS, type EffectLabels, type PointStyle } from '../graph/types'
import { useGraph } from '../graph/store'
import { PlotlyChart, type GuideDrag } from './PlotlyChart'
import { legendOn, resolveGroups, resolveHighlight } from './pointStyle'
import { axisBase, guideLine, PALETTES, plotBase } from './theme'
import { matchingGeneSet, useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

type Eff = 'up' | 'down' | 'none'
const ORDER: Eff[] = ['none', 'down', 'up']

/** Interactive volcano: log2FC vs significance, colored by effect, with threshold guides.
 *  Selected (pinned) genes are drawn on top as their own emphasised group, with a legend entry
 *  only when they form a saved geneset (named after it). */
export function VolcanoView({
  volcano,
  title,
  threshold,
  onThresholdChange,
  labelTop = 0,
  effectLabels = DEFAULT_EFFECT_LABELS,
  style
}: {
  volcano: VolcanoData
  title?: string
  /** per-tile marker / highlight / legend look (unset fields use the volcano defaults) */
  style?: PointStyle
  /** display names for the down/up classes (from the Compare config) */
  effectLabels?: EffectLabels
  /** label only the top-N most significant genes; 0 offers every significant gene and lets the
   *  placement layer keep as many as fit */
  labelTop?: number
  /** the compare's threshold — drives the guide geometry: linear (vertical FC + horizontal stat
   *  lines) vs non-linear SAM (a single curved boundary). Falls back to linear when absent. */
  threshold?: ThresholdConfig
  /** when set, the guide lines become draggable; a drag commits the moved boundary back as a
   *  threshold patch (fcLow/fcHigh/statMin), which live-reclassifies the genes. */
  onThresholdChange?: (partial: Partial<ThresholdConfig>) => void
}) {
  const mode = useUiTheme((s) => s.mode)
  // Pinned (linked-selection) genes become their own trace. Subscribe to
  // pinnedIds only (not hoverId), so the plot rebuilds on a click-select, not on every hover.
  const pinnedIds = useSelection((s) => s.pinnedIds)
  // A selection that IS a saved geneset gets a legend entry under that geneset's name; an ad-hoc
  // pick gets none (the overlay already marks and names each pinned gene).
  const geneSets = useGraph((s) => s.geneSets)
  const selSet = matchingGeneSet(pinnedIds, geneSets)
  const selName = selSet?.name ?? null
  // A geneset's own colour (set in the gene selector) replaces the effect colours for its points.
  const selColor = selSet?.color ?? null
  const yLabel = volcano.statType === 'pP' ? '−log P-value' : '−log Q-value'
  // Resolved once per config change (stable objects, so PlotlyChart doesn't re-render per hover).
  // Memo inputs are kept PRIMITIVE / stable: the parent hands a fresh `effectLabels` object and
  // `onThresholdChange` closure on every render, and either in the deps would rebuild every trace
  // (a full Plotly redraw) on each click anywhere in the app.
  const upName = effectLabels.up
  const downName = effectLabels.down
  const groups = useMemo(
    () => resolveGroups(style, 'volcano', { up: upName, down: downName }),
    [style, upName, downName]
  )
  const onThresholdRef = useRef(onThresholdChange)
  useEffect(() => {
    onThresholdRef.current = onThresholdChange
  }, [onThresholdChange])
  const editable = !!onThresholdChange
  const emphasis = useMemo(() => resolveHighlight(style), [style])
  const showLegend = legendOn(style)

  const { data, layout, labels, guides } = useMemo(() => {
    const p = PALETTES[mode]
    // The tooltip names the gene only when the highlight's own label is off (else it's a duplicate).
    // Fold-change axis names the comparison ("log₂FC · A | B") when the rows share one.
    const fcLabel = volcano.comparison ? `log₂FC · ${volcano.comparison}` : 'log₂FC'
    const hover = `${emphasis.label ? '' : '%{text}<br>'}${fcLabel}=%{x:.3f}<br>${yLabel}=%{y:.3f}<extra></extra>`
    const look = (eff: Eff) => groups.get(eff)!

    // Always colour EVERY point by effect (up/down/none), so the significance groups stay
    // visible whether or not anything is selected — never grey the cloud out.
    const byEffect: Record<Eff, VolcanoPoint[]> = { up: [], down: [], none: [] }
    for (const pt of volcano.points) byEffect[pt.effect].push(pt)
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
    const sel = volcano.points.filter((pt) => pinnedIds.has(pt.uniqID))
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

    const line = (x0: number, x1: number, y0: number, y1: number) => ({
      type: 'line',
      x0,
      x1,
      y0,
      y1,
      line: guideLine(p)
    })
    const yMax = Math.max(1, ...volcano.points.map((pt) => pt.y))
    // Pin explicit axis ranges (with padding) so the range never re-pads on hover — otherwise
    // the enlarged overlay marker on an edge point shifts the whole cloud, sliding the point
    // out from under the cursor and bouncing between hover/unhover.
    const xs = volcano.points.map((pt) => pt.x)
    const xLo = Math.min(volcano.fcLow, 0, ...xs)
    const xHi = Math.max(volcano.fcHigh, 0, ...xs)
    const xPad = (xHi - xLo || 2) * 0.05

    // Guide geometry follows the threshold TYPE. Non-linear (SAM): a hyperbola boundary
    //   stat = P_lim + b/(|log₂FC| − FC_lim)     (stored as statMin=P_lim, s0=−FC_lim)
    // defined by three draggable anchors — the P asymptote (a horizontal floor line), the FC
    // asymptote (two vertical wall lines at ±FC_lim), and a `b` handle sitting on the curve one
    // FC-unit outside the wall (where its height above the floor equals b). Linear: the usual
    // vertical FC cutoffs + horizontal stat cutoff, each a draggable line shape.
    const isSam = threshold?.type === 'non-linear'
    // Asymmetric mode: the up and down cutoffs are independent (no mirrored drags); otherwise a
    // drag on either side sets both (the store keeps them in lock-step too).
    const asymmetric = threshold?.asymmetric ?? false
    const samShapes: Record<string, unknown>[] = []
    let sam:
      | {
          statMin: number
          asym: number
          asymL: number
          s0: number
          s0L: number
          b: number
          samPath: (b: number) => string
        }
      | undefined
    if (isSam && threshold) {
      const statMin = threshold.statMin
      const b = threshold.b
      const s0v = threshold.s0
      const s0L = threshold.s0Down ?? s0v // down side's asymptote (mirrors s0 unless asymmetric)
      const asym = -s0v // FC asymptote |FC| = −s0 (positive in the normal FC-limit regime)
      const asymL = -s0L
      const yTop = yMax * 1.08
      const xRight = xHi + xPad
      // Build the SAM boundary path for a given b (uses the actual s0, so it matches applyThreshold).
      // Sample the RIGHT branch from where the curve meets the plot top (avoiding the blow-up near the
      // asymptote) out to the edge, never left of x=0; the LEFT branch mirrors it. Re-sampling on each
      // preview (not scaling a snapshot) keeps the drag preview matching the committed shape.
      const toPath = (pts: Array<[number, number]>): string =>
        pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('')
      // Sample UP TO yCap (above the plot top) so the near-vertical rise toward the asymptote is part
      // of the path and Plotly clips it at yTop — the curve then visibly shoots off the top near the
      // FC limit instead of ending flat at the edge.
      const yCap = statMin + (yTop - statMin) * 2
      const xLeft = xLo - xPad
      // One branch of the hyperbola for a given asymptote (positive-x form); the left branch is
      // the same shape sampled with the down side's asymptote and mirrored.
      const branch = (
        bVal: number,
        a: number,
        s0b: number,
        xEnd: number
      ): Array<[number, number]> => {
        const xStart = Math.max(0, a + bVal / Math.max(yCap - statMin, 1e-6))
        const pts: Array<[number, number]> = []
        if (xStart < xEnd) {
          const N = 140
          for (let i = 0; i < N; i++) {
            const x = xStart + ((xEnd - xStart) * i) / (N - 1)
            pts.push([x, Math.min(statMin + bVal / (x + s0b), yCap)])
          }
        }
        return pts
      }
      const samPath = (bVal: number): string => {
        const right = branch(bVal, asym, s0v, xRight)
        const left = branch(bVal, asymL, s0L, -xLeft)
          .map(([x, y]) => [-x, y] as [number, number])
          .reverse()
        return `${toPath(left)}${toPath(right)}`
      }
      samShapes.push({ type: 'path', path: samPath(b), line: guideLine(p) }) // [0] curve
      // The anchors are SMALL tick marks sitting just OUTSIDE their axis line (not full asymptote
      // lines) — a solid "grab" style that reads as a handle against the dashed curve. The cross-axis
      // extent is PAPER-referenced from the axis (paper 0) OUT into the margin (paper −TICK), so it's
      // clipped to the figure (not the plot area); the drag-axis coordinate (statMin / ±asym) stays
      // in data space.
      const handle = { ...guideLine(p), width: 2, dash: 'solid' }
      const TICK = 0.025 // paper length of each tick, into the margin
      // [1] P limit: tick just left of the y-axis (paper x ∈ [−TICK, 0]) at y = statMin.
      samShapes.push({
        type: 'line',
        xref: 'paper',
        x0: -TICK,
        x1: 0,
        y0: statMin,
        y1: statMin,
        line: handle
      })
      // [2],[3] FC limit: ticks just below the x-axis (paper y ∈ [−TICK, 0]) at x = ±asym.
      samShapes.push({
        type: 'line',
        x0: asym,
        x1: asym,
        yref: 'paper',
        y0: -TICK,
        y1: 0,
        line: handle
      })
      samShapes.push({
        type: 'line',
        x0: -asymL,
        x1: -asymL,
        yref: 'paper',
        y0: -TICK,
        y1: 0,
        line: handle
      })
      // `b` has no separate handle — the whole curve is grabbable (see the 'curve' guide below).
      sam = { statMin, asym, asymL, s0: s0v, s0L, b, samPath }
    }

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
        title: fcLabel,
        zeroline: false,
        range: [xLo - xPad, xHi + xPad],
        autorange: false
      },
      yaxis: {
        ...axisBase(p),
        title: yLabel,
        zeroline: false,
        range: [0, yMax * 1.08],
        autorange: false
      },
      // Guide order is fixed so a drag maps back to the right threshold field. Linear: draw only the
      // segments that BOUND the two significance wings — FC verticals ONLY above statMin, and the
      // stat cutoff as two horizontals ONLY outside ±fc (no line across the middle, where nothing is
      // significant). Order: [0]=fcLow, [1]=fcHigh, [2]=stat-left, [3]=stat-right.
      // SAM → [0]=curve, [1]=P asymptote, [2/3]=FC asymptotes.
      shapes: isSam
        ? samShapes
        : [
            line(volcano.fcLow, volcano.fcLow, volcano.statMin, yMax),
            line(volcano.fcHigh, volcano.fcHigh, volcano.statMin, yMax),
            line(xLo - xPad, volcano.fcLow, volcano.statMin, volcano.statMin),
            line(volcano.fcHigh, xHi + xPad, volcano.statMin, volcano.statMin)
          ]
    }
    // Collision-managed labels for the genes of every group whose label switch is on (by default
    // the significant ones), most significant first. PlotlyChart itself leaves out any pinned gene
    // (the selection overlay names it).
    const ranked = volcano.points.filter((pt) => look(pt.effect).label).sort((a, b) => b.y - a.y)
    const labels = (labelTop > 0 ? ranked.slice(0, labelTop) : ranked).map((pt) => ({
      x: pt.x,
      y: pt.y,
      text: pt.label,
      priority: pt.y,
      id: pt.uniqID
    }))
    // A bracket CORNER (±fc, statMin) is a 2-D handle adjusting both fold change and stat at once:
    // it live-updates all four bracket segments and commits fcLow/fcHigh/statMin together.
    // Symmetric: both FC verticals follow the dragged corner's |x|. Asymmetric: only the dragged
    // side's vertical moves (the other keeps its own cutoff); the stat floor always moves.
    const cornerVisual = (mx: number, my: number): Record<string, unknown> => {
      const fc = Math.abs(mx)
      const st = Math.max(0, my)
      const lo = asymmetric && mx > 0 ? volcano.fcLow : -fc
      const hi = asymmetric && mx < 0 ? volcano.fcHigh : fc
      return {
        'shapes[0].x0': lo,
        'shapes[0].x1': lo,
        'shapes[0].y0': st,
        'shapes[1].x0': hi,
        'shapes[1].x1': hi,
        'shapes[1].y0': st,
        'shapes[2].y0': st,
        'shapes[2].y1': st,
        'shapes[2].x1': lo,
        'shapes[3].y0': st,
        'shapes[3].y1': st,
        'shapes[3].x0': hi
      }
    }
    const cornerCommit = (mx: number, my: number): void => {
      const statMin = Math.max(0, my)
      const commit = onThresholdRef.current
      if (!asymmetric) commit?.({ fcLow: -Math.abs(mx), fcHigh: Math.abs(mx), statMin })
      else if (mx < 0) commit?.({ fcLow: -Math.abs(mx), statMin })
      else commit?.({ fcHigh: Math.abs(mx), statMin })
    }
    const cornerLabel = (mx: number, my: number): string =>
      `${asymmetric ? (mx < 0 ? 'log₂FC ≤ −' : 'log₂FC ≥ ') : '|log₂FC| ≥ '}${Math.abs(mx).toFixed(2)}, ${yLabel} ≥ ${Math.max(0, my).toFixed(2)}`
    // Draggable guides (only when editing is wired). Shape indices match the `shapes` order above.
    const guides: GuideDrag[] | undefined =
      !editable || (isSam && !sam)
        ? undefined
        : isSam && sam
          ? [
              // P limit (floor) → statMin; tick straddling the y-axis, drag vertically.
              {
                shapeIndex: 1,
                axis: 'y',
                kind: 'point',
                cursor: 'ns-resize',
                value: sam.statMin,
                key: 'statMin',
                crossPaper: true,
                format: (v) => `${yLabel} ≥ ${Math.max(0, v).toFixed(2)}`
              },
              // FC limit (±FC_lim) → s0 = −FC_lim; ticks straddling the x-axis, drag horizontally.
              // Symmetric: mirrored. Asymmetric: the left tick sets the down side's own s0Down.
              {
                shapeIndex: 2,
                axis: 'x',
                kind: 'point',
                cursor: 'ew-resize',
                value: sam.asym,
                key: 'fcLim',
                mirrorShapeIndex: asymmetric ? undefined : 3,
                crossPaper: true,
                format: (v) =>
                  `${asymmetric ? 'log₂FC ≥ ' : '|log₂FC| ≥ '}${Math.abs(v).toFixed(2)}`
              },
              {
                shapeIndex: 3,
                axis: 'x',
                kind: 'point',
                cursor: 'ew-resize',
                value: -sam.asymL,
                key: asymmetric ? 'fcLimDown' : 'fcLim',
                mirrorShapeIndex: asymmetric ? undefined : 2,
                crossPaper: true,
                format: (v) =>
                  `${asymmetric ? 'log₂FC ≤ −' : '|log₂FC| ≥ '}${Math.abs(v).toFixed(2)}`
              },
              // b: the whole curve is grabbable — drag it so it passes through the mouse point, with
              // the point cropped into the permissible region (|FC| ≥ FC_lim, stat ≥ P_lim). Last in
              // the list so the axis ticks above take grab priority where they'd overlap.
              {
                shapeIndex: 0,
                axis: 'y',
                kind: 'curve',
                cursor: 'nesw-resize',
                value: sam.b,
                key: 'b',
                format: (v) => `b = ${v.toFixed(2)}`,
                // 45° cursor matching the branch: right branch → ↗ (nesw), left branch → ↖ (nwse).
                cursorFn: (mx) => (mx >= 0 ? 'nesw-resize' : 'nwse-resize'),
                // Mouse point → new b, cropped into the permissible region (|FC| ≥ FC_lim, stat ≥ P_lim).
                solve: (mx, my) => {
                  const cy = Math.max(sam.statMin, my)
                  // Solve on the branch under the cursor (the down side may have its own asymptote).
                  const [a, s0b] = mx < 0 ? [sam.asymL, sam.s0L] : [sam.asym, sam.s0]
                  const cxAbs = Math.max(a, Math.abs(mx))
                  return Math.max(0.01, (cy - sam.statMin) * (cxAbs + s0b))
                },
                // Live preview: re-sample the curve for the new b (extends toward the asymptote).
                render: (bVal) => sam.samPath(bVal)
              }
            ]
          : [
              // Corners first, so grabbing near (±fc, statMin) adjusts BOTH fields (each references its
              // FC vertical, whose (x0,y0) is the corner). Right corner → ↗ (nesw), left → ↖ (nwse).
              {
                shapeIndex: 1,
                axis: 'x',
                kind: 'corner',
                cursor: 'nesw-resize',
                value: 0,
                key: 'corner',
                cornerVisual,
                cornerCommit,
                cornerLabel
              },
              {
                shapeIndex: 0,
                axis: 'x',
                kind: 'corner',
                cursor: 'nwse-resize',
                value: 0,
                key: 'corner',
                cornerVisual,
                cornerCommit,
                cornerLabel
              },
              // Symmetric: the fold-change lines mirror each other (both set to ±|value|) and the
              // tooltip shows the magnitude. Asymmetric: each line is its own cutoff.
              {
                shapeIndex: 0,
                axis: 'x',
                kind: 'line',
                cursor: 'ew-resize',
                value: volcano.fcLow,
                key: asymmetric ? 'fcLow' : 'fc',
                mirrorShapeIndex: asymmetric ? undefined : 1,
                format: (v) =>
                  asymmetric ? `log₂FC ≤ ${v.toFixed(2)}` : `|log₂FC| ≥ ${Math.abs(v).toFixed(2)}`
              },
              {
                shapeIndex: 1,
                axis: 'x',
                kind: 'line',
                cursor: 'ew-resize',
                value: volcano.fcHigh,
                key: asymmetric ? 'fcHigh' : 'fc',
                mirrorShapeIndex: asymmetric ? undefined : 0,
                format: (v) =>
                  asymmetric ? `log₂FC ≥ ${v.toFixed(2)}` : `|log₂FC| ≥ ${Math.abs(v).toFixed(2)}`
              },
              // The stat cutoff is two segments (left/right of the middle gap) that drag together.
              {
                shapeIndex: 2,
                axis: 'y',
                kind: 'line',
                cursor: 'ns-resize',
                value: volcano.statMin,
                key: 'statMin',
                syncShapeIndex: 3,
                format: (v) => `${yLabel} ≥ ${Math.max(0, v).toFixed(2)}`
              },
              {
                shapeIndex: 3,
                axis: 'y',
                kind: 'line',
                cursor: 'ns-resize',
                value: volcano.statMin,
                key: 'statMin',
                syncShapeIndex: 2,
                format: (v) => `${yLabel} ≥ ${Math.max(0, v).toFixed(2)}`
              }
            ]
    return { data: traces, layout: lay, labels, guides }
  }, [
    volcano,
    title,
    yLabel,
    mode,
    pinnedIds,
    selName,
    selColor,
    threshold,
    editable,
    labelTop,
    groups,
    showLegend,
    emphasis.label
  ])

  // Route a dragged guide's new value to the right threshold field (called once, on release).
  const onGuide = (key: string, value: number): void => {
    if (!onThresholdChange || !threshold) return
    if (key === 'fc') {
      // Symmetric linear FC: whichever line moved, set both cutoffs to ±|value| about 0.
      const mag = Math.abs(value)
      onThresholdChange({ fcLow: -mag, fcHigh: mag })
    } else if (key === 'fcLow') {
      onThresholdChange({ fcLow: -Math.abs(value) }) // asymmetric: the down cutoff alone (≤ 0)
    } else if (key === 'fcHigh') {
      onThresholdChange({ fcHigh: Math.abs(value) }) // asymmetric: the up cutoff alone (≥ 0)
    } else if (key === 'statMin') {
      onThresholdChange({ statMin: Math.max(0, value) }) // P asymptote / stat floor, ≥ 0
    } else if (key === 'fcLim') {
      onThresholdChange({ s0: -Math.abs(value) }) // FC asymptote: FC_lim = |value|, stored as s0 = −FC_lim
    } else if (key === 'fcLimDown') {
      onThresholdChange({ s0Down: -Math.abs(value) }) // asymmetric: the down side's own asymptote
    } else if (key === 'b') {
      onThresholdChange({ b: Math.max(0.01, value) }) // curve height (solved absolute b, already cropped)
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
