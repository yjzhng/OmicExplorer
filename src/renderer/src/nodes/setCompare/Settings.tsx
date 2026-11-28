import { type ReactNode, useMemo } from 'react'
import { condLabel, sampleIndex } from '../../engine'
import { useGraph } from '../../graph/store'
import { useCondUnits } from '../../graph/run/useUpstreamFacts'
import { numericOfResult } from '../../graph/types'
import type { SetCompareConfig } from '../../graph/config/enrich'
import { ValueMultiSelect } from '../../ui/controls/ValueMultiSelect'
import { CapRow, Field, NumberInput, QuickToggle, Section, Select } from '../kit/settings/controls'
import { CategoricalSelect, type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { SourceField } from '../enrich/Settings'
import { type PlotSettingsProps } from '../settings'
import {
  choicesOf,
  DEFAULT_FDR,
  DEFAULT_MAX_INTERSECTIONS,
  DEFAULT_SHARE,
  defaultCountOf,
  groupByOf,
  levelConds,
  pickedOf
} from './model'

type Props = PlotPanelProps<SetCompareConfig>

/** The upstream's result (stable from the store; derived lists are memoised by the callers). */
function useUpstream(edgeNodeId: string) {
  return useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    return upId ? s.results[upId] : undefined
  })
}

/** What the sets are: what they hold and how they're read from the upstream, which are drawn, and
 *  the saved gene sets drawn with them. */
function SetsSection({ config, update, edgeNodeId }: Props): ReactNode {
  const up = useUpstream(edgeNodeId)
  const geneSets = useGraph((s) => s.geneSets)
  const numeric = useMemo(() => numericOfResult(up), [up])
  const units = useCondUnits(edgeNodeId)
  const choices = useMemo(() => choicesOf(config, up, numeric, units), [config, up, numeric, units])
  const labelOf = useMemo(() => new Map(choices.map((c) => [c.key, c.label])), [choices])
  const picked = useMemo(
    () => [...pickedOf(config, choices, defaultCountOf(up))],
    [config, choices, up]
  )
  const samples = useMemo(
    () => (up?.kind === 'standardize' ? (up.std.samples ?? sampleIndex(up.std).reps) : []),
    [up]
  )
  const conds = useMemo(() => levelConds(samples), [samples])
  const compare = up?.kind === 'compare'
  const terms = compare && config.elements === 'terms'
  const groupBy = up?.kind === 'standardize' ? groupByOf(config, samples) : undefined
  return (
    <Section title="Sets">
      {compare && (
        <Field
          label="show"
          info="The genes significant in each comparison, or the terms enriched among them."
          aside={<QuickToggle config={config} field="elements" update={update} kind="setCompare" />}
        >
          <Select
            value={terms ? 'terms' : 'genes'}
            onChange={(v) => update({ elements: v })}
            options={[
              { value: 'genes', label: 'genes' },
              { value: 'terms', label: 'enriched terms' }
            ]}
          />
        </Field>
      )}
      {terms && (
        <>
          <Field
            label="method"
            aside={<QuickToggle config={config} field="method" update={update} kind="setCompare" />}
          >
            <Select
              value={config.method ?? 'ora'}
              onChange={(v) => update({ method: v })}
              options={[
                { value: 'ora', label: 'ORA (over-representation)' },
                { value: 'gsea', label: 'GSEA (ranked)' }
              ]}
            />
          </Field>
          <SourceField config={config} update={update} edgeNodeId={edgeNodeId} />
          <Field
            label="FDR below"
            info="A term is in a set when its BH-adjusted p is below this."
            aside={
              <QuickToggle config={config} field="termFdr" update={update} kind="setCompare" />
            }
          >
            <div style={{ width: 90 }}>
              <NumberInput
                value={config.termFdr ?? DEFAULT_FDR}
                step={0.01}
                min={0}
                max={1}
                onChange={(v) => v > 0 && v <= 1 && update({ termFdr: v })}
              />
            </div>
          </Field>
        </>
      )}
      {compare && (
        <Field
          label="direction"
          aside={
            <QuickToggle config={config} field="direction" update={update} kind="setCompare" />
          }
        >
          <Select
            value={config.direction ?? 'any'}
            onChange={(v) => update({ direction: v })}
            options={[
              { value: 'any', label: 'up or down' },
              { value: 'up', label: 'up' },
              { value: 'down', label: 'down' },
              { value: 'split', label: 'both' }
            ]}
          />
        </Field>
      )}
      {groupBy && (
        <>
          <Field
            label="group by"
            info="A set per level of this condition, every sample at that level pooled."
            aside={
              <QuickToggle config={config} field="groupBy" update={update} kind="setCompare" />
            }
          >
            <Select
              value={groupBy === 'sample' ? '' : (groupBy[0] ?? '')}
              onChange={(v) => update({ groupBy: [v], sets: undefined })}
              options={conds.map((c) => ({ value: c, label: condLabel(c) }))}
              disabled={!conds.length}
            />
          </Field>
          {groupBy !== 'sample' && (
            <Field
              label="measured in ≥"
              info="A gene is in a group's set when measured (not imputed) in at least this share of its samples — 0 for any one."
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 70 }}>
                  <NumberInput
                    value={Math.round((config.minShare ?? DEFAULT_SHARE) * 100)}
                    step={5}
                    min={0}
                    max={100}
                    onChange={(v) => update({ minShare: Math.min(100, Math.max(0, v)) / 100 })}
                  />
                </div>
                <span>% of samples</span>
              </div>
            </Field>
          )}
        </>
      )}
      <Field label="sets">
        <ValueMultiSelect
          values={choices.map((c) => c.key)}
          selected={picked}
          members
          noun="set"
          labelOf={(k) => labelOf.get(k) ?? k}
          onChange={(next) => update({ sets: next })}
          disabled={!choices.length}
        />
      </Field>
      {!terms && geneSets.length > 0 && (
        <Field label="gene sets" info="Saved gene sets, drawn as sets of their own.">
          <ValueMultiSelect
            values={geneSets.map((g) => g.id)}
            selected={config.geneSets ?? []}
            members
            noun="gene set"
            labelOf={(id) => geneSets.find((g) => g.id === id)?.name ?? id}
            onChange={(next) => update({ geneSets: next })}
          />
        </Field>
      )}
    </Section>
  )
}

