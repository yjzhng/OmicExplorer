import { type ReactNode, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  type ConditionKey,
  conditionLevels,
  condLabel,
  isCustomCond,
  orderConds,
  sampleName,
  sampleLevels,
  samplePasses,
  sheetSamples
} from '../../engine'
import { loadAbove, wiredKindOf } from '../../graph/registry'
import { useGraph } from '../../graph/store'
import {
  type LoadConfig,
  loadCustomConditions,
  loadNumericConditions,
  type SubsetConfig
} from '../../graph/types'
import { ValueMultiSelect } from '../../ui/ValueMultiSelect'
import { Field, Section } from '../kit/settings/controls'
import { useInputText } from '../kit/settings/hooks'
import { styles } from '../kit/settings/styles'
import { type StepSettingsProps } from '../settings'

/** Subset: one searchable multi-select per condition the upstream dataset carries, keeping the
 *  samples whose conditions take the ticked values (all of a condition's values = unfiltered). */
export function SubsetPanel({ id, config }: { id: string; config: SubsetConfig }) {
  const updateConfig = useGraph((s) => s.updateConfig)
  const std = useGraph((s) => {
    const up = s.edges.find((e) => e.target === id)?.source
    const r = up ? s.results[up] : undefined
    return r?.kind === 'standardize' ? r.std : null
  })
  // Off Load data (wiredKindOf): the samplesheet's samples, read as Clean data will read them, less
  // what any Subsets above this one drop — there's no run to pick values from yet.
  const aboveLoad = useGraph((s) =>
    wiredKindOf(s, id) === 'load'
      ? ((loadAbove(s, id)?.load.data.config as LoadConfig | undefined) ?? null)
      : null
  )
  // (the Subsets' own selectors: stable objects, so a shallow compare holds)
  const aboveKeep = useGraph(useShallow((s) => loadAbove(s, id)?.keep ?? []))
  const above = useMemo(
    () => (aboveLoad ? { load: aboveLoad, keep: aboveKeep } : null),
    [aboveLoad, aboveKeep]
  )
  const sheetText = useInputText(above?.load.samplesheet)
  const sheet = useMemo(() => {
    if (!above || sheetText == null) return null
    try {
      const passes = above.keep.map(samplePasses)
      return sheetSamples(sheetText, loadCustomConditions(above.load)).filter((m) =>
        passes.every((pass) => pass(m))
      )
    } catch {
      return null // a samplesheet Clean data couldn't read either: its run says why
    }
  }, [above, sheetText])
  const levels = useMemo(
    () =>
      above
        ? sheet
          ? sampleLevels(sheet, loadNumericConditions(above.load))
          : {}
        : std
          ? conditionLevels(std)
          : {},
    [above, sheet, std]
  )
  const samples = above ? sheet : (std?.samples ?? null)
  const keep = useMemo(() => config.keep ?? {}, [config.keep])
  const counts = useMemo(() => {
    if (!samples) return null
    const pass = samplePasses({ keep, reps: config.reps, drop: config.drop })
    return { kept: samples.filter(pass).length, of: samples.length }
  }, [samples, keep, config.reps, config.drop])
  // The replicates on offer: as numbered at import — the samplesheet's, else Clean data's (a Subset
  // before Clean data with no rep column has none yet: it numbers them as it reads the data).
  const reps = useMemo(
    () =>
      [...new Set((samples ?? []).map((m) => m.rep).filter((r): r is number => r != null))]
        .sort((a, b) => a - b)
        .map(String),
    [samples]
  )
  const sampleNames = useMemo(() => (samples ?? []).map((m) => m.sample), [samples])
  // Each sample named by its conditions (cell · cmpd · dose · time … · r<rep>), not its file name — which
  // may say nothing (a run number, an acquisition path). Two that would read alike get their file
  // name after it. What's stored (`drop`) stays the file name, so a renamed condition keeps it.
  const nameOf = useMemo(() => {
    const label = new Map((samples ?? []).map((m) => [m.sample, sampleName(m)]))
    const seen = new Map<string, number>()
    for (const l of label.values()) seen.set(l, (seen.get(l) ?? 0) + 1)
    return (v: string): string => {
      const l = label.get(v)
      return l == null ? v : (seen.get(l) ?? 0) > 1 || l === '' ? `${l || 'sample'} (${v})` : l
    }
  }, [samples])

  if (above ? !sheet : !std)
    return (
      <Section title="Subset">
        <div style={styles.hint}>
          {above
            ? 'Configure the Load data tile to pick values.'
            : 'Connect and run a Clean data tile to pick values.'}
        </div>
      </Section>
    )
  const conds = orderConds(Object.keys(levels) as ConditionKey[])
  return (
    <Section
      title="Subset"
      subtitle={counts ? `${counts.kept} of ${counts.of} samples` : undefined}
      info={
        above
          ? "Keeps the samples whose conditions (and replicate) take the ticked values, less any left out by name; the Clean data step below reads only those, so its clean-up sees just them. A condition left at All isn't filtered. Replicates keep the numbers they were imported with."
          : "Keeps the samples whose conditions (and replicate) take the ticked values, less any left out by name; downstream tiles see only those. A condition left at All isn't filtered. Replicates keep the numbers they were imported with."
      }
    >
      {conds.map((c) => (
        <Field key={c} label={condLabel(c)}>
          <ValueMultiSelect
            values={levels[c] ?? []}
            selected={keep[c] ?? []}
            noun={
              c === 'cmpd'
                ? 'compound'
                : c === 'time'
                  ? 'time point'
                  : isCustomCond(c)
                    ? 'value'
                    : c
            }
            onChange={(next) => {
              const { [c]: _drop, ...rest } = keep
              void _drop
              updateConfig(id, { keep: next.length ? { ...rest, [c]: next } : rest })
            }}
          />
        </Field>
      ))}
      {/* Whole replicate sets: unticking r3 drops replicate 3 of every condition. */}
      {reps.length > 1 && (
        <Field label="replicate">
          <ValueMultiSelect
            values={reps}
            selected={config.reps ?? []}
            noun="replicate"
            onChange={(next) => updateConfig(id, { reps: next.length ? next : undefined })}
          />
        </Field>
      )}
      {/* One-off exclusions (a bad replicate of one condition): untick a sample to leave it out —
                kept as the samples left out (`drop`), so samples new upstream are kept. */}
      {sampleNames.length > 1 && (
        <Field label="samples">
          <ValueMultiSelect
            values={sampleNames}
            selected={
              config.drop?.length ? sampleNames.filter((n) => !config.drop!.includes(n)) : []
            }
            noun="sample"
            labelOf={nameOf}
            onChange={(next) => {
              const drop = next.length ? sampleNames.filter((n) => !next.includes(n)) : []
              updateConfig(id, { drop: drop.length ? drop : undefined })
            }}
          />
        </Field>
      )}
    </Section>
  )
}

/** Its settings panel (nodes/settings.ts). */
export function Settings({ id, config }: StepSettingsProps): ReactNode {
  return <SubsetPanel id={id} config={config as SubsetConfig} />
}
