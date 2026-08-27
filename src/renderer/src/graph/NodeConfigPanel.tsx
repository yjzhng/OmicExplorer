import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import {
  crossPairs,
  facetContextDims,
  previewCompare,
  previewTwoWay,
  type ConditionKey,
  type Pair,
  type StandardizeResult
} from '../engine'
import { UI } from '../ui/theme'
import { ComparisonDialog } from './ComparisonDialog'
import { InteractiveImportDialog } from './InteractiveImportDialog'
import { DEFAULT_FOCUS } from './focus'
import { accentOf, categoryOf, CATEGORIES, NODE_SPECS } from './registry'
import { useGraph } from './store'
import {
  isCompareConfigured,
  isStep,
  normalizeCompareConfig,
  resolveLoadMode,
  type BarConfig,
  type BubbleConfig,
  type CompareConfig,
  type ContrastConfig,
  type DRConfig,
  type DumbbellConfig,
  type FocusConfig,
  type HeatmapConfig,
  type LoadConfig,
  type MAConfig,
  type NodeConfig,
  type NodeKind,
  type NodeResult,
  type ClusterConfig,
  type CorrConfig,
  type PlotChild,
  type PlotGroupConfig,
  type QcConfig,
  type ScatterConfig,
  type StandardizeConfig,
  type TdrConfig,
  type VolcanoConfig
} from './types'

type GeneOption = { value: string; label: string }

