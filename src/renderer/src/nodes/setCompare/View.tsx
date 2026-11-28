import type { ReactNode } from 'react'
import { SwitchBar } from '../../dashboard/SwitchBar'
import {
  condLabel,
  ENRICH_SOURCE_LABEL,
  type EnrichSource,
  enrichSourcesPresent,
  sampleIndex
} from '../../engine'
import { quickOn } from '../../graph/registry'
import { factsOf, unmetRequirement } from '../../graph/run/requirements'
import type { SetCompareConfig } from '../../graph/config/enrich'
import { Built, Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import {
  DEFAULT_FDR,
  DEFAULT_MAX_INTERSECTIONS,
  groupByOf,
  levelConds,
  setsOf,
  termSourceOf
} from './model'
import { UpSetView, VennView } from './SetView'
import { FDR_PRESETS } from '../enrich/termCut'

const DIRECTIONS = ['any', 'up', 'down', 'split'] as const
const VIEWS = ['upset', 'venn'] as const
const VIEW_LABEL: Record<string, string> = { upset: 'UpSet', venn: 'Venn' }

/** A Venn draws this many sets at most (and at least two). */
const VENN_MAX = 3

/** The set comparison's result body (nodes/views.ts): its switches, then the UpSet or the Venn of
 *  the sets picked. Plain render function (no hooks): the views hold the charts' own. */
export function setCompareView(v: ViewContext): ReactNode {
  const { upstream, cfgSource, patchConfig, numeric, plotRun, categoricalOf, geneSets, units } = v
  if (upstream?.kind !== 'standardize' && upstream?.kind !== 'compare')
    return <Empty text="Connect a Clean data, Compare or Curve fit tile and run it." />
  const cfg = cfgSource as SetCompareConfig
  const compare = upstream.kind === 'compare'
  const terms = compare && cfg.elements === 'terms'
  const source = termSourceOf(cfg, upstream)
  // the term sets these genes carry (none: no terms to compare)
  const termSources =
    upstream.kind === 'compare'
      ? enrichSourcesPresent(upstream.annotationMap ?? {}, upstream.keggCategories)
      : []
  const unmet = unmetRequirement('setCompare', { ...cfg, source }, factsOf(upstream))
  const run = plotRun?.kind === 'sets' ? plotRun : undefined
  const combo = `${cfg.method ?? 'ora'}|${source}`
  const displayMap = upstream.kind === 'compare' ? upstream.displayMap : upstream.std.displayMap
  // a term's FDR cut: the presets, with the config's own where it's another
  const fdr = cfg.termFdr ?? DEFAULT_FDR
  const fdrOptions = [...new Set([...FDR_PRESETS, fdr])].sort((a, b) => a - b).map(String)
  const view = cfg.view ?? 'upset'
  const order = cfg.order ?? 'size'
  // Clean data: the conditions its sets can be grouped by (those with levels), and the one they are
  const samples =
    upstream.kind === 'standardize' ? (upstream.std.samples ?? sampleIndex(upstream.std).reps) : []
  const conds = levelConds(samples)
  const groupBy = upstream.kind === 'standardize' ? groupByOf(cfg, samples) : 'sample'
  // the sets' title: the condition they're levels of, with its unit ("dose (nM)")
  // the sets' title: the condition they're levels of ("dose"; each set its level with the unit)
  const setsTitle = groupBy !== 'sample' && groupBy.length === 1 ? condLabel(groupBy[0]) : undefined
  const capOn = cfg.capEnabled ?? true
  const max = capOn ? (cfg.maxIntersections ?? DEFAULT_MAX_INTERSECTIONS) : null
  const palette = categoricalOf(cfg)

  const withBar = (count: number | null, body: ReactNode): ReactNode => (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
          {quickOn(cfg, 'view', 'setCompare') && (
            <SwitchBar
              label="view"
              // what's drawn: a Venn asked for over sets it can't draw shows as the UpSet it falls
              // back to (and comes back on its own where the sets allow one)
              value={
                view === 'venn' && count != null && (count < 2 || count > VENN_MAX) ? 'upset' : view
              }
              options={[...VIEWS]}
              optionLabel={(o) => VIEW_LABEL[o] ?? o}
              optionDisabled={(o) =>
                o === 'venn' && count != null && (count < 2 || count > VENN_MAX)
                  ? 'A Venn draws 2 or 3 sets'
                  : undefined
              }
              onChange={(o) => patchConfig({ view: o })}
            />
          )}
          {conds.length > 1 && groupBy !== 'sample' && quickOn(cfg, 'groupBy', 'setCompare') && (
            <SwitchBar
              label="group by"
              value={groupBy[0] ?? ''}
              options={conds}
              optionLabel={(c) => condLabel(c as (typeof conds)[number])}
              onChange={(c) => patchConfig({ groupBy: [c], sets: undefined })}
            />
          )}
          {compare && quickOn(cfg, 'elements', 'setCompare') && (
            <SwitchBar
              label="show"
              value={terms ? 'terms' : 'genes'}
              options={['genes', 'terms']}
              optionDisabled={(o) =>
                o === 'terms' && !termSources.length
                  ? 'No GO / KEGG / … terms on these genes'
                  : undefined
              }
              onChange={(o) => patchConfig({ elements: o })}
            />
          )}
          {terms && quickOn(cfg, 'method', 'setCompare') && (
            <SwitchBar
              label="method"
              value={cfg.method ?? 'ora'}
              options={['ora', 'gsea']}
              optionLabel={(o) => o.toUpperCase()}
              onChange={(o) => patchConfig({ method: o })}
            />
          )}
          {terms && quickOn(cfg, 'source', 'setCompare') && termSources.length > 1 && (
            <SwitchBar
              label="terms"
              value={source}
              options={termSources}
              optionLabel={(o) =>
                (ENRICH_SOURCE_LABEL[o as EnrichSource] ?? o).replace(/\s*\(human\)$/, '')
              }
              onChange={(o) => patchConfig({ source: o })}
            />
          )}
          {terms && quickOn(cfg, 'termFdr', 'setCompare') && (
            <SwitchBar
              label="FDR <"
              value={String(fdr)}
              options={fdrOptions}
              onChange={(o) => patchConfig({ termFdr: Number(o) })}
            />
          )}
          {compare && quickOn(cfg, 'direction', 'setCompare') && (
            <SwitchBar
              label="direction"
              value={cfg.direction ?? 'any'}
              options={[...DIRECTIONS]}
              optionLabel={(o) => (o === 'split' ? 'both' : o)}
              onChange={(o) => patchConfig({ direction: o })}
            />
          )}
          {view === 'upset' && quickOn(cfg, 'order', 'setCompare') && (
            <SwitchBar
              label="order"
              value={order}
              options={['size', 'degree']}
              onChange={(o) => patchConfig({ order: o })}
            />
          )}
        </div>
        <div style={styles.stackBody}>{body}</div>
      </div>
    </div>
  )
  if (unmet) return withBar(null, <Empty text={unmet} />)
  if (!run) return withBar(null, <Empty text="Run the plot to read its sets." />)
  if (terms && !run.enrich) return withBar(null, <Empty text="Re-run the plot for its terms." />)
  return (
    <Built
      name="setCompare"
      build={() => {
        const { sets, termGenes } = setsOf(cfg, run, combo, geneSets, numeric, units)
        // terms: a mark selects the genes behind its terms, in the sets it stands for (built
        // here, once per build, so the views' memos hold)
        const genesOf = termGenes
          ? (members: readonly string[], of: readonly number[]): string[] => {
              const out = new Set<string>()
              for (const i of of) {
                const byTerm = termGenes.get(sets[i].key)
                for (const t of members) for (const g of byTerm?.get(t) ?? []) out.add(g)
              }
              return [...out]
            }
          : undefined
        return { sets, genesOf }
      }}
      deps={[
        run,
        combo,
        geneSets,
        numeric,
        units,
        cfg.elements,
        cfg.groupBy,
        cfg.minShare,
        cfg.direction,
        cfg.sets,
        cfg.geneSets,
        cfg.termFdr
      ]}
    >
      {({ sets, genesOf }) => {
        if (!sets.length)
          return withBar(0, <Empty text="No sets picked — pick them in the settings." />)
        if (!sets.some((s) => s.members.length))
          return withBar(
            sets.length,
            <Empty text={terms ? 'No significant terms in these sets.' : 'These sets are empty.'} />
          )
        const venn = view === 'venn' && sets.length >= 2 && sets.length <= VENN_MAX
        const props = {
          title: setsTitle,
          sets,
          colors: palette,
          genesOf,
          displayMap: terms ? undefined : displayMap
        }
        return withBar(
          sets.length,
          venn ? <VennView {...props} /> : <UpSetView {...props} order={order} max={max} />
        )
      }}
    </Built>
  )
}
