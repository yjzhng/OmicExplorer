import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { SwitchBar } from '../../dashboard/SwitchBar'
import { quickOn } from '../../graph/registry'
import { factsOf, unmetRequirement } from '../../graph/run/requirements'
import type { StringConfig } from '../../graph/config/enrich'
import {
  STRING_LEVEL_ORDER,
  type StringLevel,
  autoStringLevel,
  stringCapOptions,
  stringLevelScore
} from '../../ui/plot/stringModel'
import { resultStringTaxon } from '../kit/requirements'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { StringView } from './StringView'

/** The string result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function stringView(v: ViewContext): ReactNode {
  const {
    upstream,
    cfgSource,
    stringLevels,
    patchConfig,
    numeric,
    facetSel,
    plotRun,
    setStringLevels,
    paletteOf
  } = v
  if (upstream?.kind !== 'compare')
    return <Empty text="Connect a Compare or Curve fit tile and run it." />
  const cfg = cfgSource as StringConfig
  const maxGenes = cfg.maxGenes > 0 ? cfg.maxGenes : 40
  const addInteractors = cfg.addInteractors ?? false
  // Unset = auto: the highest level at which this setting has a network (from the view's read);
  // medium before the read is back.
  const known = stringLevels
  const confidence: StringLevel = cfg.confidence ?? (known ? autoStringLevel(known) : 'medium')
  // Species: a manual override, else the dominant taxon learned from the annotation fetch.
  const ann = upstream.annotationMap ?? {}
  const species = cfg.species && cfg.species > 0 ? cfg.species : resultStringTaxon(ann)
  // A custom cap set in the gear shows as its own option so the bar never lies. One read covers
  // them all (and the export's), so switching between them only re-renders.
  const caps = stringCapOptions(maxGenes)
  const geneOpts = caps.map(String)
  const withBar = (body: ReactNode): ReactNode => (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
          {quickOn(cfg, 'confidence') && (
            <SwitchBar
              // each level as its score cutoff (links at or above it are drawn)
              label="confidence ≥"
              // No level has a network → none is picked (every one is greyed).
              value={known && known.size === 0 ? '' : confidence}
              options={STRING_LEVEL_ORDER}
              optionLabel={(o) => stringLevelScore(o as StringLevel)}
              onChange={(v) => patchConfig({ confidence: v })}
              // A level with no network can't be picked (only known for a query-only network).
              optionDisabled={(o) =>
                known && !known.has(o as StringLevel)
                  ? 'No interactions among the query genes at this confidence'
                  : undefined
              }
            />
          )}
          {quickOn(cfg, 'maxGenes') && (
            <SwitchBar
              label="max genes"
              value={String(maxGenes)}
              options={geneOpts}
              onChange={(v) => patchConfig({ maxGenes: Number(v) })}
            />
          )}
          {quickOn(cfg, 'addInteractors') && (
            <SwitchBar
              label="interactors"
              value={addInteractors ? 'add connected' : 'query only'}
              options={['query only', 'add connected']}
              onChange={(v) => patchConfig({ addInteractors: v === 'add connected' })}
            />
          )}
        </div>
        <div style={styles.stackBody}>{body}</div>
      </div>
    </div>
  )
  const unmet = unmetRequirement('string', cfg, factsOf(upstream))
  if (unmet || !species) return withBar(<Empty text={unmet ?? 'No species detected.'} />)
  return withBar(
    <FacetedPlot numeric={numeric} rows={{ of: upstream.cmp }} facetSel={facetSel}>
      {(rows, facetKey) => (
        <StringView
          rows={rows}
          displayMap={upstream.displayMap}
          annotationMap={ann}
          // From the plot's run: this facet's network for every setting (graph/run/plotRun.ts).
          all={plotRun?.kind === 'string' ? plotRun.facets[facetKey] : undefined}
          level={confidence}
          maxGenes={maxGenes}
          capOptions={plotRun?.kind === 'string' ? plotRun.caps : caps}
          addInteractors={addInteractors}
          onLevels={setStringLevels}
          palette={paletteOf(cfg, 'fcObject')}
          outlines={cfg}
        />
      )}
    </FacetedPlot>
  )

  return <Empty text="No output." />
}