/** Gene picker options (uniqID → display label) from a result's rows. */
function geneOptionsFromResult(r: NodeResult | undefined): GeneOption[] {
  if (!r) return []
  const dm = r.kind === 'standardize' ? r.std.displayMap : r.displayMap
  const rows =
    r.kind === 'standardize' ? r.std.rows : r.kind === 'compare' ? r.cmp.rows : r.ctr.rows
  const ids = [...new Set(rows.map((x) => x.uniqID))]
  return ids
    .map((id) => ({ value: id, label: dm[id] ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Gene universe for a node's pickers: its own result if it produces one (Standardize),
 *  else its upstream result (a plot's comparison/contrast/standardize input). */
function useGeneOptions(id: string): GeneOption[] {
  const result = useGraph((s) => {
    const own = s.results[id]
    if (own?.kind === 'standardize') return own
    const upId = s.edges.find((e) => e.target === id)?.source
    return upId ? s.results[upId] : undefined
  })
  return useMemo(() => geneOptionsFromResult(result), [result])
}

const CONDS: ConditionKey[] = ['strain', 'cmpd', 'dose', 'time']

/** The plotting ops a group subcard can be (everything in the plotting category except
 *  the group container itself — groups don't nest). */
const GROUP_CHILD_OPS: NodeKind[] = CATEGORIES.plotting.ops

/** Subcard switcher + add/remove for a group tile, shown above the active child's config. */
function GroupChildManager({ groupId, activeId }: { groupId: string; activeId: string }) {
  const children = useGraph((s) => {
    const g = s.nodes.find((n) => n.id === groupId)
    return g && isStep(g) && g.data.kind === 'plotGroup'
      ? (g.data.config as PlotGroupConfig).children
      : []
  })
  const selectChildCard = useGraph((s) => s.selectChildCard)
  const addGroupChild = useGraph((s) => s.addGroupChild)
  const removeGroupChild = useGraph((s) => s.removeGroupChild)
  const accent = accentOf('plotting')
  return (
    <Section title="Subcards">
      <div style={styles.subTabs}>
        {children.map((c) => {
          const on = c.id === activeId
          return (
            <button
              key={c.id}
              onClick={() => selectChildCard(groupId, c.id)}
              style={{
                ...styles.subTab,
                borderColor: on ? accent : UI.border,
                background: on ? UI.panelAlt : 'transparent'
              }}
            >
              {NODE_SPECS[c.kind].label}
            </button>
          )
        })}
      </div>
      <div style={styles.subActions}>
        <Select
          value=""
          onChange={(v) => v && addGroupChild(groupId, v as NodeKind)}
          options={[
            { value: '', label: '+ add plot…' },
            ...GROUP_CHILD_OPS.map((o) => ({ value: o, label: NODE_SPECS[o].label }))
          ]}
        />
        <button
          style={{ ...styles.iconBtnSm, color: '#f2b8b9', borderColor: '#7a3a3f' }}
          title={
            children.length > 1
              ? 'Remove this subcard'
              : 'Remove the last subcard (deletes the group)'
          }
          onClick={() => removeGroupChild(groupId, activeId)}
        >
          ✕
        </button>
      </div>
    </Section>
  )
}

/** The config sub-panel for one plotting op, with its updater/focus already bound so it
 *  serves both a standalone plot node and a group subcard. */
function PlotConfig({
  kind,
  config,
  update,
  focusNodeId
}: {
  kind: NodeKind
  config: NodeConfig
  update: (patch: Record<string, unknown>) => void
  focusNodeId: string
}): ReactNode {
  const props = { update, focusNodeId }
  switch (kind) {
    case 'volcano':
      return <VolcanoPanel config={config as VolcanoConfig} {...props} />
    case 'heatmap':
      return <HeatmapPanel config={config as HeatmapConfig} {...props} />
    case 'scatter':
      return <ScatterPanel config={config as ScatterConfig} {...props} />
    case 'dumbbell':
      return <DumbbellPanel config={config as DumbbellConfig} {...props} />
    case 'ma':
      return <MAPanel config={config as MAConfig} {...props} />
    case 'dr':
      return <DRPanel config={config as DRConfig} {...props} />
    case 'bubble':
      return <BubblePanel config={config as BubbleConfig} {...props} />
    case 'tdr':
      return <TdrPanel config={config as TdrConfig} {...props} />
    case 'geneBar':
      return <GeneBarPanel config={config as BarConfig} {...props} />
    case 'pca':
      return <ClusterPanel config={config as ClusterConfig} {...props} />
    case 'qc':
      return <QcPanel config={config as QcConfig} {...props} />
    case 'corr':
      return <CorrPanel config={config as CorrConfig} {...props} />
    default:
      return null
  }
}

/** Floating config popover for a single node (anchored to its right via NodeToolbar).
 *  A `plotGroup` shows its active subcard's config (chosen on the tile / via `selectedSub`). */
export function NodeConfigPanel({ id }: { id: string }) {
  const node = useGraph((s) => s.nodes.find((n) => n.id === id))
  const selectedSub = useGraph((s) => s.selectedSub)
  const deleteNode = useGraph((s) => s.deleteNode)
  const duplicateNode = useGraph((s) => s.duplicateNode)
  const changeOp = useGraph((s) => s.changeOp)
  const updateConfig = useGraph((s) => s.updateConfig)
  const updateChildConfig = useGraph((s) => s.updateChildConfig)

  if (!node || !isStep(node)) return null
  const kind = node.data.kind
  const isGroup = kind === 'plotGroup'
  const children = isGroup ? (node.data.config as PlotGroupConfig).children : []
  const activeChild: PlotChild | undefined = isGroup
    ? (children.find((c) => c.id === selectedSub) ?? children[0])
    : undefined

  // For a group the header/accent follow the active subcard; else the node's own op.
  const headKind = activeChild?.kind ?? kind
  const category = categoryOf(headKind)
  const spec = NODE_SPECS[headKind]
  const ops = CATEGORIES[category].ops

  return (
    <div style={styles.panel}>
      <div style={{ ...styles.head, borderTopColor: accentOf(category) }}>
        <div style={styles.headText}>
          <span style={{ ...styles.headCat, color: accentOf(category) }}>
            {CATEGORIES[category].label}
          </span>
          <span style={styles.headTitle}>{isGroup ? `Group · ${spec.label}` : spec.label}</span>
          <span style={styles.headId}>{node.id}</span>
        </div>
        <div style={styles.headActions}>
          <button style={styles.iconBtnSm} title="Duplicate" onClick={() => duplicateNode(id)}>
            ⧉
          </button>
          <button
            style={{ ...styles.iconBtnSm, color: '#f2b8b9', borderColor: '#7a3a3f' }}
            title="Delete"
            onClick={() => deleteNode(id)}
          >
            ✕
          </button>
        </div>
      </div>
      <div style={styles.scroll}>
        {isGroup ? (
          activeChild ? (
            <GroupChildManager groupId={id} activeId={activeChild.id} />
          ) : (
            <div style={styles.hint}>Empty group.</div>
          )
        ) : (
          ops.length > 1 && (
            <Section title="Operation">
              <Field label="type">
                <Select
                  value={kind}
                  onChange={(v) => changeOp(id, v as NodeKind)}
                  options={ops.map((o) => ({ value: o, label: NODE_SPECS[o].label }))}
                />
              </Field>
            </Section>
          )
        )}
        {kind === 'load' && <LoadPanel id={id} config={node.data.config as LoadConfig} />}
        {kind === 'standardize' && (
          <StandardizePanel id={id} config={node.data.config as StandardizeConfig} />
        )}
        {kind === 'compare' && <ComparePanel id={id} config={node.data.config as CompareConfig} />}
        {kind === 'contrast' && (
          <ContrastPanel id={id} config={node.data.config as ContrastConfig} />
        )}
        {/* Standalone plot node: its own config bound to updateConfig. */}
        {!isGroup && (
          <PlotConfig
            kind={kind}
            config={node.data.config}
            update={(p) => updateConfig(id, p)}
            focusNodeId={id}
          />
        )}
        {/* Group subcard: the active child's config, bound to updateChildConfig, focus via
            the group's edge. */}
        {isGroup && activeChild && (
          <PlotConfig
            kind={activeChild.kind}
            config={activeChild.config}
            update={(p) => updateChildConfig(id, activeChild.id, p)}
            focusNodeId={id}
          />
        )}
      </div>
    </div>
  )
}

// ── per-kind panels ─────────────────────────────────────────────────────────────

function LoadPanel({ id, config }: { id: string; config: LoadConfig }) {
  const update = useGraph((s) => s.updateConfig)
  const inputFiles = useGraph((s) => s.inputFiles)
  const refreshDataFiles = useGraph((s) => s.refreshDataFiles)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [refreshState, setRefreshState] = useState<'idle' | 'busy' | 'done'>('idle')
  const opts = [{ value: '', label: '—' }, ...inputFiles.map((f) => ({ value: f, label: f }))]
  // Effective mode (tolerates legacy/unset values so a chip is always selected — see
  // resolveLoadMode); a fresh tile defaults to interactive.
  const mode = resolveLoadMode(config)
  // Interactive import is set up once the standard files have been generated (config.data set).
  const converted = !!config.data
  const doRefresh = async () => {
    if (refreshState === 'busy') return
    setRefreshState('busy')
    await refreshDataFiles()
    setRefreshState('done')
    window.setTimeout(() => setRefreshState('idle'), 1400)
  }
  const refreshLabel =
    refreshState === 'busy' ? 'Refreshing…' : refreshState === 'done' ? '✓ Refreshed' : '⟳ Refresh'
  return (
    <>
      {/* Import mode: Manual = pick the three standard files; Interactive = pick one raw data
          matrix and configure samples in a dialog, which materializes the standard files. */}
      <Section title="Import mode">
        <div style={styles.subTabs}>
          {(['interactive', 'manual'] as const).map((m) => {
            const on = m === mode
            return (
              <button
                key={m}
                onClick={() => update(id, { mode: m })}
                style={{
                  ...styles.subTab,
                  background: on ? UI.accent : 'transparent',
                  color: on ? UI.accentText : UI.text,
                  borderColor: on ? UI.accent : UI.border
                }}
              >
                {m === 'manual' ? 'Manual' : 'Interactive'}
              </button>
            )
          })}
        </div>
        <div style={styles.hint}>
          {mode === 'manual'
            ? 'Provide the three standard input files.'
            : 'Provide one data matrix; configure samples to generate the standard files.'}
        </div>
      </Section>

      <Section
        title={mode === 'manual' ? 'Input files' : 'Input file'}
        action={
          <button
            style={{
              ...styles.chip,
              ...(refreshState === 'done' ? styles.chipDone : null),
              opacity: refreshState === 'busy' ? 0.6 : 1
            }}
            disabled={refreshState === 'busy'}
            onClick={() => void doRefresh()}
          >
            {refreshLabel}
          </button>
        }
      >
        {mode === 'manual' ? (
          <>
            <div style={styles.hint}>Choose from files in the project&apos;s data folder.</div>
            <Field label="data">
              <Select
                value={config.data ?? ''}
                onChange={(v) => update(id, { data: v || null })}
                options={opts}
              />
            </Field>
            <Field label="samplesheet">
              <Select
                value={config.samplesheet ?? ''}
                onChange={(v) => update(id, { samplesheet: v || null })}
                options={opts}
              />
            </Field>
            <Field label="ID map">
              <Select
                value={config.db ?? ''}
                onChange={(v) => update(id, { db: v || null })}
                options={opts}
              />
            </Field>
          </>
        ) : (
          <>
            <div style={styles.hint}>Choose the data matrix from the data folder.</div>
            <Field label="raw data">
              <Select
                value={config.matrix ?? ''}
                onChange={(v) => update(id, { matrix: v || null })}
                options={opts}
              />
            </Field>
            <div
              style={{
                ...styles.hint,
                marginBottom: 0,
                color: converted ? '#3fae5a' : '#e2b93b'
              }}
            >
              {converted
                ? `✓ Ready · generated ${config.data}`
                : '⚠ Not configured — pipeline blocked'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                style={{ ...styles.btn, opacity: config.matrix ? 1 : 0.5 }}
                disabled={!config.matrix}
                onClick={() => setDialogOpen(true)}
              >
                {converted ? 'Edit samples…' : 'Configure samples…'}
              </button>
            </div>
            {dialogOpen && <InteractiveImportDialog id={id} onClose={() => setDialogOpen(false)} />}
          </>
        )}
      </Section>
    </>
  )
}

function StandardizePanel({ id, config }: { id: string; config: StandardizeConfig }) {
  const update = useGraph((s) => s.updateConfig)
  const options = useGeneOptions(id)
  const std = useGraph((s) => {
    const r = s.results[id]
    return r?.kind === 'standardize' ? r.std : null
  })
  const active = config.activeConditions ?? CONDS
  // Interactive-import conditions from the upstream Load tile (if any) — lets us grey out absent
  // conditions BEFORE the node runs. Stable reference so the presence memo doesn't churn.
  const upConditions = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === id)?.source
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    if (up && isStep(up) && up.data.kind === 'load') {
      return (up.data.config as LoadConfig).interactive?.conditions ?? null
    }
    return null
  })
  // Which conditions actually carry values (computed independently of the user's active selection,
  // mirroring the engine's presence test). Prefer the standardized result once the node has run;
  // before that, fall back to the upstream interactive samplesheet so absent conditions grey out
  // immediately. null only when neither is available (a manual load that hasn't run yet).
  // Memoized — these scan every row, so they must not re-run on each config edit.
  const present = useMemo(() => {
    if (std)
      return new Set(
        CONDS.filter((c) =>
          c === 'strain' || c === 'cmpd'
            ? std.rows.some((r) => r[c] !== '')
            : std.rows.some((r) => r[c] != null)
        )
      )
    if (upConditions) {
      const vals = Object.values(upConditions)
      return new Set(CONDS.filter((c) => vals.some((v) => String(v[c] ?? '').trim() !== '')))
    }
    return null
  }, [std, upConditions])
  const geneTotal = useMemo(
    () => (std ? new Set(std.rows.map((r) => r.uniqID)).size : 0),
    [std]
  )
  const toggle = (c: ConditionKey) => {
    const set = new Set(active)
    if (set.has(c)) set.delete(c)
    else set.add(c)
    const list = CONDS.filter((x) => set.has(x))
    update(id, { activeConditions: list.length === CONDS.length ? null : list })
  }
  return (
    <>
      <Section title="Active conditions">
        <div style={styles.hint}>Conditions absent from the data are greyed out (auto-ignored).</div>
        {CONDS.map((c) => {
          const avail = present ? present.has(c) : true
          return (
            <Checkbox
              key={c}
              label={c}
              checked={avail && active.includes(c)}
              disabled={!avail}
              title={avail ? undefined : 'No values for this condition in the data'}
              onChange={() => toggle(c)}
            />
          )
        })}
      </Section>
      <Section title="Clean-up">
        <div style={styles.hint}>
          Drop genes identified in fewer than this share of samples (0 keeps everything).
        </div>
        <Field label="Min. samples %">
          <NumberInput
            value={config.minSamplePct ?? 0}
            step={5}
            min={0}
            max={100}
            onChange={(v) =>
              update(id, { minSamplePct: Math.min(100, Math.max(0, Math.round(v))) })
            }
          />
        </Field>
        {std && (std.cleanup?.droppedGenes ?? 0) > 0 && (
          <div style={styles.hint}>
            Dropped {std.cleanup.droppedGenes.toLocaleString()} of{' '}
            {(std.cleanup.droppedGenes + geneTotal).toLocaleString()} genes below{' '}
            {std.cleanup.minSamplePct}% of {std.cleanup.sampleCount} samples.
          </div>
        )}
      </Section>
      <Section title="Focus genes">
        <div style={styles.hint}>Master sets inherited by downstream plots set to “inherit”.</div>
        <GeneSets
          goi={config.goi ?? []}
          panel={config.panel ?? []}
          options={options}
          onChange={(patch) => update(id, patch)}
        />
      </Section>
    </>
  )
}

/** How many comparisons the configured comparison would run (a dry-run count for the ready
 *  message): distinct num|den labels for an explicit compare, or the interaction groups for a
 *  two-way ANOVA. Null if it can't be determined (not configured / incomplete). */
function comparisonCount(std: StandardizeResult, config: CompareConfig): number | null {
  try {
    if (config.analysis === 'two_way_anova') {
      // Level pairs from the multi-select num/den values (legacy single fields as fallback).
      const factorPairs = (c: ConditionKey, n1: string, d1: string): Pair[] => {
        const cross = crossPairs(config.num[c] ?? [], config.den[c] ?? [])
        return cross.length > 0 ? cross : n1 && d1 ? [[n1, d1]] : []
      }
      const p1 = factorPairs(config.condition, config.pairNum, config.pairDen)
      const p2 = factorPairs(config.condition2, config.pair2Num, config.pair2Den)
      if (p1.length === 0 || p2.length === 0) return null
      return previewTwoWay({
        rows: std.rows,
        factors: [
          { condition: config.condition, pairs: p1 },
          { condition: config.condition2, pairs: p2 }
        ],
        activeConditions: std.activeConditions
      }).groups
    }
    return previewCompare({
      rows: std.rows,
      num: config.num,
      den: config.den,
      match: config.match,
      activeConditions: std.activeConditions
    }).labels.length
  } catch {
    return null
  }
}

function ComparePanel({ id, config: rawConfig }: { id: string; config: CompareConfig }) {
  const config = normalizeCompareConfig(rawConfig)
  const configured = isCompareConfigured(config)
  const update = useGraph((s) => s.updateConfig)
  const [dialogOpen, setDialogOpen] = useState(false)
  const std = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === id)?.source
    const r = upId ? s.results[upId] : undefined
    return r?.kind === 'standardize' ? r.std : null
  })

  const t = config.threshold
  const setT = (partial: Partial<CompareConfig['threshold']>) =>
    update(id, { threshold: { ...t, ...partial } })

  // Only the comparison-defining fields change the count — NOT threshold/transform. Keying the
  // memo on those (references stay stable when only the threshold changes) avoids re-running the
  // O(rows) previewCompare dry-run on every unrelated edit, which stalled on large data.
  const nComparisons = useMemo(
    () => (std && configured ? comparisonCount(std, config) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      std,
      configured,
      config.analysis,
      config.num,
      config.den,
      config.match,
      config.condition,
      config.condition2,
      config.pairNum,
      config.pairDen,
      config.pair2Num,
      config.pair2Den
    ]
  )
  const readyMsg =
    nComparisons != null
      ? `✓ Ready, ${nComparisons} comparison${nComparisons === 1 ? '' : 's'} configured interactively`
      : '✓ Ready, configured interactively'

  return (
    <>
      <Section title="Comparison">
        <button
          style={styles.configBtn}
          disabled={!std}
          title={std ? undefined : 'Run the upstream Standardize first'}
          onClick={() => setDialogOpen(true)}
        >
          Configure comparison…
        </button>
        <div style={{ ...styles.compareSummary, color: configured ? '#3fae5a' : '#e2b93b' }}>
          {configured ? readyMsg : '⚠ Not configured — pipeline blocked'}
        </div>
        {dialogOpen && std && (
          <ComparisonDialog id={id} config={config} std={std} onClose={() => setDialogOpen(false)} />
        )}
        <Checkbox
          label="log2-transform before testing"
          checked={config.transform}
          onChange={(v) => update(id, { transform: v })}
        />
      </Section>
      <Section title="Threshold">
        <Field label="significance">
          <Select
            value={t.statType}
            onChange={(v) => setT({ statType: v as 'pP' | 'pQ' })}
            options={[
              { value: 'pP', label: 'pP (raw p)' },
              { value: 'pQ', label: 'pQ (FDR)' }
            ]}
          />
        </Field>
        <Field label="curve">
          <Select
            value={t.type}
            onChange={(v) => setT({ type: v as 'linear' | 'non-linear' })}
            options={[
              { value: 'linear', label: 'linear' },
              { value: 'non-linear', label: 'SAM (non-linear)' }
            ]}
          />
        </Field>
        {t.type === 'linear' ? (
          <>
            <Field label="FC low">
              <NumberInput value={t.fcLow} step={0.1} onChange={(v) => setT({ fcLow: v })} />
            </Field>
            <Field label="FC high">
              <NumberInput value={t.fcHigh} step={0.1} onChange={(v) => setT({ fcHigh: v })} />
            </Field>
            <Field label="stat min">
              <NumberInput value={t.statMin} step={0.1} onChange={(v) => setT({ statMin: v })} />
            </Field>
          </>
        ) : (
          <>
            <Field label="stat min">
              <NumberInput value={t.statMin} step={0.1} onChange={(v) => setT({ statMin: v })} />
            </Field>
            <Field label="b">
              <NumberInput value={t.b} step={0.1} onChange={(v) => setT({ b: v })} />
            </Field>
            <Field label="s0">
              <NumberInput value={t.s0} step={0.05} onChange={(v) => setT({ s0: v })} />
            </Field>
          </>
        )}
      </Section>
    </>
  )
}

