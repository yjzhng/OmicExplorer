import { type CSSProperties, type ReactNode, useMemo } from 'react'
import { CLUSTER_COLOR } from '../../engine'
import { useGraph } from '../../graph/store'
import {
  clusterByCluster,
  clusterColoring,
  clusterColorWrite,
  type ClusterConfig,
  clusterLook,
  clusterStyle,
  numericOfResult
} from '../../graph/types'
import { AUTO } from '../../ui/ColorPicker'
import { OpacitySlider } from '../../ui/OpacitySlider'
import { DEFAULT_OUTLINE } from '../../ui/pointStyle'
import { UI } from '../../ui/theme'
import {
  ColorChip,
  Field,
  NumberInput,
  QuickToggle,
  Section,
  Select
} from '../kit/settings/controls'
import { CONDS } from '../kit/settings/hooks'
import {
  CategoricalRows,
  ColorFadeFields,
  type PlotPanelProps,
  PlotSections
} from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'
import { styleBoxes } from './model'

export function ClusterPanel({ config, update, edgeNodeId }: PlotPanelProps<ClusterConfig>) {
  // What marks the data and the territory outlining it, from old configs too (clusterLook); every
  // write below sets both, so an old combined 'territory' display becomes the two settings.
  const look = clusterLook(config)
  // Select the (stable) upstream result, then derive the condition list in a memo —
  // returning a freshly-built array straight from the selector would fail Zustand's
  // reference equality and loop forever.
  const upstream = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    return upId ? s.results[upId] : undefined
  })
  const active = useMemo(
    () => (upstream?.kind === 'standardize' ? upstream.std.activeConditions : CONDS),
    [upstream]
  )
  const numeric = useMemo(() => numericOfResult(upstream), [upstream])
  // Coloured by conditions (default) or by clusters; the conditions picked and the one fading them
  // (none: null), as the settings show them — a pick the data no longer carries falls back to the
  // default (clusterColoring), so nothing needs snapping here. In the default condition order.
  const byCluster = clusterByCluster(config)
  const { picks, fade } = clusterColoring(config, active, numeric)
  return (
    // How the data are prepared (Data, upstream of the embedding), what is plotted and how it's
    // coloured (General), the features used, how the points and territories are drawn.
    <PlotSections
      // how the data are prepared for the embedding: upstream of everything drawn
      statistic={
        <Section title="Data">
          <Field label="transform">
            <Select
              value={config.transform ?? 'auto'}
              onChange={(v) => update({ transform: v as ClusterConfig['transform'] })}
              options={[
                // Follows Clean data's log-transform exactly (none = the data as it arrived).
                { value: 'auto', label: 'as Clean data' },
                { value: 'log2', label: 'log₂' },
                { value: 'log10', label: 'log' },
                { value: 'none', label: 'none' }
              ]}
            />
          </Field>
          <Field label="replicates">
            <Select
              value={config.replicates ?? 'individual'}
              onChange={(v) => update({ replicates: v as ClusterConfig['replicates'] })}
              options={[
                { value: 'individual', label: 'individual' },
                { value: 'mean', label: 'mean' }
              ]}
            />
          </Field>
          <Field label="missing values">
            <Select
              value={config.missing ?? 'complete'}
              onChange={(v) => update({ missing: v as ClusterConfig['missing'] })}
              options={[
                { value: 'impute', label: 'impute' },
                { value: 'complete', label: 'complete cases' }
              ]}
            />
          </Field>
          <Field label="normalize">
            <Select
              value={config.center ?? 'median'}
              onChange={(v) => update({ center: v as ClusterConfig['center'] })}
              options={[
                { value: 'median', label: 'median' },
                { value: 'zscore', label: 'z-score' },
                { value: 'quantile', label: 'quantile' },
                { value: 'none', label: 'none' }
              ]}
            />
          </Field>
          <Field label="gene scaling">
            <Select
              value={config.scale ?? 'unit'}
              onChange={(v) => update({ scale: v as ClusterConfig['scale'] })}
              options={[
                { value: 'unit', label: 'unit variance' },
                { value: 'none', label: 'none' }
              ]}
            />
          </Field>
        </Section>
      }
      general={
        <>
          <Field label="method">
            <Select
              value={config.method}
              onChange={(v) => update({ method: v as ClusterConfig['method'] })}
              options={[
                { value: 'pca', label: 'PCA' },
                { value: 'umap', label: 'UMAP' },
                { value: 'tsne', label: 't-SNE' }
              ]}
            />
          </Field>
          {/* PCA is the only method with component variances, so the scree has nothing to show for
              UMAP/t-SNE. */}
          {config.method === 'pca' && (
            <Field
              label="plot"
              aside={<QuickToggle config={config} field="plot" update={update} kind="pca" />}
            >
              <Select
                value={config.plot ?? 'pc'}
                onChange={(v) => update({ plot: v as ClusterConfig['plot'] })}
                options={[
                  { value: 'pc', label: 'PC' },
                  { value: 'loadings', label: 'loadings' },
                  { value: 'scree', label: 'scree' }
                ]}
              />
            </Field>
          )}
          {config.method === 'pca' && config.plot === 'scree' && (
            <div style={styles.hint}>
              Variance explained per component — a steep drop after PC1–2 means the PC plot
              summarises the data well; a flat scree means it doesn’t.
            </div>
          )}
          {config.method === 'pca' && config.plot === 'loadings' && (
            <>
              <Field label="loadings">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 90 }}>
                  <NumberInput
                    value={config.loadings ?? 10}
                    step={1}
                    min={1}
                    max={40}
                    onChange={(v) => update({ loadings: Math.max(1, Math.min(40, Math.round(v))) })}
                  />
                </div>
              </Field>
              <div style={styles.hint}>
                The most influential features in the same PC1/PC2 plane, as vectors from the origin
                — which measurements drive the separation, not just that there is one. Same
                direction = moves together; opposite = trades off; longer = stronger.
              </div>
            </>
          )}
        </>
      }
      // how many features the embedding is built from (the most variable)
      ranking={
        <Field
          label="features"
          info="Build the embedding from every feature, or only the most variable ones."
        >
          <Select
            value={String(config.topVar ?? 0)}
            onChange={(v) => update({ topVar: Number(v) })}
            options={[
              { value: '0', label: 'all' },
              { value: '100', label: 'top 100' },
              { value: '250', label: 'top 250' },
              { value: '500', label: 'top 500' }
            ]}
          />
        </Field>
      }
      marks={
        <Section title="Points">
          {/* Two independent settings: what marks the data, and the territory outlining it. */}
          <Field
            label="data"
            aside={<QuickToggle config={config} field="display" update={update} kind="pca" />}
          >
            <Select
              value={look.data}
              onChange={(v) =>
                update({ display: v as 'replicate' | 'centroid', outline: look.territory })
              }
              options={[
                { value: 'replicate', label: 'replicate' },
                { value: 'centroid', label: 'centroid' }
              ]}
            />
          </Field>
          <Field
            label="territory"
            aside={<QuickToggle config={config} field="territory" update={update} kind="pca" />}
          >
            <Select
              value={look.territory}
              onChange={(v) =>
                update({ display: look.data, outline: v as 'hull' | 'gaussian' | 'none' })
              }
              options={[
                { value: 'hull', label: 'hull' },
                { value: 'gaussian', label: 'gaussian' },
                { value: 'none', label: 'none' }
              ]}
            />
          </Field>
          {look.territory !== 'none' && (
            <div style={styles.hint}>
              {look.territory === 'hull'
                ? 'The convex hull of each condition group’s points (colour × fade) — only where measurements landed.'
                : 'A ~95% covariance ellipse per condition group (colour × fade) — smoother, but extrapolated beyond the points.'}
            </div>
          )}
          <ClusterMarkerField config={config} update={update} centroid={look.data === 'centroid'} />
        </Section>
      }
      // the embedding scatter's axis style: a whole-plot row of Axes and lines
      axes={
        // (the embedding scatter's: scree and loadings keep their own)
        (config.plot ?? 'pc') === 'pc' || config.method !== 'pca' ? (
          <>
            <Field label="axes">
              <Select
                value={config.axisMode ?? 'standard'}
                onChange={(v) => update({ axisMode: v as ClusterConfig['axisMode'] })}
                options={[
                  { value: 'standard', label: 'standard' },
                  { value: 'minimal', label: 'minimal' }
                ]}
              />
            </Field>
            {config.axisMode === 'minimal' && (
              <div style={styles.hint}>
                Two short lines at the bottom-left corner with the axis titles — no ticks or
                numbers. Of the Axes settings only the title size and the axis line’s width apply.
              </div>
            )}
          </>
        ) : null
      }
      colours={
        <CategoricalRows config={config} update={update}>
          {/* What the colours mean: the samples' conditions (default), or clusters computed from
              the data. */}
          <Field
            label="color by"
            aside={<QuickToggle config={config} field="colorBy" update={update} kind="pca" />}
          >
            <Select
              value={byCluster ? 'clusters' : 'conditions'}
              onChange={(v) =>
                update(
                  v === 'clusters' ? { colorBy: CLUSTER_COLOR } : clusterColorWrite(picks, fade)
                )
              }
              options={[
                { value: 'conditions', label: 'conditions' },
                { value: 'clusters', label: 'clusters' }
              ]}
            />
          </Field>
          {/* By conditions: the user's choice as made — which conditions colour (several: every
              combination its own colour), and which one, if any, fades them. Nothing inferred
              from the conditions' types. */}
          {!byCluster && (
            <ColorFadeFields
              active={active}
              numeric={numeric}
              picks={picks}
              fade={fade}
              onChange={(p, f) => update(clusterColorWrite(p, f))}
            />
          )}
          {/* The two cluster knobs only apply while the colours ARE clusters. */}
          {config.colorBy === CLUSTER_COLOR && (
            <>
              <Field
                label="cluster on"
                aside={<QuickToggle config={config} field="clusterOn" update={update} kind="pca" />}
              >
                <Select
                  value={config.clusterOn ?? 'coords'}
                  onChange={(v) => update({ clusterOn: v as ClusterConfig['clusterOn'] })}
                  options={[
                    { value: 'coords', label: 'plotted x/y' },
                    { value: 'features', label: 'all features' }
                  ]}
                />
              </Field>
              <div style={styles.hint}>
                {(config.clusterOn ?? 'coords') === 'coords'
                  ? 'Clusters what you see, so the colours always match the visual grouping — but it clusters a 2-D projection, so groups that overlap on screen merge.'
                  : 'Clusters the same high-dimensional data the embedding ran on, so the grouping is the real structure and is identical under PCA/UMAP/t-SNE — a cluster may then look split on screen.'}
              </div>
              <Field
                label="cluster count"
                aside={
                  <QuickToggle config={config} field="clusterCount" update={update} kind="pca" />
                }
              >
                <Select
                  value={config.clusterCount ?? 'fixed'}
                  onChange={(v) => update({ clusterCount: v as ClusterConfig['clusterCount'] })}
                  options={[
                    { value: 'fixed', label: 'fixed' },
                    { value: 'conditions', label: 'per condition' },
                    { value: 'auto', label: 'auto' }
                  ]}
                />
              </Field>
              {(config.clusterCount ?? 'fixed') === 'fixed' && (
                <Field label="clusters">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 90 }}>
                    <NumberInput
                      value={config.clusterK ?? 3}
                      step={1}
                      min={1}
                      max={24}
                      onChange={(v) =>
                        update({ clusterK: Math.max(1, Math.min(24, Math.round(v))) })
                      }
                    />
                  </div>
                </Field>
              )}
              {(config.clusterCount ?? 'fixed') === 'conditions' && (
                <div style={styles.hint}>
                  One group per distinct condition — asks whether the samples group the way the
                  design says they should.
                </div>
              )}
              {(config.clusterCount ?? 'fixed') === 'auto' && (
                <div style={styles.hint}>
                  Cuts the dendrogram at its largest gap, so the count follows the data. Convenient,
                  but it can change between datasets.
                </div>
              )}
            </>
          )}
        </CategoricalRows>
      }
    />
  )
}
/** The markers' look — the mark on show (replicate dots or centroids): size, opacity, outline
 *  width and colour ('auto' = the panel's). */
