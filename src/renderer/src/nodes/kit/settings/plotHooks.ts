import { useGraph } from '../../../graph/store'
import type { ClusterConfig } from '../../../graph/config/cluster'
import {
  type CompareConfig,
  type EffectLabels,
  effectLabelsOf
} from '../../../graph/config/compare'
import { isComparisonKind, isStep } from '../../../graph/types'
import { type EffectColors, plotEffectColors } from '../../../graph/config/plotStyle'
import {
  CATEGORICAL_SCHEMES,
  paletteAt,
  toCategoricalId,
  type PaletteRef
} from '../../../ui/color/palettes'
import { useAppSettings, useRolePalette } from '../../../ui/app/useAppSettings'

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
/** The effect colours a plot's groups follow when left automatic: sampled from its FC palette —
 *  the plot's own, else the global one (see plotEffectColors). */
export function useEffectColors(plotPalette?: PaletteRef): EffectColors {
  const globalFc = useRolePalette('fcObject')
  return plotEffectColors(undefined, globalFc, plotPalette)
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
 *  before the plot-wide switch — its old `style.legend`. */
export function legendShown(config: { legend?: unknown; style?: { legend?: boolean } }): boolean {
  return config.legend !== false && config.style?.legend !== false
}

/** What an Automatic "the group's colour" chip shows where each group has its own: the plot's
 *  categorical palette's first colours, as diagonal bands (ColorChip `autoColor`). */
export function useCategoricalInk(config: unknown, field = 'categorical'): string {
  const global = useAppSettings((s) => s.categorical)
  const id = toCategoricalId((config as Record<string, unknown> | undefined)?.[field]) ?? global
  const c = CATEGORICAL_SCHEMES[id].slice(0, 4)
  return c.length > 1 ? `linear-gradient(135deg, ${c.join(', ')})` : (c[0] ?? 'transparent')
}

/** What an Automatic chip shows where the colour runs along a palette (a line per level, a value
 *  scale): the palette itself, low → high, as a diagonal band (ColorChip `autoColor`). */
export const paletteInk = (ref: PaletteRef): string =>
  `linear-gradient(135deg, ${paletteAt(ref, 0)}, ${paletteAt(ref, 0.5)}, ${paletteAt(ref, 1)})`