function ContrastPanel({ id, config }: { id: string; config: ContrastConfig }) {
  const update = useGraph((s) => s.updateConfig)
  // Pool every upstream comparison's rows (omicViz pools all primaries), then offer the
  // conditions they carry and each condition's levels. Select only the *stable* store
  // slices and derive in a memo — building the array inside the selector would return a
  // fresh reference on every call, fail Zustand's equality check and loop forever.
  const edges = useGraph((s) => s.edges)
  const results = useGraph((s) => s.results)
  const { conds, levels } = useMemo(() => {
    const rows: Array<Record<string, unknown>> = edges
      .filter((e) => e.target === id)
      .map((e) => results[e.source])
      .flatMap((r) =>
        r?.kind === 'compare' ? (r.cmp.rows as unknown as Array<Record<string, unknown>>) : []
      )
    const m = {} as Record<ConditionKey, string[]>
    for (const c of CONDS) {
      const seen = new Set<string>()
      for (const row of rows) {
        const v = row[c]
        if (v === '' || v == null) continue
        seen.add(String(v))
      }
      m[c] = [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    }
    // Only conditions with ≥2 levels can be contrasted.
    return { conds: CONDS.filter((c) => m[c].length >= 2), levels: m }
  }, [edges, results, id])

  // Snap to a contrastable condition (and clear stale levels) when the current one has
  // no two levels in the pooled rows — e.g. right after connecting a different Compare.
  useEffect(() => {
    if (conds.length > 0 && !conds.includes(config.condition))
      update(id, { condition: conds[0], pairNum: '', pairDen: '' })
  }, [conds, config.condition, id, update])

  const opts = (levels[config.condition] ?? []).map((v) => ({ value: v, label: v }))
  return (
    <Section title="Contrast">
      <div style={{ fontSize: 11, color: UI.textMuted, lineHeight: 1.4, marginBottom: 6 }}>
        Pools the upstream comparison rows, then contrasts two levels of one condition — e.g. strain
        clpP vs WT within one vehicle normalisation.
      </div>
      <Field label="condition">
        <Select
          value={config.condition}
          onChange={(v) => update(id, { condition: v as ConditionKey, pairNum: '', pairDen: '' })}
          options={(conds.length ? conds : CONDS).map((c) => ({ value: c, label: c }))}
        />
      </Field>
      <Field label="FC1 (numerator)">
        <Select
          value={config.pairNum}
          onChange={(v) => update(id, { pairNum: v })}
          options={opts}
        />
      </Field>
      <Field label="FC2 (denominator)">
        <Select
          value={config.pairDen}
          onChange={(v) => update(id, { pairDen: v })}
          options={opts}
        />
      </Field>
      <Field label="relationship">
        <Select
          value={config.relationship}
          onChange={(v) => update(id, { relationship: v as ContrastConfig['relationship'] })}
          options={[
            { value: 'correlated', label: 'correlated (OLS)' },
            { value: 'independent', label: 'independent (marginal)' }
          ]}
        />
      </Field>
    </Section>
  )
}

/** Common props for every plotting panel. `update` is already bound to the right
 *  target (a node's config, or a subcard's config inside a group). `focusNodeId` is the
 *  id whose incoming edge points at the plot's upstream — the plot node itself, or the
 *  group node for a subcard (a subcard has no edge of its own). */
interface PlotPanelProps<C> {
  config: C
  update: (patch: Record<string, unknown>) => void
  focusNodeId: string
}

function VolcanoPanel({ config, update, focusNodeId }: PlotPanelProps<VolcanoConfig>) {
  return (
    <Section title="Volcano">
      <Field label="y-axis">
        <Select
          value={config.statType}
          onChange={(v) => update({ statType: v as 'pP' | 'pQ' })}
          options={[
            { value: 'pP', label: '−log10 p' },
            { value: 'pQ', label: '−log10 q' }
          ]}
        />
      </Field>
      <Field label="label top N">
        <NumberInput
          value={config.labelTop}
          step={1}
          min={0}
          onChange={(v) => update({ labelTop: Math.max(0, Math.round(v)) })}
        />
      </Field>
      <FocusField focusNodeId={focusNodeId} update={update} focus={config.focus ?? DEFAULT_FOCUS} />
    </Section>
  )
}

function ScatterPanel({ config, update }: PlotPanelProps<ScatterConfig>) {
  return (
    <Section title="Scatter">
      <Field label="label top N">
        <NumberInput
          value={config.labelTop}
          step={1}
          min={0}
          onChange={(v) => update({ labelTop: Math.max(0, Math.round(v)) })}
        />
      </Field>
    </Section>
  )
}

function MAPanel({ config, update, focusNodeId }: PlotPanelProps<MAConfig>) {
  return (
    <Section title="MA">
      <Field label="FC low">
        <NumberInput value={config.fcLow} step={0.1} onChange={(v) => update({ fcLow: v })} />
      </Field>
      <Field label="FC high">
        <NumberInput value={config.fcHigh} step={0.1} onChange={(v) => update({ fcHigh: v })} />
      </Field>
      <FocusField focusNodeId={focusNodeId} update={update} focus={config.focus ?? DEFAULT_FOCUS} />
    </Section>
  )
}

const AXIS_OPTS = [
  { value: 'dose', label: 'dose' },
  { value: 'time', label: 'time' }
]

function DRPanel({ config, update, focusNodeId }: PlotPanelProps<DRConfig>) {
  return (
    <Section title="Response curves">
      <Field label="axis">
        <Select
          value={config.axis}
          onChange={(v) => update({ axis: v as DRConfig['axis'] })}
          options={AXIS_OPTS}
        />
      </Field>
      <Field label="highlight top N (0 = top 10)">
        <NumberInput
          value={config.topGenes}
          step={1}
          min={0}
          onChange={(v) => update({ topGenes: Math.max(0, Math.round(v)) })}
        />
      </Field>
      <FocusField focusNodeId={focusNodeId} update={update} focus={config.focus ?? DEFAULT_FOCUS} />
    </Section>
  )
}

function BubblePanel({ config, update, focusNodeId }: PlotPanelProps<BubbleConfig>) {
  return (
    <Section title="Bubble">
      <Field label="axis">
        <Select
          value={config.axis}
          onChange={(v) => update({ axis: v as BubbleConfig['axis'] })}
          options={AXIS_OPTS}
        />
      </Field>
      <Field label="top genes (0 = top 20)">
        <NumberInput
          value={config.topGenes}
          step={1}
          min={0}
          onChange={(v) => update({ topGenes: Math.max(0, Math.round(v)) })}
        />
      </Field>
      <FocusField focusNodeId={focusNodeId} update={update} focus={config.focus ?? DEFAULT_FOCUS} />
    </Section>
  )
}

function DumbbellPanel({ config, update, focusNodeId }: PlotPanelProps<DumbbellConfig>) {
  return (
    <Section title="Dumbbell">
      <Field label="top genes (0 = top 100)">
        <NumberInput
          value={config.topGenes}
          step={1}
          min={0}
          onChange={(v) => update({ topGenes: Math.max(0, Math.round(v)) })}
        />
      </Field>
      <FocusField focusNodeId={focusNodeId} update={update} focus={config.focus ?? DEFAULT_FOCUS} />
    </Section>
  )
}

function TdrPanel({ config, update, focusNodeId }: PlotPanelProps<TdrConfig>) {
  return (
    <Section title="TDR (dose × time)">
      <div style={styles.hint}>One figure per focus gene (needs dose and time active).</div>
      <FocusField focusNodeId={focusNodeId} update={update} focus={config.focus ?? DEFAULT_FOCUS} />
    </Section>
  )
}

function GeneBarPanel({ config, update, focusNodeId }: PlotPanelProps<BarConfig>) {
  return (
    <Section title="Bar">
      <div style={styles.hint}>Focus gene value across every condition.</div>
      <FocusField focusNodeId={focusNodeId} update={update} focus={config.focus ?? DEFAULT_FOCUS} />
    </Section>
  )
}

function ClusterPanel({ config, update, focusNodeId }: PlotPanelProps<ClusterConfig>) {
  // Select the (stable) upstream result, then derive the condition list in a memo —
  // returning a freshly-built array straight from the selector would fail Zustand's
  // reference equality and loop forever.
  const upstream = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === focusNodeId)?.source
    return upId ? s.results[upId] : undefined
  })
  const active = useMemo(() => {
    if (upstream?.kind === 'standardize') return upstream.std.activeConditions
    // For a comparison, color by a *context* condition — the comparison's own
    // dimension is constant within one comparison, so exclude it.
    if (upstream?.kind === 'compare') return facetContextDims(upstream.cmp.rows)
    return CONDS
  }, [upstream])
  // If the stored colorBy isn't a valid option for this upstream (e.g. the default
  // 'cmpd' on a cmpd-comparison responsome), snap it to the first context condition.
  useEffect(() => {
    if (active.length > 0 && !active.includes(config.colorBy)) update({ colorBy: active[0] })
  }, [active, config.colorBy, update])
  return (
    <Section title="Cluster">
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
      <Field label="color by">
        <Select
          value={config.colorBy}
          onChange={(v) => update({ colorBy: v as ConditionKey })}
          options={active.map((c) => ({ value: c, label: c }))}
        />
      </Field>
      <Field label="display">
        <Select
          value={config.display ?? 'centroid'}
          onChange={(v) => update({ display: v as ClusterConfig['display'] })}
          options={[
            { value: 'centroid', label: 'centroid + territory' },
            { value: 'replicate', label: 'per replicate' }
          ]}
        />
      </Field>
    </Section>
  )
}

