import { type ReactNode, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { StandardizeResult } from '../../engine'
import { useGraph } from '../../graph/store'
import { Field, Section } from '../kit/settings/controls'
import { type StepSettingsProps } from '../settings'

/** Merge has no settings — what it pools is the wiring. What it DOES need to show is whether the
 *  pooling meant anything: datasets are matched by uniqID, so two inputs that share few ids merge
 *  into a mostly-sparse table, and nothing else in the pipeline would tell you. */
export function MergePanel({ id }: { id: string }) {
  // Same shallow-select-then-memo pattern as ComparePanel: the result refs are stable, the derived
  // numbers are not.
  const stds = useGraph(
    useShallow((s) =>
      s.edges
        .filter((e) => e.target === id)
        .map((e) => s.results[e.source])
        .filter((r) => r?.kind === 'standardize')
        .map((r) => (r as { std: StandardizeResult }).std)
    )
  )
  const inputCount = useGraph((s) => s.edges.filter((e) => e.target === id).length)
  const stats = useMemo(() => {
    if (stds.length === 0) return null
    const idSets = stds.map((d) => new Set(d.rows.map((r) => r.uniqID)))
    const union = new Set<string>()
    for (const set of idSets) for (const u of set) union.add(u)
    const shared = [...union].filter((u) => idSets.every((set) => set.has(u))).length
    return { per: idSets.map((set) => set.size), union: union.size, shared }
  }, [stds])

  return (
    <Section title="Merge">
      <Field label="inputs">
        <div style={{ fontSize: 12 }}>
          {inputCount === 0
            ? 'Connect two or more Clean data tiles.'
            : stds.length < inputCount
              ? `${stds.length} of ${inputCount} inputs have run.`
              : `${inputCount} dataset${inputCount === 1 ? '' : 's'}${inputCount === 1 ? ' — passes through unchanged' : ''}`}
        </div>
      </Field>
      {stats && stds.length > 1 && (
        <Field label="features">
          <div style={{ fontSize: 12 }}>
            {stats.per.join(' / ')} per input · {stats.union.toLocaleString()} pooled ·{' '}
            {stats.shared.toLocaleString()} shared by all
          </div>
        </Field>
      )}
    </Section>
  )
}

/** Its settings panel (nodes/settings.ts). */
export function Settings({ id }: StepSettingsProps): ReactNode {
  return <MergePanel id={id} />
}
