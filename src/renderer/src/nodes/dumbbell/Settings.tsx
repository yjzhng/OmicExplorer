import { type ReactNode } from 'react'
import { contextOf, DUMBBELL_ORDERS, dumbbellOrderLabel } from '../../engine'
import { useGraph } from '../../graph/store'
import type { DumbbellConfig } from '../../graph/types'
import { useUpstreamFacts } from '../../graph/useUpstreamFacts'
import { CapSection, Field, QuickToggle, Section, Select } from '../kit/settings/controls'
import { type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { type PlotSettingsProps } from '../settings'

export function DumbbellPanel({ config, update, edgeNodeId }: PlotPanelProps<DumbbellConfig>) {
  // The side names (the contrast's cmp1/cmp2) label the order choices, as on the tile.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { result } = useUpstreamFacts(upId)
  // the context tuples: the first row's, all the labels read (no row built)
  const rows = result?.kind === 'contrast' ? contextOf(result.ctr).rows : undefined
  return (
    <>
      <Section title="Dumbbell">
        <Field
          label="order by"
          aside={<QuickToggle config={config} field="order" update={update} />}
        >
          <Select
            value={config.order ?? 'diff'}
            onChange={(v) => update({ order: v as DumbbellConfig['order'] })}
            options={DUMBBELL_ORDERS.map((o) => ({ value: o, label: dumbbellOrderLabel(o, rows) }))}
          />
        </Field>
      </Section>
      <CapSection
        title="Cap genes"
        hint="Show only the most divergent significant genes."
        field="topGenes"
        value={config.topGenes}
        enabled={config.capEnabled}
        update={update}
        rule={(n) => `Keep the top ${n} significant genes by |FC difference|.`}
      />
    </>
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <PlotSections show={<DumbbellPanel config={config as DumbbellConfig} {...props} />} />
}
