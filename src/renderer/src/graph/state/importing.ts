import { buildStandardInputs, guessRolesPreset, parseMatrix } from '../../engine'
import { matrixColumns, missingImportColumns } from '../../engine/interactive'
import { reportError } from '../../shared/diagnostics'
import { diskWrite } from '../diskWrites'
import { againstStamp, stampOf, type FileStat } from '../loadCheck'
import { patchLoadStamps, putCheck, statFiles } from '../loadFiles'
import { type Getter, type GraphState, type Setter, type StoreSet } from '../store'
import { fitTemplateSpec, isTemplateSpec } from '../template'
import {
  isStep,
  type LoadCheck,
  resolveLoadMode,
  type InteractiveImport,
  type LoadConfig,
  unconfiguredLoad
} from '../types'
import { locationOf } from './shared'

export const loadCheckRuns = new Map<string, Promise<LoadCheck | undefined>>()
/** The checkLoad itself (one at a time per tile — see the store's checkLoad). */
export async function checkLoadNow(
  get: Getter,
  set: Setter,
  id: string
): Promise<LoadCheck | undefined> {
  const s = get()
  const node = s.nodes.find((n) => n.id === id)
  if (!node || !isStep(node) || node.data.kind !== 'load') return undefined
  const cfg = node.data.config as LoadConfig
  const dir = s.dataDir
  // Nothing to check yet (the tile says what it needs), or no way to (an older main process).
  if (!dir || unconfiguredLoad(cfg) || typeof window.api.statDataFiles !== 'function')
    return putCheck(get, set, id, undefined)
  const scope = locationOf(s)?.scope
  const fields = (['data', 'samplesheet', 'db'] as const).filter((f) => !!cfg[f])
  const names = fields.map((f) => cfg[f] as string)
  const stats = await statFiles(dir, names, scope)
  const missing = names.filter((_, i) => !stats[i])

  if (resolveLoadMode(cfg) === 'interactive') {
    // The raw file is read as the conversion reads it (the data folder; or a path picked outside it).
    const matrix = cfg.matrix
    const [src] = matrix ? await statFiles(dir, [matrix]) : [null]
    let changed = false
    if (matrix && src) {
      const from = cfg.convertedFrom
      if (!from) {
        // Converted before tiles kept a stamp: its files are named after the raw file they came
        // from, so another one picked since shows; else this one is taken as converted from.
        changed =
          cfg.data !== `${matrix.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')}_datamatrix.csv`
        if (!changed) {
          const [h] = await statFiles(dir, [matrix], undefined, true)
          if (h) patchLoadStamps(get, set, id, { convertedFrom: stampOf(matrix, h) })
        }
      } else {
        const v = await againstStamp(from, matrix, src, async () => {
          const [h] = await statFiles(dir, [matrix], undefined, true)
          return h
        })
        if (v === 'changed') changed = true
        else if (v !== 'same') patchLoadStamps(get, set, id, { convertedFrom: v })
      }
    }
    // A changed raw file, or converted files gone with the raw one still there: convert again.
    if (src && (changed || missing.length)) return get().reconvertLoad(id)
    if (missing.length) return putCheck(get, set, id, { state: 'filesMissing', names: missing })
    if (!src && matrix) return putCheck(get, set, id, { state: 'sourceMissing', name: matrix })
    return putCheck(get, set, id, { state: 'ok' })
  }

  // Manual: your own files, against what Clean data last read.
  if (missing.length) return putCheck(get, set, id, { state: 'filesMissing', names: missing })
  const read = cfg.readStamps ?? {}
  const restamp: NonNullable<LoadConfig['readStamps']> = {}
  const changedNames: string[] = []
  // What reads this tile has a result: a file with no stamp yet is taken as the one it read.
  const hasRead = s.edges.some((e) => e.source === id && !!s.results[e.target])
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    const st = stats[i]!
    const was = read[f]
    const hashNow = async (): Promise<FileStat | null> =>
      (await statFiles(dir, [names[i]], scope, true))[0]
    if (!was) {
      if (hasRead) {
        const h = await hashNow()
        if (h) restamp[f] = stampOf(names[i], h)
      }
      continue
    }
    const v = await againstStamp(was, names[i], st, hashNow)
    if (v === 'changed') changedNames.push(names[i])
    else if (v !== 'same') restamp[f] = v
  }
  if (Object.keys(restamp).length)
    patchLoadStamps(get, set, id, { readStamps: { ...read, ...restamp } })
  if (changedNames.length) {
    // Out of date below, once (a check that finds it so again leaves it as it is).
    const before = get().loadChecks[id]
    if (before?.state !== 'filesChanged') get().invalidateDownstream(id)
    return putCheck(get, set, id, { state: 'filesChanged', names: changedNames })
  }
  return putCheck(get, set, id, { state: 'ok' })
}
/** Load data's import: checking its files, converting a raw matrix (interactive import) to the standard inputs. */
export function importingSlice(
  set: StoreSet,
  get: Getter
): Pick<
  GraphState,
  | 'checkLoad'
  | 'checkLoads'
  | 'reconvertLoad'
  | 'detectInteractive'
  | 'setInteractive'
  | 'convertInteractive'
