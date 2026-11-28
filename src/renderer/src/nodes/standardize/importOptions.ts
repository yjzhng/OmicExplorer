/** How Clean data reads its import, besides the files themselves — shared by its run and its
 *  settings' preview of the import's proteins (proteinPreview), so the two read it alike. */
import type { SampleFilter, StandardizeInput } from '../../engine'
import {
  type LoadConfig,
  loadCustomConditions,
  loadNumericConditions,
  type StandardizeConfig
} from '../../graph/types'

/** The import's reading options: the conditions in play, the Subsets above, the custom
 *  conditions (and which are numeric) and the KEGG categories. */
export function importOptions(
  load: LoadConfig,
  keep: SampleFilter[],
  cfg: StandardizeConfig
): Pick<
  StandardizeInput,
  'activeConditions' | 'subsets' | 'customConditions' | 'numericConditions' | 'keggCategories'
> {
  return {
    activeConditions: cfg.activeConditions ?? undefined,
    ...(keep.length ? { subsets: keep } : null),
    // The interactive import knows exactly which samplesheet columns are custom conditions;
    // a hand-written samplesheet (manual mode) leaves this unset and ingest auto-detects. One
    // switched off isn't written, so isn't listed.
    customConditions: loadCustomConditions(load),
    // …and of those, the ones declared numeric: checked as numbers, and Clean data's schema
    // from then on (numericConditions)
    numericConditions: loadNumericConditions(load),
    // Global (non-per-row) map from the interactive import — passed straight through so
    // enrichment can group KEGG pathways by category.
    keggCategories: load.interactive?.annotations?.keggCategories
  }
}
