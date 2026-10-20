/** React binding for requirements.ts: live upstream facts from the graph store. Kept apart from
 *  the pure module so the requirement table stays unit-testable without the store. */
import { useMemo } from 'react'

import type { ConditionKey } from '../engine'
import { axisAvailFor } from './registry'
import { curveAxisOf, isCurveFit, type UpstreamFacts } from './requirements'
import { useGraph } from './store'
import { condUnitsFor, isStep, type CompareConfig, type CondUnits } from './types'

/** Live facts for the tile whose incoming edge lands on `nodeId` (a plot, group, or placeholder's
 *  source). Selects primitives/stable refs so Zustand's equality check holds. */
export function useUpstreamFacts(upstreamId: string | undefined): UpstreamFacts {
  const kind = useGraph((s) => {
    const n = upstreamId ? s.nodes.find((x) => x.id === upstreamId) : undefined
    return n && isStep(n) ? n.data.kind : undefined
  })
  const result = useGraph((s) => (upstreamId ? s.results[upstreamId] : undefined))
  const curve = useGraph((s) => isCurveFit(s.nodes.find((x) => x.id === upstreamId)))
  // A Curve fit's model and whether it fits dose × time surfaces (as upstreamFacts) — the Response
  // plot needs surfaces, the residual plots CurveCurator's curves.
  const fitKey = useGraph((s) => {
    const n = s.nodes.find((x) => x.id === upstreamId)
    if (!isCurveFit(n) || !n || !isStep(n)) return ''
    const cfg = n.data.config as CompareConfig
    const pair = cfg.surface && cfg.surfacePair ? cfg.surfacePair.join(',') : ''
    // a one-axis fit's axis (its curves' once run)
    const axis = cfg.surface ? '' : curveAxisOf(upstreamId ? s.results[upstreamId] : undefined, cfg)
    return `${cfg.detection === 'spline' ? 'spline' : '4pl'}|${cfg.surface ? 1 : 0}|${pair}|${axis}`
  })
  const axesKey = useGraph((s) => {
    // the numeric conditions as one string, so the selector returns a primitive
    return axisAvailFor(s, upstreamId).join('|')
  })
  return useMemo(
    () => ({
      kind,
      result,
      axes: axesKey ? (axesKey.split('|') as ConditionKey[]) : [],
      curve,
      ...(fitKey
        ? (() => {
            const [det, surf, pair, axis] = fitKey.split('|')
            return {
              detection: det === 'spline' ? ('spline' as const) : ('4pl' as const),
              surface: surf === '1',
              ...(pair ? { surfacePair: pair.split(',') as [ConditionKey, ConditionKey] } : null),
              ...(axis ? { curveAxis: axis as ConditionKey } : null)
            }
          })()
        : null)
    }),
    [kind, result, axesKey, curve, fitKey]
  )
}

/** The condition units the data feeding `nodeId` was imported with (see condUnitsFor). Selects a
 *  string key so Zustand's equality check holds, and rebuilds the object only when it changes. */
export function useCondUnits(nodeId: string | undefined): CondUnits {
  const key = useGraph((s) => JSON.stringify(Object.entries(condUnitsFor(s, nodeId)).sort()))
  return useMemo(() => Object.fromEntries(JSON.parse(key) as Array<[string, string]>), [key])
}
