// node capture.mjs <cdpPort> <project.omicexplorer> <out.json> [--extend]
// Drives a SEPARATE test instance (own userData / port — see README): opens the project,
// (with --extend) adds the coverage tiles, runs everything, then records what the user sees —
//   per node: status / error / note (and each group subcard's);
//   per node (and subcard): its settings window's text and controls;
//   per Results tab: every visible plot's data + layout fingerprint, every visible table;
//   the canvas tiles' text.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { connect, log, MODS, wait } from './cdp.mjs'

const [port, project, out] = process.argv.slice(2)
const EXTEND = process.argv.includes('--extend')
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12)
const { send, ev } = await connect(port)

await send('Page.reload')
await wait(9000)
await ev(`(async () => { ${MODS} await S.getState().openProject(${JSON.stringify(project)}) })()`)
await wait(6000)
log(
  'opened',
  await ev(
    `(async () => { ${MODS} const g = S.getState(); return g.projectName + ' · ' + g.nodes.length + ' nodes' })()`
  )
)

if (EXTEND) {
  // Coverage tiles the test projects lack (the same actions → the same ids in every version).
  const r = await ev(`(async () => { ${MODS}
    const g = () => S.getState()
    const std = g().nodes.find((n) => n.data?.kind === 'standardize').id
    const cmp = g().nodes.find((n) => n.data?.kind === 'compare').id
    const cf = g().nodes.find((n) => n.data?.kind === 'curveFit').id
    const ctr = g().nodes.find((n) => n.data?.kind === 'contrast').id
    const at = (i) => ({ x: 2400 + (i % 6) * 320, y: 200 + Math.floor(i / 6) * 260 })
    let i = 0
    const add = (kind, from, cfg) => { const id = g().addNode(kind, { position: at(i++), connectFrom: from }); if (cfg) g().updateConfig(id, cfg); return id }
    // Subsets → an ANOVA (cmpd × time) → its factor plots and the directional ones
    const sub = add('subset', std, { keep: { cmpd: ['DMSO', 'drugA'], dose: ['0', '1000'] } })
    const sub2 = add('subset', std, { keep: { cmpd: ['DMSO', 'drugB'], dose: ['0', '1000'] } })
    const anova = add('compare', sub, { analysis: 'anova', method: 'ttest', compared: ['cmpd', 'time'], asFactor: ['time'],
      num: { cmpd: ['drugA'], time: ['480'] }, den: { cmpd: ['DMSO'], time: ['30'] }, match: [], pool: ['dose'] })
    for (const k of ['variance', 'interaction', 'volcano', 'heatmap', 'table']) add(k, anova)
    // Merge of the two subsets → Clean data again → its plots
    const merge = add('merge', sub)
    g().onConnect({ source: sub2, target: merge, sourceHandle: null, targetHandle: null })
    const reclean = add('standardize', merge, { minSamplePct: 50, imputeEnabled: true, cleanupEnabled: true, normalizeEnabled: true })
    for (const k of ['qc', 'corr', 'pca', 'geneBar', 'heatmap', 'table']) add(k, reclean)
    // the Curve fit's QC and metrics; the comparison's and the contrast's every plot, standalone
    for (const k of ['curveMad', 'metrics', 'potency', 'response', 'dr', 'enrich', 'string']) add(k, cf)
    for (const k of ['volcano', 'ma', 'scatter', 'dr', 'bubble', 'tdr', 'heatmap', 'enrich', 'string']) add(k, cmp)
    for (const k of ['scatter', 'dumbbell', 'dr', 'table']) add(k, ctr)
    return g().nodes.length
  })()`)
  log('extended to', r, 'nodes')
}

log('run all')
await ev(`(async () => { ${MODS} await S.getState().runAll() })()`)
const busy = `(async () => { ${MODS} const g = S.getState(); return g.nodes.filter((n) => n.data?.status === 'running' || (n.data?.config?.children ?? []).some((c) => c.status === 'running')).length })()`
for (let t = 0; t < 240; t++) {
  if ((await ev(busy)) === 0) break
  await wait(5000)
}
await wait(3000)
const statuses = JSON.parse(
  await ev(`(async () => { ${MODS}
  return JSON.stringify(S.getState().nodes.filter((n) => n.type === 'step').map((n) => ({ id: n.id, kind: n.data.kind, name: n.data.name ?? null,
    status: n.data.status, error: n.data.error ?? null, note: n.data.note ?? null,
    children: (n.data.config.children ?? []).map((c) => ({ id: c.id, kind: c.kind, status: c.status ?? null, error: c.error ?? null })) })))
})()`)
)
log('statuses', statuses.filter((s) => s.status === 'done').length, '/', statuses.length, 'done')

