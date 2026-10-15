import { useMemo } from 'react'

import { condLabel, metaValue, type ConditionKey, type GeneBarData } from '../engine'
import { condsOf } from './clusterPlan'
import { condTooltip, geneLine, valueLine } from './condTooltip'
import { bindSampleLink, sampleKey, sampleMeta } from './sampleLink'
import { groupMeta } from './traceFocus'
import { valueColor, type ValueRange } from './colormap'
import { conditionColorer } from './condColor'
import { PlotlyChart } from './PlotlyChart'
import { ROLE_DEFAULTS, type PaletteRef } from './palettes'
import { sectionKey, SECTIONED_LEGEND } from './legendSections'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** How opaque a bar coloured by category is — a little fainter than the category's colour. */
const BAR_FADE = 0.7

/** How the replicate dots look: shown, size (px), opacity (0–1), colour ('auto' = its bar's), and
 *  whether they're spread sideways (jittered) or stacked in one column. */
export interface ReplicateLook {
  show: boolean
  size: number
  opacity: number
  color: string
  jitter: boolean
}

/** Selected genes' standardized value across every condition — grouped bars (mean ± the chosen
 *  error), one series per gene. Landscape draws vertical bars (conditions across x); portrait
 *  draws horizontal bars (conditions down y). Bars are filled by value on the shared viridis scale
 *  (`range`), or by condition: a categorical one picks the colour, a numeric one (dose, time) the
 *  shade, light = low → dark = high. */
