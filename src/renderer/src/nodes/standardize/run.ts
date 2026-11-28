/** Clean data's run: read its Load data's import (through any Subsets) and clean, normalise
 *  and impute it — or, fed by another Clean data (a Merge, a Subset of one), clean that table again. */
import { locationOf } from '../../graph/state/shared'
import { engine } from '../../engine/client'
import { loadCheckProblem, stampOf } from '../../graph/loadCheck'
import { patchLoadStamps, putCheck, scalePreviews, statFiles } from '../../graph/loadFiles'
import { loadAbove, wiredKindOf } from '../../graph/registry'
import {
  batchSpecOf,
  cleanupRuleOfConfig,
  imputeOn,
  normalizeOptionsOf,
  isStep,
  type LoadConfig,
  resolveLoadMode,
  type StandardizeConfig
} from '../../graph/types'
import type { StandardizeResult } from '../../engine'
import type { StepRunContext } from '../runContext'
import { importOptions } from './importOptions'
import { forgetProteinPreview } from './proteinPreview'

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
      cleanupRule: cleanupRuleOfConfig(cfg),
      normalize: normalizeOptionsOf(cfg),
      batch: batchSpecOf(cfg),
      impute: imputeOn(cfg)
        ? {
            method: cfg.imputeMethod ?? 'perseus',
            shift: cfg.imputeShift,
            width: cfg.imputeWidth
          }
        : undefined,
      logTransform: cfg.logTransform,
      logDisplay: cfg.logDisplay
    })
    if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
    if (refusedReference(ctx, std)) return
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
    forgetProteinPreview(id)
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
      ...importOptions(load, above?.keep ?? [], cfg),
      cleanupRule: cleanupRuleOfConfig(cfg),
      normalize: normalizeOptionsOf(cfg),
      batch: batchSpecOf(cfg),
      impute: imputeOn(cfg)
        ? {
            method: cfg.imputeMethod ?? 'perseus',
            shift: cfg.imputeShift,
            width: cfg.imputeWidth
          }
        : undefined,
      logTransform: cfg.logTransform,
      logDisplay: cfg.logDisplay
    })
    if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
    if (refusedReference(ctx, std)) return
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

/** Normalising to a reference protein with none to divide by — none picked, or the one picked in no
 *  sample (dropped in clean-up, or not in this data): the step stops with why, rather than pass
 *  un-normalised values on as fractions of it. True when it stopped. */
function refusedReference(ctx: StepRunContext, std: StandardizeResult): boolean {
  const { id, get, setStatus } = ctx
  const nz = std.normalization
  if (!nz?.refused) return false
  // their names from this run, or (dropped since) the last one that had them
  const prev = get().results[id]
  const nameOf = (uid: string): string =>
    std.displayMap[uid] ??
    (prev?.kind === 'standardize' ? prev.std.displayMap[uid] : undefined) ??
    uid
  const refs = (nz.proteins ?? (nz.protein ? [nz.protein] : [])).map(nameOf)
  setStatus(
    'error',
    nz.refused === 'unpicked'
      ? 'Pick the reference protein to normalise to.'
      : refs.length === 1
        ? `The reference protein ${refs[0]} isn't in the data (dropped in clean-up?). Pick another.`
        : `None of the reference proteins (${refs.join(', ')}) is in the data (dropped in clean-up?). Pick others.`
  )
  return true
}
