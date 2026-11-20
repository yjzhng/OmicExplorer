// node import-test.mjs <cdpPort> <SynthData project> <out.json> <fetch.json> save|use
// The import path end to end, on SynthData's real-protein matrix: an interactive Load (the existing
// import spec on the new matrix), the metadata fetch (UniProt: names, GO, KEGG), conversion, Clean
// data → Compare → volcano, enrichment and STRING, and their Results tabs.
// UniProt's answers vary between runs (HTTP 503s), so the downstream steps use one fixed fetch
// result: `save` writes this run's to <fetch.json>, `use` reads it (the live fetch still runs, and
// its outcome is reported).
import fs from 'node:fs'
import crypto from 'node:crypto'
import { connect, log, MODS, wait } from './cdp.mjs'

const [port, project, out, fetchFile, mode] = process.argv.slice(2)
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12)
const { send, ev } = await connect(port)

await send('Page.reload')
await wait(9000)
await ev(`(async () => { ${MODS} await S.getState().openProject(${JSON.stringify(project)}) })()`)
await wait(5000)
const fixed = mode === 'use' ? fs.readFileSync(fetchFile, 'utf8') : 'null'
const steps = JSON.parse(
  await ev(`(async () => { ${MODS}
  const g = () => S.getState()
  const cfgOf = (k) => g().nodes.find((n) => n.data?.kind === k)?.data.config
  const at = (i) => ({ x: 200 + i * 320, y: 1600 })
  const load = g().addNode('load', { position: at(0) })
  g().updateConfig(load, { ...cfgOf('load'), matrix: 'SynthData_seed01_real.csv', data: null, samplesheet: null, db: null })
  const text = await window.api.readDataFile(g().dataDir, 'SynthData_seed01_real.csv')
  const accs = text.trim().split('\\n').slice(1).map((l) => l.split(',')[0])
  const t0 = Date.now()
  const live = await window.api.fetchUniprot(accs, ['protein_name', 'gene_names', 'go_bp', 'go_mf', 'go_cc', 'kegg'])
  const fetchMs = Date.now() - t0
  window.__fetch = JSON.stringify(live)
  const res = ${fixed} ?? live
  g().setInteractive(load, { annotations: { source: 'uniprot', fields: ['proteinName', 'geneName', 'GO_BP', 'GO_MF', 'GO_CC', 'KEGG', 'KEGG_cat', 'KEGG_grp'],
    byId: res.byId, taxon: res.taxon, keggOrg: res.keggOrg, keggCategories: res.keggCategories } })
  const conv = await g().convertInteractive(load)
  const std = g().addNode('standardize', { position: at(1), connectFrom: load })
  g().updateConfig(std, cfgOf('standardize'))
  const cmp = g().addNode('compare', { position: at(2), connectFrom: std })
  g().updateConfig(cmp, cfgOf('compare'))
  const enrich = g().addNode('enrich', { position: at(3), connectFrom: cmp })
  const string = g().addNode('string', { position: at(4), connectFrom: cmp })
  const volcano = g().addNode('volcano', { position: at(5), connectFrom: cmp })
  // a new plot tile is a group of one: its species on the plot itself
  const sg = g().nodes.find((n) => n.id === string)
  const child = sg?.data.config.children?.[0]?.id
  if (child) g().updateChildConfig(string, child, { species: 9606 })
  for (const id of [std, cmp, enrich, string, volcano]) await g().runNode(id)
  const withGo = Object.values(res.byId).filter((r) => r.GO_BP).length
  const withKegg = Object.values(res.byId).filter((r) => r.KEGG).length
  return JSON.stringify({ ids: { load, std, cmp, enrich, string, volcano },
    liveFetch: { found: live.found, error: live.error ?? null, fetchMs },
    fetch: { asked: accs.length, found: res.found, taxon: res.taxon ?? null, keggOrg: res.keggOrg ?? null, withGo, withKegg },
    convert: conv })
})()`)
)
if (mode === 'save') fs.writeFileSync(fetchFile, await ev('window.__fetch'))
log('live fetch', JSON.stringify(steps.liveFetch))
log('fetch used', JSON.stringify(steps.fetch), 'convert', JSON.stringify(steps.convert))
const busy = `(async () => { ${MODS} return S.getState().nodes.filter((n) => n.data?.status === 'running' || (n.data?.config?.children ?? []).some((c) => c.status === 'running')).length })()`
for (let t = 0; t < 120; t++) {
  if ((await ev(busy)) === 0) break
  await wait(5000)
}
const statuses = JSON.parse(
  await ev(`(async () => { ${MODS}
  const ids = ${JSON.stringify(Object.values(steps.ids))}
  return JSON.stringify(S.getState().nodes.filter((n) => ids.includes(n.id)).map((n) => ({ id: n.id, kind: n.data.kind, status: n.data.status, error: n.data.error ?? null, note: n.data.note ?? null,
    children: (n.data.config.children ?? []).map((c) => ({ kind: c.kind, status: c.status ?? null, error: c.error ?? null })) })))
})()`)
)
log('statuses', JSON.stringify(statuses))
await ev(`(async () => { ${MODS} V.getState().setView('results') })()`)
await wait(4000)
const DUMP = `(() => {
  const vis = (el) => el.offsetParent !== null
  const pick = (tr) => { const o = {}; for (const k of ['type','name','x','y','z','text','customdata','mode']) if (tr[k] !== undefined) o[k] = tr[k]; return o }
  const plots = [...document.querySelectorAll('.js-plotly-plot')].filter(vis).map((d) => JSON.stringify((d.data || []).map(pick)))
  return JSON.stringify({ plots, text: document.body.innerText.replace(/\\s+/g, ' ').trim() })
})()`
const tabs = {}
for (const id of [steps.ids.cmp, steps.ids.enrich, steps.ids.string, steps.ids.volcano]) {
  await ev(`(async () => { ${MODS} V.getState().setResultsTab(${JSON.stringify(id)}) })()`)
  let prev = ''
  let d
  for (let t = 0; t < 25; t++) {
    await wait(3000)
    d = JSON.parse(await ev(DUMP))
    const fp = sha(JSON.stringify(d.plots))
    if (fp === prev && t >= 2) break
    prev = fp
  }
  tabs[id] = { plots: d.plots.map((p) => sha(p) + ':' + p.length).sort(), text: d.text }
  log('tab', id, d.plots.length, 'plots')
}
fs.writeFileSync(
  out,
  JSON.stringify({ steps: { ...steps, liveFetch: undefined }, statuses, tabs }, null, 1)
)
log('written', out)
process.exit(0)
