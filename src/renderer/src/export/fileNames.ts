/** Download and export file names, as a person reads them: the results tab, the plot, then what's
 *  on show — `AU28 r3 - Volcano - AU-28 vs DMSO - 0.16 µM, 72 h`. No internal ids. Pure. */
import { condLabel, type ConditionKey } from '../engine'
import { type CondUnits, unitOf } from '../graph/config/units'

/** Characters no file system takes in a name (and control characters). */
// eslint-disable-next-line no-control-regex -- control characters are exactly what's refused
const BAD = /[/\\:*?"<>|\u0000-\u001f]+/g

/** One part of a file name: what a file system refuses becomes '-', spaces collapse, and leading
 *  or trailing dots, dashes and spaces go (a name starting with '.' is hidden). */
export function namePart(s: string): string {
  return s
    .replace(BAD, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
}

/** A comparison as read: "AU-28 | DMSO" → "AU-28 vs DMSO". */
export const comparisonText = (c: string): string =>
  c
    .split(/\s*\|\s*/)
    .filter(Boolean)
    .join(' vs ')

/** One condition's value on show, with its unit when it has one ("0.16 µM", "72 h"); a categorical
 *  one as it is ("WT"). An unnamed or a.u. unit leaves the number bare, so it's named instead
 *  ("dose 0.16") — a bare number doesn't say what it is. */
export function conditionText(
  dim: ConditionKey,
  value: string | number,
  units: CondUnits | undefined
): string {
  const v = String(value)
  const u = unitOf(units, dim)?.trim()
  if (u && u !== 'a.u.') return `${v} ${u}`
  return /^-?[\d.]+(e-?\d+)?$/i.test(v) ? `${condLabel(dim)} ${v}` : v
}

/** The longest a name gets before its extension (well inside every file system's 255). */
const MAX = 150

/** A file's title from its parts, in order (absent ones skipped), joined with " - ". */
export function fileTitle(parts: Array<string | null | undefined>, fallback = 'Plot'): string {
  const t = parts
    .map((p) => (p ? namePart(p) : ''))
    .filter(Boolean)
    .join(' - ')
  return (t.length > MAX ? t.slice(0, MAX).trim() : t) || fallback
}

/** The view on show as a title part: the condition values, each with its unit, in the order given
 *  (the facet hierarchy) — `0.16 µM, 72 h`; '' when there are none. */
export function contextText(
  values: Array<{ dim: ConditionKey; value: string | number }>,
  units: CondUnits | undefined
): string {
  return values.map((v) => conditionText(v.dim, v.value, units)).join(', ')
}

/** Names made unique, ignoring case (as a Mac disk does): a repeat gets " (2)", " (3)", … before
 *  its extension. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((n) => {
    const key = n.toLowerCase()
    const k = (seen.get(key) ?? 0) + 1
    seen.set(key, k)
    if (k === 1) return n
    const dot = n.lastIndexOf('.')
    const slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'))
    return dot > slash ? `${n.slice(0, dot)} (${k})${n.slice(dot)}` : `${n} (${k})`
  })
}
