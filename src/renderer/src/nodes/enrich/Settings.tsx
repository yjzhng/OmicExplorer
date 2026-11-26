import { type ReactNode, useMemo } from 'react'
import {
  ENRICH_GROUPS,
  ENRICH_SOURCE_LABEL,
  enrichSourcesPresent,
  resolveEnrichSource
} from '../../engine'
import { useGraph } from '../../graph/store'
import type { EnrichConfig } from '../../graph/types'
import { Field, NumberInput, QuickToggle, Select } from '../kit/settings/controls'
import {
  CategoricalSelect,
  ColourRows,
  type PlotPanelProps,
  PlotSections
} from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { OnOffSwitch } from '../../ui/ToggleSwitch'
import { type PlotSettingsProps } from '../settings'

/** Enrichment: test method, term source, plot style and the term cap. The same fields as the
 *  tile's quick switch bars, so either place edits the one config. */
export function EnrichPanel({ config, update, edgeNodeId }: PlotPanelProps<EnrichConfig>) {
  // Select the (stable) upstream result, then derive the source list in a memo — a freshly-built
  // array straight from the selector would fail Zustand's reference equality and loop forever.
  const upstream = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    return upId ? s.results[upId] : undefined
  })
  // The term sets these genes carry; null until the upstream Compare has run, when nothing is
  // known yet and every set stays pickable.
  const present = useMemo(
    () =>
      upstream?.kind === 'compare'
        ? enrichSourcesPresent(upstream.annotationMap ?? {}, upstream.keggCategories)
        : null,
    [upstream]
  )
  // The source the plot is actually testing: the saved one, or its fallback when the genes don't
  // carry it — so the dropdown shows what the chart shows.
  const saved = config.source ?? 'go'
  const source = (present && resolveEnrichSource(saved, present)) ?? saved
  // Every offered set under its heading (Function / Pathway, as the import and the gene selector
  // group them): those the data has are pickable, the rest greyed and marked, so the list says both
  // what can be tested and what a fetch would add. A heading is an inert row.
  const sourceOptions = ENRICH_GROUPS.flatMap((g) => [
    {
      value: `__group:${g.label}`,
      label: g.label,
      disabled: true,
      render: <span style={styles.optionHeading}>{g.label}</span>
    },
    ...g.sources.map((v) => {
      const missing = present !== null && !present.includes(v)
      return {
        value: v,
        label: missing ? `${ENRICH_SOURCE_LABEL[v]} — not fetched` : ENRICH_SOURCE_LABEL[v],
        disabled: missing
      }
    })
  ])
  const method = config.method ?? 'ora'
  // 'ridge' is GSEA-only; a persisted ridge style under ORA reads (and re-saves) as dot.
  const style = config.style === 'ridge' && method !== 'gsea' ? 'dot' : (config.style ?? 'dot')
  const styleOpts = method === 'gsea' ? ['dot', 'bar', 'ridge'] : ['dot', 'bar']
  return (
    <>
      <Field label="method" aside={<QuickToggle config={config} field="method" update={update} />}>
        <Select
          value={method}
          onChange={(v) => {
            const m = v as EnrichConfig['method']
            update({ method: m, ...(m !== 'gsea' && style === 'ridge' ? { style: 'dot' } : null) })
          }}
          options={[
            { value: 'ora', label: 'ORA (over-representation)' },
            { value: 'gsea', label: 'GSEA (ranked)' }
          ]}
        />
      </Field>
      <Field label="terms" aside={<QuickToggle config={config} field="source" update={update} />}>
        <Select
          value={source}
          onChange={(v) => update({ source: v as EnrichConfig['source'] })}
          options={sourceOptions}
        />
      </Field>
      <Field label="style" aside={<QuickToggle config={config} field="style" update={update} />}>
        <Select
          value={style}
          onChange={(v) => update({ style: v as EnrichConfig['style'] })}
          options={styleOpts.map((o) => ({ value: o, label: o }))}
        />
      </Field>
      <Field
        label="modules"
        info="Gene modules: terms carried by largely the same genes (Jaccard ≥ 0.5 on their hit genes, on average) stacked together, module by module, with a bar beside each — as the heatmap's gene modules."
        aside={<QuickToggle config={config} field="modules" update={update} />}
      >
        <OnOffSwitch
          on={!!config.modules}
          label="gene modules"
          onChange={(v) => update({ modules: v })}
        />
      </Field>
      {config.modules && (
        <Field
          label="show"
          info="Every top term, or only each module's most significant one (terms in no module stay) — one term per finding."
        >
          <Select
            value={config.show ?? 'all'}
            onChange={(v) => update({ show: v as EnrichConfig['show'] })}
            options={[
              { value: 'all', label: 'all terms' },
              { value: 'one', label: 'one per module' }
            ]}
          />
        </Field>
      )}
      <Field
        label="order"
        info="Stack the terms by significance alone, or by category first — the categories in the legend's order, each's terms by significance (by NES in the ridge style). With modules on, it orders the terms within each module."
      >
        <Select
          value={config.termOrder ?? 'significance'}
          onChange={(v) => update({ termOrder: v as EnrichConfig['termOrder'] })}
          options={[
            { value: 'significance', label: 'significance' },
            { value: 'category', label: 'category, then significance' }
          ]}
        />
      </Field>
    </>
  )
}
/** How many terms are drawn — this plot's "how many" (General's genes rows). */
function EnrichTerms({ config, update }: PlotPanelProps<EnrichConfig>): ReactNode {
  return (
    <Field
      label="Max terms"
      info={`Show the ${config.topTerms ?? 15} most enriched terms each way — a cap to keep the plot legible: choosing categories or modules in the legend shows their ${config.topTerms ?? 15} most enriched, from every term found.`}
    >
      <div style={{ width: 90 }}>
        <NumberInput
          value={config.topTerms ?? 15}
          step={5}
          min={1}
          onChange={(v) => update({ topTerms: Math.max(1, Math.round(v)) })}
        />
      </div>
    </Field>
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return (
    <PlotSections
      general={<EnrichPanel config={config as EnrichConfig} {...props} />}
      ranking={<EnrichTerms config={config as EnrichConfig} {...props} />}
      colours={
        <ColourRows
          config={config as EnrichConfig}
          {...props}
          groups
          // up / down is an effect, not a fold change: the up or down genes a term is enriched in
          // (ORA), or its NES's sign (GSEA)
          paletteLabel="effect palette"
          groupsLabel="effect group"
          // "none" draws only the ridge style's all-genes reference
          noneDrawn={
            (config as EnrichConfig).method === 'gsea' && (config as EnrichConfig).style === 'ridge'
          }
          hint="The up / down colours draw the bars, stems and dots — a dot faint to full by significance, on a scale reaching at least FDR 0.05."
        >
          {/* the term groups' colours (the category legend), a term's group the same colour in
              every enrichment plot — Automatic = the global categorical palette */}
          <Field label="categories">
            <CategoricalSelect
              config={config as unknown as Record<string, unknown>}
              update={props.update}
            />
          </Field>
          {/* the gene modules' colours (their bars and legend chips); on the categories' palette,
              the colours after the categories' */}
          {(config as EnrichConfig).modules && (
            <Field
              label="modules"
              info="On the same palette as the categories, the modules take the colours after theirs, so no module shares a category's colour."
            >
              <CategoricalSelect
                config={config as unknown as Record<string, unknown>}
                update={props.update}
                field="moduleCategorical"
              />
            </Field>
          )}
        </ColourRows>
      }
    />
  )
}
