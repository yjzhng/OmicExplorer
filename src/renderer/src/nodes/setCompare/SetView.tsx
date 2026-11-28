import Plotly, { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'
import { useCallback, useMemo, useRef } from 'react'

import { useElementSize } from '../../dashboard/useElementSize'
import {
  type Intersection,
  intersections,
  maskOf,
  regionPoints,
  type SetDef,
  sortIntersections,
  type IntersectionOrder,
  vennLayout
} from '../../engine'
import { tooltip } from '../../ui/plot/condTooltip'
import { fitText, measureText } from '../../ui/plot/legendChips'
import { PlotlyChart } from '../../ui/plot/PlotlyChart'
import { useSelection } from '../../ui/plot/useSelection'
import { FADE, useScrollEdges } from '../../ui/table/scrollEdges'
import {
  PALETTES,
  type Palette,
  PLOT_TEXT,
  plotBase,
  plotFontCss,
  withAlpha
} from '../../ui/app/theme'
import { useUiTheme } from '../../ui/app/useUiTheme'

/** The figure's inset, px. */
const PAD = 10
/** Mark ids: an intersection's (its bar, dots or region), a set's (its bar). */
const X = 'sets:x:'
const S = 'sets:s:'
/** A Venn circle's fill strength, and the points round its edge. */
const VENN_ALPHA = 0.2
const CIRCLE_STEPS = 96
/** A region narrower than this (px from its point to the nearest edge) has its count written out
 *  past the circles, this far out. */
const THIN = 9
const CALLOUT = 18
/** Members listed in a hover. */
const HOVER_NAMES = 12

type Trace = Record<string, unknown>

/** What a mark's ids mean: the genes it stands for (a click selects them — its members, or the
 *  genes behind its terms) and the marks it lights with it. */
interface Marks {
  data: Trace[]
  layout: Record<string, unknown>
  membersOf: Map<string, readonly string[]>
  lights: Map<string, string[]>
  /** a text trace of row names that bold as their rows light (the UpSet's set names): its index,
   *  each name and the id it lights with, and the colour the rest fade to */
  rowLabels?: { trace: number; text: string[]; ids: string[]; faded: string }
}

/** Both views' props. `genesOf`: where the members aren't genes (terms), the genes a mark over
 *  some of them in some sets stands for — what a click selects in every plot. Unset: the members
 *  are the genes. */
export interface SetViewProps {
  /** what the sets are levels of ("dose") — over the names / the circles */
  title?: string
  sets: readonly SetDef[]
  colors: readonly string[]
  genesOf?: (members: readonly string[], sets: readonly number[]) => string[]
  displayMap?: Record<string, string>
}

const NONE: Marks = {
  data: [],
  layout: {},
  membersOf: new Map(),
  lights: new Map()
}

/** The size the figure is laid out at: the box's, in 10 px steps (a resize rebuilds it only as it
 *  crosses one). */
function useBox() {
  const { ref, width, height } = useElementSize<HTMLDivElement>()
  return {
    ref,
    W: width > 0 ? Math.floor(width / 10) * 10 : 0,
    H: height > 0 ? Math.floor(height / 10) * 10 : 0
  }
}

/** A hover's list of members by name, the first HOVER_NAMES and how many more. */
function names(ids: readonly string[], displayMap?: Record<string, string>): string {
  const ns = ids.slice(0, HOVER_NAMES).map((g) => displayMap?.[g] ?? g)
  const more = ids.length - ns.length
  return ns.join(', ') + (more > 0 ? ` +${more} more` : '')
}

/** An intersection's name: "A ∩ B", or "A only". */
const xName = (x: Intersection, sets: readonly SetDef[]): string =>
  x.sets.length === 1
    ? `${sets[x.sets[0]].label} only`
    : x.sets.map((i) => sets[i].label).join(' ∩ ')

function frame(p: Palette, W: number, H: number, annotations: unknown[], shapes: unknown[] = []) {
  return {
    ...plotBase(p),
    showlegend: false,
    margin: { l: 0, r: 0, t: 0, b: 0 },
    xaxis: { visible: false, range: [0, W], fixedrange: true },
    yaxis: { visible: false, range: [H, 0], fixedrange: true },
    annotations,
    shapes,
    hovermode: 'closest'
  }
}

/** The chart, with its marks' members and lights wired to the selection. */
function Chart({ marks }: { marks: Marks }) {
  const { membersOf, lights, rowLabels } = marks
  // The row names bold as their rows light — a set hovered, or a column of it (as an enrichment
  // plot's terms bold) — and while one is selected: a set whose genes are all selected, or the
  // sets of the column whose genes the selection is. The rest fade. Re-texted in place, not
  // redrawn.
  const onGraphMount = useCallback(
    (el: PlotlyGraphDiv) => {
      if (!rowLabels) return
      let sig = ''
      const apply = (): void => {
        const { hoverId, pinnedIds } = useSelection.getState()
        const active = new Set<string>()
        if (hoverId) {
          active.add(hoverId)
          for (const m of lights.get(hoverId) ?? []) active.add(m)
        }
        if (pinnedIds.size)
          for (const [id, ms] of membersOf) {
            if (!ms.length || !ms.every((g) => pinnedIds.has(g))) continue
            // a set: all its genes selected; a column: exactly its genes selected
            if (id.startsWith(S)) active.add(id)
            else if (id.startsWith(X) && ms.length === pinnedIds.size)
              for (const m of lights.get(id) ?? []) active.add(m)
          }
        const on = rowLabels.ids.map((id) => active.has(id))
        const any = on.some(Boolean)
        const next = `${any ? 1 : 0}${on.map((b) => (b ? 1 : 0)).join('')}`
        if (next === sig) return
        sig = next
        const text = rowLabels.text.map((t, i) =>
          !any ? t : on[i] ? `<b>${t}</b>` : `<span style="color:${rowLabels.faded}">${t}</span>`
        )
        try {
          void (
            Plotly as unknown as {
              restyle: (el: PlotlyGraphDiv, u: Record<string, unknown>, t: number[]) => unknown
            }
          ).restyle(el, { text: [text] }, [rowLabels.trace])
        } catch {
          /* cosmetic */
        }
      }
      apply()
      return useSelection.subscribe(apply)
    },
    [rowLabels, lights, membersOf]
  )
  const pinIdsOf = useCallback((id: string) => [...(membersOf.get(id) ?? [])], [membersOf])
  const memberIdsOf = useCallback((id: string) => lights.get(id) ?? null, [lights])
  return (
    <PlotlyChart
      data={marks.data}
      layout={marks.layout}
      emptyNote={false}
      pinIdsOf={pinIdsOf}
      memberIdsOf={memberIdsOf}
      onGraphMount={rowLabels ? onGraphMount : undefined}
      controls="none"
    />
  )
}

/** An UpSet row's least and most height, a column's least and most width, px. Past what the box
 *  holds at the least, the figure grows and scrolls. */
const ROW_MIN = 14
const ROW_MAX = 24
const COL_MIN = 8
const COL_MAX = 28
/** The column width the names give way to: they're cut only where the columns would be narrower. */
const COL_FIT = 20
/** The gap between the matrix and the set-size bars, px. */
const BAR_GAP = 8
/** The most empty dots (columns × sets) an UpSet draws. */
const EMPTY_DOTS_MAX = 20000
/** The intersection bars' least height, px (the matrix under them scrolls past it). */
const BARS_MIN = 110

/** The UpSet: a column per intersection — its size as a bar over a dot in each set it's in — and
 *  each set's size as a bar right of its row. Hovering a column lights it; hovering a set's bar
 *  lights it and every column it's in; a click selects their genes, in every plot.
 *
 *  Drawn as a fixed handful of traces however many sets and columns there are (a bar trace per
 *  bar chart, one trace of dots, one of their joins, one of text per label column) — a trace or an
 *  annotation per mark made a few hundred sets take Plotly most of a minute. Two charts: the bars,
 *  which stay put, and the matrix of set rows under them, which scrolls when the rows outgrow the
 *  box; wider than the box, both scroll sideways together. */
export function UpSetView({
  title,
  sets,
  colors,
  genesOf,
  displayMap,
  order,
  max
}: SetViewProps & { order: IntersectionOrder; max: number | null }) {
  const mode = useUiTheme((s) => s.mode)
  const { ref, W, H } = useBox()
  const xRef = useRef<HTMLDivElement>(null)
  const yRef = useRef<HTMLDivElement>(null)
  const [xEdges] = useScrollEdges(xRef)
  const [yEdges] = useScrollEdges(yRef)
  const all = useMemo(() => sortIntersections(intersections(sets), order), [sets, order])
  const shown = useMemo(() => (max != null ? all.slice(0, max) : all), [all, max])

  const { bars, matrix, figW, barsH, rowsH } = useMemo((): {
    bars: Marks
    matrix: Marks
    figW: number
    barsH: number
    rowsH: number
  } => {
    if (W <= 0 || H <= 0 || !sets.length)
      return { bars: NONE, matrix: NONE, figW: 0, barsH: 0, rowsH: 0 }
    const p = PALETTES[mode]
    const font = `${PLOT_TEXT.tick}px ${plotFontCss()}`
    const small = `${PLOT_TEXT.label}px ${plotFontCss()}`
    const m = sets.length
    const k = Math.max(1, shown.length)
    const sizes = sets.map((s) => new Set(s.members).size)
    // left to right: the sets' names, the matrix, the sets' size bars (growing rightward)
    const sizeText = Math.ceil(measureText(String(Math.max(0, ...sizes)), small)) + 4
    const barsW = Math.round(Math.min(140, Math.max(60, W * 0.15)))
    let widest = 0
    // (measured bold: a name bolds when its row lights, and mustn't then run into the dots)
    const bold = `bold ${font}`
    for (const s of sets) widest = Math.max(widest, measureText(s.label, bold))
    // the column's title sits over the names: as wide as they get, at least
    if (title) widest = Math.max(widest, measureText(title, font))
    // the names take all they need while the columns still get a comfortable width; cut only
    // where they don't (then to a share of the box, at least)
    const roomForNames = W - 2 * PAD - BAR_GAP - barsW - k * COL_FIT
    // (a few px past the widest name: a name is cut to labelW − 12, and one measured to the pixel
    // would lose its last letter to rounding)
    const labelW = Math.floor(Math.min(Math.ceil(widest) + 16, Math.max(W * 0.3, roomForNames)))
    const colW = Math.min(COL_MAX, Math.max(COL_MIN, (W - 2 * PAD - BAR_GAP - barsW - labelW) / k))
    // width the columns leave at their widest goes to the set-size bars, so the figure fills the box
    const setBarsW =
      barsW + Math.max(0, Math.floor(W - 2 * PAD - BAR_GAP - barsW - labelW - colW * k))
    const x0 = PAD + labelW
    // where the set-size bars start, right of the matrix
    const xb = x0 + colW * k + BAR_GAP
    const figW = Math.max(W, Math.ceil(xb + setBarsW + PAD))
    // top to bottom, two charts: the counts and the intersection bars (`barsH` tall), then the
    // matrix (`rowsH`) — which scrolls under the bars where it doesn't fit
    // room over the bars for their counts: a line, or the largest count's length where they're
    // turned upright (columns too narrow to write it across)
    const largestCount = Math.max(1, ...shown.map((x) => x.members.length))
    const countW = measureText(String(largestCount), small) + 2
    const top = PAD + (countW <= colW ? PLOT_TEXT.label : countW) + 6
    const rowH = Math.min(ROW_MAX, Math.max(ROW_MIN, ((H - 2 * PAD) * 0.45) / m))
    const rowsH = Math.ceil(rowH * m + PAD)
    // (all of it fits: the bars take what the rows leave; else half the box, at least BARS_MIN)
    const fitsAll = top + BARS_MIN + 8 + rowsH <= H
    const barsHeight = fitsAll
      ? H - rowsH
      : Math.min(H, Math.max(top + BARS_MIN + 8, Math.round(H * 0.5)))
    const base = barsHeight - 8
    const barMax = Math.max(10, base - top)
    const biggest = Math.max(1, ...shown.map((x) => x.members.length))
    const r = Math.max(2.5, Math.min(5, Math.min(colW, rowH) * 0.3))
    const cx = (j: number): number => x0 + colW * (j + 0.5)
    const cy = (i: number): number => rowH * (i + 0.5)

    const membersOf = new Map<string, readonly string[]>()
    const lights = new Map<string, string[]>()
    const colsOf = new Map<number, string[]>()
    const tip = (title: string, n: number, ids: readonly string[]): string =>
      tooltip({ title, values: [['size', n]] }, p.textMuted) + `<br>${names(ids, displayMap)}`

    // every other row shaded, to read along: one fill of separate boxes
    const sx: Array<number | null> = []
    const sy: Array<number | null> = []
    for (let i = 0; i < m; i += 2) {
      const a = PAD
      const b = xb + setBarsW
      const y0 = rowH * i
      const y1 = y0 + rowH
      sx.push(a, b, b, a, a, null)
      sy.push(y0, y0, y1, y1, y0, null)
    }
    const stripes: Trace = {
      type: 'scatter',
      mode: 'lines',
      x: sx,
      y: sy,
      fill: 'toself',
      fillcolor: withAlpha(p.textMuted, 0.07),
      line: { width: 0 },
      hoverinfo: 'skip',
      showlegend: false
    }

    // the columns: their bars (counts over them), their dots, the joins between their dots
    const ids = shown.map((x) => X + x.id)
    const fits = measureText(String(biggest), small) + 2 <= colW
    const columnBars: Trace = {
      type: 'bar',
      __oeOwnIds: true,
      x: shown.map((_, j) => cx(j)),
      y: shown.map((x) => -(x.members.length / biggest) * barMax),
      base: shown.map(() => base),
      width: shown.map(() => colW * 0.72),
      marker: { color: p.text, line: { width: 0 } },
      text: shown.map((x) => String(x.members.length)),
      textposition: 'outside',
      textangle: fits ? 0 : -90,
      textfont: { size: PLOT_TEXT.label, color: p.textMuted },
      cliponaxis: false,
      hovertext: shown.map((x) => tip(xName(x, sets), x.members.length, x.members)),
      hoverinfo: 'text',
      customdata: ids,
      showlegend: false
    }
    const ex: number[] = []
    const ey: number[] = []
    const dx: number[] = []
    const dy: number[] = []
    const dc: string[] = []
    const did: string[] = []
    const dtext: string[] = []
    // the empty dots only while there are few enough to draw (past that the stripes guide the eye)
    const emptyDots = k * m <= EMPTY_DOTS_MAX
    const lx: Array<number | null> = []
    const ly: Array<number | null> = []
    shown.forEach((x, j) => {
      const id = ids[j]
      membersOf.set(id, genesOf ? genesOf(x.members, x.sets) : x.members)
      // a column lights its own marks and the rows of the sets it's in (their size bars)
      lights.set(id, [id, ...x.sets.map((i) => S + i)])
      const inSet = new Set(x.sets)
      if (emptyDots)
        for (let i = 0; i < m; i++)
          if (!inSet.has(i)) {
            ex.push(cx(j))
            ey.push(cy(i))
          }
      const rows = [...x.sets].sort((a, b) => a - b)
      const text = columnBars.hovertext as string[]
      for (const i of rows) {
        ;(colsOf.get(i) ?? colsOf.set(i, []).get(i)!).push(id)
        dx.push(cx(j))
        dy.push(cy(i))
        dc.push(colors[i % colors.length])
        did.push(id)
        dtext.push(text[j])
      }
      if (rows.length > 1) {
        lx.push(cx(j), cx(j), null)
        ly.push(cy(rows[0]), cy(rows[rows.length - 1]), null)
      }
    })
    const empty: Trace = {
      type: 'scatter',
      mode: 'markers',
      x: ex,
      y: ey,
      marker: { size: 2 * r, color: withAlpha(p.textMuted, 0.25), line: { width: 0 } },
      hoverinfo: 'skip',
      showlegend: false
    }
    const joins: Trace = {
      type: 'scatter',
      mode: 'lines',
      x: lx,
      y: ly,
      // thin and soft: they tie a column's dots together without weighing more than the dots
      line: { width: 1, color: withAlpha(p.textMuted, 0.55) },
      hoverinfo: 'skip',
      showlegend: false
    }
    const dots: Trace = {
      type: 'scatter',
      mode: 'markers',
      __oeNoLabel: true,
      __oeOwnIds: true,
      x: dx,
      y: dy,
      marker: { size: 2 * r, color: dc, line: { width: 0 } },
      hovertext: dtext,
      hoverinfo: 'text',
      customdata: did,
      showlegend: false
    }

    // the sets: their size bars (rightward from the matrix), counts and names
    const barSpan = Math.max(10, setBarsW - sizeText)
    const largest = Math.max(1, ...sizes)
    const setIds = sets.map((_, i) => S + i)
    sets.forEach((s, i) => {
      membersOf.set(setIds[i], genesOf ? genesOf(s.members, [i]) : s.members)
      lights.set(setIds[i], [setIds[i], ...(colsOf.get(i) ?? [])])
    })
    const lens = sizes.map((n) => (n / largest) * barSpan)
    const setBars: Trace = {
      type: 'bar',
      orientation: 'h',
      __oeOwnIds: true,
      x: lens,
      base: lens.map(() => xb),
      y: sets.map((_, i) => cy(i)),
      width: sets.map(() => rowH * 0.62),
      marker: { color: sets.map((_, i) => colors[i % colors.length]), line: { width: 0 } },
      hovertext: sets.map((s, i) => tip(s.label, sizes[i], s.members)),
      hoverinfo: 'text',
      customdata: setIds,
      showlegend: false
    }
    // the names hover and select as their set's bar does: a clear bar over each name's row
    const nameHits: Trace = {
      ...setBars,
      x: sets.map(() => Math.max(1, x0 - 2 - PAD)),
      base: sets.map(() => PAD),
      width: sets.map(() => rowH),
      marker: { color: 'rgba(0,0,0,0)', line: { width: 0 } }
    }
    const textCol = (
      xs: number[],
      texts: string[],
      size: number,
      color: string,
      side: 'left' | 'right'
    ): Trace => ({
      type: 'scatter',
      mode: 'text',
      x: xs,
      y: sets.map((_, i) => cy(i)),
      text: texts,
      textposition: `middle ${side}`,
      textfont: { size, color },
      hoverinfo: 'skip',
      showlegend: false
    })
    const counts = textCol(
      lens.map((len) => xb + len + 3),
      sizes.map(String),
      PLOT_TEXT.label,
      p.textMuted,
      'right'
    )
    const labels = textCol(
      sets.map(() => x0 - 6),
      sets.map((s) => fitText(s.label, labelW - 12, bold)),
      PLOT_TEXT.tick,
      p.text,
      'left'
    )

    // titles: each bar chart's, beside it
    const note = (text: string, x: number, y: number, xanchor: string, yanchor: string) => ({
      text,
      x,
      y,
      xref: 'x',
      yref: 'y',
      xanchor,
      yanchor,
      showarrow: false,
      font: { size: PLOT_TEXT.tick, color: p.textMuted }
    })
    const annotations: unknown[] = [
      // read upward, as a y-axis title, just left of the bars
      { ...note('intersection size', x0 - 4, (top + base) / 2, 'right', 'middle'), textangle: -90 },
      note('set size', xb, barsHeight - 4, 'left', 'bottom'),
      // the names' column title: what the sets are levels of, at the column's left (clear of the
      // upright axis title at its right)
      ...(title ? [note(title, PAD, barsHeight - 4, 'left', 'bottom')] : [])
    ]
    if (all.length > shown.length)
      annotations.push({
        ...note(
          `${shown.length} of ${all.length} intersections`,
          xb + setBarsW,
          PAD,
          'right',
          'top'
        ),
        font: { size: PLOT_TEXT.label, color: p.textMuted }
      })
    const shapes = [
      {
        type: 'line',
        x0,
        x1: x0 + colW * k,
        y0: base,
        y1: base,
        line: { width: 1, color: p.axis }
      }
    ]
    // (both charts share the members and the lights: a set's row lights its columns' bars too)
    return {
      bars: {
        data: [columnBars],
        layout: { ...frame(p, figW, barsHeight, annotations, shapes), bargap: 0 },
        membersOf,
        lights
      },
      matrix: {
        data: [stripes, empty, joins, dots, setBars, nameHits, counts, labels],
        // (a bar under the cursor wins over a dot beside it: Plotly ranks a bar below any point
        // within the hover distance, so the distance is kept to about a dot's size. Overlay: the
        // names' clear bars and the set bars are two bar traces, which Plotly would otherwise set
        // side by side, each off its row's middle)
        layout: { ...frame(p, figW, rowsH, []), bargap: 0, barmode: 'overlay', hoverdistance: 6 },
        membersOf,
        lights,
        rowLabels: {
          trace: 7,
          text: labels.text as string[],
          ids: setIds,
          faded: withAlpha(p.text, 0.4)
        }
      },
      figW,
      barsH: barsHeight,
      rowsH
    }
  }, [W, H, mode, title, sets, shown, all.length, colors, displayMap, genesOf])

  return (
    // the box measured is what's visible. The bars stay put; the matrix under them scrolls when
    // its rows need more room than is left, and both scroll sideways together when the columns
    // do — a short fade on each edge with more past it, as the data tables have
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={xRef}
        style={{ width: '100%', height: '100%', overflowX: 'auto', overflowY: 'hidden' }}
      >
        <div style={{ width: figW > W ? figW : '100%', height: barsH }}>
          <Chart marks={bars} />
        </div>
        <div
          ref={yRef}
          style={{
            width: figW > W ? figW : '100%',
            height: Math.max(0, H - barsH),
            overflowY: 'auto',
            overflowX: 'hidden'
          }}
        >
          <div style={{ height: rowsH }}>
            <Chart marks={matrix} />
          </div>
        </div>
      </div>
      {yEdges.top && <div style={{ ...FADE.top, top: barsH }} />}
      {yEdges.bottom && <div style={FADE.bottom} />}
      {xEdges.left && <div style={FADE.left} />}
      {xEdges.right && <div style={FADE.right} />}
    </div>
  )
}

/** An area-proportional Venn of two or three sets (engine/stats/sets vennLayout): each circle's area its
 *  set's size, each pair's overlap the members they share. Each region carries its own count (the
 *  members in exactly its sets); hovering it lights it, a click selects its genes. A region the
 *  circles can't draw is listed under them. */
export function VennView({ title, sets, colors, genesOf, displayMap }: SetViewProps) {
  const mode = useUiTheme((s) => s.mode)
  const { ref, W, H } = useBox()
  const xs = useMemo(() => intersections(sets), [sets])
  const circles = useMemo(() => vennLayout(sets), [sets])
  const points = useMemo(() => regionPoints(circles), [circles])

  const marks = useMemo((): Marks => {
    if (W <= 0 || H <= 0 || !sets.length) return NONE
    const p = PALETTES[mode]
    const font = `${PLOT_TEXT.tick}px ${plotFontCss()}`
    const sizes = sets.map((s) => new Set(s.members).size)
    const labels = sets.map((s, i) => `${s.label} (${sizes[i]})`)
    const widths = labels.map((l) => measureText(l, font))
    const missing = xs.filter((x) => !points.has(maskOf(x.sets)))
    // room for the names: above (two sets), or round the circles (three)
    const three = sets.length === 3
    const side = three ? Math.min(W * 0.25, Math.max(...widths) + 12) : PAD
    const topRoom = PLOT_TEXT.tick + 12
    const bottomRoom =
      (three ? PLOT_TEXT.tick + 12 : PAD) + (missing.length ? PLOT_TEXT.label + 8 : 0)
    const bx0 = Math.min(...circles.map((c) => c.x - c.r))
    const bx1 = Math.max(...circles.map((c) => c.x + c.r))
    const by0 = Math.min(...circles.map((c) => c.y - c.r))
    const by1 = Math.max(...circles.map((c) => c.y + c.r))
    const fit = (extra: number): number =>
      Math.min(
        Math.max(20, W - 2 * side - 2 * PAD - 2 * extra) / Math.max(1e-9, bx1 - bx0),
        Math.max(20, H - topRoom - bottomRoom - 2 * extra) / Math.max(1e-9, by1 - by0)
      )
    // a region written out past the circles needs room round them
    const k0 = fit(0)
    const callouts = [...points.values()].some((pt) => pt.margin * k0 < THIN)
    const k = callouts ? fit(CALLOUT + PLOT_TEXT.heading) : k0
    const availH = Math.max(20, H - topRoom - bottomRoom)
    const ox = W / 2
    const oy = topRoom + availH / 2
    const px = (x: number): number => ox + x * k
    const py = (y: number): number => oy + y * k

    const data: Trace[] = []
    const annotations: unknown[] = []
    const membersOf = new Map<string, readonly string[]>()
    const lights = new Map<string, string[]>()
    circles.forEach((c, i) => {
      const xsP: number[] = []
      const ysP: number[] = []
      for (let s = 0; s <= CIRCLE_STEPS; s++) {
        const a = (2 * Math.PI * s) / CIRCLE_STEPS
        xsP.push(px(c.x + c.r * Math.cos(a)))
        ysP.push(py(c.y + c.r * Math.sin(a)))
      }
      const col = colors[i % colors.length]
      data.push({
        type: 'scatter',
        mode: 'lines',
        x: xsP,
        y: ysP,
        fill: 'toself',
        fillcolor: withAlpha(col, VENN_ALPHA),
        line: { width: 1.5, color: col },
        hoverinfo: 'skip',
        showlegend: false
      })
    })
    // each set's name: above its circle (two), or out from the middle of the three
    const mx = circles.reduce((s, c) => s + c.x, 0) / circles.length
    const my = circles.reduce((s, c) => s + c.y, 0) / circles.length
    // (two: both on one line over the figure, so neither name sits over the other circle)
    const top =
      py(Math.min(...circles.map((c) => c.y - c.r))) - (callouts ? CALLOUT + PLOT_TEXT.heading : 4)
    const named = circles.map((c, i) => {
      if (!three) return { x: px(c.x), y: top, xanchor: 'center', yanchor: 'bottom' }
      let dx = c.x - mx
      let dy = c.y - my
      const len = Math.hypot(dx, dy)
      if (len < 1e-9) [dx, dy] = [0, -1]
      else [dx, dy] = [dx / len, dy / len]
      // (past the counts written outside, where there are any)
      const off = callouts ? CALLOUT + PLOT_TEXT.heading : 6
      return {
        x: px(c.x + dx * c.r) + dx * off,
        y: py(c.y + dy * c.r) + dy * off,
        xanchor: dx > 0.35 ? 'left' : dx < -0.35 ? 'right' : 'center',
        yanchor: dy > 0.35 ? 'top' : dy < -0.35 ? 'bottom' : 'middle',
        i
      }
    })
    // two names above circles that sit close: pushed apart, each to its own side of the middle
    if (!three && named.length === 2) {
      const [a, b] = named[0].x <= named[1].x ? [named[0], named[1]] : [named[1], named[0]]
      const wa = widths[named.indexOf(a)]
      const wb = widths[named.indexOf(b)]
      if (b.x - a.x < (wa + wb) / 2 + 8) {
        const mid = (a.x + b.x) / 2
        Object.assign(a, { x: mid - 4, xanchor: 'right' })
        Object.assign(b, { x: mid + 4, xanchor: 'left' })
      }
    }
    // each name cut to the room on its side of its anchor
    const room = (x: number, anchor: string): number =>
      anchor === 'right'
        ? x - PAD
        : anchor === 'left'
          ? W - PAD - x
          : 2 * Math.min(x - PAD, W - PAD - x)
    named.forEach((n, i) =>
      annotations.push({
        text: fitText(labels[i], Math.max(20, room(n.x, n.xanchor)), font),
        x: n.x,
        y: n.y,
        xref: 'x',
        yref: 'y',
        xanchor: n.xanchor,
        yanchor: n.yanchor,
        showarrow: false,
        font: { size: PLOT_TEXT.tick, color: colors[i % colors.length] }
      })
    )
    // each region's count, where it's drawn
    for (const x of xs) {
      const at = points.get(maskOf(x.sets))
      if (!at) continue
      const id = X + x.id
      membersOf.set(id, genesOf ? genesOf(x.members, x.sets) : x.members)
      lights.set(id, [id])
      // a region too thin to write in (circles nearly alike): its count out past the circles, a
      // line back to it
      let lx = px(at.x)
      let ly = py(at.y)
      if (at.margin * k < THIN) {
        let dx = at.x
        let dy = at.y
        const len = Math.hypot(dx, dy)
        if (len < 1e-9) [dx, dy] = [0, -1]
        else [dx, dy] = [dx / len, dy / len]
        // how far along that way the point leaves the last circle
        let out = 0
        for (const c of circles) {
          const fx = at.x - c.x
          const fy = at.y - c.y
          const b = fx * dx + fy * dy
          const disc = b * b - (fx * fx + fy * fy - c.r * c.r)
          if (disc >= 0) out = Math.max(out, -b + Math.sqrt(disc))
        }
        lx = px(at.x + dx * out) + dx * CALLOUT
        ly = py(at.y + dy * out) + dy * CALLOUT
        data.push({
          type: 'scatter',
          mode: 'lines',
          x: [px(at.x), lx - dx * 8],
          y: [py(at.y), ly - dy * 8],
          line: { width: 1, color: p.textMuted },
          hoverinfo: 'skip',
          showlegend: false
        })
      }
      data.push({
        type: 'scatter',
        mode: 'markers+text',
        __oeNoLabel: true,
        __oeOwnIds: true,
        __oeId: id,
        x: [lx],
        y: [ly],
        marker: { size: 28, color: 'rgba(0,0,0,0)', line: { width: 0 } },
        text: [String(x.members.length)],
        textposition: 'middle center',
        textfont: { size: PLOT_TEXT.heading, color: p.text },
        hoverinfo: 'text',
        hovertext: [
          tooltip({ title: xName(x, sets), values: [['size', x.members.length]] }, p.textMuted) +
            `<br>${names(x.members, displayMap)}`
        ],
        customdata: [id],
        showlegend: false
      })
    }
    // what the sets are levels of, top left
    if (title)
      annotations.push({
        text: title,
        x: PAD,
        y: PAD,
        xref: 'x',
        yref: 'y',
        xanchor: 'left',
        yanchor: 'top',
        showarrow: false,
        font: { size: PLOT_TEXT.tick, color: p.textMuted }
      })
    if (missing.length)
      annotations.push({
        text: fitText(
          `not drawn: ${missing.map((x) => `${xName(x, sets)} (${x.members.length})`).join(', ')}`,
          W - 2 * PAD,
          `${PLOT_TEXT.label}px ${plotFontCss()}`
        ),
        x: PAD,
        y: H - PAD,
        xref: 'x',
        yref: 'y',
        xanchor: 'left',
        yanchor: 'bottom',
        showarrow: false,
        font: { size: PLOT_TEXT.label, color: p.textMuted }
      })
    return { data, layout: frame(p, W, H, annotations), membersOf, lights }
  }, [W, H, mode, title, sets, xs, circles, points, colors, displayMap, genesOf])

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      <Chart marks={marks} />
    </div>
  )
}
