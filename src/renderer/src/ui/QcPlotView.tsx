import { useMemo } from 'react'

import { useElementSize } from '../dashboard/useElementSize'

import { condLabel, metaValue, type ConditionKey, type QcData, type QcGroup } from '../engine'
import { condsOf } from './clusterPlan'
import { condTooltip } from './condTooltip'
import { bindSampleLink, sampleKey, sampleMeta } from './sampleLink'
import { groupMeta } from './traceFocus'
import { conditionColorer } from './condColor'
import { PlotlyChart } from './PlotlyChart'
import { sectionKey, SECTIONED_LEGEND } from './legendSections'
import { axisBase, PALETTES, plotBase, QC_FILL, withAlpha } from './theme'
import { useUiTheme } from './useUiTheme'

/** How opaque the imputed share of a protein-count bar is: its bar's colour, solid, on top
 *  of the stack… */
const IMPUTED_OPACITY = 1
/** …and the measured share beneath it faint, outlined in its colour: the imputed proteins are the
 *  part to notice, and the two must not blur together. */
const MEASURED_OPACITY = 0.3
/** A bar slot narrower than this (px) separates its bars with an edge, not a gap (see `dense`). */
const DENSE_SLOT = 12
/** That edge: a hairline in the background colour (px) — one device pixel on a 2× screen. */
const DENSE_EDGE = 0.5
/** Of the tile's width, roughly what the axis and legend take — the rest is the bars'. */
const DENSE_ALLOWANCE = 200

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Per-sample QC plot for a standardized result: a violin, box, or bar chart of the chosen
 * metric (intensity distribution / %CV / protein count) with one category per sample (or,
 * for CV, per condition group). Violin/box show the distribution; bar shows each group's
 * summary (median for intensity/CV, the count for proteins). With imputation on, a protein-count
 * bar stacks the imputed proteins (solid) on top of the measured ones (fainter). Marks take one colour, or
 * are coloured by condition — a categorical one picks the colour, dose/time the shade.
 */
