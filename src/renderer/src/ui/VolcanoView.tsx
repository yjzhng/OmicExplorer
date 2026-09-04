import { useMemo } from 'react'

import type { ThresholdConfig, VolcanoData, VolcanoPoint } from '../engine'
import { PlotlyChart, type GuideDrag } from './PlotlyChart'
import { axisBase, EFFECT_COLOR, guideLine, PALETTES, plotBase } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

type Eff = 'up' | 'down' | 'none'
const ORDER: Eff[] = ['none', 'down', 'up']

/** Interactive volcano: log2FC vs significance, colored by effect, with threshold guides.
 *  When `focus` genes are set, they keep full effect color + an outline while the rest
 *  of the cloud dims to a grey background (omicViz's background/highlight split). */
export function VolcanoView({
  volcano,
  title,
  focus,
  threshold,
  onThresholdChange
}: {
  volcano: VolcanoData
  title?: string
  focus?: string[]
  /** the compare's threshold — drives the guide geometry: linear (vertical FC + horizontal stat
   *  lines) vs non-linear SAM (a single curved boundary). Falls back to linear when absent. */
  threshold?: ThresholdConfig
  /** when set, the guide lines become draggable; a drag commits the moved boundary back as a
   *  threshold patch (fcLow/fcHigh/statMin), which live-reclassifies the genes. */
  onThresholdChange?: (partial: Partial<ThresholdConfig>) => void
}) {
  const mode = useUiTheme((s) => s.mode)
  // Pinned (linked-selection) genes become their own "Selected" legend group. Subscribe to
  // pinnedIds only (not hoverId), so the plot rebuilds on a click-select, not on every hover.
  const pinnedIds = useSelection((s) => s.pinnedIds)
  const yLabel = volcano.statType === 'pP' ? '−log₁₀ p' : '−log₁₀ q'

  const { data, layout, labels, guides } = useMemo(() => {
    const p = PALETTES[mode]
    const focusSet = new Set(focus ?? [])
    const hasFocus = focusSet.size > 0
    const hover = `%{text}<br>log2FC=%{x:.3f}<br>${yLabel}=%{y:.3f}<extra></extra>`

    // Always colour EVERY point by effect (up/down/none), so the significance groups stay
    // visible whether or not GOI is active — never grey the cloud out.
    const byEffect: Record<Eff, VolcanoPoint[]> = { up: [], down: [], none: [] }
    for (const pt of volcano.points) byEffect[pt.effect].push(pt)
    const traces: Array<Record<string, unknown>> = ORDER.map((eff) => {
      const pts = byEffect[eff]
      return {
        type: 'scatter',
        mode: 'markers',
        name: `${eff} (${pts.length})`,
        x: pts.map((pt) => pt.x),
        y: pts.map((pt) => pt.y),
        text: pts.map((pt) => pt.label),
        customdata: pts.map((pt) => pt.uniqID),
        hovertemplate: hover,
        marker: { color: EFFECT_COLOR[eff], size: 7, opacity: 0.85 }
      }
    })
    // With focus (GOI) genes set, draw them ON TOP as an emphasis layer — same effect colour,
    // enlarged, outlined and labelled — so they stand out without hiding everyone else's
    // significance. Shown in the legend as its own "GOI" group (the outline marks the group).
    if (hasFocus) {
      const fg = volcano.points.filter((pt) => focusSet.has(pt.uniqID))
      traces.push({
        type: 'scatter',
        mode: 'markers+text',
        name: `GOI (${fg.length})`,
        showlegend: true,
        x: fg.map((pt) => pt.x),
        y: fg.map((pt) => pt.y),
        text: fg.map((pt) => pt.label),
        textposition: 'top center',
        textfont: { size: 10, color: p.text },
        customdata: fg.map((pt) => pt.uniqID),
        hovertemplate: hover,
        marker: {
          color: fg.map((pt) => EFFECT_COLOR[pt.effect]),
          size: 12,
          opacity: 1,
          line: { width: 1.5, color: p.text }
        }
      })
    }
    // Pinned genes → a "Selected" legend group, drawn on top with a bright highlight ring so
    // they read distinctly from GOI (dark outline) and from the effect groups.
    const sel = volcano.points.filter((pt) => pinnedIds.has(pt.uniqID))
    if (sel.length) {
      traces.push({
        type: 'scatter',
        // Markers only — the pinned gene's LABEL comes from the shared selection overlay (which
        // labels each active gene exactly once); duplicating it here caused a doubled label.
        mode: 'markers',
        name: `Selected (${sel.length})`,
        showlegend: true,
        x: sel.map((pt) => pt.x),
        y: sel.map((pt) => pt.y),
        customdata: sel.map((pt) => pt.uniqID),
        hovertemplate: hover,
        // A single/few pins are enlarged for emphasis; a big group (e.g. a legend-group click)
        // shrinks so the cloud doesn't overwhelm.
        marker:
          sel.length > 12
            ? { color: sel.map((pt) => EFFECT_COLOR[pt.effect]), size: 9, opacity: 1 }
            : { color: sel.map((pt) => EFFECT_COLOR[pt.effect]), size: 14, opacity: 1 }
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
    //   stat = P_lim + b/(|log2FC| − FC_lim)     (stored as statMin=P_lim, s0=−FC_lim)
    // defined by three draggable anchors — the P asymptote (a horizontal floor line), the FC
    // asymptote (two vertical wall lines at ±FC_lim), and a `b` handle sitting on the curve one
    // FC-unit outside the wall (where its height above the floor equals b). Linear: the usual
    // vertical FC cutoffs + horizontal stat cutoff, each a draggable line shape.
    const isSam = threshold?.type === 'non-linear'
    const samShapes: Record<string, unknown>[] = []
    let sam:
      | { statMin: number; asym: number; s0: number; b: number; samPath: (b: number) => string }
      | undefined
    if (isSam && threshold) {
      const statMin = threshold.statMin
      const b = threshold.b
      const s0v = threshold.s0
      const asym = -s0v // FC asymptote |FC| = −s0 (positive in the normal FC-limit regime)
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
      const samPath = (bVal: number): string => {
        const xStart = Math.max(0, asym + bVal / Math.max(yCap - statMin, 1e-6))
        const right: Array<[number, number]> = []
        if (xStart < xRight) {
          const N = 140
          for (let i = 0; i < N; i++) {
            const x = xStart + ((xRight - xStart) * i) / (N - 1)
            right.push([x, Math.min(statMin + bVal / (Math.abs(x) + s0v), yCap)])
          }
        }
        const left = right.map(([x, y]) => [-x, y] as [number, number]).reverse()
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
      samShapes.push({ type: 'line', xref: 'paper', x0: -TICK, x1: 0, y0: statMin, y1: statMin, line: handle })
      // [2],[3] FC limit: ticks just below the x-axis (paper y ∈ [−TICK, 0]) at x = ±asym.
      samShapes.push({ type: 'line', x0: asym, x1: asym, yref: 'paper', y0: -TICK, y1: 0, line: handle })
      samShapes.push({ type: 'line', x0: -asym, x1: -asym, yref: 'paper', y0: -TICK, y1: 0, line: handle })
      // `b` has no separate handle — the whole curve is grabbable (see the 'curve' guide below).
      sam = { statMin, asym, s0: s0v, b, samPath }
    }

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      // Legend centered ABOVE the plot (horizontal), not on the right: a right-side legend
      // reserves horizontal room that shifts as its content changes, moving the cloud sideways
      // on hover and bouncing the point. A top legend never affects the plot width. Forced
      // always-on (showlegend) so it never appears/disappears and reflows the layout.
      showlegend: true,
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 },
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: {
        ...axisBase(p),
        title: 'log₂ fold change',
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
    // Collision-managed labels for the SIGNIFICANT genes (most significant first). GOI/pinned
    // genes are already named by their own emphasis traces, so leave them out to avoid doubles.
    const named = new Set([...(focus ?? []), ...pinnedIds])
    const labels = volcano.points
      .filter((pt) => pt.effect !== 'none' && !named.has(pt.uniqID))
      .map((pt) => ({ x: pt.x, y: pt.y, text: pt.label, priority: pt.y, id: pt.uniqID }))
    // A bracket CORNER (±fc, statMin) is a 2-D handle adjusting both fold change and stat at once:
    // it live-updates all four bracket segments and commits fcLow/fcHigh/statMin together.
    const cornerVisual = (mx: number, my: number): Record<string, unknown> => {
      const fc = Math.abs(mx)
      const st = Math.max(0, my)
      return {
        'shapes[0].x0': -fc, 'shapes[0].x1': -fc, 'shapes[0].y0': st,
        'shapes[1].x0': fc, 'shapes[1].x1': fc, 'shapes[1].y0': st,
        'shapes[2].y0': st, 'shapes[2].y1': st, 'shapes[2].x1': -fc,
        'shapes[3].y0': st, 'shapes[3].y1': st, 'shapes[3].x0': fc
      }
    }
    const cornerCommit = (mx: number, my: number): void =>
      onThresholdChange?.({ fcLow: -Math.abs(mx), fcHigh: Math.abs(mx), statMin: Math.max(0, my) })
    const cornerLabel = (mx: number, my: number): string =>
      `|log₂FC| ≥ ${Math.abs(mx).toFixed(2)}, ${yLabel} ≥ ${Math.max(0, my).toFixed(2)}`
    // Draggable guides (only when editing is wired). Shape indices match the `shapes` order above.
    const guides: GuideDrag[] | undefined =
      !onThresholdChange || (isSam && !sam)
        ? undefined
        : isSam && sam
          ? [
              // P limit (floor) → statMin; tick straddling the y-axis, drag vertically.
              {
                shapeIndex: 1, axis: 'y', kind: 'point', cursor: 'ns-resize', value: sam.statMin,
                key: 'statMin', crossPaper: true, format: (v) => `${yLabel} ≥ ${Math.max(0, v).toFixed(2)}`
              },
              // FC limit (±FC_lim) → s0 = −FC_lim; ticks straddling the x-axis, drag horizontally, symmetric.
              {
                shapeIndex: 2, axis: 'x', kind: 'point', cursor: 'ew-resize', value: sam.asym,
                key: 'fcLim', mirrorShapeIndex: 3, crossPaper: true, format: (v) => `|log₂FC| ≥ ${Math.abs(v).toFixed(2)}`
              },
              {
                shapeIndex: 3, axis: 'x', kind: 'point', cursor: 'ew-resize', value: -sam.asym,
                key: 'fcLim', mirrorShapeIndex: 2, crossPaper: true, format: (v) => `|log₂FC| ≥ ${Math.abs(v).toFixed(2)}`
              },
              // b: the whole curve is grabbable — drag it so it passes through the mouse point, with
              // the point cropped into the permissible region (|FC| ≥ FC_lim, stat ≥ P_lim). Last in
              // the list so the axis ticks above take grab priority where they'd overlap.
              {
                shapeIndex: 0, axis: 'y', kind: 'curve', cursor: 'nesw-resize', value: sam.b,
                key: 'b', format: (v) => `b = ${v.toFixed(2)}`,
                // 45° cursor matching the branch: right branch → ↗ (nesw), left branch → ↖ (nwse).
                cursorFn: (mx) => (mx >= 0 ? 'nesw-resize' : 'nwse-resize'),
                // Mouse point → new b, cropped into the permissible region (|FC| ≥ FC_lim, stat ≥ P_lim).
                solve: (mx, my) => {
                  const cy = Math.max(sam.statMin, my)
                  const cxAbs = Math.max(sam.asym, Math.abs(mx))
                  return Math.max(0.01, (cy - sam.statMin) * (cxAbs + sam.s0))
                },
                // Live preview: re-sample the curve for the new b (extends toward the asymptote).
                render: (bVal) => sam.samPath(bVal)
              }
            ]
          : [
            // Corners first, so grabbing near (±fc, statMin) adjusts BOTH fields (each references its
            // FC vertical, whose (x0,y0) is the corner). Right corner → ↗ (nesw), left → ↖ (nwse).
            {
              shapeIndex: 1, axis: 'x', kind: 'corner', cursor: 'nesw-resize', value: 0, key: 'corner',
              cornerVisual, cornerCommit, cornerLabel
            },
            {
              shapeIndex: 0, axis: 'x', kind: 'corner', cursor: 'nwse-resize', value: 0, key: 'corner',
              cornerVisual, cornerCommit, cornerLabel
            },
            // The fold-change lines are symmetric about 0: dragging either mirrors the other. The
            // tooltip shows the magnitude, since both cutoffs are set to ±|value|.
            {
              shapeIndex: 0, axis: 'x', kind: 'line', cursor: 'ew-resize', value: volcano.fcLow,
              key: 'fc', mirrorShapeIndex: 1, format: (v) => `|log₂FC| ≥ ${Math.abs(v).toFixed(2)}`
            },
            {
              shapeIndex: 1, axis: 'x', kind: 'line', cursor: 'ew-resize', value: volcano.fcHigh,
              key: 'fc', mirrorShapeIndex: 0, format: (v) => `|log₂FC| ≥ ${Math.abs(v).toFixed(2)}`
            },
            // The stat cutoff is two segments (left/right of the middle gap) that drag together.
            {
              shapeIndex: 2, axis: 'y', kind: 'line', cursor: 'ns-resize', value: volcano.statMin,
              key: 'statMin', syncShapeIndex: 3, format: (v) => `${yLabel} ≥ ${Math.max(0, v).toFixed(2)}`
            },
            {
              shapeIndex: 3, axis: 'y', kind: 'line', cursor: 'ns-resize', value: volcano.statMin,
              key: 'statMin', syncShapeIndex: 2, format: (v) => `${yLabel} ≥ ${Math.max(0, v).toFixed(2)}`
            }
          ]
    return { data: traces, layout: lay, labels, guides }
  }, [volcano, title, yLabel, mode, focus, pinnedIds, threshold, onThresholdChange])

  // Route a dragged guide's new value to the right threshold field (called once, on release).
  const onGuide = (key: string, value: number): void => {
    if (!onThresholdChange || !threshold) return
    if (key === 'fc') {
      // Linear FC is symmetric: whichever line moved, set both cutoffs to ±|value| about 0.
      const mag = Math.abs(value)
      onThresholdChange({ fcLow: -mag, fcHigh: mag })
    } else if (key === 'statMin') {
      onThresholdChange({ statMin: Math.max(0, value) }) // P asymptote / stat floor, ≥ 0
    } else if (key === 'fcLim') {
      onThresholdChange({ s0: -Math.abs(value) }) // FC asymptote: FC_lim = |value|, stored as s0 = −FC_lim
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
      guides={guides}
      onGuide={onGuide}
    />
  )
}