export function ClusterMarkerField({
  config,
  update,
  centroid
}: {
  config: ClusterConfig
  update: (patch: Record<string, unknown>) => void
  centroid: boolean
}): ReactNode {
  const st = clusterStyle(config)
  const { px } = styleBoxes(update)
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }
  const what = centroid ? 'Centroid' : 'Dot'
  return (
    <>
      <Field label="size">
        {centroid
          ? px('centroidSize', st.centroidSize, 'Centroid size (px)', 2, 30)
          : px('markerSize', st.markerSize, 'Dot size (px)', 2, 24)}
      </Field>
      <Field label="opacity">
        <OpacitySlider
          label={what}
          value={centroid ? st.centroidOpacity : st.markerOpacity}
          onChange={(v) => update({ [centroid ? 'centroidOpacity' : 'markerOpacity']: v })}
        />
      </Field>
      <Field label="outline">
        <div style={row}>
          {px('outlineWidth', st.outlineWidth ?? DEFAULT_OUTLINE, 'Outline width (px)', 0, 4)}
          <ColorChip
            color={st.outlineColor}
            on
            label="Outline colour"
            title={
              st.outlineColor === AUTO ? 'Outline colour: automatic (the panel)' : 'Outline colour'
            }
            onPick={(c) => update({ outlineColor: c })}
            onAuto={() => update({ outlineColor: AUTO })}
            autoLabel="Automatic (the panel)"
            autoColor={UI.panel}
          />
        </div>
      </Field>
    </>
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <ClusterPanel config={config as ClusterConfig} {...props} />
}
