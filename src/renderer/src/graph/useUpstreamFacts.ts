/** React binding for requirements.ts: live upstream facts from the graph store. Kept apart from
 *  the pure module so the requirement table stays unit-testable without the store. */
import { useMemo } from 'react'

import { axisAvailFor } from './registry'
import type { UpstreamFacts } from './requirements'
import { useGraph } from './store'
import { isStep } from './types'

/** Live facts for the tile whose incoming edge lands on `nodeId` (a plot, group, or placeholder's
 *  source). Selects primitives/stable refs so Zustand's equality check holds. */
export function useUpstreamFacts(upstreamId: string | undefined): UpstreamFacts {
  const kind = useGraph((s) => {
    const n = upstreamId ? s.nodes.find((x) => x.id === upstreamId) : undefined
    return n && isStep(n) ? n.data.kind : undefined
  })
  const result = useGraph((s) => (upstreamId ? s.results[upstreamId] : undefined))
  const axesKey = useGraph((s) => {
    const a = axisAvailFor(s, upstreamId)
    return `${a.dose}:${a.time}`
  })
  return useMemo(
    () => ({
      kind,
      result,
      axes: { dose: axesKey.startsWith('true'), time: axesKey.endsWith('true') }
    }),
    [kind, result, axesKey]
  )
}
