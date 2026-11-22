import { type ReactNode } from 'react'
import { useGraph } from '../../graph/store'
import { type TableConfig, TABLE_GENE_MAX } from '../../graph/types'
import { useUpstreamFacts } from '../../graph/useUpstreamFacts'
import { toPaletteRef } from '../../ui/palettes'
import { OnOffSwitch } from '../../ui/ToggleSwitch'
import { useRolePalette } from '../../ui/useAppSettings'
import { Field, NumberInput, Select } from '../kit/settings/controls'
import { autoOf } from '../kit/settings/plotHooks'
import { PanelPaletteSelect, type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { type PlotSettingsProps } from '../settings'

/** Data table: which view it opens in (the in-table switch still flips it live). */
export function TablePanel({ config, update, edgeNodeId }: PlotPanelProps<TableConfig>) {
  // The cells' automatic palette follows what the table shows: Clean data's abundance → viridis
  // (as its heatmap); a Compare's or Contrast's signed values → RdBu reversed.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { kind: upKind, result } = useUpstreamFacts(upId)
  // As the tile decides (by the upstream result), the node's kind for one not yet run.
  const fromClean = result ? result.kind === 'standardize' : !upKind || upKind === 'standardize'
  const dataRole = useRolePalette('data')
  const fcRole = useRolePalette('fc')
  const colored = config.colored ?? true
  return (
    <PlotSections
      general={
        <>
          <Field label={fromClean ? 'view' : 'default view'}>
            <Select
              value={config.view === 'qc' && !fromClean ? 'matrix' : (config.view ?? 'matrix')}
              onChange={(v) => update({ view: v as TableConfig['view'] })}
              options={[
                { value: 'matrix', label: 'Matrix (gene × column)' },
                { value: 'long', label: 'Long (one row per value)' },
                // Clean data's per-sample QC
                ...(fromClean ? [{ value: 'qc', label: 'QC (one row per sample)' }] : [])
              ]}
            />
          </Field>
          {/* Display only: a longer id or name is cut with "…" and shown whole on hover; search,
              filters, sort and copy use it in full. */}
          {(
            [
              ['uniqID max length', 'idMaxLen', 'Longer uniqIDs'],
              ['gene name max length', 'geneMaxLen', 'Longer gene names']
            ] as const
          ).map(([label, field, what]) => (
            <Field key={field} label={label}>
              <div style={{ width: 90 }}>
                <NumberInput
                  value={config[field] ?? TABLE_GENE_MAX}
                  step={5}
                  min={4}
                  max={500}
                  title={`${what} are cut with … (shown in full on hover)`}
                  onChange={(v) => update({ [field]: Math.min(500, Math.max(4, Math.round(v))) })}
                />
              </div>
            </Field>
          ))}
        </>
      }
      colours={
        <>
          <Field label="colour cells">
            <OnOffSwitch
              on={colored}
              label="Colour cells"
              title="Colour the value cells (the tile's Colour switch is the same setting)"
              onChange={(v) => update({ colored: v })}
            />
          </Field>
          {colored && (
            <Field label="palette">
              <PanelPaletteSelect
                value={toPaletteRef(config.palette)}
                onChange={(v) => update({ palette: v })}
                auto={autoOf(fromClean ? dataRole : fcRole)}
              />
            </Field>
          )}
        </>
      }
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <TablePanel config={config as TableConfig} {...props} />
}