export function GeneBarView({
  bar,
  title,
  orient = 'landscape',
  range,
  valueLabel = 'value',
  replicates,
  colorCat,
  colorNum,
  errorWidth = 1.4,
  errorColor = 'auto',
  valueRangeFixed,
  categorical = CATEGORICAL,
  valuePalette = ROLE_DEFAULTS.data,
  condTitle = condLabel
}: {
  /** a condition's legend heading — with its unit for dose / time (default: its name) */
  condTitle?: (c: ConditionKey) => string
  bar: GeneBarData
  title?: string
  orient?: 'landscape' | 'portrait'
  range?: ValueRange
  /** the value axis title — the scale, e.g. "log₂ abundance" (see abundanceLabel) */
  valueLabel?: string
  /** the replicate dots over the bars (none when unset or hidden) */
  replicates?: ReplicateLook
  /** colour by condition: the categorical one (colour) and/or the numeric one (shade) */
  colorCat?: ConditionKey
  colorNum?: ConditionKey
  /** error bar line width (px) */
  errorWidth?: number
  /** error bar colour: 'auto' = the theme's text colour, else a fixed colour */
  errorColor?: string
  /** a fixed value axis range (the global scale); unset = fit this gene's bars */
  valueRangeFixed?: [number, number]
  /** the categorical palette conditions and genes cycle (the plot's own, else the global one) */
  categorical?: readonly string[]
  /** colour by value: the data-values palette (the global role's) */
  valuePalette?: PaletteRef
}) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const horizontal = orient === 'portrait'
    const barColor = range ? valueColor(range, valuePalette) : null
    const logVal = range?.log ?? false
    // Error bars, in one colour per set (Plotly's error bars take a single colour). Asymmetric
    // arrays (errUp/errDown) so log-space spread renders as unequal linear whiskers on the log axis.
    const err = (gb: { errUp: number; errDown: number }[], color: string) => ({
      type: 'data',
      symmetric: false,
      array: gb.map((b) => b.errUp),
      arrayminus: gb.map((b) => b.errDown),
      visible: true,
      color,
      thickness: errorWidth,
      width: 3
    })
    // Colour by condition. A condition the data doesn't carry (a stale setting) is left out; with
    // neither left, bars colour by value.
    const byCond = conditionColorer(bar.conds, (c) => bar.condMeta[c], colorCat, colorNum, {
      base: categorical[0],
      missing: p.textMuted,
      palette: categorical
    })
    const byCondition = byCond.on
    /** The fill of one bar. */
    const fillOf = (b: { cond: string; mean: number | null }, geneIndex: number): string =>
      byCondition
        ? byCond.fill(b.cond)
        : barColor
          ? (barColor(b.mean) ?? p.textMuted)
          : categorical[geneIndex % categorical.length]
    /** A bar's GROUP colour — its fill without the numeric condition's shade (the categorical
     *  condition's colour, or the base colour when only a dose/time colours the bars). What an
     *  'auto' replicate dot and error bar take. */
    const primaryOf = (b: { cond: string; mean: number | null }, geneIndex: number): string =>
      byCondition ? byCond.primary(b.cond) : fillOf(b, geneIndex)
    const autoError = errorColor === 'auto'
    // Error bars on traces of their own (`errorSets` below), one per colour and condition, so a
    // condition's error bar dims with its bar on a sample hover (Plotly's error bars take their
    // trace's opacity, not a bar's). Several genes' bars sit side by side, off their category's
    // centre, so a fixed colour's error bars then ride on the bars themselves.
    const ownErrors = autoError || bar.genes.length === 1
    // Each condition slot's identity for its tooltip, one condition per line; the slot's label
    // when it carries no condition values.
    const tipConds = condsOf(Object.values(bar.condMeta))
    const identOf = (cond: string): string =>
      (bar.condMeta[cond] &&
        condTooltip(bar.condMeta[cond], tipConds, p.textMuted, { rep: false })) ||
      cond
    const valueAt = horizontal ? '%{x:.4~g}' : '%{y:.4~g}'
    // A condition slot's link key (see sampleLink): a whole condition, so it answers every
    // replicate of it.
    // A condition slot's groups — the legend swatches it falls under (`cond=value`), so selecting a
    // swatch keeps that condition's bars and dots and fades the rest (traceFocus), as on the QC.
    const condGroups = (cond: string): string[] =>
      byCondition && bar.condMeta[cond]
        ? [colorCat, colorNum].flatMap((c) => {
            const v = c ? metaValue(bar.condMeta[cond], c) : null
            return c && v != null && v !== '' ? [`${c}=${v}`] : []
          })
        : []
    const keyOf = (cond: string): string | null =>
      bar.condMeta[cond] ? sampleKey(bar.condMeta[cond], null) : null
    const traces = bar.genes.map((g, i) => {
      const gb = bar.bars.filter((b) => b.uniqID === g.uniqID)
      const conds = gb.map((b) => b.cond)
      const means = gb.map((b) => b.mean)
      return {
        type: 'bar',
        name: g.label,
        orientation: horizontal ? 'h' : 'v',
        x: horizontal ? means : conds,
        y: horizontal ? conds : means,
        // the tooltip's text only — never drawn on the bar
        text: conds.map(identOf),
        textposition: 'none',
        meta: {
          ...sampleMeta(conds.map(keyOf)),
          ...groupMeta({ pointGroups: conds.map(condGroups) })
        },
        hovertemplate: `${geneLine(g.label)}<br>%{text}<br>${valueLine('mean', valueAt)}<extra></extra>`,
        // Drawn by `errorSets` below, unless several genes' bars share a category (see ownErrors).
        ...(ownErrors ? {} : { [horizontal ? 'error_x' : 'error_y']: err(gb, errorColor) }),
        marker: {
          color: gb.map((b) => (b.mean == null ? 'rgba(0,0,0,0)' : fillOf(b, i))),
          // A category colour's bars sit a little fainter than the colour itself, so the replicate
          // dots and error bars in that colour ('auto') stand out on them. Value colouring keeps
          // the viridis scale exact, matching the heatmap.
          ...(byCondition || !barColor ? { opacity: BAR_FADE } : {})
        },
        // Several genes AND colour by condition: the bars' own legend entries would say nothing.
        ...(byCondition ? { showlegend: false } : {})
      }
    })
    const condAxis = {
      ...axisBase(p),
      title: 'condition',
      automargin: true,
      ...(horizontal ? {} : { tickangle: -40 })
    }
    // Log-scale the value axis when the data is log-scaled (matches the heatmap/colour map).
    // Force MAJOR decade ticks only (10¹, 10², 10³ …) — Plotly's auto log ticks otherwise mix in
    // 2/5 mantissa ticks (…2, 5, 1000, 2, 5, 10k…), which reads as confusing. Labels use <sup> so
    // they render as proper powers of ten.
    const logTicks: Record<string, unknown> = {}
    if (logVal && range) {
      const eLo = Math.floor(Math.log10(range.min))
      const eHi = Math.ceil(Math.log10(range.max))
      const tickvals: number[] = []
      const ticktext: string[] = []
      for (let e = eLo; e <= eHi; e++) {
        tickvals.push(Math.pow(10, e))
        ticktext.push(`10<sup>${e}</sup>`)
      }
      // Pin the axis to the global decade span so the decade ticks always fall inside the visible
      // range (a single gene's bars may sit within one decade, which would otherwise clip every
      // tick), and so the value axis reads the same across genes. Log-axis range is in log10 units.
      Object.assign(logTicks, {
        type: 'log',
        tickmode: 'array',
        tickvals,
        ticktext,
        range: [eLo, eHi]
      })
    }
    // Per gene: this gene's own min to max — bar tops, error bar ends and replicates — rather than
    // Plotly's autorange, which always reaches down to the bars' base at 0.
    let gLo = Infinity
    let gHi = -Infinity
    for (const b of bar.bars) {
      if (b.mean == null) continue
      // the replicates count only while they're drawn
      const reps = replicates?.show ? b.values : []
      gLo = Math.min(gLo, b.mean - b.errDown, ...reps)
      gHi = Math.max(gHi, b.mean + b.errUp, ...reps)
    }
    const gPad = (gHi - gLo) * 0.08 || Math.abs(gHi) * 0.08 || 1
    const geneRange: [number, number] | undefined =
      Number.isFinite(gLo) && Number.isFinite(gHi) ? [gLo - gPad, gHi + gPad] : undefined
    const valAxis = {
      ...axisBase(p),
      title: valueLabel,
      ...logTicks,
      ...(!logVal && (valueRangeFixed ?? geneRange)
        ? { range: valueRangeFixed ?? geneRange, autorange: false }
        : {})
    }
    // Baseline where "NaN" labels sit. On a log axis Plotly wants annotation coords as log10 of
    // the value, so anchor at log10(min) (the bottom of the data); linear sits at 0.
    const valBase = logVal && range && range.min > 0 ? Math.log10(range.min) : 0
    // Missing conditions (mean null) draw no bar; label the empty slot "NaN" at the baseline.
    const annotations = bar.bars
      .filter((b) => b.mean == null)
      .map((b) => ({
        [horizontal ? 'y' : 'x']: b.cond,
        [horizontal ? 'x' : 'y']: valBase,
        text: 'NaN',
        showarrow: false,
        font: { size: 10, color: p.textMuted },
        ...(horizontal ? { xanchor: 'left', xshift: 4 } : { yanchor: 'bottom', yshift: 3 })
      }))
    // The replicates, one dot each, over the bars, spread sideways a little, part see-through so
    // any still overlapping show darker. 'auto' takes each bar's own colour (with a thin outline in
    // the text colour, so a dot shows on its bar); a fixed colour is one colour for all. Drawn as
    // box traces with the box itself hidden: Plotly only jitters points sideways within a category
    // for boxes (a scatter on a category axis can't be offset), and a box's points take one colour
    // — so one trace per colour (and condition, below). The jitter is seeded, so the dots stay put across redraws.
    const rep = replicates?.show ? replicates : null
    const auto = rep?.color === 'auto'
    // One trace per colour AND condition, so a condition's dots dim together with its bar when
    // another sample is hovered (see sampleLink — a box's points take one trace-level opacity).
    const byColor = new Map<
      string,
      { color: string; cond: string; cats: string[]; vals: number[]; tips: string[] }
    >()
    if (rep)
      bar.genes.forEach((g, i) => {
        for (const b of bar.bars) {
          if (b.uniqID !== g.uniqID || b.values.length === 0) continue
          const c = auto ? primaryOf(b, i) : rep.color
          const id = `${c}\u0000${b.cond}`
          let grp = byColor.get(id)
          if (!grp)
            byColor.set(id, (grp = { color: c, cond: b.cond, cats: [], vals: [], tips: [] }))
          // the dot's gene, then its condition (several genes' dots share a condition's trace)
          const tip = `${geneLine(g.label)}<br>${identOf(b.cond)}`
          for (const v of b.values) {
            grp.cats.push(b.cond)
            grp.vals.push(v)
            grp.tips.push(tip)
          }
        }
      })
    const clear = 'rgba(0,0,0,0)'
    const dots = rep
      ? [...byColor.values()].map(({ color, cond, cats, vals, tips }) => ({
          type: 'box',
          name: 'replicates',
          showlegend: false,
          orientation: horizontal ? 'h' : 'v',
          x: horizontal ? vals : cats,
          y: horizontal ? cats : vals,
          boxpoints: 'all',
          jitter: rep.jitter ? 0.5 : 0,
          pointpos: 0,
          fillcolor: clear,
          line: { color: clear, width: 0 },
          hoveron: 'points',
          marker: {
            size: rep.size,
            color,
            opacity: rep.opacity,
            line: auto ? { color: p.text, width: 0.8 } : { width: 0 }
          },
          text: tips,
          meta: {
            ...(keyOf(cond) ? sampleMeta(keyOf(cond)!) : {}),
            ...groupMeta({ groups: condGroups(cond) })
          },
          hovertemplate: `%{text}<br>${valueLine('replicate', valueAt)}<extra></extra>`
        }))
      : []
    const catName = colorCat ? condTitle(colorCat) : ''
    const numName = colorNum ? condTitle(colorNum) : ''
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      barmode: 'group',
      // A legend to tell several genes' bars apart, or to key the condition colours. One gene
      // coloured by value needs none — and Plotly would otherwise add one for the replicate dots.
      showlegend: bar.genes.length > 1 || byCondition,
      // the condition key: a section per condition (see the keys below)
      ...(byCondition ? { legend: { ...SECTIONED_LEGEND } } : {}),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: horizontal ? valAxis : condAxis,
      yaxis: horizontal ? condAxis : valAxis,
      ...(annotations.length > 0 ? { annotations } : {})
    }
    // The condition legend, a section per condition: a swatch per categorical value (its colour),
    // then per numeric value (its shade — of the bars' own colour when it's the only condition,
    // else of a neutral grey). Each selects the bars' own group (condGroups). Empty marker traces:
    // they draw nothing, the bars being one trace per gene.
    const key = (name: string, color: string, group: string, section: string) =>
      sectionKey({ name, section, group, marker: { symbol: 'square', size: 11, color } })
    const keys = [
      ...byCond.cats.map((k) => key(k.value, k.color, `${colorCat}=${k.value}`, catName)),
      ...byCond.nums.map((k) => key(k.value, k.color, `${colorNum}=${k.value}`, numName))
    ]
    // The error bars (see ownErrors): one invisible-marker scatter per colour ('auto': each bar's
    // group colour — Plotly's error bars take one colour per trace) and condition, at the bars'
    // centres, tagged as the condition's so the sample link and a legend selection fade it. The
    // tile shows one gene at a time, so a bar's centre is its category's.
    const errorSets: Record<string, unknown>[] = []
    if (ownErrors) {
      const byErr = new Map<string, { color: string; cond: string; bars: typeof bar.bars }>()
      bar.genes.forEach((g, i) => {
        for (const b of bar.bars) {
          if (b.uniqID !== g.uniqID || b.mean == null) continue
          const c = autoError ? primaryOf(b, i) : errorColor
          const id = `${c}\u0000${b.cond}`
          let grp = byErr.get(id)
          if (!grp) byErr.set(id, (grp = { color: c, cond: b.cond, bars: [] }))
          grp.bars.push(b)
        }
      })
      for (const { color, cond, bars: gb } of byErr.values()) {
        const conds = gb.map((b) => b.cond)
        const means = gb.map((b) => b.mean)
        errorSets.push({
          type: 'scatter',
          mode: 'markers',
          showlegend: false,
          hoverinfo: 'skip',
          x: horizontal ? means : conds,
          y: horizontal ? conds : means,
          marker: { size: 1, opacity: 0 },
          meta: {
            ...(keyOf(cond) ? sampleMeta(keyOf(cond)!) : {}),
            ...groupMeta({ groups: condGroups(cond) })
          },
          [horizontal ? 'error_x' : 'error_y']: err(gb, color)
        })
      }
    }
    return { data: [...traces, ...errorSets, ...dots, ...keys], layout: lay }
  }, [
    bar,
    title,
    orient,
    mode,
    range,
    valueLabel,
    replicates,
    colorCat,
    colorNum,
    errorWidth,
    errorColor,
    valueRangeFixed,
    categorical,
    valuePalette,
    condTitle
  ])

  return <PlotlyChart data={data} layout={layout} onGraphMount={bindSampleLink} />
}