await ev(`(async () => { ${MODS} V.getState().setView('canvas') })()`)
await wait(3000)
const canvasText = await ev(
  `[...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id') + ': ' + n.innerText.replace(/\\s+/g, ' ').trim()).sort().join('\\n')`
)
const PANEL = `(() => {
  const ctrls = [...document.querySelectorAll('input, select, textarea, button[aria-pressed], [role="switch"], [role="radio"]')]
    .filter((e) => e.offsetParent !== null)
    .map((e) => (e.tagName + ':' + (e.type || e.getAttribute('role') || '') + '=' + (e.type === 'checkbox' || e.type === 'radio' ? e.checked : (e.value ?? '')) + (e.getAttribute('aria-pressed') ? '/' + e.getAttribute('aria-pressed') : '') + (e.getAttribute('aria-checked') ? '/' + e.getAttribute('aria-checked') : '')))
  return JSON.stringify({ text: document.body.innerText.replace(/\\s+/g, ' ').trim(), ctrls })
})()`
const settings = {}
for (const s of statuses) {
  const targets = s.kind === 'plotGroup' ? s.children.map((c) => [s.id, c.id]) : [[s.id]]
  for (const [id, child] of targets) {
    await ev(
      `(async () => { ${MODS} const g = S.getState(); ${child ? `g.selectNode(${JSON.stringify(id)}); g.selectChildCard(${JSON.stringify(id)}, ${JSON.stringify(child)})` : `g.selectNode(${JSON.stringify(id)})`} })()`
    )
    await wait(900)
    settings[child ? `${id}/${child}` : id] = JSON.parse(await ev(PANEL))
  }
}
await ev(`(async () => { ${MODS} S.getState().selectNode(null) })()`)
log('settings', Object.keys(settings).length)

await ev(`(async () => { ${MODS} V.getState().setView('results') })()`)
await wait(5000)
const tabs = JSON.parse(
  await ev(
    `JSON.stringify([...document.querySelectorAll('[data-tab]')].map((t) => t.getAttribute('data-tab')))`
  )
)
const DUMP = `(() => {
  const vis = (el) => el.offsetParent !== null
  const tables = [...document.querySelectorAll('table')].filter(vis).map((t) => ({
    head: [...t.querySelectorAll('thead th')].map((th) => th.innerText.replace(/\\s+/g, ' ').trim()).join('|'),
    body: [...t.querySelectorAll('tbody tr')].slice(0, 60).map((tr) => [...tr.children].map((td) => td.textContent.trim()).join('|'))
  }))
  const pick = (tr) => { const o = {}; for (const k of ['type','name','x','y','z','text','customdata','mode','orientation','visible']) if (tr[k] !== undefined) o[k] = tr[k]; if (tr.marker) o.marker = { color: tr.marker.color, size: tr.marker.size, symbol: tr.marker.symbol }; if (tr.line) o.line = { color: tr.line.color, dash: tr.line.dash, width: tr.line.width }; return o }
  const lay = (l) => { const o = {}; for (const [k, v] of Object.entries(l || {})) if (/^[xy]axis\\d*$/.test(k)) o[k] = { title: v.title?.text ?? v.title, type: v.type, range: v.range }; o.title = l?.title?.text ?? l?.title; o.annotations = (l?.annotations || []).map((a) => a.text); o.shapes = (l?.shapes || []).length; o.showlegend = l?.showlegend; return o }
  const plots = [...document.querySelectorAll('.js-plotly-plot')].filter(vis).map((d) => ({ data: JSON.stringify((d.data || []).map(pick)), layout: JSON.stringify(lay(d.layout)) }))
  return JSON.stringify({ tables, plots, text: document.body.innerText.replace(/\\s+/g, ' ').trim() })
})()`
const results = {}
for (const tab of tabs) {
  await ev(`(async () => { ${MODS} V.getState().setResultsTab(${JSON.stringify(tab)}) })()`)
  let prev = ''
  let d
  for (let t = 0; t < 30; t++) {
    await wait(3000)
    d = JSON.parse(await ev(DUMP))
    const fp = sha(JSON.stringify(d.plots) + JSON.stringify(d.tables))
    if (fp === prev && t >= 2) break
    prev = fp
  }
  results[tab] = {
    tables: d.tables,
    plots: d.plots
      .map((p) => ({ data: sha(p.data) + ':' + p.data.length, layout: p.layout }))
      .sort((a, b) => (a.data + a.layout).localeCompare(b.data + b.layout)),
    text: d.text
  }
  log('tab', tab, 'plots', d.plots.length, 'tables', d.tables.length)
}
fs.writeFileSync(out, JSON.stringify({ statuses, canvasText, settings, results }, null, 1))
log('written', out)
process.exit(0)
