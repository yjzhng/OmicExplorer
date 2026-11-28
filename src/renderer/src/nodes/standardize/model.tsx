import type { ReactNode } from 'react'
import { type ConditionKey, orderConds, customCond, type Shape } from '../../engine'
import { StatusNote } from '../../ui/controls/StatusNote'
import type { SampleConds } from '../../engine/types'
import { CONDS } from '../kit/settings/hooks'

/** Whether a histogram looks normal, under its caption: a symmetric hump reads fine; a skewed
 *  shape — raw intensities' pile near zero and long tail — is a warning. */
export const shapeNote = (shape: Shape | undefined): ReactNode =>
  shape ? (
    <StatusNote kind={shape === 'normal' ? 'ok' : 'warn'} inline>
      Detected: <b>{shape}</b>
    </StatusNote>
  ) : undefined
/** A condition's values per sample, for filling batches: the conditions that take two or more. */
export function batchSourceConds(samples: SampleConds[]): ConditionKey[] {
  const vals = new Map<ConditionKey, Set<string>>()
  const note = (c: ConditionKey, v: unknown): void => {
    if (v == null || v === '') return
    let set = vals.get(c)
    if (!set) vals.set(c, (set = new Set()))
    set.add(String(v))
  }
  for (const m of samples) {
    for (const c of CONDS) note(c, m[c as 'cell'])
    for (const [k, v] of Object.entries(m.extra ?? {})) note(customCond(k), v)
  }
  return orderConds([...vals].filter(([, set]) => set.size > 1).map(([c]) => c))
}