> {
  return {
    checkLoad: (id) => {
      const running = loadCheckRuns.get(id)
      if (running) return running
      const run = checkLoadNow(get, set, id).finally(() => loadCheckRuns.delete(id))
      loadCheckRuns.set(id, run)
      return run
    },
    checkLoads: async () => {
      const ids = get()
        .nodes.filter((n) => isStep(n) && n.data.kind === 'load')
        .map((n) => n.id)
      await Promise.all(ids.map((id) => get().checkLoad(id)))
    },
    reconvertLoad: async (id) => {
      putCheck(get, set, id, { state: 'converting' })
      const res = await get().convertInteractive(id)
      return putCheck(
        get,
        set,
        id,
        res.ok
          ? { state: 'ok' }
          : res.missing?.length
            ? { state: 'columns', missing: res.missing }
            : { state: 'error', message: res.error ?? 'The re-conversion failed.' }
      )
    },

    detectInteractive: async (id, preset = 'none') => {
      const s = get()
      const dir = s.dataDir
      if (!dir) return { ok: false, error: 'Set the project data folder first.' }
      const node = s.nodes.find((n) => n.id === id)
      if (!node || !isStep(node) || node.data.kind !== 'load')
        return { ok: false, error: 'Not a Load tile.' }
      const cfg = node.data.config as LoadConfig
      if (!cfg.matrix) return { ok: false, error: 'Choose a data matrix file first.' }
      const matrixText = await window.api.readDataFile(dir, cfg.matrix)
      if (!matrixText)
        return { ok: false, error: `Matrix not found in the data folder (${cfg.matrix}).` }
      let interactive: InteractiveImport
      try {
        const info = parseMatrix(matrixText)
        // A template's spec (no columns yet) is fitted onto this matrix's: read by its preset, then
        // whatever of it still applies carried over (see fitTemplateSpec).
        const tpl = isTemplateSpec(cfg.interactive) ? cfg.interactive : null
        const by = tpl?.preset && tpl.preset !== 'custom' ? tpl.preset : preset
        interactive = { columns: info.columns, roles: guessRolesPreset(info, by), conditions: {} }
        if (tpl) interactive = fitTemplateSpec(tpl, interactive)
      } catch (e) {
        reportError(e, { where: 'import', nodeId: id, detail: 'read the matrix' })
        return { ok: false, error: e instanceof Error ? e.message : 'Failed to read the matrix.' }
      }
      get().updateConfig(id, { interactive })
      const sampleCount = Object.values(interactive.roles).filter((r) => r === 'sample').length
      return { ok: true, count: sampleCount }
    },

    setInteractive: (id, patch) => {
      // Editing the import spec shouldn't spam undo history, so patch config in place (no commit).
      // But it MUST mark the project dirty — otherwise the Save button stays disabled and a fetched
      // annotation set (STRING/KEGG ids, etc.) is silently lost on reopen.
      set((st) => ({
        dirty: true,
        nodes: st.nodes.map((n) => {
          if (n.id !== id || !isStep(n)) return n
          const cfg = n.data.config as LoadConfig
          const interactive = { ...(cfg.interactive as InteractiveImport), ...patch }
          return { ...n, data: { ...n.data, config: { ...cfg, interactive } } }
        })
      }))
    },

    convertInteractive: async (id) => {
      const s = get()
      const dir = s.dataDir
      if (!dir) return { ok: false, error: 'Set the project data folder first.' }
      const node = s.nodes.find((n) => n.id === id)
      if (!node || !isStep(node) || node.data.kind !== 'load')
        return { ok: false, error: 'Not a Load tile.' }
      const cfg = node.data.config as LoadConfig
      if (!cfg.matrix) return { ok: false, error: 'Choose a data matrix file first.' }
      const matrixText = await window.api.readDataFile(dir, cfg.matrix)
      if (!matrixText)
        return { ok: false, error: `Matrix not found in the data folder (${cfg.matrix}).` }
      const interactive = cfg.interactive
      if (!interactive) return { ok: false, error: 'Set up the columns first (step 1).' }
      // The saved settings read columns by name: a raw file without them can't be converted with them.
      const missing = missingImportColumns(matrixColumns(matrixText), interactive.roles)
      if (missing.length) {
        const named = missing.slice(0, 3).map((c) => `“${c}”`)
        if (missing.length > 3) named.push(`${missing.length - 3} more`)
        return {
          ok: false,
          missing,
          error: `The raw data has no ${missing.length === 1 ? 'column' : 'columns'} ${named.join(', ')} — edit the import to match it.`
        }
      }
      let adapted
      try {
        adapted = buildStandardInputs(matrixText, {
          roles: interactive.roles,
          conditions: interactive.conditions,
          customConditions: interactive.customConditions,
          hiddenConditions: interactive.hiddenConditions,
          filters: interactive.filters,
          annotations: interactive.annotations
            ? {
                fields: interactive.annotations.fields,
                byId: interactive.annotations.byId,
                taxon: interactive.annotations.taxon
              }
            : undefined
        })
      } catch (e) {
        reportError(e, { where: 'import', nodeId: id, detail: 'build inputs' })
        return { ok: false, error: e instanceof Error ? e.message : 'Failed to build inputs.' }
      }
      // Base the generated names on the matrix.
      const base = cfg.matrix.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
      const files = {
        data: `${base}_datamatrix.csv`,
        samplesheet: `${base}_samplesheet.csv`,
        db: `${base}_metadata.csv`
      }
      // Generated files go to the workflow folder's input/.
      try {
        await diskWrite(async () => {
          const wf = locationOf(get())?.scope
          await window.api.writeInputFile(dir, files.data, adapted.dataText, wf)
          await window.api.writeInputFile(dir, files.samplesheet, adapted.samplesheetText, wf)
          await window.api.writeInputFile(dir, files.db, adapted.dbText, wf)
        })
      } catch (e) {
        void get().refreshDataFiles()
        reportError(e, { where: 'import', nodeId: id, detail: 'write inputs' })
        return { ok: false, error: e instanceof Error ? e.message : 'Failed to write inputs.' }
      }
      // What it was converted from, to tell when the raw file changes (checkLoad).
      const [src] = await statFiles(dir, [cfg.matrix], undefined, true)
      // Point the Load tile's standard fields at the generated files — from here the
      // pipeline runs the standard path, identical to a manual custom-format project.
      get().updateConfig(id, {
        data: files.data,
        samplesheet: files.samplesheet,
        db: files.db,
        convertedFrom: src ? stampOf(cfg.matrix, src) : undefined
      })
      set((st) => ({ loadChecks: { ...st.loadChecks, [id]: { state: 'ok' } } }))
      // Load is `hasRun: false`, so updateConfig won't stale the pipeline — do it here so a
      // (re)conversion forces Standardize to re-run against the freshly written files.
      get().invalidateDownstream(id)
      await get().refreshDataFiles()
      return { ok: true, files }
    }
  }
}
