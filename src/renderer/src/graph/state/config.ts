import {
  type ContrastStat,
  withLogTransform,
  snapStatMin,
  reclassifyContrast,
  previewOfResult,
  type ScalePreview,
  type ThresholdConfig
} from '../../engine'
import { withChildStatuses } from './shared'
import { resultHistory } from './shared'
import { reclassify } from './shared'
import { locationOf } from './shared'
import {
  isStep,
  type NodeConfig,
  type LoadConfig,
  resolveLoadMode,
  isComparisonKind,
  type CompareConfig,
  type EffectLabels,
  DEFAULT_EFFECT_LABELS,
  type CondUnits,
  declaredNumeric,
  type StandardizeConfig,
  type ContrastConfig,
  type PlotGroupConfig,
  plotResultKey
} from '../types'
import { type StoreSet, type Getter, type GraphState } from '../store'
import { NODE_SPECS, runsIn, wiredKindOf, loadAbove } from '../registry'
import { scalePreviews } from '../loadFiles'
import { hiddenGeneIds } from '../geneMask'
import { engine } from '../../engine/client'

/** …and per Clean data result, for a Clean data step fed by one (previewOfResult). */
export const resultPreviews = new WeakMap<object, ScalePreview>()
/** Tile settings: a node's (or a group subcard's) config, and the settings that patch results live (a Compare's threshold, a Contrast's statistic) or are display-only. */
export function configSlice(
  set: StoreSet,
  get: Getter
): Pick<
  GraphState,
  | 'updateConfig'
  | 'setCompareEffectLabels'
  | 'setCurveMethod'
  | 'setLoadUnits'
  | 'setLoadNumeric'
  | 'previewStdScale'
  | 'setStdLogTransform'
  | 'setCompareThreshold'
  | 'setContrastStat'
  | 'applyConfigToKind'
  | 'updateChildConfig'
