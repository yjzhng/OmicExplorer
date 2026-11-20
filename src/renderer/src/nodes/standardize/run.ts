/** Clean data's run: read its Load data's import (through any Subsets) and clean, normalise
 *  and impute it — or, fed by another Clean data (a Merge, a Subset of one), clean that table again. */
import { locationOf } from '../../graph/state/shared'
import { engine } from '../../engine/client'
import { loadCheckProblem, stampOf } from '../../graph/loadCheck'
import { patchLoadStamps, putCheck, scalePreviews, statFiles } from '../../graph/loadFiles'
import { loadAbove, wiredKindOf } from '../../graph/registry'
import {
  batchSpecOf,
  cleanupOn,
  imputeOn,
  isStep,
  type LoadConfig,
  loadCustomConditions,
  loadNumericConditions,
  resolveLoadMode,
  type StandardizeConfig
} from '../../graph/types'
import type { StepRunContext } from '../runContext'

export async function run(ctx: StepRunContext): Promise<void> {
  const { id, kind, node, state, get, set, setStatus } = ctx
  const upClean = (() => {
    const up = state.upstreamId(id)
    return kind === 'standardize' && up && wiredKindOf(state, up) === 'standardize' ? up : null
  })()
  if (kind === 'standardize' && upClean) {
    // Fed by Clean data (another Clean data, a Merge, a Subset of one): no import to read —
    // its clean-up, normalisation and imputation run again on the table it's given.
    const upRes = state.results[upClean]
    if (upRes?.kind !== 'standardize') {
      setStatus('error', 'Run the Clean data it reads from first.')
      return
    }
    setStatus('running')
    const cfg = node.data.config as StandardizeConfig
    const std = await engine.reclean({
      std: upRes.std,
      minSamplePct: cleanupOn(cfg) ? (cfg.minSamplePct ?? 0) : 0,
      minSamplePctBy: cfg.minSamplePctBy ?? [],
      normalize: cfg.normalizeEnabled
        ? {
            reference: cfg.normalizeReference ?? 'shared',
            spread: !!cfg.normalizeSpread,
            ...(cfg.normalizeReference === 'protein' ? { protein: cfg.normalizeProtein } : null)
          }
        : undefined,
      batch: batchSpecOf(cfg),
      impute: imputeOn(cfg)
        ? {
            method: cfg.imputeMethod ?? 'perseus',
            shift: cfg.imputeShift,
            width: cfg.imputeWidth
          }
        : undefined,
      logTransform: cfg.logTransform
    })
    if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
    set((s) => ({ results: { ...s.results, [id]: { kind: 'standardize', std } } }))
    setStatus('done')
    get().invalidateDownstream(id)
  } else {
    // its Load data: the input, or above the Subsets that filter the import first
    const above = loadAbove(state, id)
    const loadNode = above?.load
    const dir = state.dataDir
    let load = loadNode && isStep(loadNode) ? (loadNode.data.config as LoadConfig) : undefined
    if (!loadNode || !isStep(loadNode) || loadNode.data.kind !== 'load' || !dir) {
      setStatus('error', 'Connect a Load tile and set the project data folder.')
      return
    }
    // Interactive mode materializes standard files into input/ (see convertInteractive), so
    // the run always reads the standard three-file inputs — identical to Manual mode.
    if (!load?.data || !load.samplesheet) {
      setStatus(
        'error',
        load && resolveLoadMode(load) === 'interactive'
          ? 'Interactive mode: click “Configure samples…” on the Load tile and convert first.'
          : 'Connect a Load tile with a data file and samplesheet.'
      )
      return
    }
    setStatus('running')
    // Its files as they are now: a changed raw file is converted again first; files that are
    // gone (or a raw file the import no longer fits) stop the run with why. A re-conversion
    // puts this step out of date as it goes, so it's marked running again after.
    const check = await get().checkLoad(loadNode.id)
    const why = check && loadCheckProblem(check, resolveLoadMode(load))
    if (why) {
      setStatus('error', why)
      return
    }
    setStatus('running')
    const freshLoad = get().nodes.find((n) => n.id === loadNode.id)
    if (freshLoad && isStep(freshLoad)) load = freshLoad.data.config as LoadConfig
    if (!load.data || !load.samplesheet) {
      setStatus('error', 'Connect a Load tile with a data file and samplesheet.')
      return
    }
    // Generated standard files live in the workflow's folder; the read falls back to the shared
    // data-folder root, so your own input files and older projects' flat ones still resolve.
    const wf = locationOf(state)?.scope
    // The file is being read afresh: drop its cached preview so the settings re-read it too
    // (a re-converted import keeps the same file name).
    scalePreviews.delete(`${dir}|${wf?.base ?? ''}|${load.data}`)
    const [dataText, samplesheetText, dbText] = await Promise.all([
      window.api.readDataFile(dir, load.data, wf),
      window.api.readDataFile(dir, load.samplesheet, wf),
      load.db ? window.api.readDataFile(dir, load.db, wf) : Promise.resolve(null)
    ])
    if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
    if (!dataText || !samplesheetText) {
      setStatus(
        'error',
        `Input file not found in the data folder (${load.data}, ${load.samplesheet}).`
      )
      return
    }
    // What was read, to tell when your own files change under it (manual mode — checkLoad).
    if (resolveLoadMode(load) === 'manual') {
      const fields = (['data', 'samplesheet', 'db'] as const).filter((f) => !!load?.[f])
      const read = await statFiles(
        dir,
        fields.map((f) => load![f] as string),
        wf,
        true
      )
      const readStamps: NonNullable<LoadConfig['readStamps']> = {}
      fields.forEach((f, i) => {
        const st = read[i]
        if (st) readStamps[f] = stampOf(load![f] as string, st)
      })
      patchLoadStamps(get, set, loadNode.id, { readStamps })
      putCheck(get, set, loadNode.id, { state: 'ok' })
    }
    const dataFilename = load.data
    const cfg = node.data.config as StandardizeConfig
    const std = await engine.standardize({
      dataText,
      dataFilename,
      samplesheetText,
      dbText: dbText ?? undefined,
      activeConditions: cfg.activeConditions ?? undefined,
      ...(above?.keep.length ? { subsets: above.keep } : null),
      // The interactive import knows exactly which samplesheet columns are custom conditions;
      // a hand-written samplesheet (manual mode) leaves this unset and ingest auto-detects. One
      // switched off isn't written, so isn't listed.
      customConditions: loadCustomConditions(load),
      // …and of those, the ones declared numeric: checked as numbers, and Clean data's schema
      // from then on (numericConditions)
      numericConditions: loadNumericConditions(load),
      minSamplePct: cleanupOn(cfg) ? (cfg.minSamplePct ?? 0) : 0,
      minSamplePctBy: cfg.minSamplePctBy ?? [],
      normalize: cfg.normalizeEnabled
        ? {
            reference: cfg.normalizeReference ?? 'shared',
            spread: !!cfg.normalizeSpread,
            ...(cfg.normalizeReference === 'protein' ? { protein: cfg.normalizeProtein } : null)
          }
        : undefined,
      batch: batchSpecOf(cfg),
      impute: imputeOn(cfg)
        ? {
            method: cfg.imputeMethod ?? 'perseus',
            shift: cfg.imputeShift,
            width: cfg.imputeWidth
          }
        : undefined,
      // Global (non-per-row) map from the interactive import — passed straight through so
      // enrichment can group KEGG pathways by category.
      keggCategories: load.interactive?.annotations?.keggCategories,
      logTransform: cfg.logTransform
    })
    if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
    set((s) => ({ results: { ...s.results, [id]: { kind: 'standardize', std } } }))
    // A DB is optional, so a missing one doesn't stop the run — but say so.
    setStatus(
      'done',
      undefined,
      load.db && dbText == null
        ? `DB file not found (${load.db}) — ran without annotations.`
        : undefined
    )
    get().invalidateDownstream(id)
  }
}
