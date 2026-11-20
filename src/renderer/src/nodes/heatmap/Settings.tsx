import type { ReactNode } from 'react'
import type { LeafOrder } from '../../engine'
import { useGraph } from '../../graph/store'
import {
  DENDRO_CLADES_DEFAULT,
  HEATMAP_LEAF_ORDERS,
  HEATMAP_LINKAGES,
  heatmapCondBar,
  type HeatmapConfig,
  type HeatmapLinkage,
  isComparisonKind,
  isStep,
  primaryColorLevels
} from '../../graph/types'
import { useUpstreamFacts } from '../../graph/useUpstreamFacts'
import { toPaletteRef } from '../../ui/palettes'
import { OnOffSwitch } from '../../ui/ToggleSwitch'
import { useRolePalette } from '../../ui/useAppSettings'
import {
  CapSection,
  Field,
  NumberInput,
  QuickToggle,
  SampleOrderField,
  Section,
  Select
} from '../kit/settings/controls'
import { autoOf } from '../kit/settings/plotHooks'
import {
  CategoricalSelect,
  ColourSection,
  PanelPaletteSelect,
  type PlotPanelProps,
  PlotSections
} from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'

/** A heatmap's palette follows what it draws: from a Compare, log₂FC on the fold-change palette
 *  (Automatic = the global one); from Clean data, abundance on its value palette (Automatic =
 *  viridis). */
export function HeatmapColourSection(props: PlotPanelProps<HeatmapConfig>): ReactNode {
  // Decided as the plot decides (PanelBody: the upstream RESULT is a comparison's — a Compare's or
  // a Curve fit's), so the panel's Automatic always names what's drawn; the upstream node's kind
  // covers a tile not yet run.
  const upId = useGraph((s) => s.edges.find((e) => e.target === props.edgeNodeId)?.source)
  const { kind: upKind, result } = useUpstreamFacts(upId)
  const fromCompare = result ? result.kind === 'compare' : isComparisonKind(upKind)
  const dataRole = useRolePalette('data')
  if (fromCompare) return <ColourSection {...props} role="fc" />
  return (
    <Section title="Colour">
      <Field label="palette">
        <PanelPaletteSelect
          value={toPaletteRef(props.config.valuePalette)}
          onChange={(v) => props.update({ valuePalette: v })}
          auto={autoOf(dataRole)}
        />
      </Field>
    </Section>
  )
}
/** One side of a fold-change heatmap's clustering (its genes, or its conditions): a caption, and
 *  under it, indented, the most clusters, the modules (a coloured bar per cluster), the tree, and
 *  the bars' palette. `fields` names the config keys the side's settings live in. */
