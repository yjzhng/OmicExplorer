// node compare.mjs <base.json> <other.json> — every difference between two captures, by area.
// Paths under an e2e work folder (…/<side>/proj/…) are compared side-independently.
import fs from 'node:fs'
const norm = (t) => t.replace(/\/e2e\/[^/"]+\/proj\//g, '/e2e/X/proj/')
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(norm(fs.readFileSync(f, 'utf8'))))
const diffs = []
const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y)
const byId = (l) => Object.fromEntries(l.map((s) => [s.id, s]))
const sa = byId(a.statuses)
const sb = byId(b.statuses)
for (const id of new Set([...Object.keys(sa), ...Object.keys(sb)]))
  if (!eq(sa[id], sb[id])) diffs.push(['status', id, sa[id], sb[id]])
if (a.canvasText !== b.canvasText) {
  const la = a.canvasText.split('\n')
  const lb = b.canvasText.split('\n')
  for (const l of la) if (!lb.includes(l)) diffs.push(['canvas', 'base only', l])
  for (const l of lb) if (!la.includes(l)) diffs.push(['canvas', 'other only', l])
}
const textDiff = (x, y) => {
  let i = 0
  while (i < x.length && x[i] === y[i]) i++
  return {
    at: i,
    base: x.slice(Math.max(0, i - 80), i + 160),
    other: y.slice(Math.max(0, i - 80), i + 160)
  }
}
for (const k of new Set([...Object.keys(a.settings ?? {}), ...Object.keys(b.settings ?? {})])) {
  const x = a.settings?.[k]
  const y = b.settings?.[k]
  if (!x || !y) {
    diffs.push(['settings', k, 'missing in ' + (x ? 'other' : 'base')])
    continue
  }
  if (x.text !== y.text) diffs.push(['settings-text', k, textDiff(x.text, y.text)])
  if (!eq(x.ctrls, y.ctrls)) diffs.push(['settings-controls', k, x.ctrls.length, y.ctrls.length])
}
for (const tab of new Set([...Object.keys(a.results ?? {}), ...Object.keys(b.results ?? {})])) {
  const x = a.results?.[tab]
  const y = b.results?.[tab]
  if (!x || !y) {
    diffs.push(['results', tab, 'missing in ' + (x ? 'other' : 'base')])
    continue
  }
  const dataOf = (p) => p.plots.map((q) => q.data).sort()
  if (!eq(dataOf(x), dataOf(y))) diffs.push(['plot-data', tab, dataOf(x), dataOf(y)])
  else if (!eq(x.plots, y.plots))
    diffs.push([
      'plot-layout',
      tab,
      x.plots.filter((p) => !y.plots.some((q) => eq(p, q))).map((p) => p.layout),
      y.plots.filter((p) => !x.plots.some((q) => eq(p, q))).map((p) => p.layout)
    ])
  if (!eq(x.tables, y.tables)) diffs.push(['tables', tab, x.tables.length, y.tables.length])
  if (x.text !== y.text) diffs.push(['results-text', tab, textDiff(x.text, y.text)])
}
const counts = {}
for (const d of diffs) counts[d[0]] = (counts[d[0]] ?? 0) + 1
console.log(
  JSON.stringify({
    counts,
    nodes: a.statuses.length,
    settings: Object.keys(a.settings ?? {}).length,
    tabs: Object.keys(a.results ?? {}).length
  })
)
for (const d of diffs) console.log(JSON.stringify(d).slice(0, 900))
