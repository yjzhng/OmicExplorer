/** The Clean data plots' shared tooltip (PCA, QC, bar, heatmap, sample correlation), top to
 *  bottom: the gene in bold when the mark is one gene's (`geneLine`); the sample or condition — one
 *  line per condition, its name small and faint before the value, as the data table's stacked
 *  column header (thKey / thValue) — (`condTooltip`); then the measured values, one `name value`
 *  line each, in the plain text (`valueLine`), so they read apart from the conditions. */
import { condLabel, metaValue, type ConditionKey } from '../../engine'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A tooltip line's widest, in characters: past it a title wraps — a hover box must never grow
 *  across the plot it explains. */
export const TOOLTIP_WIDTH = 48

/** Plain text wrapped at word breaks into lines of at most `width` characters, joined with `<br>`
 *  (a single word longer than that is cut with "…"). Text that is markup or a Plotly placeholder
 *  is left as it is — it can't be measured here. */
export function wrapTooltip(s: string, width = TOOLTIP_WIDTH): string {
  if (s.length <= width || /[<%]/.test(s)) return s
  const lines: string[] = []
  let line = ''
  for (const raw of s.split(/\s+/)) {
    const word = raw.length > width ? `${raw.slice(0, width - 1)}…` : raw
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.join('<br>')
}

/** One `name value` line: the name at the header's key size and muted colour. */
export const condLine = (name: string, value: string | number, muted: string): string =>
  `<span style="font-size:9px;color:${muted}">${esc(name)}</span> ${esc(String(value))}`

/** The condition lines of a meta (cell → cmpd → dose → time → customs, as `conds` orders them),
 *  skipping any it has no value for; then its replicate when `rep` is given. Joined with `<br>`;
 *  '' when nothing is set (the caller falls back to its plain label). */
export function condTooltip(
  m: { extra?: Record<string, string>; rep?: number | null },
  conds: readonly ConditionKey[],
  muted: string,
  { rep = true }: { rep?: boolean } = {}
): string {
  const lines = conds.flatMap((c) => {
    const v = metaValue(m, c)
    return v == null || v === '' ? [] : [condLine(condLabel(c), v, muted)]
  })
  if (rep && m.rep != null) lines.push(condLine('rep', m.rep, muted))
  return lines.join('<br>')
}

/** The gene a mark belongs to: its own line, in bold, first. */
export const geneLine = (label: string): string => `<b>${esc(label)}</b>`

/** One measured value: `name value`, plain. `value` may be a Plotly placeholder (`%{y:.3~g}`), so
 *  it is not escaped. */
export const valueLine = (name: string, value: string | number): string => `${esc(name)} ${value}`

/** Every plot's tooltip, one layout: the hovered thing in bold (`title` — a gene, a term, a
 *  sample's own label); then the conditions it's at, labelled as the data table's column headers
 *  (`conds` — dose, time, comparison, replicate…: name small and faint, then the value); then the
 *  measured values below, plain (`values` — `name value`, no "="). Any part may be a Plotly
 *  placeholder (`%{x:.3g}`) or an already-built block (a `condTooltip`); empty parts are left out.
 *  A long title wraps (wrapTooltip), so the box stays narrow.
 *  Ends the template too (`<extra></extra>` — no side box), when `template` is set. */
export function tooltip(
  parts: {
    title?: string
    conds?: Array<[string, string | number] | string>
    values?: Array<[string, string | number]>
  },
  muted: string,
  { template = false }: { template?: boolean } = {}
): string {
  const lines: string[] = []
  if (parts.title) lines.push(`<b>${wrapTooltip(parts.title)}</b>`)
  for (const c of parts.conds ?? []) {
    if (typeof c === 'string') {
      if (c) lines.push(c)
    } else lines.push(condLine(c[0], c[1], muted))
  }
  for (const [n, v] of parts.values ?? []) lines.push(valueLine(n, v))
  const body = lines.join('<br>')
  return template ? `${body}<extra></extra>` : body
}