// Plot types valid per metric: distributions (intensity/CV) → violin/box; a per-sample count
// (proteins) → bar only.
function qcPlotOptions(metric: QcConfig['metric']): QcConfig['plot'][] {
  return metric === 'proteins' ? ['bar'] : ['violin', 'box']
}

function QcPanel({ config, update }: PlotPanelProps<QcConfig>) {
  const plotOpts = qcPlotOptions(config.metric)
  const plot = plotOpts.includes(config.plot) ? config.plot : plotOpts[0]
  return (
    <Section title="QC">
      <div style={styles.hint}>Per-sample quality: intensity distribution, %CV, or protein count.</div>
      <Field label="metric">
        <Select
          value={config.metric}
          onChange={(v) => {
            const m = v as QcConfig['metric']
            const opts = qcPlotOptions(m)
            update({ metric: m, plot: opts.includes(config.plot) ? config.plot : opts[0] })
          }}
          options={[
            { value: 'intensity', label: 'intensity' },
            { value: 'cv', label: 'CV %' },
            { value: 'proteins', label: '# proteins' }
          ]}
        />
      </Field>
      {/* Proteins is bar-only, so the plot selector only appears for the distribution metrics. */}
      {plotOpts.length > 1 && (
        <Field label="plot">
          <Select
            value={plot}
            onChange={(v) => update({ plot: v as QcConfig['plot'] })}
            options={plotOpts.map((o) => ({ value: o, label: o }))}
          />
        </Field>
      )}
    </Section>
  )
}