export function ClusterSideFields({
  caption,
  noun,
  fields,
  config,
  update
}: Pick<PlotPanelProps<HeatmapConfig>, 'config' | 'update'> & {
  caption: string
  noun: string
  fields: {
    max: keyof HeatmapConfig
    modules: keyof HeatmapConfig
    tree: keyof HeatmapConfig
    palette: keyof HeatmapConfig
  }
}): ReactNode {
  const cfg = config as unknown as Record<string, unknown>
  const max = cfg[fields.max]
  return (
    <>
      <div style={{ ...styles.sideTag, marginTop: 12 }}>{caption}</div>
      <div style={styles.subGroup}>
        <Field
          label="max"
          info={`Cut the tree into this many clusters (one per row when there are fewer ${noun}), each a module.`}
        >
          <NumberInput
            value={typeof max === 'number' ? max : DENDRO_CLADES_DEFAULT}
            step={1}
            min={2}
            onChange={(v) => update({ [fields.max]: Math.max(2, Math.round(v)) })}
          />
        </Field>
        <Field
          label="module"
          aside={
            <QuickToggle config={config} field={fields.modules} update={update} kind="heatmap" />
          }
        >
          <OnOffSwitch
            on={!!cfg[fields.modules]}
            label={`${caption} modules`}
            title={`A coloured bar over each cluster's ${noun}${noun === 'genes' ? ' — click one to select its genes' : ''}`}
            onChange={(v) => update({ [fields.modules]: v })}
          />
        </Field>
        <Field
          label="tree"
          aside={<QuickToggle config={config} field={fields.tree} update={update} kind="heatmap" />}
        >
          <OnOffSwitch
            on={!!cfg[fields.tree]}
            label={`${caption} tree`}
            title={`The clustering tree of the ${noun}`}
            onChange={(v) => update({ [fields.tree]: v })}
          />
        </Field>
        <Field label="palette">
          <CategoricalSelect config={cfg} update={update} field={fields.palette} />
        </Field>
      </div>
    </>
  )
}
export function HeatmapPanel({ config, update, edgeNodeId }: PlotPanelProps<HeatmapConfig>) {
  // The gene cap is a fold-change concept (top-N differential genes); the intensity heatmap
  // always shows the full proteome, on Clean data's own log-transform scale (no setting here).
  // Gate the cap on the upstream kind; an unwired heatmap offers it.
  const upstreamKind = useGraph((s) => {
    const up = s.nodes.find((n) => n.id === s.edges.find((e) => e.target === edgeNodeId)?.source)
    return up && isStep(up) ? up.data.kind : undefined
  })
  // The Clean data's primary colour condition's levels, for the condition bar's default (on while
  // they fit the palette). A number, so the selector stays stable.
  const condLevels = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    const r = upId ? s.results[upId] : undefined
    return r?.kind === 'standardize' ? primaryColorLevels(r.std) : 0
  })
  return (
    <>
      {upstreamKind !== 'standardize' && (
        <CapSection
          title="Cap genes"
          hint="Show only the strongest differential genes."
          field="maxGenes"
          value={config.maxGenes}
          enabled={config.capEnabled}
          update={update}
          defaultValue={50}
          rule={(n) => `Keep the top ${n} differential genes by largest |log₂FC|.`}
        />
      )}
      {upstreamKind === 'compare' && (
        <Section
          title="Clustering"
          info="Hierarchical clustering of the genes and the comparison columns, on the euclidean distance between their log₂FC (capped at the colour limit)."
        >
          <Field
            label="linkage"
            aside={<QuickToggle config={config} field="linkage" update={update} kind="heatmap" />}
          >
            <Select
              value={config.linkage ?? 'ward'}
              onChange={(v) => update({ linkage: v as HeatmapLinkage })}
              options={Object.entries(HEATMAP_LINKAGES).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field
            label="leaf order"
            aside={<QuickToggle config={config} field="leafOrder" update={update} kind="heatmap" />}
          >
            <Select
              value={config.leafOrder ?? 'mean'}
              onChange={(v) => update({ leafOrder: v as LeafOrder })}
              options={Object.entries(HEATMAP_LEAF_ORDERS).map(([value, label]) => ({
                value,
                label
              }))}
            />
          </Field>
          <ClusterSideFields
            caption="gene cluster"
            noun="genes"
            fields={{
              max: 'dendroClades',
              modules: 'geneModules',
              tree: 'geneTree',
              palette: 'geneCategorical'
            }}
            config={config}
            update={update}
          />
          <ClusterSideFields
            caption="condition cluster"
            noun="comparisons"
            fields={{
              max: 'dendroColClades',
              modules: 'condModules',
              tree: 'condTree',
              palette: 'condCategorical'
            }}
            config={config}
            update={update}
          />
        </Section>
      )}
      {/* The condition bar belongs to the Clean-data heatmap (a fold-change one has none). */}
      {upstreamKind !== 'compare' && (
        <Section title="Heatmap">
          <Field
            label="Show conditions"
            aside={<QuickToggle config={config} field="condBar" update={update} />}
          >
            <OnOffSwitch
              on={heatmapCondBar(config, condLevels)}
              label="Show conditions"
              title="A coloured track per condition along the samples"
              onChange={(v) => update({ condBar: v })}
            />
          </Field>
          <SampleOrderField config={config} update={update} />
        </Section>
      )}
    </>
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return (
    <PlotSections
      show={<HeatmapPanel config={config as HeatmapConfig} {...props} />}
      colours={<HeatmapColourSection config={config as HeatmapConfig} {...props} />}
    />
  )
}