> {
  return {
    updateConfig: (id, partial) => {
      get().commit()
      const before = get().nodes.find((n) => n.id === id)
      const prevConfig = before && isStep(before) ? before.data.config : undefined
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n)
            ? { ...n, data: { ...n.data, config: { ...n.data.config, ...partial } as NodeConfig } }
            : n
        )
      }))
      // A runnable node goes stale on a config change — a step on any; a plot only on one outside
      // what its run computed (its spec's staleOn; view settings just re-render).
      const kind = get().nodeKind(id)
      const spec = kind ? NODE_SPECS[kind] : undefined
      const after = get().nodes.find((n) => n.id === id)
      // A Subset off Load data has no run (runsIn): like Load data, its edit stales what's below.
      if (kind === 'subset' && !runsIn(get(), id)) get().invalidateDownstream(id)
      // Load data has no run either: another file picked puts what reads it out of date (manual
      // mode — an interactive tile's re-conversion does so itself), and the tile is checked again
      // (an interactive one re-converts a newly picked raw file — see checkLoad).
      if (kind === 'load' && prevConfig) {
        const was = prevConfig as LoadConfig
        const now = { ...was, ...partial } as LoadConfig
        const files = (['data', 'samplesheet', 'db'] as const).some((f) => was[f] !== now[f])
        if (files && resolveLoadMode(now) === 'manual') get().invalidateDownstream(id)
        if (files || was.matrix !== now.matrix) void get().checkLoad(id)
      }
      const stale =
        !!spec?.hasRun &&
        runsIn(get(), id) &&
        (!spec.staleOn ||
          (!!prevConfig &&
            !!after &&
            isStep(after) &&
            spec.staleOn(after.data.config, prevConfig, get().results[id])))
      if (stale) {
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id && isStep(n)
              ? { ...n, data: { ...n.data, status: 'idle', error: undefined } }
              : n
          )
        }))
        const results = { ...get().results }
        delete results[id]
        set({ results })
        get().invalidateDownstream(id)
        // A cluster's run settings changed from the tile's switches: run it again at once (in the
        // worker), as the switch implies — rather than leave the tile on "Not run yet".
        if (kind === 'pca' && before && isStep(before) && before.data.status === 'done')
          void get().runNode(id)
      }
    },

    setCompareEffectLabels: (id, labels) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isStep(node) || !isComparisonKind(node.data.kind)) return
      const cfg = node.data.config as CompareConfig
      const effectLabels: EffectLabels = {
        ...DEFAULT_EFFECT_LABELS,
        ...cfg.effectLabels,
        ...labels
      }
      get().commit()
      // Display-only, so patch the config directly (updateConfig would stale the compare).
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n)
            ? { ...n, data: { ...n.data, config: { ...cfg, effectLabels } as NodeConfig } }
            : n
        ),
        dirty: true
      }))
    },
    setCurveMethod: (id, method) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isStep(node) || !isComparisonKind(node.data.kind)) return
      const cfg = node.data.config as CompareConfig
      if (cfg.curveMethod === method) return
      get().commit()
      // Display-only, so patch the config directly (updateConfig would stale the curve fit).
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n)
            ? { ...n, data: { ...n.data, config: { ...cfg, curveMethod: method } as NodeConfig } }
            : n
        ),
        dirty: true
      }))
    },
    setLoadUnits: (id, units) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isStep(node) || node.data.kind !== 'load') return
      const cfg = node.data.config as LoadConfig
      const next: CondUnits = { ...cfg.units, ...units }
      const was: Record<string, string | undefined> = cfg.units ?? {}
      if (Object.entries(next).every(([c, v]) => v === was[c])) return
      get().commit()
      // Display-only, so patch the config directly (updateConfig would stale everything below).
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n)
            ? { ...n, data: { ...n.data, config: { ...cfg, units: next } as NodeConfig } }
            : n
        ),
        dirty: true
      }))
    },
    setLoadNumeric: (id, name, numeric, opts) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isStep(node) || node.data.kind !== 'load') return
      const cfg = node.data.config as LoadConfig
      const was = declaredNumeric(cfg)
      if (was.includes(name) === numeric) return
      const next = numeric ? [...was, name] : was.filter((n) => n !== name)
      // the one declaration on the tile (kept, even empty, so an older import's copy no longer reads)
      const config: LoadConfig = { ...cfg, numericConditions: next }
      if (cfg.interactive?.numericConditions) {
        const { numericConditions: _legacy, ...rest } = cfg.interactive
        void _legacy
        config.interactive = rest
      }
      get().commit()
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n) ? { ...n, data: { ...n.data, config: config as NodeConfig } } : n
        ),
        dirty: true
      }))
      // Load has no run of its own: what reads it (Clean data and below) goes stale
      if (opts?.stale !== false) get().invalidateDownstream(id)
    },
    previewStdScale: async (id) => {
      const state = get()
      const up = state.upstreamId(id)
      if (up && wiredKindOf(state, up) === 'standardize') {
        const r = state.results[up]
        if (r?.kind !== 'standardize') return null
        let p = resultPreviews.get(r.std)
        if (!p) resultPreviews.set(r.std, (p = previewOfResult(r.std)))
        return p
      }
      const load = (loadAbove(state, id)?.load.data.config as LoadConfig | undefined) ?? null
      const dir = state.dataDir
      if (!load?.data || !dir) return null
      const wf = locationOf(state)?.scope
      const key = `${dir}|${wf?.base ?? ''}|${load.data}`
      const hit = scalePreviews.get(key)
      if (hit) return hit
      const text = await window.api.readDataFile(dir, load.data, wf)
      if (text == null) return null
      const preview = await engine.previewScale(text, load.data)
      scalePreviews.set(key, preview)
      return preview
    },
    setStdLogTransform: (id, logTransform) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isStep(node) || node.data.kind !== 'standardize') return
      const cfg = node.data.config as StandardizeConfig
      get().commit()
      // Its own result isn't re-run: its rows are linear whatever the choice, so it's only re-stamped
      // with the scale it's now presented on (withLogTransform) — what everything it feeds reads.
      // But a Compare tests on that scale (logged or not), so whatever was computed downstream is
      // stale. (An undo restores the result as it was: the config differs, so its recorded version
      // comes back — see undoResults.ts.)
      set((s) => {
        const res = s.results[id]
        return {
          nodes: s.nodes.map((n) =>
            n.id === id && isStep(n)
              ? { ...n, data: { ...n.data, config: { ...cfg, logTransform } as NodeConfig } }
              : n
          ),
          ...(res?.kind === 'standardize'
            ? {
                results: {
                  ...s.results,
                  [id]: { ...res, std: withLogTransform(res.std, logTransform) }
                }
              }
            : null),
          dirty: true
        }
      })
      if ((cfg.logTransform ?? 'none') !== logTransform) get().invalidateDownstream(id)
    },
    setCompareThreshold: (id, partial) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isStep(node) || !isComparisonKind(node.data.kind)) return
      const cur = (node.data.config as CompareConfig).threshold
      // Snap dragged values to what the panel shows: fold changes to 2 decimals, the stat cutoff so
      // its p-value is 3 decimals — the guide then reads as the number the user sees in the config.
      const r2 = (v: number): number => Math.round(v * 100) / 100
      const snapped: Partial<ThresholdConfig> = { ...partial }
      if (snapped.fcLow != null) snapped.fcLow = r2(snapped.fcLow)
      if (snapped.fcHigh != null) snapped.fcHigh = r2(snapped.fcHigh)
      if (snapped.s0 != null) snapped.s0 = r2(snapped.s0)
      if (snapped.s0Down != null) snapped.s0Down = r2(snapped.s0Down)
      if (snapped.statMin != null) snapped.statMin = snapStatMin(snapped.statMin)
      const threshold: ThresholdConfig = { ...cur, ...snapped }
      // Symmetric mode: the down cutoff follows the up one (fcLow = −fcHigh, s0Down = s0), so the
      // engine and every plot can read the raw fields without knowing about the switch. When the
      // user moved the DOWN side (e.g. dragged the left line), take that as the magnitude instead.
      if (!threshold.asymmetric) {
        const mag =
          snapped.fcLow != null && snapped.fcHigh == null
            ? Math.abs(snapped.fcLow)
            : Math.abs(threshold.fcHigh)
        threshold.fcHigh = mag
        threshold.fcLow = -mag
        if (snapped.s0Down != null && snapped.s0 == null) threshold.s0 = snapped.s0Down
        delete threshold.s0Down
      }
      // No-op guard: dragging that lands back on the same value shouldn't spawn an undo step or
      // needlessly stale a downstream contrast. Every field is compared (not a list that a new
      // setting could be missing from).
      const fields = new Set([...Object.keys(threshold), ...Object.keys(cur)]) as Set<
        keyof ThresholdConfig
      >
      if ([...fields].every((k) => threshold[k] === cur[k])) return
      get().commit()
      // Patch the threshold on the Compare config WITHOUT going through updateConfig — the statistics
      // are unchanged, so the compare must stay `done` (updateConfig would stale it and force a re-run).
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n)
            ? {
                ...n,
                data: {
                  ...n.data,
                  config: { ...(n.data.config as CompareConfig), threshold } as NodeConfig
                }
              }
            : n
        )
      }))
      // Re-classify the stored result rows in place: only thrsh/signf/effect depend on the threshold
      // (log2FC, pP, pQ are already final). Cheap enough to run synchronously on the UI thread.
      // Re-classify the stored result rows: only the calls depend on the threshold (log2FC, pP, pQ
      // are already final). Cheap enough to run synchronously on the UI thread.
      const res = get().results[id]
      if (res?.kind === 'compare') {
        const next = reclassify(res, threshold, hiddenGeneIds(get()))
        resultHistory.derive(next, res) // same statistics: one version in the undo history
        set((s) => ({ results: { ...s.results, [id]: next } }))
      }
      // Everything downstream follows the new calls without a manual Run. A Contrast below masks by
      // the compare's per-gene call, so its result is stale now: cleared at once (never taken for
      // current meanwhile — by an undo either) and re-run. The plots aren't cleared — those drawn
      // straight from this result redraw live, and the ones whose run depends on the calls
      // (enrichment, STRING) recompute in place.
      get().invalidateDownstream(id, true)
      void get().refreshDownstream(id)
    },

    setContrastStat: (id, partial) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isStep(node) || node.data.kind !== 'contrast') return
      const cfg = node.data.config as ContrastConfig
      const cur: ContrastStat = cfg.stat ?? {}
      const stat: ContrastStat = { ...cur, ...partial }
      // No-op guard, as a Compare drag's: landing back on the same cutoffs is no change (no undo
      // step, nothing staled).
      if (JSON.stringify(stat) === JSON.stringify(cur)) return
      get().commit()
      const res = get().results[id]
      const next =
        res?.kind === 'contrast' ? reclassifyContrast(res.ctr, cfg.relationship, stat) : null
      if (!next) {
        // An older result (or none) can't be re-called in place: save the cutoffs and re-run.
        get().updateConfig(id, { stat })
        void get().rerunFrom(id)
        return
      }
      // Patch the cutoffs WITHOUT updateConfig — the per-side values are unchanged, so the contrast
      // stays `done` (updateConfig would stale it and force a re-run) — and keep the re-called rows.
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n)
            ? { ...n, data: { ...n.data, config: { ...cfg, stat } as NodeConfig } }
            : n
        ),
        results:
          res?.kind === 'contrast' ? { ...s.results, [id]: { ...res, ctr: next } } : s.results
      }))
      // As a Compare drag: steps below go stale at once, then everything downstream re-runs.
      get().invalidateDownstream(id, true)
      void get().refreshDownstream(id)
    },

    applyConfigToKind: (kind, config, exceptId) => {
      get().commit()
      // The settings a plot tile carries are display-only (look, axes, caps), so this never touches
      // results or stales anything downstream — it's a restyle of every tile of that kind.
      const look = { ...config }
      delete look.axis // a dose tile stays a dose tile; only its look travels
      set((s) => ({
        nodes: s.nodes.map((n) => {
          if (!isStep(n)) return n
          if (n.data.kind === kind && n.id !== exceptId)
            return {
              ...n,
              data: { ...n.data, config: { ...n.data.config, ...look } as NodeConfig }
            }
          if (n.data.kind !== 'plotGroup') return n
          const cfg = n.data.config as PlotGroupConfig
          if (!cfg.children.some((c) => c.kind === kind && c.id !== exceptId)) return n
          return {
            ...n,
            data: {
              ...n.data,
              // the group's own settings (its fold) kept — only its subcards change
              config: {
                ...cfg,
                children: cfg.children.map((c) =>
                  c.kind === kind && c.id !== exceptId
                    ? { ...c, config: { ...c.config, ...look } as NodeConfig }
                    : c
                )
              }
            }
          }
        }),
        dirty: true
      }))
    },
    updateChildConfig: (groupId, childId, partial) => {
      get().commit()
      // Children are plot subcards: a setting re-renders live, unless it's outside what the plot's run
      // computed (its spec's staleOn) — then its result is cleared and it must run again.
      const group = get().nodes.find((n) => n.id === groupId)
      const prev =
        group && isStep(group) && group.data.kind === 'plotGroup'
          ? (group.data.config as PlotGroupConfig).children.find((c) => c.id === childId)
          : undefined
      set((s) => ({
        nodes: s.nodes.map((n) => {
          if (n.id !== groupId || !isStep(n) || n.data.kind !== 'plotGroup') return n
          const cfg = n.data.config as PlotGroupConfig
          return {
            ...n,
            data: {
              ...n.data,
              // the group's own settings (its fold) kept — only the subcard changes
              config: {
                ...cfg,
                children: cfg.children.map((c) =>
                  c.id === childId ? { ...c, config: { ...c.config, ...partial } as NodeConfig } : c
                )
              }
            }
          }
        })
      }))
      if (!prev) return
      const key = plotResultKey(groupId, childId)
      const next = { ...prev.config, ...partial } as NodeConfig
      if (!NODE_SPECS[prev.kind].staleOn?.(next, prev.config, get().results[key])) return
      const results = { ...get().results }
      delete results[key]
      set((s) => ({
        results,
        nodes: s.nodes.map((n) =>
          n.id === groupId && isStep(n)
            ? withChildStatuses(n, (c) =>
                c.id === childId
                  ? { status: 'idle' }
                  : { status: c.status ?? 'idle', error: c.error }
              )
            : n
        )
      }))
      // A cluster's run settings changed: run it again at once (see updateConfig).
      if (prev.kind === 'pca' && prev.status === 'done') void get().runPlotChild(groupId, childId)
    }
  }
}
