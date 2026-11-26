import { useMemo } from 'react'

import {
  bandConfAt,
  bandEdgePath,
  type AxisTail,
  type ScatterData,
  type ScatterPoint,
  type ValueScale
} from '../../engine'
import {
  DEFAULT_EFFECT_LABELS,
  type EffectColors,
  type EffectLabels,
  type PointStyle
} from '../../graph/types'
import { useGraph } from '../../graph/store'
import { tooltip } from '../../ui/condTooltip'
import { plainRows, plainTicks } from '../../ui/quantityAxis'
import { PlotlyChart, type GuideDrag } from '../../ui/PlotlyChart'
import {
  labelColorOf,
  legendOn,
  QUAD_ORDER,
  resolveGroups,
  resolveHighlight,
  type ResolvedGroup
} from '../../ui/pointStyle'
import {
  axisBase,
  CATEGORICAL,
  EFFECT_COLOR,
  guideLook,
  guideShapes,
  guideLine,
  PALETTES,
  PLOT_TEXT,
  plotBase
} from '../../ui/theme'
import { useSelectedGeneSets } from '../../ui/useSelection'
import { useUiTheme } from '../../ui/useUiTheme'

type Eff = 'up' | 'down' | 'none'
const twoDecimals = (v: number): string => String(Math.round(v * 100) / 100)
const EFF_ORDER: Eff[] = ['none', 'down', 'up']

/**
 * Contrast scatter: FC1 (y) vs FC2 (x). The significance boundary follows the contrast's
 * relationship — an OLS fit + prediction band when correlated, the linear cutoffs' lines on each
 * axis when independent (see ScatterGuide). Divergent genes are highlighted; the top few by
 * |FCdiff| are labelled. With `onStatDrag`, the boundary is draggable — the band's edges, the axis
 * lines — and a release reports the cutoff it now stands for (a band confidence, an axis value).
 */
