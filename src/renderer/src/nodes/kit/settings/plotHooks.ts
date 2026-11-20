import { useGraph } from '../../../graph/store'
import {
  type ClusterConfig,
  effectLabelsOf,
  isComparisonKind,
  isStep,
  plotEffectColors,
  type CompareConfig,
  type EffectColors,
  type EffectLabels
} from '../../../graph/types'
import { type PaletteRef } from '../../../ui/palettes'
import { useRolePalette } from '../../../ui/useAppSettings'

/** Whether a cluster tile draws its embedding scatter with minimal axes (scree and loadings keep
 *  their own, so the setting doesn't reach them). */
export function clusterMinimalAxes(c: ClusterConfig): boolean {
  return c.axisMode === 'minimal' && ((c.plot ?? 'pc') === 'pc' || c.method !== 'pca')
}
/** The upstream node a plot panel hangs off (its incoming edge's source), for facts the panel
 *  shows but doesn't own — the Compare's effect names, a Contrast's relationship. */
export function useUpstreamNode(edgeNodeId: string) {
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  return useGraph((s) => (upId ? s.nodes.find((n) => n.id === upId) : undefined))
}
/** The up/down class names a point plot's legend shows — the upstream Compare's effect labels
 *  (a Contrast fed by a Compare inherits nothing here; it falls back to up/down). */
export function useEffectNames(edgeNodeId: string): EffectLabels {
  const up = useUpstreamNode(edgeNodeId)
  const cfg =
    up && isStep(up) && isComparisonKind(up.data.kind)
      ? (up.data.config as CompareConfig)
      : undefined
  return effectLabelsOf(cfg)
}
/** The up/down/none colours a plot's automatic group colours follow — the upstream Compare's
 *  (the defaults from anything else). */
/** The effect colours a plot's groups follow when left automatic: sampled from the plot's own
 *  palette when it has one, else the upstream Compare's colours, else sampled from the global
 *  palette (see plotEffectColors). */
export function useEffectColors(edgeNodeId: string, plotPalette?: PaletteRef): EffectColors {
  const up = useUpstreamNode(edgeNodeId)
  const globalFc = useRolePalette('fcObject')
  const cfg =
    up && isStep(up) && isComparisonKind(up.data.kind)
      ? (up.data.config as CompareConfig)
      : undefined
  return plotEffectColors(undefined, cfg, globalFc, plotPalette)
}
/** The DR settings that make up its look, persisted with the tile (see DRConfig / drLook). */
export const DR_LOOK_FIELDS = [
  'lineWidth',
  'lineColor',
  'lineOpacity',
  'points',
  'pointSize',
  'pointColor',
  'pointOpacity',
  'errors',
  'errorStyle',
  'errorColor',
  'errorOpacity',
  'ec50Line'
] as const
/** A palette's name as an Automatic option shows it (reversed noted). */
export const paletteLabel = (palette: PaletteRef): string =>
  palette.reverse ? `${palette.id} (reversed)` : palette.id
/** The Automatic option of a palette picker: following `palette`, named for it. */
export const autoOf = (palette: PaletteRef): { palette: PaletteRef; label: string } => ({
  palette,
  label: paletteLabel(palette)
})

/** Whether a plot's legend is shown: the plot-wide switch (`legend`), and — a point plot from
 *  before the Legend section — its old `style.legend`. */
export function legendShown(config: { legend?: unknown; style?: { legend?: boolean } }): boolean {
  return config.legend !== false && config.style?.legend !== false
}
