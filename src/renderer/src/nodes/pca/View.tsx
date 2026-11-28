import type { ReactNode } from 'react'
import { SwitchBar } from '../../dashboard/SwitchBar'
import { CLUSTER_COLOR, type ConditionKey, VALID_CONDITIONS } from '../../engine'
import { quickOn } from '../../graph/registry'
import { useGraph } from '../../graph/store'
import {
  clusterByCluster,
  clusterColoring,
  clusterColorWrite,
  clusterFadeScheme
} from '../../graph/config/coloring'
import { type ClusterConfig, clusterLook, clusterStyle } from '../../graph/config/cluster'
import { Empty, PlotNotRun } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { ClusterTile } from './ClusterTile'

/** What the cluster tile's `plot` choice reads as on screen (the stored values are terse). */
export const PLOT_LABEL: Record<NonNullable<ClusterConfig['plot']>, string> = {
  pc: 'PC plot',
  loadings: 'loadings',
  scree: 'scree plot'
}
/** The pca result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function pcaView(v: ViewContext): ReactNode {
  const {
    cfgSource,
    patchConfig,
    upstream,
    plotRun,
    child,
    node,
    condTitle,
    categoricalOf,
    numeric
  } = v
  const cfg = cfgSource as ClusterConfig
  // What marks the data, and the territory outlining it — from old configs too (clusterLook).
  const { data: display, territory } = clusterLook(cfg)
  // Every write sets both, so an old combined 'territory' display becomes the two settings.
  const patchLook = (next: Partial<ReturnType<typeof clusterLook>>): void =>
    patchConfig({
      display: next.data ?? display,
      outline: next.territory ?? territory
    })
  // All three plots are PCA notions, so the choice is only offered (and only honoured) for PCA.
  const plot = cfg.method === 'pca' ? (cfg.plot ?? 'pc') : 'pc'
  const scree = plot === 'scree'
  // Colour-by options are the Standardize's active conditions. Keep the current value
  // selectable if it's off-list.
  const active: ConditionKey[] =
    upstream?.kind === 'standardize'
      ? upstream.std.activeConditions
      : (VALID_CONDITIONS as ConditionKey[])
  // What the colours mean: the conditions (the ones picked in the settings) or the computed
  // clusters — the tile's switch flips between the two, the pick kept across.
  const byCluster = clusterByCluster(cfg)
  const fadeScheme = clusterFadeScheme(cfg, active, numeric)
  // The colours drawn, from the picks as the settings show them (a new plot's default included):
  // one condition its own colours, several every combination's (the fade, if any, by fadeScheme).
  const { picks, fade } = clusterColoring(cfg, active, numeric)
  const drawn = byCluster ? null : clusterColorWrite(picks, fade)
  const clusterOn = cfg.clusterOn ?? 'coords'
  const clusterCount = cfg.clusterCount ?? 'fixed'
  const withBar = (body: ReactNode): ReactNode => (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
          {cfg.method === 'pca' && quickOn(cfg, 'plot', 'pca') && (
            <SwitchBar
              label="plot"
              value={PLOT_LABEL[plot]}
              options={Object.values(PLOT_LABEL)}
              onChange={(v) =>
                patchConfig({
                  plot: (Object.keys(PLOT_LABEL) as Array<ClusterConfig['plot'] & string>).find(
                    (k) => PLOT_LABEL[k] === v
                  )
                })
              }
            />
          )}
          {/* Everything below styles the embedding scatter, which the scree plot replaces. */}
          {!scree && quickOn(cfg, 'colorBy', 'pca') && (
            <SwitchBar
              label="colour by"
              value={byCluster ? 'clusters' : 'conditions'}
              options={['conditions', 'clusters']}
              onChange={(v) =>
                patchConfig(
                  v === 'clusters' ? { colorBy: CLUSTER_COLOR } : clusterColorWrite(picks, fade)
                )
              }
            />
          )}
          {/* Both cluster knobs only mean anything while the colours ARE clusters. */}
          {!scree && byCluster && quickOn(cfg, 'clusterOn', 'pca') && (
            <SwitchBar
              label="cluster on"
              value={clusterOn}
              options={['coords', 'features']}
              onChange={(v) => patchConfig({ clusterOn: v as ClusterConfig['clusterOn'] })}
            />
          )}
          {!scree && byCluster && quickOn(cfg, 'clusterCount', 'pca') && (
            <SwitchBar
              label="count"
              value={clusterCount}
              options={['fixed', 'conditions', 'auto']}
              onChange={(v) => patchConfig({ clusterCount: v as ClusterConfig['clusterCount'] })}
            />
          )}
          {!scree && quickOn(cfg, 'display', 'pca') && (
            <SwitchBar
              label="data"
              value={display}
              options={['replicate', 'centroid']}
              onChange={(v) => patchLook({ data: v as 'replicate' | 'centroid' })}
            />
          )}
          {!scree && quickOn(cfg, 'territory', 'pca') && (
            <SwitchBar
              label="territory"
              value={territory}
              options={['hull', 'gaussian', 'none']}
              onChange={(v) => patchLook({ territory: v as 'hull' | 'gaussian' | 'none' })}
            />
          )}
          {/* PCA computation parameters (scaling, missing, normalize, features, transform,
                  replicates) live in the tile's settings dialog (gear), not inline. */}
        </div>
        <div style={styles.stackBody}>{body}</div>
      </div>
    </div>
  )
  if (upstream?.kind !== 'standardize')
    return <Empty text="Connect a Clean data tile and run it." />
  // Drawn from the plot's run (the embedding, computed in the worker). A result from before the
  // cluster computed in its run (a bare marker) has no embedding: run it.
  if (plotRun?.kind !== 'cluster')
    return withBar(
      <PlotNotRun
        status="idle"
        onRun={() => {
          const g = useGraph.getState()
          void (child ? g.runPlotChild(node.id, child.id) : g.runTargets([node.id]))
        }}
      />
    )
  return withBar(
    <ClusterTile
      condTitle={condTitle}
      categorical={categoricalOf(cfg)}
      cluster={plotRun.cluster}
      colorBy={drawn?.colorBy ?? CLUSTER_COLOR}
      groupConds={drawn?.groupConds}
      display={display}
      territory={territory}
      plot={plot}
      loadings={cfg.loadings}
      // coloured by conditions with a fade: drawn by the complex legend — the colour conditions
      // as picked, the fade as its shade (clusterFadeScheme)
      legend={fadeScheme ? 'complex' : 'simple'}
      axisMode={cfg.axisMode}
      look={clusterStyle(cfg)}
      schemeColor={fadeScheme?.color}
      schemeShade={fadeScheme?.shade}
      schemeArrow={fadeScheme?.arrow}
      schemeAsGiven
      numeric={numeric}
    />
  )

  return <Empty text="No output." />
}
