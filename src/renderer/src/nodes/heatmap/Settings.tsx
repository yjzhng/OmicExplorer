import type { ReactNode } from 'react'
import type { LeafOrder } from '../../engine'
import { useGraph } from '../../graph/store'
import {
  DENDRO_CLADES_DEFAULT,
  HEATMAP_COND_DISTANCES,
  HEATMAP_LEAF_ORDERS,
  HEATMAP_LINKAGES,
  heatmapCondBar,
  type HeatmapCondDistance,
  type HeatmapConfig,
  type HeatmapLinkage
} from '../../graph/config/heatmap'
import { isComparisonKind, isStep } from '../../graph/types'
import { primaryColorLevels } from '../../graph/config/coloring'
import { useUpstreamFacts } from '../../graph/run/useUpstreamFacts'
import { toPaletteRef } from '../../ui/color/palettes'
import { OnOffSwitch } from '../../ui/controls/ToggleSwitch'
import { useRolePalette } from '../../ui/app/useAppSettings'
import {
  CapRow,
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
  ColourRows,
  PanelPaletteSelect,
  type PlotPanelProps,
  PlotSections
} from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'

/** A heatmap's palette follows what it draws: from a Compare, log₂FC on the fold-change palette
 *  (Automatic = the global one); from Clean data, abundance on its value palette (Automatic =
 *  viridis). */
export function HeatmapColourRows(props: PlotPanelProps<HeatmapConfig>): ReactNode {
  // Decided as the plot decides (PanelBody: the upstream RESULT is a comparison's — a Compare's or
  // a Curve fit's), so the panel's Automatic always names what's drawn; the upstream node's kind
  // covers a tile not yet run.
  const upId = useGraph((s) => s.edges.find((e) => e.target === props.edgeNodeId)?.source)
  const { kind: upKind, result } = useUpstreamFacts(upId)
  const fromCompare = result ? result.kind === 'compare' : isComparisonKind(upKind)
  const dataRole = useRolePalette('data')
  // From a Compare: the modules' palettes too (the clusters' coloured bars).
  if (fromCompare)
    return (
      <ColourRows {...props} role="fc">
        <Field label="gene modules">
          <CategoricalSelect
            config={props.config as unknown as Record<string, unknown>}
            update={props.update}
            field="geneCategorical"
          />
        </Field>
        <Field label="condition modules">
          <CategoricalSelect
            config={props.config as unknown as Record<string, unknown>}
            update={props.update}
            field="condCategorical"
          />
        </Field>
      </ColourRows>
    )
  return (
    <>
      <Field label="palette">
        <PanelPaletteSelect
          value={toPaletteRef(props.config.valuePalette)}
          onChange={(v) => props.update({ valuePalette: v })}
          auto={autoOf(dataRole)}
        />
      </Field>
    </>
  )
}
/** One side of a fold-change heatmap's clustering (its genes, or its conditions): a caption, and
 *  under it, indented, the most clusters, the modules (a coloured bar per cluster) and the tree
 *  (the bars' palette is in General). `fields` names the config keys the side's settings
 *  live in. */
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
      </div>
    </>
  )
}
/** A fold-change heatmap's clustering — an analysis of the data before it's drawn, so a section of
 *  the Statistic slot; a Clean-data heatmap has none (its samples keep their order). */
function HeatmapClustering({ config, update, edgeNodeId }: PlotPanelProps<HeatmapConfig>) {
  const upstreamKind = useHeatmapUpstream(edgeNodeId)
  if (upstreamKind !== 'compare') return null
  return (
    <Section
      title="Clustering"
      info="Hierarchical clustering of the genes and the comparison columns, on the euclidean distance between their log₂FC (capped at the colour limit) — for the columns, optionally on the pattern of their changes alone."
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
      <Field
        label="conditions by"
        info="What makes two comparison columns alike. Size and pattern: the same genes changing by similar amounts (a column whose changes are twice another's sits apart from it). Pattern only: the same genes moving the same way, however far — each column's changes scaled to the same spread first, so the distance ranks pairs as 1 − Pearson r. The genes are always clustered on size and pattern."
        aside={<QuickToggle config={config} field="condDistance" update={update} kind="heatmap" />}
      >
        <Select
          value={config.condDistance ?? 'size'}
          onChange={(v) => update({ condDistance: v as HeatmapCondDistance })}
          options={Object.entries(HEATMAP_COND_DISTANCES).map(([value, label]) => ({
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
          tree: 'geneTree'
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
          tree: 'condTree'
        }}
        config={config}
        update={update}
      />
    </Section>
  )
}
/** The upstream step's kind (undefined unwired). */
function useHeatmapUpstream(edgeNodeId: string) {
  return useGraph((s) => {
    const up = s.nodes.find((n) => n.id === s.edges.find((e) => e.target === edgeNodeId)?.source)
    return up && isStep(up) ? up.data.kind : undefined
  })
}
/** General's rows: the condition bar (along a Clean-data heatmap's samples, a fold-change one's
 *  comparison columns), and a Clean-data heatmap's sample order. */
export function HeatmapPanel({ config, update, edgeNodeId }: PlotPanelProps<HeatmapConfig>) {
  const upstreamKind = useHeatmapUpstream(edgeNodeId)
  // The Clean data's primary colour condition's levels, for the condition bar's default (on while
  // they fit the palette). A number, so the selector stays stable.
  const condLevels = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    const r = upId ? s.results[upId] : undefined
    return r?.kind === 'standardize' ? primaryColorLevels(r.std) : 0
  })
  const fc = upstreamKind === 'compare'
  return (
    <>
      <Field
        label="Show conditions"
        aside={<QuickToggle config={config} field="condBar" update={update} />}
      >
        <OnOffSwitch
          // a fold-change heatmap's tracks are on unless switched off
          on={fc ? (config.condBar ?? true) : heatmapCondBar(config, condLevels)}
          label="Show conditions"
          title={
            fc
              ? 'A coloured track per condition along the comparisons: the comparison, then each condition that tells them apart'
              : 'A coloured track per condition along the samples'
          }
          onChange={(v) => update({ condBar: v })}
        />
      </Field>
      {!fc && <SampleOrderField config={config} update={update} />}
    </>
  )
}

/** A fold-change heatmap's gene cap (a Clean-data one draws every gene it's given). */
function HeatmapGenes({ config, update, edgeNodeId }: PlotPanelProps<HeatmapConfig>): ReactNode {
  if (useHeatmapUpstream(edgeNodeId) === 'standardize') return null
  return (
    <CapRow
      label="Max genes"
      info="Show only the strongest differential genes."
      field="maxGenes"
      value={config.maxGenes}
      enabled={config.capEnabled}
      update={update}
      split={config}
      defaultValue={50}
      rule={(n) => `Keep the top ${n} differential genes by largest |log₂FC|.`}
      step={10}
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return (
    <PlotSections
      statistic={<HeatmapClustering config={config as HeatmapConfig} {...props} />}
      general={<HeatmapPanel config={config as HeatmapConfig} {...props} />}
      ranking={<HeatmapGenes config={config as HeatmapConfig} {...props} />}
      colours={<HeatmapColourRows config={config as HeatmapConfig} {...props} />}
    />
  )
}
