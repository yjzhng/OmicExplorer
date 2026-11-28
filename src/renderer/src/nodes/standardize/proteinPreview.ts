/** The proteins a Clean data step's input holds — their names and descriptions — what its
 *  reference-protein picker offers and searches, with no run of its own needed: fed by another Clean data (a Merge, a Subset of one),
 *  that table's; fed by a Load, its import read as the run reads it (engine previewProteins),
 *  before any clean-up. Null while there's nothing to read (no Load files, no upstream result) or
 *  the import can't be read. */
import { proteinDescs, type ProteinList } from '../../engine'
import { engine } from '../../engine/client'
import { loadAbove, wiredKindOf } from '../../graph/registry'
import { locationOf } from '../../graph/state/shared'
import type { GraphState } from '../../graph/store'
import { isStep, type LoadConfig, type StandardizeConfig } from '../../graph/types'
import { importOptions } from './importOptions'

/** step id → what was read, by the inputs it was read from (a run drops its step's: the files
 *  may have changed under the same names) */
const previews = new Map<string, { key: string; names: Promise<ProteinList | null> }>()

export function forgetProteinPreview(id: string): void {
  previews.delete(id)
}

/** (`state`: the graph store's, passed in so the run, which drops a step's preview, needn't load
 *  the store) */
export function previewStdProteins(state: GraphState, id: string): Promise<ProteinList | null> {
  const up = state.upstreamId(id)
  if (up && wiredKindOf(state, up) === 'standardize') {
    const r = state.results[up]
    return Promise.resolve(
      r?.kind === 'standardize' ? proteinListOf(r.std.displayMap, r.std.annotationMap) : null
    )
  }
  const node = state.nodes.find((n) => n.id === id)
  const above = loadAbove(state, id)
  const load = above?.load.data.config as LoadConfig | undefined
  const dir = state.dataDir
  if (!node || !isStep(node) || !above || !load?.data || !load.samplesheet || !dir)
    return Promise.resolve(null)
  const cfg = node.data.config as StandardizeConfig
  const wf = locationOf(state)?.scope
  const opts = importOptions(load, above.keep, cfg)
  const key = JSON.stringify([dir, wf?.base ?? '', load.data, load.samplesheet, load.db, opts])
  const hit = previews.get(id)
  if (hit?.key === key) return hit.names
  const names = (async (): Promise<ProteinList | null> => {
    const [dataText, samplesheetText, dbText] = await Promise.all([
      window.api.readDataFile(dir, load.data!, wf),
      window.api.readDataFile(dir, load.samplesheet!, wf),
      load.db ? window.api.readDataFile(dir, load.db, wf) : Promise.resolve(null)
    ])
    if (!dataText || !samplesheetText) return null
    try {
      return await engine.previewProteins({
        dataText,
        dataFilename: load.data!,
        samplesheetText,
        dbText: dbText ?? undefined,
        ...opts
      })
    } catch {
      // (an import the run would refuse too: it says why when it runs)
      return null
    }
  })()
  previews.set(id, { key, names })
  // a failed read isn't kept: the next ask tries again
  void names.then((n) => {
    if (!n && previews.get(id)?.names === names) previews.delete(id)
  })
  return names
}

/** A Clean data table's proteins: its names, and its annotations' descriptions. */
export const proteinListOf = (
  names: Record<string, string>,
  annotationMap: Record<string, Record<string, string>>
): ProteinList => ({ names, descs: proteinDescs(annotationMap) })
