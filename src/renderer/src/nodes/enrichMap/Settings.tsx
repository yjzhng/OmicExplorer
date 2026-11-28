import type { ReactNode } from 'react'
import type { EnrichMapConfig } from '../../graph/types'
import { OnOffSwitch } from '../../ui/ToggleSwitch'
import { Field, NumberInput, QuickToggle, Select } from '../kit/settings/controls'
import { CategoricalSelect, type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { SourceField } from '../enrich/Settings'
import { SIGNIFICANT_FDR } from '../enrich/termCut'
import { mapCut } from './terms'
import { type PlotSettingsProps } from '../settings'

/** The map's own rows: the test and term set (as the enrichment plot's), which direction, and the
 *  modules column. */
function MapPanel({ config, update, edgeNodeId }: PlotPanelProps<EnrichMapConfig>): ReactNode {
  return (
    <>
      <Field label="method" aside={<QuickToggle config={config} field="method" update={update} />}>
        <Select
          value={config.method ?? 'ora'}
          onChange={(v) => update({ method: v as EnrichMapConfig['method'] })}
          options={[
            { value: 'ora', label: 'ORA (over-representation)' },
            { value: 'gsea', label: 'GSEA (ranked)' }
          ]}
        />
      </Field>
      <SourceField config={config} update={update} edgeNodeId={edgeNodeId} />
      <Field
        label="direction"
        info="The terms enriched among the up genes, the down genes, or both — a term found both ways is one node, its genes pooled."
        aside={<QuickToggle config={config} field="direction" update={update} />}
      >
        <Select
          value={config.direction ?? 'both'}
          onChange={(v) => update({ direction: v as EnrichMapConfig['direction'] })}
          options={[
            { value: 'both', label: 'both' },
            { value: 'up', label: 'up' },
            { value: 'down', label: 'down' }
          ]}
        />
      </Field>
      <Field
        label="overlap"
        info="Overlapping terms can leave a ribbon's genes apart on a node's edge, with no order keeping every ribbon in one piece. Stack: that edge's ribbons are stacked in the order they go, each thinned so together they fill the bar, widening to full size by the far end. Split: the ribbon leaves in strands, one off each run of its genes, merging soon after."
        aside={<QuickToggle config={config} field="overlap" update={update} />}
      >
        <Select
          value={config.overlap ?? 'stack'}
          onChange={(v) => update({ overlap: v as EnrichMapConfig['overlap'] })}
          options={[
            { value: 'stack', label: 'stack (thin to fit)' },
            { value: 'split', label: 'split into strands' }
          ]}
        />
      </Field>
      <Field
        label="modules"
        info="A column of gene modules on the right: terms carried by largely the same genes (Jaccard ≥ 0.5 on their hit genes, on average) flow on into one node — as the enrichment plot's modules."
        aside={<QuickToggle config={config} field="modules" update={update} />}
      >
        <OnOffSwitch
          on={config.modules ?? true}
          label="gene modules"
          onChange={(v) => update({ modules: v })}
        />
      </Field>
    </>
  )
}

/** Which terms are drawn: those below an FDR cut (none: every term), at most Max terms each way. */
function MapTerms({ config, update }: PlotPanelProps<EnrichMapConfig>): ReactNode {
  const { fdr, top } = mapCut(config)
  return (
    <>
      <Field
        label="FDR below"
        info="Only terms with an FDR (BH-adjusted p) below this are drawn. Empty: the top terms, whatever their FDR."
        aside={<QuickToggle config={config} field="termFdr" update={update} />}
      >
        <div style={{ width: 90 }}>
          <NumberInput
            optional
            value={fdr}
            step={0.01}
            min={0}
            max={1}
            ladderFrom={SIGNIFICANT_FDR}
            placeholder="none"
            onChange={(v) =>
              update({ termFdr: v == null || !(v > 0 && v <= 1) ? undefined : v, terms: undefined })
            }
          />
        </div>
      </Field>
      <Field label="Max terms" info={`Show the ${top} most enriched terms each way.`}>
        <div style={{ width: 90 }}>
          <NumberInput
            value={config.topTerms ?? 15}
            step={5}
            min={1}
            onChange={(v) => update({ topTerms: Math.max(1, Math.round(v)), terms: undefined })}
          />
        </div>
      </Field>
    </>
  )
}

/** Its settings panel (nodes/settings.ts). */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  const cfg = config as EnrichMapConfig
  return (
    <PlotSections
      general={<MapPanel config={cfg} {...props} />}
      ranking={<MapTerms config={cfg} {...props} />}
      colours={
        <>
          {/* a category's colour is its place in the source's order — the same as in the
              enrichment plot */}
          <Field label="categories">
            <CategoricalSelect
              config={cfg as unknown as Record<string, unknown>}
              update={props.update}
            />
          </Field>
          {(cfg.modules ?? true) && (
            <Field
              label="modules"
              info="On the same palette as the categories, the modules take the colours after theirs, so no module shares a category's colour."
            >
              <CategoricalSelect
                config={cfg as unknown as Record<string, unknown>}
                update={props.update}
                field="moduleCategorical"
              />
            </Field>
          )}
        </>
      }
    />
  )
}