/** Its settings panel (nodes/settings.ts). */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  const cfg = config as SetCompareConfig
  const upset = (cfg.view ?? 'upset') === 'upset'
  return (
    <PlotSections
      statistic={<SetsSection config={cfg} {...props} />}
      general={
        <>
          <Field
            label="view"
            aside={
              <QuickToggle config={cfg} field="view" update={props.update} kind="setCompare" />
            }
          >
            <Select
              value={cfg.view ?? 'upset'}
              onChange={(v) => props.update({ view: v })}
              options={[
                { value: 'upset', label: 'UpSet' },
                { value: 'venn', label: 'Venn (2 or 3 sets, to scale)' }
              ]}
            />
          </Field>
          {upset && (
            <Field
              label="order"
              aside={
                <QuickToggle config={cfg} field="order" update={props.update} kind="setCompare" />
              }
            >
              <Select
                value={cfg.order ?? 'size'}
                onChange={(v) => props.update({ order: v })}
                options={[
                  { value: 'size', label: 'largest first' },
                  { value: 'degree', label: 'by number of sets' }
                ]}
              />
            </Field>
          )}
        </>
      }
      colours={
        <Field label="sets">
          <CategoricalSelect
            config={cfg as unknown as Record<string, unknown>}
            update={props.update}
          />
        </Field>
      }
      ranking={
        upset ? (
          <CapRow
            label="Max intersections"
            field="maxIntersections"
            value={cfg.maxIntersections ?? DEFAULT_MAX_INTERSECTIONS}
            enabled={cfg.capEnabled}
            update={props.update}
            defaultValue={DEFAULT_MAX_INTERSECTIONS}
            rule={(n) => `Draws the ${n} first intersections in the order above.`}
          />
        ) : undefined
      }
    />
  )
}
