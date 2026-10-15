import { useEffect, useMemo, useRef } from 'react'

import {
  curveCuratorBoundary,
  samBoundary,
  SAM_S0,
  type ThresholdConfig,
  type VolcanoData,
  type VolcanoPoint
} from '../engine'
import {
  DEFAULT_EFFECT_LABELS,
  type EffectColors,
  type EffectLabels,
  type PointStyle
} from '../graph/types'
import { useGraph } from '../graph/store'
import { tooltip } from './condTooltip'
import { PlotlyChart, type GuideDrag } from './PlotlyChart'
import { legendOn, resolveGroups, resolveHighlight } from './pointStyle'
import { axisBase, EFFECT_COLOR, guideLine, PALETTES, plotBase } from './theme'
import { useSelectedGeneSets } from './useSelection'
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
  effectColors,
  style,
  curveNs,
  samCut,
  ccAlpha
}: {
  /** CurveCurator called by FDR: the effective α the target settled on — the boundary's shape and
   *  cutoff (none when nothing was called) */
  ccAlpha?: number
  /** SAM permutation FDR: the |d| cutoff it settled on and the pooled t's degrees of freedom —
   *  draws its boundary (none when nothing was called) */
  samCut?: { c: number; df: number }
  /** a curve fit's typical point count (control included) — draws CurveCurator's boundary */
  curveNs?: number[]
  volcano: VolcanoData
  title?: string
  /** per-tile marker / highlight / legend look (unset fields use the volcano defaults) */
  style?: PointStyle
  /** display names for the down/up classes (from the Compare config) */
  effectLabels?: EffectLabels
  /** the upstream Compare's effect colours — what each group's automatic colour follows */
  effectColors?: EffectColors
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
  // The point counts as a stable key (a fresh array each render would rebuild the plot).
  const nsKey = curveNs?.join(',')
  // The selected saved genesets (each its own trace: legend entry, and its colour if set). An
  // ad-hoc pick gets none — PlotlyChart's shared overlay marks and names each pinned gene, restyled
  // in place — and the sets stay stable across clicks that don't change them, so a click-select
  // elsewhere doesn't rebuild this plot (a full redraw).
  const geneSets = useGraph((s) => s.geneSets)
  const selSets = useSelectedGeneSets(geneSets)
  const yLabel = volcano.statType === 'pP' ? '−log P-value' : '−log Q-value'
  // Resolved once per config change (stable objects, so PlotlyChart doesn't re-render per hover).
  // Memo inputs are kept PRIMITIVE / stable: the parent hands a fresh `effectLabels` object and
  // `onThresholdChange` closure on every render, and either in the deps would rebuild every trace
  // (a full Plotly redraw) on each click anywhere in the app.
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
        'volcano',
        { up: upName, down: downName, none: noneName },
        { up: upColor, down: downColor, none: noneColor }
      ),
    [style, upName, downName, noneName, upColor, downColor, noneColor]
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
    // Fold-change axis names the comparison ("log₂FC · A | B") when the rows share one.
    const fc = volcano.measure ?? 'log₂FC'
    const fcLabel = volcano.comparison ? `${fc} · ${volcano.comparison}` : fc
    const hover = tooltip(
      {
        title: '%{text}',
        values: [
          [fcLabel, '%{x:.3f}'],
          [yLabel, '%{y:.3f}']
        ]
      },
      p.textMuted,
      { template: true }
    )
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
      const sel = volcano.points.filter((pt) => set.ids.has(pt.uniqID))
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

    const line = (x0: number, x1: number, y0: number, y1: number) => ({
      type: 'line',
      x0,
      x1,
      y0,
      y1,
      line: guideLine(p)
    })
    // A loop, not Math.max(...points): spreading every gene as an argument can overflow the stack.
    let yMax = 1
    for (const pt of volcano.points) yMax = Math.max(yMax, pt.y)
    // Always past the significance threshold, so the guides (drawn from it up to yMax) show whole
    // and the empty significant region reads as empty — with nothing past it (every q = 1, say),
    // a range fitted to the points alone would end below the threshold and cut the guides to stubs.
    if (Number.isFinite(volcano.statMin)) yMax = Math.max(yMax, volcano.statMin * 1.25)
    // Pin explicit axis ranges (with padding) so the range never re-pads on hover — otherwise
    // the enlarged overlay marker on an edge point shifts the whole cloud, sliding the point
    // out from under the cursor and bouncing between hover/unhover.
    // Loops, not Math.min(...xs): one argument per gene can overflow the stack.
    let xLo = Math.min(volcano.fcLow, 0)
    let xHi = Math.max(volcano.fcHigh, 0)
    for (const pt of volcano.points) {
      xLo = Math.min(xLo, pt.x)
      xHi = Math.max(xHi, pt.x)
    }
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
    // CurveCurator's relevance boundary (a curve fit): fixed by α and the fold-change limits, for
    // curves of `curveN` points — drawn, not dragged (both are set in the Compare's panel).
    // SAM's boundary likewise: the |d| cutoff its permutation FDR settled on, for genes with the
    // usual degrees of freedom — set by the FDR and s0 in the panel, not dragged.
    const isCurveCurator = threshold?.type === 'curvecurator'
    const isSamFdr = threshold?.type === 'sam_fdr'
    const ccShapes: Record<string, unknown>[] = []
    const samS0 = threshold?.samS0 ?? SAM_S0
    // The required −log₁₀ p at |log₂FC| = x, and where the boundary's wall sits.
    // A curve's boundary depends on its point count, so CurveCurator's is drawn for each count
    // common in the comparison (the most common solid, others fainter) — a curve missing a dose
    // is judged by its own.
    const ns = nsKey ? nsKey.split(',').map(Number) : []
    const ccAlphaUsed =
      threshold?.ccCallBy === 'fdr'
        ? ccAlpha
        : threshold
          ? Math.pow(10, -threshold.statMin)
          : undefined
    const needs: Array<{
      at: (x: number, lim: number) => number
      wallUp: number
      wallDown: number
      hardWall: boolean
      faint: boolean
    }> =
      isCurveCurator && threshold && ccAlphaUsed != null
        ? ns.map((n, i) => ({
            at: (x: number, lim: number) => curveCuratorBoundary(x, n, lim, ccAlphaUsed),
            wallUp: threshold.fcHigh,
            wallDown: -threshold.fcLow,
            // CurveCurator also requires |log₂FC| ≥ the limit outright: a vertical wall there,
            // which shows whenever the score's own curve has flattened before reaching it.
            hardWall: true,
            faint: i > 0
          }))
        : isSamFdr && samCut
          ? [
              {
                at: (x: number) => samBoundary(x, samCut.c, samS0, samCut.df),
                wallUp: samCut.c * samS0,
                wallDown: samCut.c * samS0,
                hardWall: false,
                faint: false
              }
            ]
          : []
    for (const need of needs) {
      const yCap = yMax * 1.08 * 2
      const branch = (lim: number, xEnd: number): Array<[number, number]> => {
        const pts: Array<[number, number]> = []
        if (!(xEnd > lim)) return pts
        // Where the boundary starts: the limit itself when it's finite there, else its asymptote
        // further out (CurveCurator's F at the cutoff, called by FDR; SAM's c·s0) — found by
        // bisection, so the line rises from the true start rather than from the first even sample
        // past it, which sat partway up and left the line short of the top.
        let x0 = lim
        if (!Number.isFinite(need.at(lim, lim))) {
          if (!Number.isFinite(need.at(xEnd, lim))) return pts
          let a = lim
          let b = xEnd
          for (let k = 0; k < 50; k++) {
            const m = (a + b) / 2
            if (Number.isFinite(need.at(m, lim))) b = m
            else a = m
          }
          x0 = b
        }
        // Points packed toward the start (cubic spacing), where the boundary climbs steeply.
        const N = 140
        for (let i = 0; i < N; i++) {
          const x = x0 + (xEnd - x0) * (i / (N - 1)) ** 3
          const y = need.at(x, lim)
          if (Number.isFinite(y)) pts.push([x, Math.min(y, yCap)])
        }
        // Up to the top from where it starts: the fold-change wall when the boundary is finite at
        // the limit, else the last sliver of the asymptote's climb.
        if ((need.hardWall || x0 > lim) && pts.length && pts[0][1] < yCap)
          pts.unshift([pts[0][0], yCap])
        return pts
      }
      const toPath = (pts: Array<[number, number]>): string =>
        pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('')
      const right = branch(need.wallUp, xHi + xPad)
      const left = branch(need.wallDown, -(xLo - xPad)).map(([x, y]) => [-x, y] as [number, number])
      const look = need.faint ? { ...guideLine(p), width: 1 } : guideLine(p)
      const extra = need.faint ? { opacity: 0.45 } : null
      if (right.length) ccShapes.push({ type: 'path', path: toPath(right), line: look, ...extra })
      if (left.length) ccShapes.push({ type: 'path', path: toPath(left), line: look, ...extra })
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
      shapes:
        isCurveCurator || isSamFdr
          ? ccShapes
          : isSam
            ? samShapes
            : [
                line(volcano.fcLow, volcano.fcLow, volcano.statMin, yMax),
                line(volcano.fcHigh, volcano.fcHigh, volcano.statMin, yMax),
                line(xLo - xPad, volcano.fcLow, volcano.statMin, volcano.statMin),
                line(volcano.fcHigh, xHi + xPad, volcano.statMin, volcano.statMin)
              ]
    }
    // Collision-managed labels for the genes of every group whose label switch is on (by default
    // the significant ones), ranked by Manhattan distance from the origin — fold change and
    // significance together, each scaled to its axis' extent so neither unit dominates (a gene far
    // out on either axis, or moderately out on both, ranks high). The ranking runs before
    // PlotlyChart's crowding gate and placement, which keep the highest-ranked that fit; it also
    // decides what the label cap keeps. PlotlyChart leaves out any pinned gene (the selection
    // overlay names it).
    const xSpan = Math.max(Math.abs(xLo), Math.abs(xHi)) || 1
    const manhattan = (pt: { x: number; y: number }): number => Math.abs(pt.x) / xSpan + pt.y / yMax
    const ranked = volcano.points
      .filter((pt) => look(pt.effect).label)
      .map((pt) => ({ pt, d: manhattan(pt) }))
      .sort((a, b) => b.d - a.d)
    const labels = (labelTop > 0 ? ranked.slice(0, labelTop) : ranked).map(({ pt, d }) => ({
      x: pt.x,
      y: pt.y,
      text: pt.label,
      priority: d,
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
      !editable || isCurveCurator || isSamFdr || (isSam && !sam)
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
    selSets,
    threshold,
    editable,
    labelTop,
    groups,
    showLegend,
    nsKey,
    samCut,
    ccAlpha
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