function CorrPanel({ config, update }: PlotPanelProps<CorrConfig>) {
  return (
    <Section title="Correlation">
      <div style={styles.hint}>All-samples × all-samples Pearson correlation.</div>
      <Checkbox
        label="cluster samples"
        checked={config.cluster ?? true}
        onChange={(v) => update({ cluster: v })}
      />
    </Section>
  )
}

function HeatmapPanel({ config, update, focusNodeId }: PlotPanelProps<HeatmapConfig>) {
  return (
    <Section title="Heatmap">
      <Field label="max genes (0 = all)">
        <NumberInput
          value={config.maxGenes}
          step={10}
          min={0}
          onChange={(v) => update({ maxGenes: Math.max(0, Math.round(v)) })}
        />
      </Field>
      <Checkbox
        label="log10 intensities"
        checked={config.log10}
        onChange={(v) => update({ log10: v })}
      />
      <FocusField focusNodeId={focusNodeId} update={update} focus={config.focus ?? DEFAULT_FOCUS} />
    </Section>
  )
}

// ── small controls ──────────────────────────────────────────────────────────────

function Section({
  title,
  action,
  children
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionHead}>
        <div style={styles.sectionTitle}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={styles.field}>
      <label style={styles.fieldLabel}>{label}</label>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

function Select({
  value,
  options,
  onChange
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  // When the current value isn't one of the options (e.g. a freshly-reset pair
  // selection), show a placeholder so the browser doesn't silently display the
  // first option — otherwise picking that option fires no change event.
  const hasValue = options.some((o) => o.value === value)
  return (
    <select style={styles.input} value={value} onChange={(e) => onChange(e.target.value)}>
      {!hasValue && (
        <option value={value} disabled hidden>
          — select —
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function NumberInput({
  value,
  onChange,
  step,
  min,
  max
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
}) {
  return (
    <input
      type="number"
      style={styles.input}
      value={value}
      step={step ?? 1}
      min={min}
      max={max}
      onChange={(e) => {
        const v = Number(e.target.value)
        if (Number.isFinite(v)) onChange(v)
      }}
    />
  )
}

/** Searchable multi-select over genes. Stores uniqIDs, shows display labels — so a
 *  display-name collision never mis-resolves (the user picks a specific option). */
function GeneSelect({
  value,
  options,
  onChange,
  placeholder
}: {
  value: string[]
  options: GeneOption[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const labelOf = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options])
  const matches = useMemo(() => {
    const chosen = new Set(value)
    const q = query.trim().toLowerCase()
    const pool = options.filter((o) => !chosen.has(o.value))
    const f = q
      ? pool.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      : pool
    return f.slice(0, 50)
  }, [options, value, query])
  return (
    <div style={styles.geneWrap}>
      {value.length > 0 && (
        <div style={styles.tokens}>
          {value.map((v) => (
            <span key={v} data-token={v} style={styles.token} title={v}>
              {labelOf.get(v) ?? v}
              <button
                style={styles.tokenX}
                title="remove"
                onClick={() => onChange(value.filter((x) => x !== v))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        style={styles.input}
        value={query}
        placeholder={placeholder ?? 'search genes…'}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() !== '' && (
        <div style={styles.geneList}>
          {matches.length === 0 ? (
            <div style={styles.geneEmpty}>no match</div>
          ) : (
            matches.map((o) => (
              <button
                key={o.value}
                data-gene-option={o.value}
                style={styles.geneOpt}
                onClick={() => {
                  onChange([...value, o.value])
                  setQuery('')
                }}
              >
                <span>{o.label}</span>
                {o.label !== o.value && <span style={styles.geneId}>{o.value}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** The two focus-gene pickers (GOI + relevant panel), stacked. */
function GeneSets({
  goi,
  panel,
  options,
  onChange
}: {
  goi: string[]
  panel: string[]
  options: GeneOption[]
  onChange: (patch: { goi?: string[]; panel?: string[] }) => void
}) {
  if (options.length === 0)
    return <div style={styles.hint}>Run the upstream tile to load the gene list.</div>
  return (
    <>
      <div style={styles.stackLabel}>gene of interest</div>
      <GeneSelect
        value={goi}
        options={options}
        onChange={(v) => onChange({ goi: v })}
        placeholder="add GOI…"
      />
      <div style={styles.stackLabel}>relevant genes</div>
      <GeneSelect
        value={panel}
        options={options}
        onChange={(v) => onChange({ panel: v })}
        placeholder="add panel gene…"
      />
    </>
  )
}

/** A plot's focus-gene control: mode (none / inherit / custom) + custom pickers. */
function FocusField({
  focusNodeId,
  update,
  focus
}: {
  focusNodeId: string
  update: (patch: Record<string, unknown>) => void
  focus: FocusConfig
}) {
  const options = useGeneOptions(focusNodeId)
  const set = (patch: Partial<FocusConfig>): void => update({ focus: { ...focus, ...patch } })
  return (
    <>
      <Field label="focus genes">
        <Select
          value={focus.mode}
          onChange={(v) => set({ mode: v as FocusConfig['mode'] })}
          options={[
            { value: 'none', label: 'none' },
            { value: 'inherit', label: 'inherit (global)' },
            { value: 'custom', label: 'custom' }
          ]}
        />
      </Field>
      {focus.mode === 'custom' && (
        <GeneSets goi={focus.goi} panel={focus.panel} options={options} onChange={(p) => set(p)} />
      )}
    </>
  )
}

function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  title
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  title?: string
}) {
  return (
    <label
      style={{ ...styles.checkRow, ...(disabled ? { opacity: 0.45, cursor: 'default' } : null) }}
      title={title}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

const styles: Record<string, CSSProperties> = {
  configBtn: {
    width: '100%',
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  compareSummary: {
    fontSize: 11,
    color: UI.textMuted,
    marginTop: 6,
    overflowWrap: 'anywhere',
    lineHeight: 1.4
  },
  panel: {
    width: 268,
    maxHeight: '58vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.55)',
    minHeight: 0,
    overflow: 'hidden',
    textAlign: 'left'
  },
  head: {
    padding: '10px 14px',
    borderTop: '3px solid',
    borderBottom: `1px solid ${UI.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8
  },
  headText: { minWidth: 0 },
  headActions: { display: 'flex', gap: 6, flex: '0 0 auto' },
  iconBtnSm: {
    width: 24,
    height: 24,
    borderRadius: 5,
    border: `1px solid ${UI.border}`,
    background: 'transparent',
    color: UI.text,
    fontSize: 12,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0
  },
  headCat: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    display: 'block'
  },
  headTitle: { fontWeight: 700, fontSize: 13, display: 'block' },
  headId: { color: UI.textMuted, fontSize: 11 },
  scroll: { flex: 1, overflow: 'auto', minHeight: 0 },
  section: { padding: '12px 14px', borderBottom: `1px solid ${UI.border}` },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted
  },
  hint: { color: UI.textMuted, fontSize: 11, marginBottom: 8, lineHeight: 1.4 },
  subTabs: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  subTab: {
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '3px 8px',
    fontSize: 11,
    fontWeight: 600,
    color: UI.text,
    cursor: 'pointer'
  },
  subActions: { display: 'flex', alignItems: 'center', gap: 6 },
  field: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  fieldLabel: { color: UI.textMuted, fontSize: 11, width: 90, flex: '0 0 90px' },
  input: {
    width: '100%',
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '4px 7px',
    fontSize: 12,
    boxSizing: 'border-box'
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: UI.text,
    marginBottom: 6,
    cursor: 'pointer'
  },
  geneWrap: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 },
  stackLabel: { color: UI.textMuted, fontSize: 11, marginTop: 4, marginBottom: 2 },
  tokens: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  token: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    padding: '1px 4px 1px 8px',
    fontSize: 11,
    color: UI.text,
    maxWidth: '100%'
  },
  tokenX: {
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    cursor: 'pointer',
    fontSize: 13,
    lineHeight: 1,
    padding: '0 2px'
  },
  geneList: {
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    background: UI.panelAlt,
    maxHeight: 168,
    overflow: 'auto'
  },
  geneOpt: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${UI.border}`,
    color: UI.text,
    fontSize: 12,
    padding: '5px 8px',
    cursor: 'pointer'
  },
  geneId: { color: UI.textMuted, fontSize: 10, fontVariantNumeric: 'tabular-nums' },
  geneEmpty: { color: UI.textMuted, fontSize: 11, padding: '6px 8px' },
  fileRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 11,
    marginBottom: 4
  },
  muted: { color: UI.textMuted },
  btnRow: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' },
  btn: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '6px 10px',
    fontSize: 11,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: UI.accent,
    color: UI.accentText,
    borderColor: UI.accent,
    fontWeight: 600,
    width: '100%'
  },
  chip: {
    background: UI.panelAlt,
    color: UI.textMuted,
    border: '1px solid transparent',
    borderRadius: 999,
    padding: '3px 10px',
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: 0.3,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
    minWidth: 96,
    textAlign: 'center',
    transition: 'color 120ms, border-color 120ms, background 120ms'
  },
  chipDone: {
    color: UI.accent,
    borderColor: UI.accent
  },
  footer: { display: 'flex', gap: 8, padding: 12, borderTop: `1px solid ${UI.border}` }
}
