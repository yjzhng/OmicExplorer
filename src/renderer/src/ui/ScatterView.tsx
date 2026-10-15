import { useMemo } from 'react'

import {
  bandConfAt,
  bandEdgePath,
  marginalQAt,
  type AxisTail,
  type ScatterData,
  type ScatterPoint
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
import {
  legendOn,
  QUAD_ORDER,
  resolveGroups,
  resolveHighlight,
  type ResolvedGroup
} from './pointStyle'
import { axisBase, EFFECT_COLOR, CATEGORICAL, guideLine, PALETTES, plotBase } from './theme'
import { useSelectedGeneSets } from './useSelection'
import { useUiTheme } from './useUiTheme'

type Eff = 'up' | 'down' | 'none'
const EFF_ORDER: Eff[] = ['none', 'down', 'up']

/**
 * Contrast scatter: FC1 (y) vs FC2 (x). The significance boundary follows the contrast's
 * relationship — an OLS fit + prediction band when correlated, a 9-zone per-axis box when
 * independent (see ScatterGuide). Divergent genes are highlighted; the top few by |FCdiff|
 * are labelled. With `onStatDrag`, the boundary is draggable — the band's edges, the axis lines —
 * and a release reports the cutoff it now stands for (a band confidence, an axis q).
 */
export function ScatterView({
  scatter,
  title,
  labelTop = 0,
  effectLabels = DEFAULT_EFFECT_LABELS,
  effectColors,
  style,
  onStatDrag,
  asymmetric = false
}: {
  scatter: ScatterData
  title?: string
  labelTop?: number
  /** per-tile marker / highlight / legend look (unset fields use the scatter defaults) */
  style?: PointStyle
  /** display names for the down/up classes (from the upstream Compare/Contrast config) */
  effectLabels?: EffectLabels
  /** the upstream Compare's effect colours — what each group's automatic colour follows */
  effectColors?: EffectColors
  /** a dragged edge's new cutoff, on release: the band's top / bottom edge → its confidence; an
   *  axis line (A = y, B = x; up / down of its centre) → its q. Unset = the guides stay put. */
  onStatDrag?: (edge: 'bandUp' | 'bandDown' | AxisTail, value: number) => void
  /** the contrast's cutoffs are per tail: the edges move apart (otherwise a band edge drags its
   *  partner with it, mirrored) */
  asymmetric?: boolean
}) {
  const mode = useUiTheme((s) => s.mode)
  // The selected saved genesets (each its own trace: legend entry, and its colour if set). An
  // ad-hoc pick gets none — PlotlyChart's shared overlay marks and names each pinned gene, restyled
  // in place — and the sets stay stable across clicks that don't change them, so a click-select
  // elsewhere doesn't rebuild this plot (a full redraw).
  const geneSets = useGraph((s) => s.geneSets)
  const selSets = useSelectedGeneSets(geneSets)
  // Point groups depend on the relationship. A correlated (OLS) contrast colours called genes by
  // the side of the fitted line they broke out on — up (red, above) / down (blue, below) / none
  // (grey), matching volcano/MA. An independent (marginal) contrast instead colours by QUADRANT: the
  // composite "<FC1 dir>, <FC2 dir>" effect, so each significant corner reads as its own group.
  const marginal = scatter.guide?.kind === 'marginal'
  // Resolved once per config change (stable objects, so PlotlyChart doesn't re-render per hover).
  // Memo inputs kept primitive (the parent hands a fresh `effectLabels` object per render).
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
        marginal ? 'scatterQuad' : 'scatter',
        { up: upName, down: downName, none: noneName },
        { up: upColor, down: downColor, none: noneColor }
      ),
    [style, marginal, upName, downName, noneName, upColor, downColor, noneColor]
  )
  const emphasis = useMemo(() => resolveHighlight(style), [style])
  const showLegend = legendOn(style)

  const editable = !!onStatDrag
  const { data, layout, labels, guides } = useMemo(() => {
    const p = PALETTES[mode]

    const hover = tooltip(
      {
        title: '%{text}',
        values: [
          [scatter.xLabel, '%{x:.3f}'],
          [scatter.yLabel, '%{y:.3f}']
        ]
      },
      p.textMuted,
      { template: true }
    )
    const trace = (pts: ScatterPoint[], g: ResolvedGroup) => ({
      type: 'scatter',
      mode: 'markers',
      name: `${g.name} (${pts.length})`,
      showlegend: g.legend,
      // This group's own highlight look — see PlotlyChart's EMPH_KEY.
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
    })
    // A point's group key: its quadrant (marginal) or effect class; anything unknown is 'none'.
    const keyOf = (pt: ScatterPoint): string =>
      marginal
        ? pt.effect && pt.effect !== 'none'
          ? pt.effect
          : 'none'
        : pt.effect === 'up' || pt.effect === 'down'
          ? pt.effect
          : 'none'
    // Unknown quadrant keys (extras beyond QUAD_ORDER) get a categorical fallback colour.
    const look = (key: string, fallbackIdx = 0): ResolvedGroup =>
      groups.get(key) ?? {
        ...groups.get('none')!,
        key,
        name: key,
        size: 8,
        color: CATEGORICAL[fallbackIdx % CATEGORICAL.length],
        label: true
      }

    let pointTraces: object[]
    if (marginal) {
      const byQuad = new Map<string, ScatterPoint[]>()
      for (const pt of scatter.points) {
        const key = keyOf(pt)
        const arr = byQuad.get(key)
        if (arr) arr.push(pt)
        else byQuad.set(key, [pt])
      }
      // Known quadrants in QUAD_ORDER first (stable colours), then any unexpected extras.
      const keys = [...byQuad.keys()].filter((k) => k !== 'none')
      keys.sort((a, b) => {
        const ia = QUAD_ORDER.indexOf(a)
        const ib = QUAD_ORDER.indexOf(b)
        return (ia < 0 ? QUAD_ORDER.length + 1 : ia) - (ib < 0 ? QUAD_ORDER.length + 1 : ib)
      })
      const noneGrp = byQuad.get('none')
      // Each quadrant is styled by its FIXED identity (the resolved group for its key), not by its
      // position among the quadrants that happen to have points — so a given quadrant always reads
      // the same regardless of which others are populated.
      pointTraces = [
        ...(noneGrp ? [trace(noneGrp, look('none'))] : []),
        ...keys.map((k) => trace(byQuad.get(k)!, look(k, keys.indexOf(k))))
      ]
    } else {
      const byEffect: Record<Eff, ScatterPoint[]> = { up: [], down: [], none: [] }
      for (const pt of scatter.points) byEffect[keyOf(pt) as Eff].push(pt)
      // One trace per effect group (none/down/up). Empty groups are dropped so the legend
      // doesn't show "(0)" entries (e.g. a value scatter is all `none`).
      pointTraces = EFF_ORDER.filter((e) => byEffect[e].length > 0).map((e) =>
        trace(byEffect[e], look(e))
      )
    }

    // One shared square spanning both axes (looped rather than spread — these arrays run to
    // thousands of genes), so the line of identity runs corner to corner. Fold changes keep the
    // origin in range — (0,0) is "no change on either side"; abundances fit the data, since
    // 0 there would only push the cloud into a corner. A little padding keeps extreme points
    // off the border.
    const all = scatter.points
    const fc = (scatter.valueKind ?? 'fc') === 'fc'
    let lo0 = fc ? 0 : Infinity
    let hi0 = fc ? 0 : -Infinity
    for (const pt of all) {
      lo0 = Math.min(lo0, pt.x, pt.y)
      hi0 = Math.max(hi0, pt.x, pt.y)
    }
    if (!Number.isFinite(lo0) || !Number.isFinite(hi0)) lo0 = hi0 = 0
    const pad = (hi0 - lo0) * 0.03 || 0.5
    const lo = lo0 - pad
    const hi = hi0 + pad

    // A *correlated* contrast gets the line of identity plus a prediction-band envelope
    // around it — dissonant genes sit outside. An *independent* one gets two thresholds on
    // each axis, carving the plane into 9 zones, and no line of identity.
    const g = scatter.guide
    const gLine = guideLine(p)
    const curve = (d: { x: number[]; y: number[] }, dashed: boolean) => ({
      type: 'scatter',
      mode: 'lines',
      hoverinfo: 'skip',
      showlegend: false,
      x: d.x,
      y: d.y,
      line: { color: p.textMuted, width: 1.5, dash: dashed ? 'dash' : 'solid' },
      opacity: dashed ? 0.7 : 0.55
    })
    // The band's edges are path SHAPES (a guide is a shape, so they can be dragged), drawn at the
    // cutoffs in force, centred on the fitted line the calls are measured from (a solid trace,
    // drawn first so points sit above it); y = x stays as a faint dotted reference — "the same
    // response on both sides". Without the band's parameters (too few points to fit), the
    // sampled edges as traces instead.
    const band = g?.kind === 'ols' ? g.band : undefined
    const conf = g?.cutoffs ?? {
      confUp: 0.99,
      confDown: 0.99,
      q: { aUp: 0.01, aDown: 0.01, bUp: 0.01, bDown: 0.01 }
    }
    const guideTraces =
      g?.kind === 'ols' && g.fit && g.upper && g.lower
        ? band
          ? [
              // the y = x reference — unless the model's line IS y = x (identity)
              ...(band.fixed
                ? []
                : [
                    {
                      ...curve({ x: [lo, hi], y: [lo, hi] }, false),
                      line: { color: p.textMuted, width: 1, dash: 'dot' },
                      opacity: 0.45
                    }
                  ]),
              curve(g.fit, false)
            ]
          : [curve(g.fit, false), curve(g.upper, true), curve(g.lower, true)]
        : []
    const edge = (side: 1 | -1) => ({
      type: 'path',
      path: bandEdgePath(band!, side > 0 ? conf.confUp : conf.confDown, side),
      line: { color: p.textMuted, width: 1.5, dash: 'dash' },
      opacity: 0.7
    })
    const hLine = (y: number) => ({
      type: 'line',
      xref: 'paper',
      x0: 0,
      x1: 1,
      y0: y,
      y1: y,
      line: gLine
    })
    const vLine = (x: number) => ({
      type: 'line',
      yref: 'paper',
      y0: 0,
      y1: 1,
      x0: x,
      x1: x,
      line: gLine
    })
    const identity = { type: 'line', x0: lo, x1: hi, y0: lo, y1: hi, line: gLine }
    const guideShapes =
      g?.kind === 'marginal'
        ? [
            hLine(g.yLo as number),
            hLine(g.yHi as number),
            vLine(g.xLo as number),
            vLine(g.xHi as number)
          ]
        : g?.kind === 'ols'
          ? band
            ? [edge(1), edge(-1)]
            : []
          : [identity] // no guide (e.g. too few points) — fall back to the line of identity

    // Draggable guides (only when editing is wired), indexed into `guideShapes` above. A band edge
    // is grabbed anywhere and passes through the cursor (its confidence solved from the point); an
    // axis line slides along its axis, its q read off where it lands.
    const pctOf = (c: number): string => `${Math.round(Math.max(0, 1 - c) * 1000) / 10}%`
    const qShown = (q: number): string =>
      String(Math.min(0.5, Math.max(0.001, Math.ceil(q * 1000 - 1e-9) / 1000)))
    const bandGuide = (i: 0 | 1): GuideDrag => {
      const side = i === 0 ? 1 : -1
      return {
        shapeIndex: i,
        axis: 'y',
        kind: 'curve',
        // across the band (along y = −x): its edges run with y = x, on axes of one scale
        cursor: 'nwse-resize',
        key: i === 0 ? 'bandUp' : 'bandDown',
        value: i === 0 ? conf.confUp : conf.confDown,
        solve: (mx, my) => Math.min(0.999, Math.max(0.5, bandConfAt(band!, mx, my))),
        render: (c) => bandEdgePath(band!, c, side),
        // symmetric: the other edge mirrors it live
        ...(asymmetric
          ? null
          : {
              syncShapeIndex: i === 0 ? 1 : 0,
              syncRender: (c: number) => bandEdgePath(band!, c, -side as 1 | -1)
            }),
        format: (c) => `${i === 0 ? 'top' : 'bottom'} ${pctOf(c)} outside the band`
      }
    }
    const lineGuide = (i: number, axis: 'x' | 'y', key: AxisTail): GuideDrag => ({
      shapeIndex: i,
      axis,
      kind: 'line',
      cursor: axis === 'x' ? 'ew-resize' : 'ns-resize',
      key,
      value: ({ 0: g?.yLo, 1: g?.yHi, 2: g?.xLo, 3: g?.xHi } as Record<number, number | undefined>)[
        i
      ] as number,
      format: (v) => `${axis === 'y' ? 'A' : 'B'} q < ${qShown(marginalQAt(g!, axis, v))}`
    })
    const guides: GuideDrag[] | undefined = !editable
      ? undefined
      : g?.kind === 'ols' && band
        ? [bandGuide(0), bandGuide(1)]
        : g?.kind === 'marginal' && g.axes
          ? [
              lineGuide(0, 'y', 'aDown'),
              lineGuide(1, 'y', 'aUp'),
              lineGuide(2, 'x', 'bDown'),
              lineGuide(3, 'x', 'bUp')
            ]
          : undefined

    // Collision-managed labels for the genes of every group whose label switch is on (by default
    // the significant / divergent ones), ranked by Manhattan distance from what the mode measures
    // against: the fitted line for a correlated contrast (|y − ŷ(x)|, the residual the calls are
    // made on; y = x without a fit), the centre for an independent one (|x| + |y|). Both axes share
    // units, so no scaling. The ranking runs before PlotlyChart's crowding gate and placement, and decides what
    // labelTop keeps; 0 (the default) offers them all, and more appear as you zoom in.
    const fitB = g?.kind === 'ols' ? g.band : undefined
    const distance = (pt: ScatterPoint): number =>
      marginal
        ? Math.abs(pt.x) + Math.abs(pt.y)
        : Math.abs(pt.y - (fitB ? fitB.beta0 + fitB.beta1 * pt.x : pt.x))
    const ranked = scatter.points
      .filter((pt) => look(keyOf(pt)).label)
      .map((pt) => ({ pt, d: distance(pt) }))
      .sort((a, b) => b.d - a.d)
    const labels = (labelTop > 0 ? ranked.slice(0, labelTop) : ranked).map(({ pt, d }) => ({
      x: pt.x,
      y: pt.y,
      text: pt.label,
      priority: d,
      id: pt.uniqID
    }))

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      // The builder owns the axis text — a contrast scatter reads "log₂FC · <side>",
      // a value scatter "log₁₀ <level>".
      // Both axes share one range (spanning the origin for fold changes), so the square is
      // symmetric and the line of identity runs corner-to-corner.
      xaxis: { ...axisBase(p), title: scatter.xLabel, zeroline: false, range: [lo, hi] },
      yaxis: {
        ...axisBase(p),
        title: scatter.yLabel,
        zeroline: false,
        scaleanchor: 'x',
        range: [lo, hi]
      },
      shapes: guideShapes,
      // Legend centered ABOVE the plot (horizontal), matching volcano/MA — a right-side legend
      // would steal plot width and shift as group names change. Fixed per config (never toggled
      // by the data) so it doesn't appear/disappear and reflow the layout.
      showlegend: showLegend,
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 }
    }
    // Each selected geneset → its genes on top as their own trace (markers only; the overlay names
    // them), with its legend entry and its colour if it has one.
    const selTrace = selSets.flatMap((set) => {
      const sel = scatter.points.filter((pt) => set.ids.has(pt.uniqID))
      if (!sel.length) return []
      return [
        {
          type: 'scatter',
          mode: 'markers',
          name: `${set.name} (${sel.length})`,
          x: sel.map((pt) => pt.x),
          y: sel.map((pt) => pt.y),
          text: sel.map((pt) => pt.label),
          customdata: sel.map((pt) => pt.uniqID),
          hovertemplate: hover,
          marker: {
            color: set.color ?? sel.map((pt) => look(keyOf(pt)).color),
            size: sel.map((pt) => look(keyOf(pt)).size),
            opacity: 1,
            line: {
              width: sel.map((pt) => look(keyOf(pt)).outline),
              color: sel.map((pt) => look(keyOf(pt)).outlineColor ?? p.text)
            }
          }
        }
      ]
    })
    return { data: [...guideTraces, ...pointTraces, ...selTrace], layout: lay, labels, guides }
  }, [scatter, title, labelTop, mode, marginal, groups, showLegend, selSets, editable, asymmetric])

  // A released guide → its cutoff: a band edge reports its solved confidence; an axis line, the q
  // its new position stands for.
  const onGuide = (key: string, value: number): void => {
    if (!onStatDrag) return
    if (key === 'bandUp' || key === 'bandDown') onStatDrag(key, value)
    else {
      const axis = key === 'aUp' || key === 'aDown' ? 'y' : 'x'
      if (scatter.guide) onStatDrag(key as AxisTail, marginalQAt(scatter.guide, axis, value))
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
