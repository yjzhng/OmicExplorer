/** The plot tiles whose data can be exported as tables (Enrichment, STRING — see
 *  export/plotData.ts), and the file names offered for them, after the group tile and plot type:
 *
 *    <group tile name>_Enrichment.csv
 *    <group tile name>_STRING network_nodes.csv / _edges.csv
 *
 *  (an unnamed group tile reads "Plot", as on the canvas). Works on the live graph and on a saved
 *  workflow doc alike. */
import { pathSeg } from './diskNames'
import { plotLabel, stepTitle } from './registry'
import { plotResultKey, type NodeConfig, type NodeKind, type PlotGroupConfig } from './types'

/** A plot tile's key: the node id, or `<group>-<child>` for a plot inside a group tile. */
export const tileKey = (nodeId: string, childId?: string): string =>
  childId ? `${nodeId}-${childId}` : nodeId

export interface PlotTableTarget {
  key: string
  kind: 'enrich' | 'string'
  config: NodeConfig
  /** the processing step it reads from — whose output/ folder its tables go in */
  upstreamId: string
  /** where the plot's run result is held (plotResultKey) — the tables are written from it */
  resultKey: string
  /** its file name stem from the current names (before any `_2`) */
  stem: string
}

/** The minimum of a node this needs — a live step node, or one from a saved workflow doc. */
interface NodeLike {
  id: string
  type?: string
  data: { kind: NodeKind; name?: string; config: NodeConfig }
}

const tableKind = (k: NodeKind): k is 'enrich' | 'string' => k === 'enrich' || k === 'string'

/** Every Enrichment / STRING plot in a workflow — standalone, or a subcard of a group tile. */
export function plotTableTargets(
  nodes: NodeLike[],
  edges: Array<{ source: string; target: string }>
): PlotTableTarget[] {
  const out: PlotTableTarget[] = []
  for (const n of nodes) {
    if (n.type && n.type !== 'step') continue // a frame (live graph only)
    const upstreamId = edges.find((e) => e.target === n.id)?.source
    if (!upstreamId) continue
    const tile = stepTitle(n)
    const add = (kind: NodeKind, config: NodeConfig, childId?: string): void => {
      if (!tableKind(kind)) return
      out.push({
        key: tileKey(n.id, childId),
        kind,
        config,
        upstreamId,
        resultKey: plotResultKey(n.id, childId),
        stem: pathSeg(`${tile}_${plotLabel(kind, config)}`, 'Plot')
      })
    }
    if (n.data.kind === 'plotGroup')
      for (const c of (n.data.config as PlotGroupConfig).children) add(c.kind, c.config, c.id)
    else add(n.data.kind, n.data.config)
  }
  return out
}

/** The files a plot's tables are written to, from its stem. */
export const plotTableFiles = (kind: 'enrich' | 'string', stem: string): string[] =>
  kind === 'enrich' ? [`${stem}.csv`] : [`${stem}_nodes.csv`, `${stem}_edges.csv`]