export function QcPlotView({
  data,
  plot,
  title,
  color = QC_FILL,
  colorCat,
  colorNum,
  fit = false,
  categorical,
  condTitle = condLabel
}: {
  /** a condition's legend heading — with its unit for dose / time (default: its name) */
  condTitle?: (c: ConditionKey) => string
  data: QcData
  plot: 'violin' | 'box' | 'bar'
  title?: string
  /** the single fill colour (hex), and the base a dose/time shades when it colours alone */
  color?: string
  /** colour by condition: the categorical one (colour) and/or the numeric one (shade) */
  colorCat?: ConditionKey
  colorNum?: ConditionKey
  /** bar plot: fit the value axis to the bar tops (with headroom) instead of starting at zero —
   *  near-equal counts read as level from zero */
  fit?: boolean
  /** the categorical palette its condition levels cycle (the plot's own, else the global one) */
  categorical?: readonly string[]
}) {
  const mode = useUiTheme((s) => s.mode)

  // Dense bars: at a few pixels a slot, a fractional gap rounds to a different whole pixel bar by
  // bar (1 or 2, 2 or 3 — some splits vanish), so the bars sit edge to edge, each outlined in a
  // background-coloured hairline: a split exactly as wide between every pair. Judged from the
  // tile's width less a rough allowance for the axis and legend (a count alone before it's
  // measured), and kept a yes/no so resizing rebuilds only on a flip.
  const { ref: boxRef, width: boxW } = useElementSize<HTMLDivElement>()
  const nBars = data.groups.length
  const dense =
    plot === 'bar' &&
    nBars > 0 &&
    (boxW > 0 ? (boxW - DENSE_ALLOWANCE) / nBars < DENSE_SLOT : nBars > 80)

  const { data: traces, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const labels = data.groups.map((g) => g.label)
    const byCond = conditionColorer(data.groups, (g: QcGroup) => g.meta, colorCat, colorNum, {
      base: color,
      missing: p.textMuted,
      palette: categorical
    })
    const fillOf = (g: QcGroup): string => (byCond.on ? byCond.fill(g) : color)
    const fills = data.groups.map(fillOf)
    // Each sample's identity for its tooltip, one condition per line (a CV group is a condition,
    // so no replicate); its label when it carries no condition values.
    const conds = condsOf(data.groups.map((g) => g.meta))
    const idents = data.groups.map(
      (g) => condTooltip(g.meta, conds, p.textMuted, { rep: data.metric !== 'cv' }) || g.label
    )
    // Each sample's link key (see sampleLink); a CV group is a whole condition.
    const linkKeys = data.groups.map((g) =>
      sampleKey(g.meta, data.metric === 'cv' ? null : g.meta.rep)
    )

    // Each sample's condition groups — the legend's swatches it falls under (`cond=value`), so
    // selecting a swatch keeps that condition's samples and fades the rest (traceFocus).
    const condGroups = (g: QcGroup): string[] =>
      byCond.on
        ? [colorCat, colorNum].flatMap((c) => {
            const v = c ? metaValue(g.meta, c) : null
            return c && v != null && v !== '' ? [`${c}=${v}`] : []
          })
        : []
    let trace: Record<string, unknown>
    let traces: Record<string, unknown>[] = []
    // Protein counts with imputation: the imputed proteins stacked on top of the measured ones.
    const stacked = plot === 'bar' && data.groups.some((g) => (g.imputed ?? 0) > 0)
    let extra: Record<string, unknown>[] = []
    if (plot === 'bar') {
      // a dense bar's outline: the split between it and its neighbours (see `dense`), in the
      // tile's own colour (the plot's background is transparent over it)
      const edge = { color: p.panel, width: DENSE_EDGE }
      const measured = data.groups.map((g) =>
        data.summary === 'count' ? (g.values[0] ?? 0) : median(g.values)
      )
      // With imputation on, either part of a stacked bar says the whole count: measured, imputed
      // and their total. `text` carries the tooltip only — never drawn on the bar.
      const stackTip = `%{text}<br>measured %{customdata[0]:,}<br>imputed %{customdata[1]:,}<br>total %{customdata[2]:,}<extra></extra>`
      const stackData = data.groups.map((g, i) => [
        measured[i],
        g.imputed ?? 0,
        measured[i] + (g.imputed ?? 0)
      ])
      const barMeta = {
        ...sampleMeta(linkKeys),
        ...groupMeta({ pointGroups: data.groups.map(condGroups) })
      }
      trace = {
        type: 'bar',
        name: 'measured',
        // its legend entry is a grey stand-in (below): Plotly's own takes the first bar's colour
        legendgroup: 'measured',
        showlegend: false,
        x: labels,
        y: measured,
        text: idents,
        textposition: 'none',
        meta: barMeta,
        marker: stacked
          ? {
              color: fills,
              opacity: MEASURED_OPACITY,
              line: dense ? edge : { color: fills, width: 1 }
            }
          : { color: fills, opacity: 0.85, ...(dense ? { line: edge } : null) },
        ...(stacked
          ? { customdata: stackData, hovertemplate: stackTip }
          : { hovertemplate: `%{text}<br>${data.yLabel} %{y:.3~g}<extra></extra>` })
      }
      if (stacked)
        extra = [
          {
            type: 'bar',
            name: 'imputed',
            legendgroup: 'imputed',
            showlegend: false,
            x: labels,
            y: data.groups.map((g) => g.imputed ?? 0),
            text: idents,
            textposition: 'none',
            meta: barMeta,
            customdata: stackData,
            marker: { color: fills, opacity: IMPUTED_OPACITY, ...(dense ? { line: edge } : null) },
            hovertemplate: stackTip
          }
        ]
    } else {
      // (category, value) pairs, one trace per sample (a violin/box trace takes one colour, and is
      // dimmed whole by the sample link), overlaid so each keeps its own category's slot. The shapes
      // don't answer hovers — a box/violin hover is one label per statistic, each repeating the
      // sample — an invisible bar over each sample's span does, with one label (hoverBars below).
      const shapeOf = (gs: QcGroup[], ink: string, key: string): Record<string, unknown> => {
        const x: string[] = []
        const y: number[] = []
        for (const g of gs)
          for (const v of g.values) {
            x.push(g.label)
            y.push(v)
          }
        const common = {
          x,
          y,
          showlegend: false,
          line: { color: ink, width: 1 },
          fillcolor: withAlpha(ink, 0.35),
          hoverinfo: 'skip',
          meta: { ...sampleMeta(key), ...groupMeta({ groups: gs.flatMap(condGroups) }) }
        }
        return plot === 'violin'
          ? {
              type: 'violin',
              ...common,
              // Density only (no per-point markers) so it stays fast with many proteins.
              points: false,
              spanmode: 'hard',
              box: { visible: true, width: 0.2 },
              meanline: { visible: false }
            }
          : { type: 'box', ...common, boxpoints: false }
      }
      traces = data.groups.map((g, i) => shapeOf([g], fills[i], linkKeys[i]))
      trace = traces.shift() ?? shapeOf([], color, '')
      // The hover target: per sample, a clear bar from its lowest value to its highest, whose
      // tooltip is the sample and its summary (median, quartiles, n).
      const stats = data.groups.map((g) => {
        const s = [...g.values].sort((a, b) => a - b)
        const q = (f: number): number => {
          if (!s.length) return NaN
          const at = (s.length - 1) * f
          const lo = Math.floor(at)
          return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (at - lo)
        }
        return {
          min: s[0] ?? 0,
          max: s[s.length - 1] ?? 0,
          q1: q(0.25),
          med: q(0.5),
          q3: q(0.75),
          n: s.length
        }
      })
      extra = [
        {
          type: 'bar',
          name: 'hover',
          showlegend: false,
          x: labels,
          base: stats.map((st) => st.min),
          y: stats.map((st) => st.max - st.min),
          text: idents,
          textposition: 'none',
          customdata: stats.map((st) => [st.med, st.q1, st.q3, st.n]),
          marker: { color: 'rgba(0,0,0,0)' },
          meta: sampleMeta(linkKeys),
          hovertemplate: `%{text}<br>median %{customdata[0]:.3~g}<br>quartiles %{customdata[1]:.3~g} – %{customdata[2]:.3~g}<br>n %{customdata[3]:,}<extra></extra>`
        }
      ]
    }
    const catName = colorCat ? condTitle(colorCat) : ''
    const numName = colorNum ? condTitle(colorNum) : ''
    // A stacked bar's two shares, in one neutral grey at their own strengths (the bars' colours
    // are the conditions'): imputed solid, measured faint and outlined. A section of their own
    // ("observation") under the conditions'; each still selects its bars (their legendgroup).
    const share = (name: string, look: Record<string, unknown>): Record<string, unknown> =>
      sectionKey({
        name,
        section: 'observation',
        group: name,
        marker: { symbol: 'square', size: 11, color: p.textMuted, ...look }
      })
    const shares = stacked
      ? [
          share('measured', {
            opacity: MEASURED_OPACITY,
            line: { color: p.textMuted, width: 1 }
          }),
          share('imputed', { opacity: IMPUTED_OPACITY })
        ]
      : []
    // The conditions first, each in its own section (cmpd and its values, then dose and its
    // shades), then the two shares' section beneath them.
    const swatch = (color: string): Record<string, unknown> => ({
      symbol: 'square',
      size: 11,
      color
    })
    const keys = [
      ...(byCond.on
        ? [
            ...byCond.cats.map((k) =>
              sectionKey({
                name: k.value,
                section: catName,
                group: `${colorCat}=${k.value}`,
                marker: swatch(k.color)
              })
            ),
            ...byCond.nums.map((k) =>
              sectionKey({
                name: k.value,
                section: numName,
                group: `${colorNum}=${k.value}`,
                marker: swatch(k.color)
              })
            )
          ]
        : []),
      ...shares
    ]

    // Fitted: from just under the lowest bar top to just over the highest, so differences between
    // samples show. With imputation, the MEASURED tops: imputing tops every sample up to about the
    // same total, so fitting the stacks would flatten them — the imputed share runs off the top.
    let fitRange: [number, number] | undefined
    if (fit && plot === 'bar') {
      const tops = data.groups.map((g) =>
        data.summary === 'count' ? (g.values[0] ?? 0) : median(g.values)
      )
      const lo = Math.min(...tops)
      const hi = Math.max(...tops)
      const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1
      if (Number.isFinite(lo) && Number.isFinite(hi)) fitRange = [Math.max(0, lo - pad), hi + pad]
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: stacked || keys.length > 0,
      barmode: stacked ? 'stack' : undefined,
      violinmode: 'overlay',
      boxmode: 'overlay',
      // On the right (Plotly's default place), a section per condition, as the bar plot does.
      ...(keys.length > 0
        ? {
            // a section per condition, in trace order — conditions, then the shares — not
            // reversed, as Plotly does by default for stacked bars
            legend: { ...SECTIONED_LEGEND }
          }
        : {}),
      // Violins and boxes wide with tight gaps (the defaults leave big ones). Bars a clear gap apart
      // (a quarter of each slot): side by side, neighbours of one colour — a condition's samples,
      // the light measured shares above all — read as one block otherwise.
      bargap: dense ? 0 : 0.25,
      boxgap: 0.12,
      boxgroupgap: 0.05,
      violingap: 0.12,
      violingroupgap: 0.05,
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: {
        ...axisBase(p),
        type: 'category',
        tickangle: -45,
        tickfont: { size: 9 },
        automargin: true
      },
      yaxis: {
        ...axisBase(p),
        title: data.yLabel,
        automargin: true,
        // Counts/CV/log-intensity are all ≥0; let intensity (non-log) autoscale normally.
        ...(fitRange
          ? { range: fitRange }
          : {
              rangemode: data.metric === 'proteins' || data.metric === 'cv' ? 'tozero' : 'normal'
            })
      }
    }
    return { data: [trace, ...traces, ...extra, ...keys], layout: lay }
  }, [data, plot, title, mode, color, colorCat, colorNum, fit, categorical, condTitle, dense])

  return (
    // Measured for the bars' density only; the chart fills it as before.
    <div ref={boxRef} style={{ width: '100%', height: '100%' }}>
      <PlotlyChart data={traces} layout={layout} onGraphMount={bindSampleLink} />
    </div>
  )
}