export function ScatterView({
  scatter,
  title,
  labelTop = 0,
  effectLabels = DEFAULT_EFFECT_LABELS,
  effectColors,
  style,
  onStatDrag,
  asymmetric = false,
  cutText = twoDecimals,
  plainScale
}: {
  scatter: ScatterData
  /** both abundance axes shown as plain values on a log axis (ui/quantityAxis): the logged scale
   *  their positions are on */
  plainScale?: ValueScale
  title?: string
  labelTop?: number
  /** per-tile marker / highlight / legend look (unset fields use the scatter defaults) */
  style?: PointStyle
  /** display names for the down/up classes (from the upstream Compare/Contrast config) */
  effectLabels?: EffectLabels
  /** the upstream Compare's effect colours — what each group's automatic colour follows */
  effectColors?: EffectColors
  /** a dragged edge's new cutoff, on release: the band's top / bottom edge → its confidence; an
   *  axis line (A = y, B = x; its up / down tail) → its value where it lands. Unset = the guides
   *  stay put. */
  onStatDrag?: (edge: 'bandUp' | 'bandDown' | AxisTail, value: number) => void
  /** the band's levels are per edge: the edges move apart (otherwise a band edge drags its
   *  partner with it, mirrored) */
  asymmetric?: boolean
  /** an axis line's value as its drag reads it (default: to 2 decimals) — a significance axis says
   *  the p it stands for */
  cutText?: (v: number) => string
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
  // (grey), matching volcano/MA. An independent (linear cutoff) contrast instead colours by
  // QUADRANT: the composite "<FC1 dir>, <FC2 dir>" effect, so each called corner reads as its own
  // group.
  const quadrants = scatter.guide?.kind === 'cutoff'
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
        quadrants ? 'scatterQuad' : 'scatter',
        { up: upName, down: downName, none: noneName },
        { up: upColor, down: downColor, none: noneColor }
      ),
    [style, quadrants, upName, downName, noneName, upColor, downColor, noneColor]
  )
  const emphasis = useMemo(() => resolveHighlight(style), [style])
  const showLegend = legendOn(style)
  const { show: gShow, dash: gDash, width: gw } = guideLook(style)

  const editable = !!onStatDrag
  const { data, layout, labels, guides } = useMemo(() => {
    const p = PALETTES[mode]

    // Shown plain, each point's two values ride formatted in its hovertext (plainRows).
    const hover = plainScale
      ? `${tooltip({ title: '%{text}' }, p.textMuted)}<br>%{hovertext}<extra></extra>`
      : tooltip(
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
    const hovertext = (pts: ScatterPoint[]) =>
      plainScale
        ? {
            hovertext: pts.map((pt) =>
              plainRows(
                [
                  [scatter.xLabel, pt.x],
                  [scatter.yLabel, pt.y]
                ],
                plainScale
              )
            )
          }
        : null
    const trace = (pts: ScatterPoint[], g: ResolvedGroup) => ({
      type: 'scatter',
      mode: 'markers',
      name: `${g.name} (${pts.length})`,
      showlegend: g.legend,
      // This group's own highlight look — see PlotlyChart's EMPH_KEY.
      __oeEmph: g.highlight,
      // The grey bulk may draw as a density past ~100k points (PlotlyChart's densityBins).
      ...(g.key === 'none' ? { __oeBin: true } : {}),
      x: pts.map((pt) => pt.x),
      y: pts.map((pt) => pt.y),
      text: pts.map((pt) => pt.label),
      ...hovertext(pts),
      customdata: pts.map((pt) => pt.uniqID),
      hovertemplate: hover,
      marker: {
        color: g.color,
        size: g.size,
        opacity: g.opacity,
        line: { width: g.outline, color: g.outlineColor ?? p.text }
      }
    })
    // A point's group key: its quadrant (linear cutoff) or effect class; anything unknown is 'none'.
    const keyOf = (pt: ScatterPoint): string =>
      quadrants
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
    if (quadrants) {
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
    const gLine = guideLine(p, gw, gDash)
    const curve = (d: { x: number[]; y: number[] }, dashed: boolean) => ({
      type: 'scatter',
      mode: 'lines',
      hoverinfo: 'skip',
      showlegend: false,
      x: d.x,
      y: d.y,
      line: { color: p.textMuted, width: gw, dash: dashed ? gDash : 'solid' },
      opacity: dashed ? 0.7 : 0.55,
      visible: gShow
    })
    // The band's edges are path SHAPES (a guide is a shape, so they can be dragged), drawn at the
    // cutoffs in force, centred on the line the calls are measured from (a solid trace, drawn
    // first so points sit above it): y = x in identity mode, else the fitted line alone — no y = x
    // beside it. Without the band's parameters (too few points to fit), the sampled edges as
    // traces instead.
    const band = g?.kind === 'ols' ? g.band : undefined
    const conf = g?.cutoffs ?? {
      confUp: 0.99,
      confDown: 0.99,
      q: { aUp: 0.01, aDown: 0.01, bUp: 0.01, bDown: 0.01 }
    }
    const guideTraces =
      g?.kind === 'ols' && g.fit && g.upper && g.lower
        ? band
          ? [curve(g.fit, false)]
          : [curve(g.fit, false), curve(g.upper, true), curve(g.lower, true)]
        : []
    const edge = (side: 1 | -1) => ({
      type: 'path',
      path: bandEdgePath(band!, side > 0 ? conf.confUp : conf.confDown, side),
      line: { color: p.textMuted, width: gw, dash: gDash },
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
    // The linear cutoff's lines: one per tail that has a cutoff (A on y, B on x).
    const cutLines: [AxisTail, 'x' | 'y', number][] = []
    if (g?.kind === 'cutoff')
      for (const [key, axis, v] of [
        ['aDown', 'y', g.yLo],
        ['aUp', 'y', g.yHi],
        ['bDown', 'x', g.xLo],
        ['bUp', 'x', g.xHi]
      ] as const)
        if (v != null) cutLines.push([key, axis, v])
    const guideShapesOf: object[] =
      g?.kind === 'cutoff'
        ? cutLines.map(([, axis, v]) => (axis === 'y' ? hLine(v) : vLine(v)))
        : g?.kind === 'ols'
          ? band
            ? [edge(1), edge(-1)]
            : []
          : [identity] // no guide (e.g. too few points) — fall back to the line of identity

    // Draggable guides (only when editing is wired), indexed into `guideShapes` above. A band edge
    // is grabbed anywhere and passes through the cursor (its confidence solved from the point); an
    // axis line slides along its axis, its q read off where it lands.
    // (to 0.001%, as the Statistic panel's finest tail)
    const pctOf = (c: number): string => `${Math.round(Math.max(0, 1 - c) * 1e5) / 1e3}%`
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
        solve: (mx, my) => Math.min(0.99999, Math.max(0.5, bandConfAt(band!, mx, my))),
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
    const lineGuide = (i: number, key: AxisTail, axis: 'x' | 'y', value: number): GuideDrag => ({
      shapeIndex: i,
      axis,
      kind: 'line',
      cursor: axis === 'x' ? 'ew-resize' : 'ns-resize',
      key,
      value,
      format: (v) => `${axis === 'y' ? 'A' : 'B'} ${cutText(v)}`
    })
    const guides: GuideDrag[] | undefined = !editable
      ? undefined
      : g?.kind === 'ols' && band
        ? [bandGuide(0), bandGuide(1)]
        : g?.kind === 'cutoff'
          ? cutLines.map(([key, axis, v], i) => lineGuide(i, key, axis, v))
          : undefined

    // Collision-managed labels for the genes of every group whose label switch is on (by default
    // the significant / divergent ones), ranked by Manhattan distance from what the mode measures
    // against: the fitted line for a correlated contrast (|y − ŷ(x)|, the residual the calls are
    // made on; y = x without a fit), the centre for an independent one (|x| + |y|). Both axes share
    // units, so no scaling. The ranking runs before PlotlyChart's crowding gate and placement, and decides what
    // labelTop keeps; 0 (the default) offers them all, and more appear as you zoom in.
    const fitB = g?.kind === 'ols' ? g.band : undefined
    const distance = (pt: ScatterPoint): number =>
      quadrants
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
      id: pt.uniqID,
      color: labelColorOf(look(keyOf(pt)), p.text),
      fontSize: look(keyOf(pt)).labelSize
    }))

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: PLOT_TEXT.heading } } : undefined,
      // The builder owns the axis text — a contrast scatter reads "log₂FC · <side>",
      // a value scatter "log₁₀ <level>".
      // Both axes share one range (spanning the origin for fold changes), so the square is
      // symmetric and the line of identity runs corner-to-corner.
      xaxis: {
        ...axisBase(p),
        title: scatter.xLabel,
        zeroline: false,
        ...(plainScale ? plainTicks(plainScale, [lo, hi]) : null),
        range: [lo, hi]
      },
      yaxis: {
        ...axisBase(p),
        title: scatter.yLabel,
        zeroline: false,
        ...(plainScale ? plainTicks(plainScale, [lo, hi]) : null),
        scaleanchor: 'x',
        range: [lo, hi]
      },
      shapes: guideShapes(guideShapesOf, gShow),
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
          ...hovertext(sel),
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
    return {
      data: [...guideTraces, ...pointTraces, ...selTrace],
      layout: lay,
      labels,
      // threshold lines off: nothing to drag either
      guides: gShow ? guides : []
    }
  }, [
    scatter,
    title,
    labelTop,
    mode,
    quadrants,
    groups,
    showLegend,
    selSets,
    editable,
    asymmetric,
    cutText,
    gw,
    gDash,
    gShow,
    plainScale
  ])

  // A released guide → its cutoff: a band edge reports its solved confidence; an axis line, the
  // value it now sits at.
  const onGuide = (key: string, value: number): void => {
    onStatDrag?.(key as 'bandUp' | 'bandDown' | AxisTail, value)
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
