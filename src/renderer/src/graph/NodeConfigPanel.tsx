import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'

import {
  classifyConditions,
  combineStandardize,
  enrichSourcesPresent,
  ENRICH_GROUPS,
  defaultTransform,
  histogramShape,
  fromLinear,
  histogram,
  outputScale,
  toLinear,
  type LogTransform,
  type Shape,
  type ScalePreview,
  type ValueHistogram,
  ENRICH_SOURCE_LABEL,
  resolveEnrichSource,
  type ContrastStat,
  statTails,
  crossPairs,
  IMPUTE_DEFAULTS,
  roundP,
  previewCompare,
  previewContrastPair,
  previewTwoWay,
  CLUSTER_COLOR,
  condLabel,
  customCond,
  orderConds,
  type ClusterColorBy,
  type ConditionKey,
  type FdrMethod,
  type Pair,
  type StandardizeResult
} from '../engine'
import { IconCopy, IconGear, IconTrash } from '../ui/icons'
import {
  defaultGroups,
  legendOn,
  resolveGroup,
  type PointPlotKind,
  type ResolvedGroup
} from '../ui/pointStyle'
import { CLEAR, ColorPicker } from '../ui/ColorPicker'
import { Select as AppSelect, type SelectOption } from '../ui/Select'
import { OnOffSwitch, ToggleSwitch } from '../ui/ToggleSwitch'
import { StatusNote } from '../ui/StatusNote'
import { gatePlotEntries, UNWIRED, type UpstreamFacts } from './requirements'
import { useUpstreamFacts } from './useUpstreamFacts'
import type { AxisDefaults } from '../ui/plotAxes'
import { PALETTES, UI } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'
import { ComparisonDialog, contrastSummary } from './ComparisonDialog'
import { isPairable, pairSides, selectorRowsOf, selectSource, toContrastSide } from './contrastPair'
import type { PairInput } from './PairContrastDialog'
import { InteractiveImportDialog } from './InteractiveImportDialog'
import { useConfigWindowOpen } from './dialogDock'
import {
  accentOf,
  canConnect,
  categoryOf,
  CATEGORIES,
  entryKey,
  NODE_SPECS,
  plotEntriesFor,
  plotLabel,
  PLOT_SECTIONS,
  stepTitle,
  type PlotMenuEntry
} from './registry'
import { useGraph } from './store'
import {
  isCompareConfigured,
  isContrastConfigured,
  isStep,
  normalizeCompareConfig,
  resolveContrastSource,
  resolveLoadMode,
  type BubbleConfig,
  type CompareConfig,
  effectLabelsOf,
  type ContrastConfig,
  type DRConfig,
  type DumbbellConfig,
  type EnrichConfig,
  type GroupStyle,
  type HeatmapConfig,
  type HighlightStyle,
  capOn,
  type LoadConfig,
  type MAConfig,
  cleanupOn,
  imputeOn,
  type NodeConfig,
  type NodeKind,
  type AxisStyle,
  type LineStyle,
  type PlotAxes,
  type PointStyle,
  type QuickAccess,
  clusterLook,
  quickOn,
  type ClusterConfig,
  type CorrConfig,
  type PlotChild,
  type PlotGroupConfig,
  type QcConfig,
  type ScatterConfig,
  type StandardizeConfig,
  type StringConfig,
  type TableConfig,
  type VolcanoConfig
} from './types'

/** Detail panel width (flow units — it scales with the canvas zoom). Exported so the tile can
 *  decide which side of itself the panel fits on. */
export const PANEL_WIDTH = 402

/** The preset conditions, as a fallback where the data's own condition list isn't known yet.
 *  Anywhere the real list is reachable (a tile's upstream result), use that instead — it carries
 *  the custom conditions too. */
const CONDS: ConditionKey[] = ['cell', 'cmpd', 'dose', 'time']

/** The plotting ops a group subcard can be (everything in the plotting category except
 *  the group container itself — groups don't nest). */
const GROUP_CHILD_OPS: NodeKind[] = CATEGORIES.plotting.ops

/** Ops fanned out into menu entries (in GROUP_CHILD_OPS order): `dr` splits into dose/time.
 *  PlotMenuEntry / plotEntriesFor / entryKey are shared with the new-step TilePicker (see registry). */
const PLOT_ENTRIES: PlotMenuEntry[] = GROUP_CHILD_OPS.flatMap(plotEntriesFor)

/** Sub-groups for the add-plot menu, so the flat plotting list reads as labelled sections by what
 *  each plot shows. Derived from the shared PLOT_SECTIONS (single source of truth, also used by the
 *  new-step TilePicker); `dr` expands into its two entry keys (dose/time). Any entry not listed falls
 *  into a trailing "Other" section, so new plot kinds are never dropped. */
const PLOT_GROUP_DEFS: { label: string; keys: string[] }[] = PLOT_SECTIONS.map((s) => ({
  label: s.label,
  keys: s.kinds.flatMap((k) => (k === 'dr' ? ['dr:axis=dose', 'dr:axis=time'] : [k]))
}))
/** Menu sections resolved to entries, plus a trailing "Other" section for any uncategorised entry. */
const PLOT_MENU_GROUPS: { label: string; entries: PlotMenuEntry[] }[] = (() => {
  const byKey = new Map(PLOT_ENTRIES.map((e) => [entryKey(e), e]))
  const used = new Set<string>()
  const groups = PLOT_GROUP_DEFS.map((g) => {
    const entries = g.keys.map((k) => byKey.get(k)).filter((e): e is PlotMenuEntry => !!e)
    entries.forEach((e) => used.add(entryKey(e)))
    return { label: g.label, entries }
  }).filter((g) => g.entries.length > 0)
  const rest = PLOT_ENTRIES.filter((e) => !used.has(entryKey(e)))
  return rest.length ? [...groups, { label: 'Other', entries: rest }] : groups
})()

/** True when a subcard is this menu entry's kind and matches every override key (so Dose-response
 *  and Time-response match independently even though both are `dr`). */
const childMatchesEntry = (c: PlotChild, e: PlotMenuEntry): boolean =>
  c.kind === e.kind &&
  (!e.override ||
    Object.entries(e.override).every(
      ([k, v]) => (c.config as unknown as Record<string, unknown>)[k] === v
    ))

/** True when the group already contains a subcard matching this entry. */
const entryPresent = (e: PlotMenuEntry, children: PlotChild[]): boolean =>
  children.some((c) => childMatchesEntry(c, e))

/** How many of the group's subcards fall into this menu section (counts duplicates). */
const sectionCount = (entries: PlotMenuEntry[], children: PlotChild[]): number =>
  children.filter((c) => entries.some((e) => childMatchesEntry(c, e))).length

/** A crisp open-chevron arrow (SVG). `deg` rotates it: 0 = points right (▸), 90 = down (▾),
 *  -90 = up (▴). `currentColor`, so it inherits the surrounding text colour. */
function Chevron({ size, deg }: { size: number; deg: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      style={{ flex: '0 0 auto', transform: `rotate(${deg}deg)`, transition: 'transform 0.12s' }}
    >
      <polyline
        points="3.5,1.5 7,5 3.5,8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Shared plumbing for the app's themed dropdowns (add-plot menu, config selects): open state, a
 *  <body>-portal anchor rect measured from the trigger, the live canvas zoom `z` (so the portaled
 *  menu — which lives OUTSIDE React Flow's transform — is scaled to match the zoomed tile yet stays
 *  crisp), the concrete palette, and close-on-outside-click / scroll / pan-zoom. */
function useZoomDropdown(): {
  open: boolean
  setOpen: (v: boolean) => void
  toggle: () => void
  rect: { left: number; bottom: number; width: number } | null
  z: number
  p: (typeof PALETTES)['dark']
  btnRef: RefObject<HTMLButtonElement | null>
  menuRef: RefObject<HTMLDivElement | null>
} {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<{ left: number; bottom: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const mode = useUiTheme((s) => s.mode)
  const p = PALETTES[mode]
  const tf = useStore((s) => `${s.transform[0]},${s.transform[1]},${s.transform[2]}`)
  const z = Number(tf.split(',')[2]) || 1
  // A fixed overlay can't follow a canvas pan/zoom, so close it when the transform changes. The
  // functional updater bails (no re-render) when it's already closed, so this doesn't cascade —
  // reacting to the external transform value is exactly what this effect is for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen((wasOpen) => (wasOpen ? false : wasOpen))
  }, [tf])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    const onResize = (): void => setOpen(false)
    // Capture-phase scroll closes on an ANCESTOR scroll, but not when the menu itself scrolls.
    const onScroll = (e: Event): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])
  const toggle = (): void => {
    if (open) return setOpen(false)
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setRect({ left: r.left, bottom: r.bottom, width: r.width })
    setOpen(true)
  }
  return { open, setOpen, toggle, rect, z, p, btnRef, menuRef }
}

/** One row in the add-plot menu; carries its own hover state (inline styles, no CSS hover). All
 *  metrics are pre-scaled by the caller so the row matches the zoomed tile while staying crisp. */
function AddPlotItem({
  label,
  checked,
  z,
  colors,
  onClick
}: {
  label: string
  checked: boolean
  z: number
  colors: { text: string; hover: string; accent: string }
  onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  // Selected (already-added) entries are highlighted in the plot-tile accent: accent text + check,
  // over a faint accent wash (a touch stronger on hover). Others use the plain menu colours.
  const bg = checked
    ? `${colors.accent}${hover ? '33' : '22'}`
    : hover
      ? colors.hover
      : 'transparent'
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8 * z,
        width: '100%',
        border: 'none',
        borderRadius: 4 * z,
        padding: `${5 * z}px ${8 * z}px`,
        fontSize: 12 * z,
        fontWeight: checked ? 600 : 400,
        color: checked ? colors.accent : colors.text,
        background: bg,
        cursor: 'pointer',
        textAlign: 'left',
        whiteSpace: 'nowrap'
      }}
    >
      <span style={{ flex: `0 0 ${14 * z}px`, color: colors.accent }}>{checked ? '✓' : ''}</span>
      <span>{label}</span>
    </button>
  )
}

/** Themed "Select plots (n)" dropdown, replacing the native <select> so the menu matches the app UI
 *  (not the OS popup) and can flag plot kinds already in the group. The list is portaled to <body>
 *  as a FIXED overlay so it floats above the tile detail window (never growing it) and renders
 *  crisply at device resolution — but every metric is multiplied by the live canvas zoom `z`, and
 *  it's positioned at the trigger's on-screen rect, so it visually tracks the zoomed tile. It uses
 *  concrete palette colours (var(--…) don't resolve on <body>, outside the app root). */
export function AddPlotMenu({
  children,
  onAdd,
  onRemove,
  upstreamKind,
  upstream
}: {
  children: PlotChild[]
  /** append one or more plot subcards (each a kind + optional config override) */
  onAdd: (specs: { kind: NodeKind; override?: Record<string, unknown> }[]) => void
  /** remove the given subcards by id */
  onRemove: (childIds: string[]) => void
  /** the group's upstream node kind — hides plots that can't consume it (invalid data→plot combos) */
  upstreamKind?: NodeKind
  /** what the upstream data carries — hides plots whose requirement it can't meet */
  upstream?: UpstreamFacts
}) {
  const { open, toggle, rect, z, p, btnRef, menuRef } = useZoomDropdown()
  const facts = upstream ?? UNWIRED
  // Only offer plots the upstream can actually feed (an unwired group offers all), and drop those
  // whose data requirement (response axes, annotations, …) the upstream can't meet.
  const menuGroups = useMemo(
    () =>
      PLOT_MENU_GROUPS.map((g) => ({
        ...g,
        entries: gatePlotEntries(
          upstreamKind ? g.entries.filter((e) => canConnect(upstreamKind, e.kind)) : g.entries,
          facts
        )
      })).filter((g) => g.entries.length > 0),
    [upstreamKind, facts]
  )
  const plotAccent = accentOf('plotting') // the plot-tile accent, for highlighting selected entries
  // Categories the user has collapsed (labels). All start expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleSection = (label: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <button ref={btnRef} onClick={toggle} style={{ ...styles.input, ...styles.menuTrigger }}>
        <span>Select plots ({children.length})</span>
        {/* Same open chevron as the category headers: points down, rotates up while the menu is open. */}
        <span style={{ color: UI.textMuted, display: 'inline-flex' }}>
          <Chevron size={11} deg={open ? -90 : 90} />
        </span>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              left: rect.left,
              top: rect.bottom + 4 * z,
              minWidth: rect.width,
              zIndex: 4000,
              background: p.panelAlt,
              border: `1px solid ${p.border}`,
              borderRadius: 6 * z,
              boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
              padding: 4 * z,
              maxHeight: 340 * z,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {menuGroups.map((g, gi) => {
              const active = sectionCount(g.entries, children)
              const total = g.entries.length
              const present = g.entries.filter((e) => entryPresent(e, children)).length
              const allOn = present === total // every entry in the category is added
              const isOpen = !collapsed.has(g.label)
              // Select-all toggles the whole category: all present → remove them all; otherwise add
              // the missing ones (in one undoable step).
              const toggleAll = (): void => {
                if (allOn) {
                  onRemove(
                    children
                      .filter((c) => g.entries.some((e) => childMatchesEntry(c, e)))
                      .map((c) => c.id)
                  )
                } else {
                  onAdd(
                    g.entries
                      .filter((e) => !entryPresent(e, children))
                      .map((e) => ({ kind: e.kind, override: e.override }))
                  )
                }
              }
              return (
                <div key={g.label}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6 * z,
                      padding: `${gi === 0 ? 2 * z : 6 * z}px ${6 * z}px ${2 * z}px`,
                      fontSize: 9.5 * z,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5 * z,
                      color: p.textMuted
                    }}
                  >
                    {/* Select/deselect the whole category (LEFT). Tri-state: filled=all, dash=some, empty=none. */}
                    <button
                      title={allOn ? 'Remove all in category' : 'Add all in category'}
                      onClick={toggleAll}
                      style={{
                        flex: '0 0 auto',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 15 * z,
                        height: 15 * z,
                        borderRadius: 4 * z,
                        border: `1px solid ${present > 0 ? plotAccent : p.border}`,
                        background: allOn ? plotAccent : 'transparent',
                        color: allOn ? p.panelAlt : plotAccent,
                        fontSize: 10 * z,
                        lineHeight: 1,
                        cursor: 'pointer',
                        padding: 0
                      }}
                    >
                      {allOn ? '✓' : present > 0 ? '–' : ''}
                    </button>
                    {/* Caret + label: click to expand/collapse the category. */}
                    <button
                      onClick={() => toggleSection(g.label)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5 * z,
                        flex: 1,
                        minWidth: 0,
                        border: 'none',
                        background: 'transparent',
                        color: 'inherit',
                        font: 'inherit',
                        letterSpacing: 'inherit',
                        textTransform: 'inherit',
                        cursor: 'pointer',
                        padding: 0,
                        textAlign: 'left'
                      }}
                    >
                      {/* Open chevron: points right when collapsed, rotates to point down when expanded. */}
                      <Chevron size={10 * z} deg={isOpen ? 90 : 0} />
                      <span>{g.label}</span>
                    </button>
                    {/* Count of active plots (RIGHT) — accent when >0, muted grey at 0. */}
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: 14 * z,
                        height: 14 * z,
                        padding: `0 ${4 * z}px`,
                        borderRadius: 7 * z,
                        fontSize: 9 * z,
                        fontWeight: 700,
                        lineHeight: 1,
                        color: active > 0 ? plotAccent : p.textMuted,
                        background: active > 0 ? `${plotAccent}26` : `${p.textMuted}22`
                      }}
                    >
                      {active}
                    </span>
                  </div>
                  {isOpen &&
                    g.entries.map((e) => (
                      <AddPlotItem
                        key={entryKey(e)}
                        label={e.label}
                        checked={entryPresent(e, children)}
                        z={z}
                        colors={{ text: p.text, hover: p.panel, accent: plotAccent }}
                        onClick={() => onAdd([{ kind: e.kind, override: e.override }])}
                      />
                    ))}
                </div>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}

/** The group tile's plot menu, as a SINGLE-choice picker: the same trigger, sections and rows, but
 *  one kind is chosen rather than a set added. Used by Settings → Plots to pick the type whose
 *  defaults are being edited (so the two places name and group the plots identically). */
export function PlotKindMenu({
  value,
  kinds,
  onChange
}: {
  value: NodeKind
  /** the kinds to offer, in any order — the menu groups them by PLOT_SECTIONS */
  kinds: NodeKind[]
  onChange: (kind: NodeKind) => void
}): ReactNode {
  const { open, toggle, setOpen, rect, z, p, btnRef, menuRef } = useZoomDropdown()
  const offered = new Set(kinds)
  const sections = PLOT_SECTIONS.map((s) => ({
    label: s.label,
    kinds: s.kinds.filter((k) => offered.has(k))
  })).filter((s) => s.kinds.length > 0)
  const listed = new Set(sections.flatMap((s) => s.kinds))
  const rest = kinds.filter((k) => !listed.has(k))
  const groups = rest.length ? [...sections, { label: 'Other', kinds: rest }] : sections
  const plotAccent = accentOf('plotting')
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <button ref={btnRef} onClick={toggle} style={{ ...styles.input, ...styles.menuTrigger }}>
        <span>{NODE_SPECS[value].label}</span>
        <span style={{ color: UI.textMuted, display: 'inline-flex' }}>
          <Chevron size={11} deg={open ? -90 : 90} />
        </span>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              left: rect.left,
              top: rect.bottom + 4 * z,
              minWidth: rect.width,
              zIndex: 4000,
              background: p.panelAlt,
              border: `1px solid ${p.border}`,
              borderRadius: 6 * z,
              boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
              padding: 4 * z,
              maxHeight: 340 * z,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {groups.map((g, gi) => (
              <div key={g.label}>
                <div
                  style={{
                    padding: `${gi === 0 ? 2 * z : 6 * z}px ${6 * z}px ${2 * z}px`,
                    fontSize: 9.5 * z,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5 * z,
                    color: p.textMuted
                  }}
                >
                  {g.label}
                </div>
                {g.kinds.map((k) => (
                  <AddPlotItem
                    key={k}
                    label={NODE_SPECS[k].label}
                    checked={k === value}
                    z={z}
                    colors={{ text: p.text, hover: p.panel, accent: plotAccent }}
                    onClick={() => {
                      onChange(k)
                      setOpen(false)
                    }}
                  />
                ))}
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}

/** The config sub-panel for one plotting op, with its updater already bound so it serves both
 *  a standalone plot node and a group subcard. Also mounted by a Results tile's config window
 *  (inside its own ReactFlowProvider, since the themed Selects read the canvas zoom). */
export function PlotConfig({
  kind,
  config,
  update,
  edgeNodeId,
  axisDefaults
}: {
  kind: NodeKind
  config: NodeConfig
  update: (patch: Record<string, unknown>) => void
  edgeNodeId: string
  /** what the live plot draws on each axis with no override — the Axes fields' placeholders.
   *  Only a tile can supply it (the canvas panel has no live chart), so it's optional. */
  axisDefaults?: AxisDefaults
}): ReactNode {
  const props = { update, edgeNodeId }
  const own = kindPanel(kind, config, props)
  // Every Plotly axis plot also gets the shared Axes section (network / table have no axes).
  return AXIS_KINDS.has(kind) ? (
    <>
      {own}
      <AxesSection config={config as { axes?: PlotAxes }} update={update} defaults={axisDefaults} />
    </>
  ) : (
    own
  )
}

/** The plots whose settings carry the shared Axes section (Plotly x/y axes). */
const AXIS_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'volcano',
  'heatmap',
  'scatter',
  'ma',
  'dr',
  'bubble',
  'dumbbell',
  'tdr',
  'geneBar',
  'pca',
  'enrich',
  'qc',
  'corr'
])

function kindPanel(
  kind: NodeKind,
  config: NodeConfig,
  props: { update: (patch: Record<string, unknown>) => void; edgeNodeId: string }
): ReactNode {
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
      return <TdrPanel />
    case 'geneBar':
      return <GeneBarPanel />
    case 'pca':
      return <ClusterPanel config={config as ClusterConfig} {...props} />
    case 'enrich':
      return <EnrichPanel config={config as EnrichConfig} {...props} />
    case 'string':
      return <StringPanel config={config as StringConfig} {...props} />
    case 'qc':
      return <QcPanel config={config as QcConfig} {...props} />
    case 'corr':
      return <CorrPanel config={config as CorrConfig} {...props} />
    case 'table':
      return <TablePanel config={config as TableConfig} {...props} />
    default:
      return null
  }
}

/** Floating config popover for a single node (anchored to its right via NodeToolbar).
 *  A `plotGroup` shows its active subcard's config (chosen on the tile / via `selectedSub`). */
export function NodeConfigPanel({
  id,
  embedded = false,
  inputs
}: {
  id: string
  embedded?: boolean
  /** Input selection, shown as the body's first section. Only the form workflow passes one — on
   *  the canvas the wiring is the edges themselves. */
  inputs?: { title: string; body: ReactNode }
}) {
  const node = useGraph((s) => s.nodes.find((n) => n.id === id))
  const selectedSub = useGraph((s) => s.selectedSub)
  const deleteNode = useGraph((s) => s.deleteNode)
  const removeGroupChild = useGraph((s) => s.removeGroupChild)
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
  // A dr tile is titled by its axis (Dose-response / Time-response), like everywhere else.
  const headLabel = plotLabel(headKind, activeChild ? activeChild.config : node.data.config)
  const ops = CATEGORIES[category].ops

  return (
    // Embedded (the form workflow): flow with the page instead of floating as a fixed-width card
    // — no shadow, no width cap, and no inner scroller fighting the page's own.
    <div
      data-config-panel={id}
      style={embedded ? { ...styles.panel, ...styles.panelEmbedded } : styles.panel}
    >
      <div style={{ ...styles.head, borderTopColor: accentOf(category) }}>
        <div style={styles.headText}>
          <span style={{ ...styles.headCat, color: accentOf(category) }}>
            {CATEGORIES[category].label}
          </span>
          <span style={styles.headTitle}>{isGroup ? `Group · ${headLabel}` : headLabel}</span>
          <span style={styles.headId}>{node.id}</span>
        </div>
        <div style={styles.headActions}>
          {/* Same chrome for both; the trash is red like the workflow/folder menus' delete. */}
          <button
            style={styles.iconBtnSm}
            title="Duplicate"
            aria-label="Duplicate"
            onClick={() => duplicateNode(id)}
          >
            <IconCopy />
          </button>
          {/* On a group the panel shows ONE plot, so delete removes just that plot (the tile itself
              goes only when its last plot does — see removeGroupChild). */}
          <button
            style={{ ...styles.iconBtnSm, color: '#e15759' }}
            title={activeChild ? `Remove ${headLabel} from group` : 'Delete'}
            aria-label={activeChild ? 'Remove plot from group' : 'Delete'}
            onClick={() => (activeChild ? removeGroupChild(id, activeChild.id) : deleteNode(id))}
          >
            <IconTrash />
          </button>
        </div>
      </div>
      <div style={embedded ? styles.scrollEmbedded : styles.scroll}>
        {inputs && <Section title={inputs.title}>{inputs.body}</Section>}
        {/* A group's subcards are managed on the tile itself (add-plot menu + the card stack);
            the panel shows only the active subcard's config. */}
        {isGroup
          ? !activeChild && <div style={styles.hint}>Empty group — add a plot on the tile.</div>
          : ops.length > 1 && (
              // The operation picker sits in the section header, right of the title.
              <Section
                title="Operation"
                action={
                  <div style={{ width: 120 }}>
                    <Select
                      value={kind}
                      onChange={(v) => changeOp(id, v as NodeKind)}
                      options={ops.map((o) => ({ value: o, label: NODE_SPECS[o].label }))}
                    />
                  </div>
                }
              >
                {null}
              </Section>
            )}
        {kind === 'load' && <LoadPanel id={id} config={node.data.config as LoadConfig} />}
        {kind === 'standardize' && (
          <StandardizePanel id={id} config={node.data.config as StandardizeConfig} />
        )}
        {kind === 'merge' && <MergePanel id={id} />}
        {kind === 'compare' && <ComparePanel id={id} config={node.data.config as CompareConfig} />}
        {kind === 'contrast' && (
          <>
            <ContrastPanel id={id} config={node.data.config as ContrastConfig} />
            <ContrastStatPanel id={id} config={node.data.config as ContrastConfig} />
          </>
        )}
        {/* Standalone plot node: its own config bound to updateConfig. */}
        {!isGroup && (
          <PlotConfig
            kind={kind}
            config={node.data.config}
            update={(p) => updateConfig(id, p)}
            edgeNodeId={id}
          />
        )}
        {/* Group subcard: the active child's config, bound to updateChildConfig; the upstream is
            found via the group's edge. */}
        {isGroup && activeChild && (
          <PlotConfig
            kind={activeChild.kind}
            config={activeChild.config}
            update={(p) => updateChildConfig(id, activeChild.id, p)}
            edgeNodeId={id}
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
  const [dialogOpen, setDialogOpen] = useConfigWindowOpen(id)
  const [refreshState, setRefreshState] = useState<'idle' | 'busy' | 'done'>('idle')
  const opts = [{ value: '', label: '—' }, ...inputFiles.map((f) => ({ value: f, label: f }))]
  // The matrix may be an external file (absolute path) picked from outside the data folder — surface
  // it as a selectable option so the dropdown shows it instead of falling back to blank.
  const matrixExternal = !!config.matrix && !inputFiles.includes(config.matrix)
  const matrixOpts = matrixExternal
    ? [
        ...opts,
        { value: config.matrix!, label: `${config.matrix!.replace(/^.*[\\/]/, '')} (external)` }
      ]
    : opts
  // Browse the whole filesystem for a matrix (not restricted to the data folder). The generated
  // standard files still go into the project's data folder on convert.
  const browseMatrix = async (): Promise<void> => {
    const path = await window.api.pickDataFile()
    if (path) update(id, { matrix: path })
  }
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
        <ToggleSwitch
          label="Import mode"
          value={mode}
          options={[
            { value: 'interactive' as const, label: 'Interactive' },
            { value: 'manual' as const, label: 'Manual' }
          ]}
          onChange={(m) => update(id, { mode: m })}
        />
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
            {/* Stacked: the header on its own line, then Browse + the file dropdown below, so a long
                filename gets the full panel width instead of sharing the row with the label. */}
            <div style={styles.fieldCol}>
              <label style={styles.fieldColLabel}>raw data</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                <button
                  style={styles.btn}
                  onClick={() => void browseMatrix()}
                  title="Choose a data file from anywhere on disk"
                >
                  Browse…
                </button>
                <Select
                  value={config.matrix ?? ''}
                  onChange={(v) => update(id, { matrix: v || null })}
                  options={matrixOpts}
                />
              </div>
            </div>
            {converted ? (
              <StatusNote kind="ok">Ready · generated {config.data}</StatusNote>
            ) : (
              <StatusNote kind="warn">Not configured — pipeline blocked</StatusNote>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <ConfigureButton
                label={converted ? 'Edit samples…' : 'Configure samples…'}
                disabled={!config.matrix}
                title={config.matrix ? undefined : 'Choose the raw data file first'}
                onClick={() => setDialogOpen(true)}
              />
            </div>
            {dialogOpen && <InteractiveImportDialog id={id} onClose={() => setDialogOpen(false)} />}
          </>
        )}
      </Section>
    </>
  )
}

/** Clean data's Data scale: the distribution of its input values — read straight from the upstream
 *  Load step's data file, so it shows before any run — the scale detected from them, the
 *  log-transform its values are presented on (none / log10 / log2; log10 by default for linear
 *  input, none for already-logged), and the distribution after that transform. Analyses always
 *  work from exact linear values (logged input is converted on the way in), so the choice sets
 *  what the table and the written data show, never a double log. */
function DataScaleSection({
  id,
  config,
  std
}: {
  id: string
  config: StandardizeConfig
  std: StandardizeResult | null
}) {
  const setLogTransform = useGraph((s) => s.setStdLogTransform)
  const previewStdScale = useGraph((s) => s.previewStdScale)
  // The upstream data file's name, so the preview re-reads when the Load step points elsewhere.
  const dataFile = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === id)?.source
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    return up && isStep(up) && up.data.kind === 'load'
      ? ((up.data.config as LoadConfig).data ?? '')
      : ''
  })
  const [preview, setPreview] = useState<ScalePreview | null | 'loading'>('loading')
  useEffect(() => {
    let live = true
    // Reset before reading: the state is the preview OF this file, so a change starts it over.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview('loading')
    previewStdScale(id)
      .then((p) => live && setPreview(p))
      .catch(() => live && setPreview(null))
    return () => {
      live = false
    }
  }, [id, dataFile, previewStdScale])

  // The data file's preview when there is one; else what the last run recorded.
  const ready = preview !== 'loading' && preview !== null ? preview : null
  const detected = ready?.inputScale ?? std?.inputScale
  const value: LogTransform | '' =
    config.logTransform ?? (detected ? defaultTransform(detected) : '')
  const out = detected ? outputScale(value || undefined, detected) : undefined
  const histIn = useMemo(
    () => (ready ? histogram(ready.sample) : (std?.inputHistogram ?? null)),
    [ready, std]
  )
  // The same values as they'll be presented: back to linear from the detected scale, then onto the
  // output one (a non-positive value has no log, so it drops out).
  const histOut = useMemo(() => {
    if (!ready || !detected || !out || out === detected) return null
    const vals: number[] = []
    for (const v of ready.sample) {
      const t = fromLinear(toLinear(v, detected), out)
      if (t != null) vals.push(t)
    }
    return histogram(vals)
  }, [ready, detected, out])
  const fmt = (v: number): string =>
    !Number.isFinite(v)
      ? '—'
      : Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-2)
        ? v.toExponential(1)
        : v.toFixed(Math.abs(v) >= 100 ? 0 : 2)
  return (
    <Section
      title="Log-transform"
      // The log-transform sits in the header, right-aligned: the section's one setting.
      action={
        <ToggleSwitch
          label="Log-transform"
          value={value}
          options={[
            { value: 'none' as const, label: 'none' },
            { value: 'log10' as const, label: 'log10' },
            { value: 'log2' as const, label: 'log2' }
          ]}
          // Display-only (analyses read linear rows) — so no re-run, the table just re-presents.
          onChange={(v) => setLogTransform(id, v as LogTransform)}
        />
      }
    >
      {preview === 'loading' && !histIn ? (
        <div style={styles.hint}>Reading the data…</div>
      ) : histIn && histIn.counts.length > 0 ? (
        <ValueHistogramView
          hist={histIn}
          fmt={fmt}
          caption="as loaded"
          // Whether the shape looks normal — to check against the histogram it heads.
          note={shapeNote(histogramShape(histIn))}
        />
      ) : (
        <div style={styles.hint}>
          No data to preview yet — set the Load step’s data file (an interactive import: convert it
          first).
        </div>
      )}
      {histOut && (
        <>
          <ValueHistogramView
            hist={histOut}
            fmt={fmt}
            caption={`after ${out}`}
            note={shapeNote(histogramShape(histOut))}
          />
        </>
      )}
    </Section>
  )
}

/** Whether a histogram looks normal, under its caption: a symmetric hump reads fine; a skewed
 *  shape — raw intensities' pile near zero and long tail — is a warning. */
const shapeNote = (shape: Shape | undefined): ReactNode =>
  shape ? (
    <StatusNote kind={shape === 'normal' ? 'ok' : 'warn'} inline>
      Detected: <b>{shape}</b>
    </StatusNote>
  ) : undefined

/** A compact histogram of values (SVG), with the range beneath — enough to see the shape: raw
 *  intensities pile up near zero with a long tail, logged values sit in a hump. */
function ValueHistogramView({
  hist,
  fmt,
  caption,
  note
}: {
  hist: ValueHistogram
  fmt: (v: number) => string
  /** what this distribution is (as loaded / after a transform), shown left of it */
  caption?: string
  /** shown under the caption (the detected-scale warning) */
  note?: ReactNode
}): ReactNode {
  const W = 240
  const H = 36
  const peak = Math.max(1, ...hist.counts)
  const bw = W / hist.counts.length
  return (
    <div style={styles.histWrap}>
      {(caption || note) && (
        <div style={styles.histHead}>
          {caption && <span style={styles.histCaption}>{caption}</span>}
          {note}
        </div>
      )}
      <div style={styles.histChart}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={styles.histSvg}
          role="img"
          aria-label={`Distribution of ${hist.n} values from ${fmt(hist.min)} to ${fmt(hist.max)}`}
        >
          {hist.counts.map((c, i) => {
            const h = (c / peak) * (H - 2)
            return (
              <rect
                key={i}
                x={i * bw + 0.5}
                y={H - h}
                width={Math.max(0.5, bw - 1)}
                height={h}
                fill={UI.accent}
                opacity={0.75}
              />
            )
          })}
        </svg>
        <div style={styles.histAxis}>
          <span>{fmt(hist.min)}</span>
          <span>{fmt(hist.max)}</span>
        </div>
      </div>
    </div>
  )
}

function StandardizePanel({ id, config }: { id: string; config: StandardizeConfig }) {
  const update = useGraph((s) => s.updateConfig)
  const std = useGraph((s) => {
    const r = s.results[id]
    return r?.kind === 'standardize' ? r.std : null
  })
  // Custom conditions declared on the upstream Load tile, so the clean-up checkboxes offer them
  // before this tile has ever run (after a run `std.activeConditions` carries them anyway).
  const upstreamCustom = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === id)?.source
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    const cfg = up && isStep(up) ? (up.data.config as LoadConfig) : undefined
    return (cfg?.interactive?.customConditions ?? []).join('\u0001')
  })
  const conds = useMemo(() => {
    const declared = upstreamCustom ? upstreamCustom.split('\u0001').map(customCond) : []
    return orderConds([...CONDS, ...(std?.activeConditions ?? []), ...declared])
  }, [std, upstreamCustom])
  const geneTotal = useMemo(() => (std ? new Set(std.rows.map((r) => r.uniqID)).size : 0), [std])
  const r2 = (v: number): number => Math.round(v * 100) / 100
  return (
    <>
      <DataScaleSection id={id} config={config} std={std} />
      <Section
        title="Clean-up"
        action={
          <OnOffSwitch
            on={cleanupOn(config)}
            label="Clean-up"
            onChange={(on) =>
              // First switch-on with no threshold yet → a sensible starting point.
              update(id, {
                cleanupEnabled: on,
                ...(on && !(config.minSamplePct > 0) ? { minSamplePct: 50 } : null)
              })
            }
          />
        }
      >
        <div style={styles.hint}>Drop low coverage genes.</div>
        {cleanupOn(config) && (
          <>
            <Field label="Min. coverage">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 90 }}>
                <NumberInput
                  value={config.minSamplePct ?? 0}
                  step={5}
                  min={0}
                  max={100}
                  onChange={(v) =>
                    update(id, { minSamplePct: Math.min(100, Math.max(0, Math.round(v))) })
                  }
                />
                <span style={{ color: UI.textMuted, fontSize: 12 }}>%</span>
              </div>
            </Field>
            {/* Which conditions the coverage is judged within. The sentence below restates the
                rule for the current choice, which reads far more plainly than describing "groups". */}
            <Field label="Coverage per">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 12px' }}>
                {conds.map((c) => {
                  const by = config.minSamplePctBy ?? []
                  const on = by.includes(c)
                  return (
                    <label key={c} style={{ ...styles.checkRow, marginBottom: 0 }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          update(id, {
                            minSamplePctBy: e.target.checked
                              ? conds.filter((k) => k === c || by.includes(k))
                              : by.filter((k) => k !== c)
                          })
                        }
                      />
                      {condLabel(c)}
                    </label>
                  )
                })}
              </div>
            </Field>
            <div style={styles.hint}>
              {(() => {
                const pct = config.minSamplePct ?? 0
                const by = config.minSamplePctBy ?? []
                const where =
                  by.length === 0
                    ? 'all samples'
                    : `samples in at least one ${by.join(' × ')} group`
                return `Keep genes detected in ≥ ${pct}% of ${where}.`
              })()}
            </div>
          </>
        )}
        {cleanupOn(config) && std && (std.cleanup?.droppedGenes ?? 0) > 0 && (
          <StatusNote kind="ok">
            Dropped {std.cleanup.droppedGenes.toLocaleString()} of{' '}
            {(std.cleanup.droppedGenes + geneTotal).toLocaleString()} genes
          </StatusNote>
        )}
      </Section>
      {/* Imputation runs after clean-up, so it fills only the gaps in genes that were kept. */}
      <Section
        title="Imputation"
        subtitle={
          cleanupOn(config) ? undefined : (
            <StatusNote kind="info" inline>
              enabled upon clean-up
            </StatusNote>
          )
        }
        action={
          <OnOffSwitch
            on={imputeOn(config)}
            label="Imputation"
            disabled={!cleanupOn(config)}
            onChange={(on) => update(id, { imputeEnabled: on })}
          />
        }
      >
        <div style={styles.hint}>
          Fill missing values assuming limits of detection for each sample (Perseus).
        </div>
        {imputeOn(config) && (
          <>
            {/* Perseus draws each gap from a normal distribution shifted below (and narrower than)
                the sample's own log-intensity distribution — the "below detection" model. */}
            <Field label="downshift">
              <div style={styles.cutoffRow}>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={config.imputeShift ?? IMPUTE_DEFAULTS.shift}
                    step={0.1}
                    min={0}
                    onChange={(v) => update(id, { imputeShift: Math.max(0, r2(v)) })}
                  />
                </div>
                <span style={styles.inlineTag}>× sample SD</span>
              </div>
            </Field>
            <Field label="width">
              <div style={styles.cutoffRow}>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={config.imputeWidth ?? IMPUTE_DEFAULTS.width}
                    step={0.05}
                    min={0.01}
                    onChange={(v) => update(id, { imputeWidth: Math.max(0.01, r2(v)) })}
                  />
                </div>
                <span style={styles.inlineTag}>× sample SD</span>
              </div>
            </Field>
            <div style={styles.hint}>
              Impute genes with a normal distribution with SD of{' '}
              {config.imputeWidth ?? IMPUTE_DEFAULTS.width} × sample SD, centred at{' '}
              {config.imputeShift ?? IMPUTE_DEFAULTS.shift} × sample SD below sample mean.
            </div>
          </>
        )}
        {imputeOn(config) && std?.imputation && (
          <StatusNote kind="ok">
            Imputed {std.imputation.imputed.toLocaleString()} of{' '}
            {std.imputation.total.toLocaleString()} values
          </StatusNote>
        )}
      </Section>
    </>
  )
}

/** How many comparisons the configured comparison would run (a dry-run count for the ready
 *  message): distinct num|den labels for an explicit compare, or the interaction groups for a
 *  two-way ANOVA. Null if it can't be determined (not configured / incomplete). */
function comparisonCount(
  std: StandardizeResult,
  config: CompareConfig
): { n: number; on: ConditionKey[] } | null {
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
      const n = previewTwoWay({
        rows: std.rows,
        factors: [
          { condition: config.condition, pairs: p1 },
          { condition: config.condition2, pairs: p2 }
        ],
        activeConditions: std.activeConditions
      }).groups
      return { n, on: [config.condition, config.condition2] }
    }
    const n = previewCompare({
      rows: std.rows,
      num: config.num,
      den: config.den,
      match: config.match,
      activeConditions: std.activeConditions
    }).labels.length
    const on = classifyConditions(std.rows, config.num, config.den, std.activeConditions).axis
    return { n, on }
  } catch {
    return null
  }
}

/** Merge has no settings — what it pools is the wiring. What it DOES need to show is whether the
 *  pooling meant anything: datasets are matched by uniqID, so two inputs that share few ids merge
 *  into a mostly-sparse table, and nothing else in the pipeline would tell you. */
function MergePanel({ id }: { id: string }) {
  // Same shallow-select-then-memo pattern as ComparePanel: the result refs are stable, the derived
  // numbers are not.
  const stds = useGraph(
    useShallow((s) =>
      s.edges
        .filter((e) => e.target === id)
        .map((e) => s.results[e.source])
        .filter((r) => r?.kind === 'standardize')
        .map((r) => (r as { std: StandardizeResult }).std)
    )
  )
  const inputCount = useGraph((s) => s.edges.filter((e) => e.target === id).length)
  const stats = useMemo(() => {
    if (stds.length === 0) return null
    const idSets = stds.map((d) => new Set(d.rows.map((r) => r.uniqID)))
    const union = new Set<string>()
    for (const set of idSets) for (const u of set) union.add(u)
    const shared = [...union].filter((u) => idSets.every((set) => set.has(u))).length
    return { per: idSets.map((set) => set.size), union: union.size, shared }
  }, [stds])

  return (
    <Section title="Merge">
      <Field label="inputs">
        <div style={{ fontSize: 12 }}>
          {inputCount === 0
            ? 'Connect two or more Clean data tiles.'
            : stds.length < inputCount
              ? `${stds.length} of ${inputCount} inputs have run.`
              : `${inputCount} dataset${inputCount === 1 ? '' : 's'}${
                  inputCount === 1 ? ' — passes through unchanged' : ''
                }`}
        </div>
      </Field>
      {stats && stds.length > 1 && (
        <Field label="features">
          <div style={{ fontSize: 12 }}>
            {stats.per.join(' / ')} per input · {stats.union.toLocaleString()} pooled ·{' '}
            {stats.shared.toLocaleString()} shared by all
          </div>
        </Field>
      )}
    </Section>
  )
}

/** A Compare's significance calls: FDR control, the threshold type and its cutoffs, and the effect
 *  class names. Shown on the Compare step, and again on a volcano fed by it — the same settings,
 *  written to the Compare, so tuning the calls is possible from the plot that shows them. */
function CompareStatisticSection({
  id,
  config,
  subtitle
}: {
  /** the Compare step the settings belong to */
  id: string
  config: CompareConfig
  subtitle?: ReactNode
}) {
  const update = useGraph((s) => s.updateConfig)
  const t = config.threshold
  // The significance statistic the FDR switch selects — names both the switch and the cutoff row.
  // Shown as the plain P/Q value; the stored threshold (and every plot) stays −log10.
  const statLabel = t.statType === 'pQ' ? 'Q-value' : 'P-value'
  // Cutoff edits re-classify the stored result live (like dragging a volcano guide) — only the
  // correction method changes the q-values themselves, which needs a re-run.
  const setThreshold = useGraph((s) => s.setCompareThreshold)
  const setT = (partial: Partial<CompareConfig['threshold']>) =>
    'fdrMethod' in partial
      ? update(id, { threshold: { ...t, ...partial } })
      : setThreshold(id, partial)
  const r2 = (v: number): number => Math.round(v * 100) / 100
  const asym = t.asymmetric ?? false
  const mirrorTitle = asym ? undefined : 'Mirrors the up cutoff — switch on asymmetric to edit'
  // First line of the effect-size block (same level as the cutoff rows): the asymmetric switch.
  const asymRow = (
    <div style={styles.cutoffRow}>
      <span style={styles.inlineTag}>asymmetric</span>
      <OnOffSwitch
        on={asym}
        label="asymmetric effect size"
        onChange={(on) => setT({ asymmetric: on })}
      />
    </div>
  )
  // Effect class names are display-only (legends/tables), so they bypass updateConfig and never
  // stale the result.
  const labels = effectLabelsOf(config)
  const setLabels = useGraph((s) => s.setCompareEffectLabels)

  return (
    <Section title="Statistic" subtitle={subtitle}>
      <Field label="FDR control">
        {/* Which statistic drives the significance calls: raw p (off), or the adjusted q (on). */}
        <OnOffSwitch
          on={t.statType === 'pQ'}
          label="FDR control"
          onChange={(on) => setT({ statType: on ? 'pQ' : 'pP' })}
        />
      </Field>
      {t.statType === 'pQ' && (
        <Field label="method">
          <Select
            value={t.fdrMethod ?? 'bh'}
            onChange={(v) => setT({ fdrMethod: v as Exclude<FdrMethod, 'none'> })}
            options={[
              { value: 'bh', label: 'Benjamini–Hochberg (FDR)' },
              { value: 'bonferroni', label: 'Bonferroni (FWER)' }
            ]}
          />
        </Field>
      )}
      <Field label="threshold type">
        <Select
          value={t.type}
          onChange={(v) => setT({ type: v as 'linear' | 'non-linear' })}
          options={[
            { value: 'linear', label: 'linear cutoff' },
            { value: 'non-linear', label: 'hyperbolic boundary' }
          ]}
        />
      </Field>
      {/* Effect size: asymmetric switch, then one line per class (up first) — the cutoff and
          the name the class shows under. Symmetric (default): the down cutoff mirrors the up one
          (store keeps them in lock-step), so its box is read-only. */}
      {t.type === 'linear' ? (
        <>
          <Field label="effect size" top>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {asymRow}
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>log₂FC ≥</span>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={t.fcHigh}
                    step={0.1}
                    onChange={(v) => setT({ fcHigh: r2(v) })}
                  />
                </div>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput value={labels.up} onCommit={(v) => setLabels(id, { up: v })} />
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>log₂FC ≤</span>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={t.fcLow}
                    step={0.1}
                    disabled={!asym}
                    title={mirrorTitle}
                    onChange={(v) => setT({ fcLow: r2(v) })}
                  />
                </div>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput
                  value={labels.down}
                  onCommit={(v) => setLabels(id, { down: v })}
                />
              </div>
            </div>
          </Field>
          {/* Named after the statistic the FDR switch selects, so the cutoff reads as one unit. */}
          <Field label="significance">
            <div style={styles.cutoffRow}>
              <span style={styles.inlineTag}>{statLabel} ≤</span>
              <div style={styles.cutoffBox}>
                <PValueInput statMin={t.statMin} onChange={(v) => setT({ statMin: v })} />
              </div>
            </div>
          </Field>
        </>
      ) : (
        <>
          {/* SAM hyperbola stat = P_lim + b/(|FC| − FC_lim); stored as s0 = −FC_lim, with an
              optional down-side asymptote s0Down (asymmetric mode; otherwise mirrors s0). */}
          <Field label="effect size" top>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {asymRow}
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>log₂FC ≥</span>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={-t.s0}
                    step={0.1}
                    onChange={(v) => setT({ s0: -Math.max(0, r2(v)) })}
                  />
                </div>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput value={labels.up} onCommit={(v) => setLabels(id, { up: v })} />
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>log₂FC ≤</span>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={t.s0Down ?? t.s0}
                    step={0.1}
                    disabled={!asym}
                    title={mirrorTitle}
                    onChange={(v) => setT({ s0Down: -Math.max(0, r2(Math.abs(v))) })}
                  />
                </div>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput
                  value={labels.down}
                  onCommit={(v) => setLabels(id, { down: v })}
                />
              </div>
            </div>
          </Field>
          <Field label="significance">
            <div style={styles.cutoffRow}>
              <span style={styles.inlineTag}>{statLabel} ≤</span>
              <div style={styles.cutoffBox}>
                <PValueInput statMin={t.statMin} onChange={(v) => setT({ statMin: v })} />
              </div>
            </div>
          </Field>
          {/* b: how far the curve bows away from its asymptotes — larger = stricter. */}
          <Field label="stringency">
            <div style={styles.cutoffRow}>
              <span style={styles.inlineTag}>b =</span>
              <div style={styles.cutoffBox}>
                <NumberInput
                  value={t.b}
                  step={0.1}
                  onChange={(v) => setT({ b: Math.max(0.01, r2(v)) })}
                />
              </div>
            </div>
          </Field>
        </>
      )}
    </Section>
  )
}

function ComparePanel({ id, config: rawConfig }: { id: string; config: CompareConfig }) {
  const config = normalizeCompareConfig(rawConfig)
  const configured = isCompareConfigured(config)
  const update = useGraph((s) => s.updateConfig)
  const [dialogOpen, setDialogOpen] = useConfigWindowOpen(id)
  // Compare accepts up to two Standardize inputs; combine them into one pooled dataset (matched by
  // uniqID) so the comparison selectors offer the union of both datasets' conditions/values. Select
  // the upstream std refs shallowly (stable across unrelated edits), then combine in a memo — a
  // single input passes through unchanged.
  const stds = useGraph(
    useShallow((s) =>
      s.edges
        .filter((e) => e.target === id)
        .map((e) => s.results[e.source])
        .filter((r) => r?.kind === 'standardize')
        .map((r) => (r as { std: StandardizeResult }).std)
    )
  )
  const std = useMemo(() => (stds.length ? combineStandardize(stds) : null), [stds])

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
  const readyMsg = nComparisons
    ? `Ready, ${nComparisons.n} comparison${nComparisons.n === 1 ? '' : 's'}${nComparisons.on.length ? ` on ${nComparisons.on.join(', ')}` : ''}`
    : 'Ready'

  return (
    <>
      <Section
        title="Comparison"
        action={
          <ConfigureButton
            label="Configure…"
            disabled={!std}
            title={std ? undefined : 'Run the upstream Clean data first'}
            onClick={() => setDialogOpen(true)}
          />
        }
      >
        {dialogOpen && std && (
          <ComparisonDialog
            id={id}
            rows={std.rows}
            active={std.activeConditions}
            initial={{
              num: config.num,
              den: config.den,
              match: config.match,
              analysis: config.analysis
            }}
            onClose={() => setDialogOpen(false)}
          />
        )}
        <Checkbox
          label="log₂-transform before testing"
          checked={config.transform}
          onChange={(v) => update(id, { transform: v })}
        />
        {configured ? (
          <StatusNote kind="ok">{readyMsg}</StatusNote>
        ) : (
          <StatusNote kind="warn">Not configured — pipeline blocked</StatusNote>
        )}
      </Section>
      <CompareStatisticSection id={id} config={config} />
    </>
  )
}

function ContrastPanel({ id, config }: { id: string; config: ContrastConfig }) {
  // Select only the *stable* store slices and derive in memos — building arrays inside the selector
  // would return a fresh reference on every call, fail Zustand's equality check and loop forever.
  const edges = useGraph((s) => s.edges)
  const results = useGraph((s) => s.results)
  const nodes = useGraph((s) => s.nodes)
  const [dialogOpen, setDialogOpen] = useConfigWindowOpen(id)

  // ── every wired input (any number), in edge order ──
  const inputs: PairInput[] = useMemo(
    () =>
      edges
        .filter((e) => e.target === id)
        .map((e) => {
          const r = results[e.source]
          const n = nodes.find((x) => x.id === e.source)
          const name =
            (n && isStep(n) ? n.data.name : undefined)?.trim() || '' || (r?.kind ?? 'input')
          return { id: e.source, name, result: r }
        }),
    [edges, results, nodes, id]
  )
  const inputIds = useMemo(() => inputs.map((i) => i.id), [inputs])
  // ── intra-dataset mode: the groups are selected from ONE input (the configured pick) ──
  const from = selectSource(config, inputIds)
  const { rows: selRows, present } = useMemo(
    () => selectorRowsOf(inputs.find((i) => i.id === from)?.result),
    [inputs, from]
  )

  // ── inter-dataset mode: the two inputs currently chosen as A/B ──
  const sides = pairSides(config, inputIds)
  const A = sides ? inputs.find((i) => i.id === sides[0]) : undefined
  const B = sides ? inputs.find((i) => i.id === sides[1]) : undefined
  const pairReady =
    !!A && !!B && isPairable(A.result) && isPairable(B.result) && A.result!.kind === B.result!.kind

  const match = useMemo(() => config.match ?? [], [config.match])
  // Status-line summaries, worded like the selector window's preview table:
  //   intra: "Ready, n contrasts on cmpd: E28 vs DMSO"      (group A vs group B)
  //   inter: "Ready, n contrasts: KO (…) vs WT (…)"          (dataset A vs dataset B)
  const intraSummary = useMemo(
    () =>
      isContrastConfigured(config) && selRows.length
        ? contrastSummary(selRows, config.num ?? {}, config.den ?? {}, match, present)
        : null,
    [config, selRows, match, present]
  )
  const interSummary = useMemo(() => {
    if (!pairReady) return null
    const p = previewContrastPair(
      toContrastSide(A!.result),
      toContrastSide(B!.result),
      match,
      { a: A!.name, b: B!.name },
      config.pairFix
    )
    if (p.warnings.length > 0) return null
    const first = p.rows[0]
    return {
      groups: p.groups,
      on: p.matched,
      nameA: first?.[0] ?? A!.name,
      nameB: first?.[2] ?? B!.name
    }
  }, [pairReady, A, B, match, config.pairFix])
  const contrastsMsg = (n: number, on: ConditionKey[], nameA: string, nameB: string): string =>
    `Ready, ${n} contrast${n === 1 ? '' : 's'}${on.length ? ` on ${on.join(', ')}` : ''}: ${nameA} vs ${nameB}`
  // One input ⇒ intra-dataset only; two or more ⇒ the config's choice (inter by default).
  const source = resolveContrastSource(config, inputs.length)
  const canConfigure = inputs.some((i) => isPairable(i.result))
  const configureBlocked = 'Connect and run an upstream Compare or Clean data first'

  return (
    <Section
      title="Contrast"
      // Top-right, like the dialog's t-test / 2-way ANOVA pill: which inputs the contrast draws
      // The same inline Configure… as the Compare tile; the intra-/inter-dataset mode shows in the
      // window's header (like the comparison dialog's t-test / 2-way ANOVA pill), set by wiring.
      action={
        <ConfigureButton
          label="Configure…"
          disabled={!canConfigure}
          title={canConfigure ? undefined : configureBlocked}
          onClick={() => setDialogOpen(true)}
        />
      }
    >
      {source === 'select' ? (
        <>
          {intraSummary ? (
            <StatusNote kind="ok">
              {contrastsMsg(
                intraSummary.groups,
                intraSummary.axis,
                intraSummary.nameA,
                intraSummary.nameB
              )}
            </StatusNote>
          ) : (
            <StatusNote kind="warn">Not configured — pipeline blocked</StatusNote>
          )}
        </>
      ) : (
        <>
          {interSummary ? (
            <StatusNote kind="ok">
              {contrastsMsg(interSummary.groups, [], interSummary.nameA, interSummary.nameB)}
            </StatusNote>
          ) : pairReady ? (
            <StatusNote kind="warn">Not configured — pipeline blocked</StatusNote>
          ) : (
            <StatusNote kind="warn">
              The two datasets must be the same kind and run — two Compares, or two Clean data.
            </StatusNote>
          )}
        </>
      )}
      {dialogOpen && (
        <ComparisonDialog
          // Keyed on the wiring: the window reads its inputs and source mode at mount, and docked in
          // the form workflow it stays open while the inputs are rewired beside it.
          key={inputIds.join(',')}
          variant="contrast"
          id={id}
          rows={selRows}
          active={present}
          initial={{
            num: config.num ?? {},
            den: config.den ?? {},
            match,
            source,
            pairA: config.pairA,
            pairB: config.pairB,
            selectFrom: from,
            pairFix: config.pairFix,
            matchSet: config.match != null
          }}
          pair={inputs}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </Section>
  )
}

/** The divergence statistic: correlated (OLS fit of A on B, genes outside its prediction band
 *  diverge) or, off, a linear cutoff per axis (robust z → BH q, plus an optional |value| floor). */
function ContrastStatPanel({ id, config }: { id: string; config: ContrastConfig }) {
  const update = useGraph((s) => s.updateConfig)
  const correlated = config.relationship !== 'independent'
  const setStat = (patch: Partial<ContrastStat>): void =>
    update(id, { stat: { ...config.stat, ...patch } })
  const t = statTails(config.stat)
  // The two sides are "groups" of one dataset (intra) or two "datasets" (inter), per the wiring.
  const inputCount = useGraph((s) => s.edges.filter((e) => e.target === id).length)
  const sideWord = resolveContrastSource(config, inputCount) === 'pair' ? 'dataset' : 'group'
  const asym = config.stat?.asymmetric ?? false
  // Shown as the TAIL — the % called on that side (1 − confidence): "top 1%" reads more
  // directly than "99% confidence". Stored as confidence / q as before.
  const pctOf = (c: number): number => Math.round((1 - c) * 1000) / 10
  const clamp = (v: number): number => Math.min(0.999, Math.max(0.5, 1 - v / 100))
  const qOf = (c: number): number => Math.round((1 - c) * 1000) / 1000
  // The primary level drives both models' fields, so switching model keeps it.
  const setPrimary = (v: number): void => {
    const c = clamp(v)
    setStat({ bandConfidence: c, cutoffQ: qOf(c) })
  }
  const unit = correlated ? '% outside the band' : '%'
  const confBox = (value: number, onChange: (v: number) => void, disabled: boolean): ReactNode => (
    <div style={styles.pctBox}>
      <NumberInput
        value={pctOf(value)}
        step={0.5}
        min={0.1}
        max={50}
        disabled={disabled}
        title={disabled ? 'Mirrors the top tail — switch on asymmetric to edit' : undefined}
        onChange={onChange}
      />
    </div>
  )
  const confRow = (
    tag: string,
    value: number,
    onChange: (v: number) => void,
    disabled: boolean
  ): ReactNode => (
    <div style={styles.cutoffRow}>
      <span style={styles.inlineTag}>{tag}</span>
      {confBox(value, onChange, disabled)}
      <span style={styles.inlineTag}>{unit}</span>
    </div>
  )
  const setTail = (tail: 'aDown' | 'bUp' | 'bDown') => (v: number) =>
    setStat({ cutoffQTails: { ...config.stat?.cutoffQTails, [tail]: qOf(clamp(v)) } })
  return (
    <Section title="Statistic">
      <Field label="correlated">
        <OnOffSwitch
          on={correlated}
          label="correlated"
          onChange={(on) => update(id, { relationship: on ? 'correlated' : 'independent' })}
        />
      </Field>
      {/* One model per mode today; a selector anyway so the choice reads as a choice (and has
          room for more models later). */}
      <Field label="model">
        <Select
          value={correlated ? 'identity' : 'linear'}
          onChange={() => undefined}
          options={
            correlated
              ? [{ value: 'identity', label: 'linear correlation (y = x)' }]
              : [{ value: 'linear', label: 'linear cutoff' }]
          }
        />
      </Field>
      {/* One cutoff for both models, entered as the tail called (top 1% = 99% confidence): the
          prediction band's level when correlated, q per axis under the linear cutoff (both fields
          are written together so switching model keeps the number). Asymmetric: the correlation
          band has two tails (top / bottom of the line); the linear cutoff has four (each axis,
          A = y and B = x, top / bottom of its centre). Mirrored boxes are disabled, like Compare's
          effect-size cutoffs. */}
      <Field label="cutoff" top>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={styles.cutoffRow}>
            <span style={styles.inlineTag}>asymmetric</span>
            <OnOffSwitch
              on={asym}
              label="asymmetric confidence"
              onChange={(on) => setStat({ asymmetric: on })}
            />
          </div>
          {correlated ? (
            <>
              {confRow('top', t.confUp, setPrimary, false)}
              {confRow(
                'bottom',
                t.confDown,
                (v) => setStat({ bandConfidenceDown: clamp(v) }),
                !asym
              )}
            </>
          ) : (
            <>
              {/* Per axis: its name on one line, then the up and down tails side by side (the
                  panel is too narrow for name + two boxes on one row). */}
              <span style={styles.sideTag}>{sideWord} A (y-axis)</span>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>top</span>
                {confBox(1 - t.q.aUp, setPrimary, false)}
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>bottom</span>
                {confBox(1 - t.q.aDown, setTail('aDown'), !asym)}
                <span style={styles.inlineTag}>%</span>
              </div>
              <span style={styles.sideTag}>{sideWord} B (x-axis)</span>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>top</span>
                {confBox(1 - t.q.bUp, setTail('bUp'), !asym)}
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>bottom</span>
                {confBox(1 - t.q.bDown, setTail('bDown'), !asym)}
                <span style={styles.inlineTag}>%</span>
              </div>
            </>
          )}
        </div>
      </Field>
    </Section>
  )
}

/** Common props for every plotting panel. `update` is already bound to the right
 *  target (a node's config, or a subcard's config inside a group). `edgeNodeId` is the
 *  id whose incoming edge points at the plot's upstream — the plot node itself, or the
 *  group node for a subcard (a subcard has no edge of its own). */
interface PlotPanelProps<C> {
  config: C
  update: (patch: Record<string, unknown>) => void
  edgeNodeId: string
}

/** The upstream node a plot panel hangs off (its incoming edge's source), for facts the panel
 *  shows but doesn't own — the Compare's effect names, a Contrast's relationship. */
function useUpstreamNode(edgeNodeId: string) {
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  return useGraph((s) => (upId ? s.nodes.find((n) => n.id === upId) : undefined))
}

/** The up/down class names a point plot's legend shows — the upstream Compare's effect labels
 *  (a Contrast fed by a Compare inherits nothing here; it falls back to up/down). */
function useEffectNames(edgeNodeId: string): { up: string; down: string } {
  const up = useUpstreamNode(edgeNodeId)
  const cfg =
    up && isStep(up) && up.data.kind === 'compare' ? (up.data.config as CompareConfig) : undefined
  return effectLabelsOf(cfg)
}

/** The y-axis stat and guide lines come from the upstream Compare's threshold, so its Statistic
 *  settings are offered here too — written to that Compare, and shared with every plot it feeds.
 *  Per tile there's the label cap and the look (per-group markers, highlight, legend). */
function VolcanoPanel({ config, update, edgeNodeId }: PlotPanelProps<VolcanoConfig>) {
  const names = useEffectNames(edgeNodeId)
  const up = useUpstreamNode(edgeNodeId)
  const compare = up && isStep(up) && up.data.kind === 'compare' ? up : undefined
  return (
    <>
      {compare && (
        <CompareStatisticSection
          id={compare.id}
          config={normalizeCompareConfig(compare.data.config as CompareConfig)}
          // Says whose settings these are: changing them here changes the Compare itself.
          subtitle={`from ${stepTitle(compare)}`}
        />
      )}
      <CapSection
        title="Cap labels"
        hint="Label only the most significant genes."
        label="Max labels"
        field="labelTop"
        value={config.labelTop}
        enabled={config.capEnabled}
        update={update}
        rule={(n) => `Label the top ${n} genes by significance.`}
      />
      <PointStyleSections kind="volcano" names={names} style={config.style} update={update} />
    </>
  )
}

function ScatterPanel({ config, update, edgeNodeId }: PlotPanelProps<ScatterConfig>) {
  const names = useEffectNames(edgeNodeId)
  // An independent (marginal) contrast colours by quadrant, so the look is per quadrant group.
  const up = useUpstreamNode(edgeNodeId)
  const quad =
    !!up &&
    isStep(up) &&
    up.data.kind === 'contrast' &&
    (up.data.config as ContrastConfig).relationship === 'independent'
  return (
    <>
      <CapSection
        title="Cap labels"
        hint="Label only the most divergent genes."
        label="Max labels"
        field="labelTop"
        value={config.labelTop}
        enabled={config.capEnabled}
        update={update}
        rule={(n) => `Label the top ${n} significant genes by |FC difference|.`}
      />
      <PointStyleSections
        kind={quad ? 'scatterQuad' : 'scatter'}
        names={names}
        style={config.style}
        update={update}
      />
    </>
  )
}

function MAPanel({ config, update, edgeNodeId }: PlotPanelProps<MAConfig>): ReactNode {
  const names = useEffectNames(edgeNodeId)
  return (
    <>
      <Section title="MA">
        {/* The fold-change lines are driven by (and drag) the upstream Compare's threshold — shared
            with volcano — so there are no per-tile FC cutoffs to set here. */}
        <div style={styles.hint}>Fold-change lines follow the upstream Compare threshold.</div>
      </Section>
      <PointStyleSections kind="ma" names={names} style={config.style} update={update} />
    </>
  )
}

/** A preview marker is capped at this diameter (px) so a large one can't stretch its cell. */
const PREVIEW_DOT = 14

/** Height (px) of a preview cell — tall enough for a bumped, ringed marker with its name above. */
const PREVIEW_H = 42

/** The look sections shared by the point plots (volcano / MA / scatter): the legend — one row per
 *  point group (colour, size, opacity, label switch) plus its show/hide switch — and the highlight
 *  look (selected / hovered emphasis and the dim of everything else). Only what the user changes is written to
 *  `config.style`; each section's Reset drops its overrides so the plot's defaults show through. */
function PointStyleSections({
  kind,
  names,
  style,
  update
}: {
  kind: PointPlotKind
  names: { up: string; down: string }
  style: PointStyle | undefined
  update: (patch: Record<string, unknown>) => void
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const ink = PALETTES[mode].text
  const groups = defaultGroups(kind, names).map((d) => resolveGroup(style, d))
  /** A group's emphasised marker size: the explicit one, else its own size plus the bump. */
  const hlSize = (g: ResolvedGroup): number => g.highlight.size ?? g.size + g.highlight.bump
  // One template for every block below, so their columns line up under the group they belong to.
  const gridCols: CSSProperties = {
    ...styles.groupGrid,
    gridTemplateColumns: `64px repeat(${groups.length}, minmax(72px, 1fr))`
  }
  const setStyle = (patch: Partial<PointStyle>): void => update({ style: { ...style, ...patch } })
  const setGroup = (key: string, patch: GroupStyle): void =>
    setStyle({ groups: { ...style?.groups, [key]: { ...style?.groups?.[key], ...patch } } })
  const setGroupHl = (key: string, patch: HighlightStyle): void =>
    setGroup(key, { highlight: { ...style?.groups?.[key]?.highlight, ...patch } })
  // A section's Reset drops only ITS fields from every group (Points: the look; Legend: the
  // per-group entry switch), leaving the other section's overrides alone.
  const hasGroupField = (fields: (keyof GroupStyle)[]): boolean =>
    Object.values(style?.groups ?? {}).some((g) => fields.some((f) => g?.[f] !== undefined)) ||
    (fields.includes('highlight') && !!style?.highlight)
  const withoutGroupFields = (fields: (keyof GroupStyle)[]): PointStyle['groups'] => {
    const next: Record<string, GroupStyle> = {}
    for (const [key, g] of Object.entries(style?.groups ?? {})) {
      const kept = { ...g }
      for (const f of fields) delete kept[f]
      if (Object.keys(kept).length) next[key] = kept
    }
    return Object.keys(next).length ? next : undefined
  }
  const LOOK_FIELDS: (keyof GroupStyle)[] = [
    'name',
    'size',
    'opacity',
    'color',
    'label',
    'highlight'
  ]
  const reset = (label: string, onClick: () => void): ReactNode => (
    <button style={styles.resetBtn} onClick={onClick} title={`Restore the default ${label}`}>
      Reset
    </button>
  )
  // Value boxes throughout: opacity over 0–1 in 0.05 steps, pixel sizes over a plot-sensible range.
  const opacity = (label: string, value: number, onChange: (v: number) => void): ReactNode => (
    <SizeBox value={value} onChange={onChange} min={0} max={1} step={0.05} title={label} />
  )
  const px = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    min: number,
    max: number,
    /** sharing its cell with a swatch or a switch — take only the room they leave */
    tight = false
  ): ReactNode => (
    <SizeBox
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      title={`${label} (px)`}
      tight={tight}
    />
  )
  return (
    <>
      <Section
        title="Points"
        // Reset sits right of the title (the subtitle slot); the legend's plot-wide switch is the
        // action — the per-group entries are a column of the table below.
        action={
          <span style={styles.quickRow}>
            <span style={styles.quickLabel}>legend</span>
            <OnOffSwitch
              on={legendOn(style)}
              label="Show legend"
              onChange={(on) => setStyle({ legend: on })}
            />
          </span>
        }
        subtitle={
          hasGroupField(LOOK_FIELDS)
            ? reset('point look', () =>
                setStyle({ groups: withoutGroupFields(LOOK_FIELDS), highlight: undefined })
              )
            : null
        }
      >
        {/* One column per group (they share every setting), one row per setting — so a value is
            compared across groups by reading along its row. Scrolls sideways when a plot has many
            groups (a marginal contrast's eight quadrants). */}
        <div style={styles.groupScroll}>
          {/* Every state up front: the settings below all show up here, so a change is judged
              without hunting for the row that drew it. Indented like a sub-block (without its
              rule) so its group columns line up with theirs. */}
          <div style={styles.previewIndent}>
            <div style={gridCols}>
              {/* The name field heads its own column: editing it here names the group everywhere,
                and the preview underneath says which marker it belongs to. */}
              <span style={{ ...styles.rowLabel, gridRow: 1, gridColumn: 1 }}>name</span>
              {groups.map((g, i) => (
                <EffectLabelInput
                  key={g.key}
                  value={g.name}
                  onCommit={(v) => setGroup(g.key, { name: v || undefined })}
                  style={{ ...styles.styleName, gridRow: 1, gridColumn: i + 2 }}
                  title="Legend name for this group on this plot (blank = the upstream tile's name)"
                />
              ))}
              <span style={{ ...styles.rowLabel, gridRow: 2, gridColumn: 1 }}>colour</span>
              {groups.map((g, i) => (
                <ColorChip
                  key={g.key}
                  color={g.color}
                  on={g.color !== CLEAR}
                  label={`${g.name} colour`}
                  title={`${g.name} colour`}
                  clearLabel="No fill (a hollow marker)"
                  onPick={(c) => setGroup(g.key, { color: c })}
                  onClear={() => setGroup(g.key, { color: CLEAR })}
                  style={{ gridRow: 2, gridColumn: i + 2, width: '100%', flex: '1 1 auto' }}
                />
              ))}
              {/* ONE ground behind every marker: a grid item spanning the three state rows and all
                the group columns. Everything in these rows is placed EXPLICITLY — auto-placement
                treats the ground's cells as taken and would flow the markers below it. */}
              <div style={styles.previewBox} />
              {(['plain', 'selected', 'faded'] as const).map((state, r) => (
                <Fragment key={state}>
                  <span style={{ ...styles.rowLabel, gridRow: r + 3, gridColumn: 1 }}>
                    {state === 'faded' ? 'not selected' : state}
                  </span>
                  {groups.map((g, i) => (
                    <MarkerPreview
                      key={g.key}
                      g={g}
                      state={state}
                      ink={ink}
                      style={{ gridRow: r + 3, gridColumn: i + 2 }}
                    />
                  ))}
                </Fragment>
              ))}
            </div>
          </div>

          <div style={{ ...styles.sideTag, marginTop: 12 }}>Plain</div>
          <div style={styles.subGroup}>
            <div style={gridCols}>
              <span style={styles.rowLabel}>size</span>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {px(`${g.name} size`, g.size, (v) => setGroup(g.key, { size: v }), 1, 20)}
                </Fragment>
              ))}

              <span style={styles.rowLabel}>opacity</span>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {opacity(`${g.name} opacity`, g.opacity, (v) => setGroup(g.key, { opacity: v }))}
                </Fragment>
              ))}

              {/* Marker outline — none by default, so a plot stays flat unless asked otherwise. */}
              <span style={styles.rowLabel}>outline</span>
              {groups.map((g) => (
                <div key={g.key} style={styles.ringCell}>
                  <ColorChip
                    color={g.outlineColor ?? ink}
                    on={g.outlineColor !== CLEAR}
                    clearLabel="No colour (keeps the width)"
                    label={`${g.name} outline colour`}
                    title={`${g.name} outline colour (default: the theme's text colour)`}
                    onPick={(c) => setGroup(g.key, { outlineColor: c })}
                    onClear={() => setGroup(g.key, { outlineColor: CLEAR })}
                  />
                  {px(
                    `${g.name} outline width`,
                    g.outline,
                    (v) => setGroup(g.key, { outline: v }),
                    0,
                    4,
                    true
                  )}
                </div>
              ))}

              <span
                style={styles.rowLabel}
                title="Offer this group's genes to the auto-label layer"
              >
                label
              </span>
              {groups.map((g) => (
                <div key={g.key} style={styles.switchCell}>
                  <OnOffSwitch
                    on={g.label}
                    label={`${g.name} labels`}
                    onChange={(on) => setGroup(g.key, { label: on })}
                  />
                </div>
              ))}

              <span style={styles.rowLabel}>legend</span>
              {groups.map((g) => (
                <div key={g.key} style={styles.switchCell}>
                  <OnOffSwitch
                    on={g.legend}
                    disabled={!legendOn(style)}
                    label={`${g.name} legend entry`}
                    onChange={(on) => setGroup(g.key, { legend: on })}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* How each group's points look while they ARE the selection. */}
          <div style={{ ...styles.sideTag, marginTop: 12 }}>Selected</div>
          <div style={styles.subGroup}>
            <div style={gridCols}>
              <span style={styles.rowLabel}>size</span>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {px(
                    `${g.name} selected size`,
                    hlSize(g),
                    (v) => setGroupHl(g.key, { size: v }),
                    1,
                    25
                  )}
                </Fragment>
              ))}

              <span style={styles.rowLabel}>outline</span>
              {groups.map((g) => (
                <div key={g.key} style={styles.ringCell}>
                  <ColorChip
                    color={g.highlight.ringColor ?? ink}
                    on={g.highlight.ringColor !== CLEAR}
                    clearLabel="No colour (keeps the width)"
                    label={`${g.name} selected-outline colour`}
                    title={`${g.name} selected-outline colour (default: the theme's text colour)`}
                    onPick={(c) => setGroupHl(g.key, { ringColor: c })}
                    onClear={() => setGroupHl(g.key, { ringColor: CLEAR })}
                  />
                  {px(
                    `${g.name} selected-outline width`,
                    g.highlight.ring,
                    (v) => setGroupHl(g.key, { ring: v }),
                    0,
                    3,
                    true
                  )}
                </div>
              ))}

              <span style={styles.rowLabel}>label</span>
              {groups.map((g) => (
                <div key={g.key} style={styles.hlLabelCell}>
                  <OnOffSwitch
                    on={g.highlight.label}
                    label={`Label selected ${g.name} points`}
                    onChange={(on) => setGroupHl(g.key, { label: on })}
                  />
                  {g.highlight.label &&
                    px(
                      `${g.name} label size`,
                      g.highlight.labelSize,
                      (v) => setGroupHl(g.key, { labelSize: v }),
                      9,
                      13,
                      true
                    )}
                </div>
              ))}
            </div>
          </div>

          {/* How each group fades while something ELSE is selected. */}
          <div style={{ ...styles.sideTag, marginTop: 12 }}>Not selected</div>
          <div style={styles.subGroup}>
            <div style={gridCols}>
              <span style={styles.rowLabel}>opacity</span>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {opacity(`${g.name} faded opacity`, g.highlight.dim, (v) =>
                    setGroupHl(g.key, { dim: v })
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </Section>
    </>
  )
}

const AXIS_OPTS = [
  { value: 'dose', label: 'dose' },
  { value: 'time', label: 'time' }
]

/** Dose- and time-response are separate tiles (the axis is fixed when the tile is picked), so the
 *  panel only carries the colour cap. Every gene is always drawn as background; the cap decides
 *  how many of the strongest responders are coloured. */
function DRPanel({ config, update, edgeNodeId }: PlotPanelProps<DRConfig>) {
  // The dose⇆time axis is only a choice when the upstream data carries both (the tile shows
  // its switch bar under the same condition); with one axis the tile forces it.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { axes: avail } = useUpstreamFacts(upId)
  const axes = AXIS_OPTS.filter((o) => avail[o.value as 'dose' | 'time'])
  return (
    <>
      {axes.length > 1 && (
        <Section title="Response">
          <Field label="axis" aside={<QuickToggle config={config} field="axis" update={update} />}>
            <Select
              value={config.axis}
              onChange={(v) => update({ axis: v as DRConfig['axis'] })}
              options={axes}
            />
          </Field>
        </Section>
      )}
      <CapSection
        title="Cap genes"
        hint="Colour only the strongest responders; every gene stays drawn in the background."
        field="topGenes"
        value={config.topGenes}
        enabled={config.capEnabled}
        update={update}
        defaultValue={10}
        rule={(n) => `Colour the top ${n} genes by response.`}
      />
    </>
  )
}

function BubblePanel({ config, update, edgeNodeId }: PlotPanelProps<BubbleConfig>) {
  // Only offer the response axes the upstream data actually carries (dose and/or time); with one
  // axis there's nothing to choose, so the selector is hidden and the config snaps to it.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { axes: avail } = useUpstreamFacts(upId)
  const axes = AXIS_OPTS.filter((o) => avail[o.value as 'dose' | 'time'])
  useEffect(() => {
    if (axes.length > 0 && !axes.some((o) => o.value === config.axis))
      update({ axis: axes[0].value as BubbleConfig['axis'] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail.dose, avail.time, config.axis])
  return (
    <>
      {axes.length > 1 && (
        <Section title="Bubble">
          <Field label="axis" aside={<QuickToggle config={config} field="axis" update={update} />}>
            <Select
              value={config.axis}
              onChange={(v) => update({ axis: v as BubbleConfig['axis'] })}
              options={axes}
            />
          </Field>
        </Section>
      )}
      <CapSection
        title="Cap genes"
        hint="Show only the strongest genes."
        field="topGenes"
        value={config.topGenes}
        enabled={config.capEnabled}
        update={update}
        defaultValue={20}
        rule={(n) => `Keep the top ${n} genes by largest |log₂FC|.`}
      />
    </>
  )
}

function DumbbellPanel({ config, update }: PlotPanelProps<DumbbellConfig>) {
  return (
    <CapSection
      title="Cap genes"
      hint="Show only the most divergent significant genes."
      field="topGenes"
      value={config.topGenes}
      enabled={config.capEnabled}
      update={update}
      rule={(n) => `Keep the top ${n} significant genes by |FC difference|.`}
    />
  )
}

/** One axis decoration (gridlines, zero line): show it, how it's stroked, how thick. The style
 *  and width only appear while it's shown — they'd configure nothing otherwise. */
function LineRow({
  label,
  on,
  onShow,
  style,
  onStyle,
  width,
  onWidth
}: {
  label: string
  on: boolean
  onShow: (on: boolean) => void
  /** omitted where Plotly offers no dash for that line (the axis line itself) */
  style?: LineStyle
  onStyle?: (v: LineStyle) => void
  width: number
  onWidth: (v: number) => void
}): ReactNode {
  // The style and width controls stay in place when the line is off — greyed rather than gone, so
  // the row keeps its shape and the settings don't appear to come and go with the switch.
  return (
    <Field label={label} top>
      <div style={styles.lineRow}>
        <OnOffSwitch on={on} label={label} onChange={onShow} />
        {style && onStyle && <LineStyleChoice value={style} onChange={onStyle} disabled={!on} />}
        <div style={styles.lineWidth}>
          <SizeBox
            value={width}
            min={0.5}
            max={4}
            step={0.5}
            disabled={!on}
            title={`${label} width (px)`}
            onChange={onWidth}
          />
        </div>
      </div>
    </Field>
  )
}

/** A sample of the stroke itself — what a line-style option looks like when drawn. */
function LineSwatch({ dash }: { dash?: string }): ReactNode {
  return (
    <svg width="34" height="10" aria-hidden style={{ display: 'block' }}>
      <line
        x1="1"
        y1="5"
        x2="33"
        y2="5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        {...(dash ? { strokeDasharray: dash } : null)}
      />
    </svg>
  )
}

/** Line-style picker: the app's dropdown, with each option drawn as the line it produces rather
 *  than named — a sample of the stroke reads faster than the word for it. */
function LineStyleChoice({
  value,
  onChange,
  disabled
}: {
  value: LineStyle
  onChange: (v: LineStyle) => void
  disabled?: boolean
}): ReactNode {
  return (
    <div style={styles.lineChoice}>
      <Select
        value={value}
        disabled={disabled}
        onChange={(v) => onChange(v as LineStyle)}
        options={[
          { value: 'solid', label: 'Solid', render: <LineSwatch /> },
          { value: 'dash', label: 'Dashed', render: <LineSwatch dash="5 3" /> },
          { value: 'dot', label: 'Dotted', render: <LineSwatch dash="1.5 3" /> }
        ]}
      />
    </div>
  )
}

/** Number box that may be EMPTY (= unset / auto): shows blank for undefined and commits
 *  undefined when cleared, unlike NumberInput which always holds a number. */
function OptNumberInput({
  value,
  onChange,
  step,
  placeholder,
  title
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  step?: number
  placeholder?: string
  title?: string
}): ReactNode {
  // Draft while editing (see NumberInput); here an EMPTY box is meaningful — it commits
  // undefined ("auto") — but a partial entry ("-", "1e") must still not be thrown away.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="number"
      className="oe-num"
      style={{ ...styles.input, textAlign: 'right' }}
      value={draft ?? value ?? ''}
      step={step ?? 'any'}
      placeholder={placeholder}
      title={title}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') onChange(undefined)
        else {
          const v = Number(raw)
          if (Number.isFinite(v)) onChange(v)
        }
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/** Axis settings shared by every Plotly plot: one axis at a time (X | Y tabs) — title, title and
 *  tick font sizes, a fixed range, tick placement and count, gridlines, the axis line's thickness,
 *  a mirrored frame and the zero line. Everything unset falls through to the view's own layout;
 *  Reset drops the shown axis's overrides. Applied in PlotlyChart via PlotAxesContext. */
function AxesSection({
  config,
  update,
  defaults
}: {
  config: { axes?: PlotAxes }
  update: (patch: Record<string, unknown>) => void
  /** the live plot's own title/range per axis — shown as each field's placeholder, so "unset"
   *  reads as the value actually in use rather than a blank or the word "auto". */
  defaults?: AxisDefaults
}): ReactNode {
  const [which, setWhich] = useState<'x' | 'y'>('x')
  const st: AxisStyle = config.axes?.[which] ?? {}
  const def = defaults?.[which] ?? {}
  // Ranges read long by default (−3.0179…) — a placeholder is a hint, so round it.
  const round = (v: number | undefined): string | undefined =>
    v == null ? undefined : String(Math.round(v * 100) / 100)
  const set = (patch: Partial<AxisStyle>): void => {
    const next: AxisStyle = { ...st, ...patch }
    for (const k of Object.keys(next) as (keyof AxisStyle)[])
      if (next[k] === undefined) delete next[k]
    update({ axes: { ...config.axes, [which]: Object.keys(next).length ? next : undefined } })
  }
  const hasAny = Object.keys(st).length > 0
  return (
    <Section
      title="Axes"
      subtitle={
        hasAny ? (
          <button
            style={styles.resetBtn}
            onClick={() => update({ axes: { ...config.axes, [which]: undefined } })}
            title={`Restore the ${which} axis defaults`}
          >
            Reset
          </button>
        ) : null
      }
      // Which axis the settings below belong to — in line with the heading, since it switches the
      // whole section rather than setting anything itself. A dot marks a customised axis.
      action={
        <div style={styles.axisPill} role="radiogroup" aria-label="Axis">
          {(['x', 'y'] as const).map((k) => {
            const on = which === k
            const dirty = Object.keys(config.axes?.[k] ?? {}).length > 0
            return (
              <button
                key={k}
                role="radio"
                aria-checked={on}
                onClick={() => setWhich(k)}
                title={dirty ? `${k} axis (customised)` : `${k} axis`}
                style={{
                  ...styles.axisPillBtn,
                  background: on ? UI.accent : 'transparent',
                  color: on ? UI.accentText : dirty ? UI.text : UI.textMuted
                }}
              >
                {k.toUpperCase()}
                {dirty ? ' •' : ''}
              </button>
            )
          })}
        </div>
      }
    >
      <div style={styles.sideTag}>Title</div>
      <div style={styles.subGroup}>
        <Field label="Text">
          <EffectLabelInput
            value={st.title ?? ''}
            onCommit={(v) => set({ title: v || undefined })}
            style={{ minWidth: 0, width: '100%' }}
            placeholder={def.title ?? "the plot's own"}
            title="Axis title (blank = the plot's own)"
          />
        </Field>
        <Field label="Size">
          <div style={styles.cutoffRow}>
            <SizeBox
              value={st.titleSize ?? 12}
              min={8}
              max={18}
              title="Title font size (px)"
              onChange={(v) => set({ titleSize: v })}
            />
          </div>
        </Field>
      </div>

      <div style={{ ...styles.sideTag, marginTop: 10 }}>Scale</div>
      <div style={styles.subGroup}>
        <Field label="Range">
          <div style={styles.cutoffRow}>
            <div style={styles.cutoffBox}>
              <OptNumberInput
                value={st.min}
                placeholder={round(def.min) ?? 'auto'}
                title="Lower bound (blank = the plot's own)"
                onChange={(v) => set({ min: v })}
              />
            </div>
            <span style={styles.inlineTag}>to</span>
            <div style={styles.cutoffBox}>
              <OptNumberInput
                value={st.max}
                placeholder={round(def.max) ?? 'auto'}
                title="Upper bound (blank = the plot's own)"
                onChange={(v) => set({ max: v })}
              />
            </div>
          </div>
        </Field>
        <Field label="Ticks">
          <div style={styles.cutoffRow}>
            <Select
              value={st.ticks ?? 'auto'}
              onChange={(v) => set({ ticks: v === 'auto' ? undefined : (v as AxisStyle['ticks']) })}
              options={[
                { value: 'auto', label: 'default' },
                { value: 'outside', label: 'outside' },
                { value: 'inside', label: 'inside' },
                { value: 'none', label: 'none' }
              ]}
            />
            <span style={{ ...styles.inlineTag, marginLeft: 6 }}>every</span>
            <div style={styles.pctBox}>
              <OptNumberInput
                value={st.interval}
                placeholder="auto"
                title="Tick spacing in the axis's own units (blank = automatic spacing)"
                onChange={(v) => set({ interval: v && v > 0 ? v : undefined })}
              />
            </div>
          </div>
        </Field>
        <Field label="Labels">
          {/* The size sits with its switch, as in the point plots' label row. */}
          <div style={styles.cutoffRow}>
            <OnOffSwitch
              on={st.tickLabels ?? true}
              label="Tick labels"
              onChange={(on) => set({ tickLabels: on })}
            />
            {(st.tickLabels ?? true) && (
              <SizeBox
                value={st.tickSize ?? 12}
                min={8}
                max={18}
                title="Tick label font size (px)"
                onChange={(v) => set({ tickSize: v })}
              />
            )}
          </div>
        </Field>
      </div>

      <div style={{ ...styles.sideTag, marginTop: 10 }}>Lines</div>
      <div style={styles.subGroup}>
        <LineRow
          label="Axis line"
          on={st.lineWidth != null ? st.lineWidth > 0 : (def.line ?? true)}
          onShow={(on) => set({ lineWidth: on ? st.lineWidth || 1 : 0 })}
          style={st.lineStyle ?? 'solid'}
          onStyle={(v) => set({ lineStyle: v === 'solid' ? undefined : v })}
          // "off" is stored as width 0, so fall back to 1 — the greyed box shows the width the
          // line would come back at, not a 0 that sits below the box's own minimum.
          width={st.lineWidth || 1}
          onWidth={(v) => set({ lineWidth: v })}
        />
        <LineRow
          label="Frame"
          on={st.mirror ?? false}
          onShow={(on) => set({ mirror: on })}
          style={st.frameStyle ?? 'solid'}
          onStyle={(v) => set({ frameStyle: v === 'solid' ? undefined : v })}
          width={st.frameWidth ?? (st.lineWidth || 1)}
          onWidth={(v) => set({ frameWidth: v })}
        />
        <LineRow
          label="Gridlines"
          on={st.grid ?? def.grid ?? false}
          onShow={(on) => set({ grid: on })}
          style={st.gridStyle ?? 'solid'}
          onStyle={(v) => set({ gridStyle: v === 'solid' ? undefined : v })}
          width={st.gridWidth ?? 1}
          onWidth={(v) => set({ gridWidth: v })}
        />
        <LineRow
          label="Zero line"
          on={st.zeroline ?? def.zeroline ?? true}
          onShow={(on) => set({ zeroline: on })}
          style={st.zerolineStyle ?? 'solid'}
          onStyle={(v) => set({ zerolineStyle: v === 'solid' ? undefined : v })}
          width={st.zerolineWidth ?? 1}
          onWidth={(v) => set({ zerolineWidth: v })}
        />
      </div>
    </Section>
  )
}

function TdrPanel(): ReactNode {
  return (
    <Section title="TDR (dose × time)">
      <div style={styles.hint}>One figure per selected gene (needs dose and time active).</div>
    </Section>
  )
}

function GeneBarPanel(): ReactNode {
  return (
    <Section title="Bar">
      <div style={styles.hint}>Each selected gene's value across every condition.</div>
    </Section>
  )
}

function ClusterPanel({ config, update, edgeNodeId }: PlotPanelProps<ClusterConfig>) {
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
  // If the stored colorBy isn't an active condition for this upstream, snap it to the first.
  // 'cluster' is a deliberate non-condition choice, so it is left alone.
  useEffect(() => {
    if (
      config.colorBy !== CLUSTER_COLOR &&
      active.length > 0 &&
      !active.includes(config.colorBy as ConditionKey)
    )
      update({ colorBy: active[0] })
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
              { value: 'pc', label: 'PC plot (samples)' },
              { value: 'loadings', label: 'loadings (features)' },
              { value: 'scree', label: 'scree plot (variance)' }
            ]}
          />
        </Field>
      )}
      {config.method === 'pca' && config.plot === 'scree' && (
        <div style={styles.hint}>
          Variance explained per component — a steep drop after PC1–2 means the PC plot summarises
          the data well; a flat scree means it doesn’t.
        </div>
      )}
      {config.method === 'pca' && config.plot === 'loadings' && (
        <>
          <Field label="features">
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
            The most influential features in the same PC1/PC2 plane, as vectors from the origin —
            which measurements drive the separation, not just that there is one. Same direction =
            moves together; opposite = trades off; longer = stronger.
          </div>
        </>
      )}
      <Field label="gene scaling">
        <Select
          value={config.scale ?? 'unit'}
          onChange={(v) => update({ scale: v as ClusterConfig['scale'] })}
          options={[
            { value: 'unit', label: 'unit variance (correlation)' },
            { value: 'none', label: 'none (covariance)' }
          ]}
        />
      </Field>
      <Field label="missing values">
        <Select
          value={config.missing ?? 'impute'}
          onChange={(v) => update({ missing: v as ClusterConfig['missing'] })}
          options={[
            { value: 'impute', label: 'impute (gene mean)' },
            { value: 'complete', label: 'complete cases only' }
          ]}
        />
      </Field>
      <Field label="normalize">
        <Select
          value={config.center ?? 'median'}
          onChange={(v) => update({ center: v as ClusterConfig['center'] })}
          options={[
            { value: 'median', label: 'median-center (offset)' },
            { value: 'zscore', label: 'z-score per sample (offset + scale)' },
            { value: 'quantile', label: 'quantile (common distribution)' },
            { value: 'none', label: 'none (raw log₂)' }
          ]}
        />
      </Field>
      <Field label="features">
        <Select
          value={String(config.topVar ?? 0)}
          onChange={(v) => update({ topVar: Number(v) })}
          options={[
            { value: '0', label: 'all genes' },
            { value: '100', label: 'top 100 most variable' },
            { value: '250', label: 'top 250 most variable' },
            { value: '500', label: 'top 500 most variable' }
          ]}
        />
      </Field>
      <Field label="transform">
        <Select
          value={config.transform ?? 'auto'}
          onChange={(v) => update({ transform: v as ClusterConfig['transform'] })}
          options={[
            { value: 'auto', label: 'auto (heuristic)' },
            { value: 'log2', label: 'log₂ (force)' },
            { value: 'log10', label: 'log (force)' },
            { value: 'none', label: 'none (linear)' }
          ]}
        />
      </Field>
      <Field label="replicates">
        <Select
          value={config.replicates ?? 'individual'}
          onChange={(v) => update({ replicates: v as ClusterConfig['replicates'] })}
          options={[
            { value: 'individual', label: 'individual replicates' },
            { value: 'mean', label: 'condition means (average reps)' }
          ]}
        />
      </Field>
      <Field
        label="legend"
        aside={<QuickToggle config={config} field="legend" update={update} kind="pca" />}
      >
        <Select
          value={config.legend ?? 'simple'}
          onChange={(v) => update({ legend: v as ClusterConfig['legend'] })}
          options={[
            { value: 'simple', label: 'simple (one condition)' },
            { value: 'complex', label: 'complex (multi-condition)' }
          ]}
        />
      </Field>
      {(config.legend ?? 'simple') === 'simple' && (
        <Field
          label="color by"
          aside={<QuickToggle config={config} field="colorBy" update={update} kind="pca" />}
        >
          <Select
            value={config.colorBy}
            onChange={(v) => update({ colorBy: v as ClusterColorBy })}
            options={[
              ...active.map((c) => ({ value: c, label: condLabel(c) })),
              { value: CLUSTER_COLOR, label: 'cluster (computed)' }
            ]}
          />
        </Field>
      )}
      {/* The two cluster knobs only apply while the colours ARE clusters. */}
      {(config.legend ?? 'simple') === 'simple' && config.colorBy === CLUSTER_COLOR && (
        <>
          <Field
            label="cluster on"
            aside={<QuickToggle config={config} field="clusterOn" update={update} kind="pca" />}
          >
            <Select
              value={config.clusterOn ?? 'coords'}
              onChange={(v) => update({ clusterOn: v as ClusterConfig['clusterOn'] })}
              options={[
                { value: 'coords', label: 'the plotted x/y' },
                { value: 'features', label: 'the full feature matrix' }
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
            aside={<QuickToggle config={config} field="clusterCount" update={update} kind="pca" />}
          >
            <Select
              value={config.clusterCount ?? 'fixed'}
              onChange={(v) => update({ clusterCount: v as ClusterConfig['clusterCount'] })}
              options={[
                { value: 'fixed', label: 'a number I choose' },
                { value: 'conditions', label: 'one per condition' },
                { value: 'auto', label: 'automatic (largest gap)' }
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
                  onChange={(v) => update({ clusterK: Math.max(1, Math.min(24, Math.round(v))) })}
                />
              </div>
            </Field>
          )}
          {(config.clusterCount ?? 'fixed') === 'conditions' && (
            <div style={styles.hint}>
              One group per distinct condition — asks whether the samples group the way the design
              says they should.
            </div>
          )}
          {(config.clusterCount ?? 'fixed') === 'auto' && (
            <div style={styles.hint}>
              Cuts the dendrogram at its largest gap, so the count follows the data. Convenient, but
              it can change between datasets.
            </div>
          )}
        </>
      )}
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
            { value: 'gaussian', label: 'gaussian (~95%)' },
            { value: 'none', label: 'none' }
          ]}
        />
      </Field>
      {look.territory !== 'none' && (
        <div style={styles.hint}>
          {look.territory === 'hull'
            ? 'The convex hull of each condition’s replicates — only where measurements landed.'
            : 'A ~95% covariance ellipse per condition — smoother and comparable, but extrapolated beyond the replicates.'}
        </div>
      )}
    </Section>
  )
}

// Plot types valid per metric: distributions (intensity/CV) → violin/box; a per-sample count
// (proteins) → bar only.
function qcPlotOptions(metric: QcConfig['metric']): QcConfig['plot'][] {
  return metric === 'proteins' ? ['bar'] : ['violin', 'box']
}

/** Enrichment: test method, term source, plot style and the term cap. The same fields as the
 *  tile's quick switch bars, so either place edits the one config. */
function EnrichPanel({ config, update, edgeNodeId }: PlotPanelProps<EnrichConfig>) {
  // Select the (stable) upstream result, then derive the source list in a memo — a freshly-built
  // array straight from the selector would fail Zustand's reference equality and loop forever.
  const upstream = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    return upId ? s.results[upId] : undefined
  })
  // The term sets these genes carry; null until the upstream Compare has run, when nothing is
  // known yet and every set stays pickable.
  const present = useMemo(
    () =>
      upstream?.kind === 'compare'
        ? enrichSourcesPresent(upstream.annotationMap ?? {}, upstream.keggCategories)
        : null,
    [upstream]
  )
  // The source the plot is actually testing: the saved one, or its fallback when the genes don't
  // carry it — so the dropdown shows what the chart shows.
  const saved = config.source ?? 'go'
  const source = (present && resolveEnrichSource(saved, present)) ?? saved
  // Every offered set under its heading (Function / Pathway, as the import and the gene selector
  // group them): those the data has are pickable, the rest greyed and marked, so the list says both
  // what can be tested and what a fetch would add. A heading is an inert row.
  const sourceOptions = ENRICH_GROUPS.flatMap((g) => [
    {
      value: `__group:${g.label}`,
      label: g.label,
      disabled: true,
      render: <span style={styles.optionHeading}>{g.label}</span>
    },
    ...g.sources.map((v) => {
      const missing = present !== null && !present.includes(v)
      return {
        value: v,
        label: missing ? `${ENRICH_SOURCE_LABEL[v]} — not fetched` : ENRICH_SOURCE_LABEL[v],
        disabled: missing
      }
    })
  ])
  const method = config.method ?? 'ora'
  // 'ridge' is GSEA-only; a persisted ridge style under ORA reads (and re-saves) as dot.
  const style = config.style === 'ridge' && method !== 'gsea' ? 'dot' : (config.style ?? 'dot')
  const styleOpts = method === 'gsea' ? ['dot', 'bar', 'ridge'] : ['dot', 'bar']
  return (
    <Section title="Enrichment">
      <Field label="method" aside={<QuickToggle config={config} field="method" update={update} />}>
        <Select
          value={method}
          onChange={(v) => {
            const m = v as EnrichConfig['method']
            update({ method: m, ...(m !== 'gsea' && style === 'ridge' ? { style: 'dot' } : null) })
          }}
          options={[
            { value: 'ora', label: 'ORA (over-representation)' },
            { value: 'gsea', label: 'GSEA (ranked)' }
          ]}
        />
      </Field>
      <Field label="terms" aside={<QuickToggle config={config} field="source" update={update} />}>
        <Select
          value={source}
          onChange={(v) => update({ source: v as EnrichConfig['source'] })}
          options={sourceOptions}
        />
      </Field>
      <Field label="style" aside={<QuickToggle config={config} field="style" update={update} />}>
        <Select
          value={style}
          onChange={(v) => update({ style: v as EnrichConfig['style'] })}
          options={styleOpts.map((o) => ({ value: o, label: o }))}
        />
      </Field>
      <Field label="Top terms">
        <div style={{ width: 90 }}>
          <NumberInput
            value={config.topTerms ?? 15}
            step={5}
            min={1}
            onChange={(v) => update({ topTerms: Math.max(1, Math.round(v)) })}
          />
        </div>
      </Field>
      <div style={styles.hint}>Show the {config.topTerms ?? 15} most enriched terms.</div>
    </Section>
  )
}

/** STRING network: confidence cutoff, gene cap, first-shell interactors and a species override.
 *  The same fields as the tile's quick switch bars, so either place edits the one config. */
function StringPanel({ config, update }: PlotPanelProps<StringConfig>) {
  return (
    <Section title="STRING network">
      <Field
        label="confidence"
        aside={<QuickToggle config={config} field="confidence" update={update} />}
      >
        <Select
          value={config.confidence ?? 'medium'}
          onChange={(v) => update({ confidence: v as StringConfig['confidence'] })}
          options={[
            { value: 'low', label: 'low (0.15)' },
            { value: 'medium', label: 'medium (0.4)' },
            { value: 'high', label: 'high (0.7)' },
            { value: 'highest', label: 'highest (0.9)' }
          ]}
        />
      </Field>
      <Field
        label="Max genes"
        aside={<QuickToggle config={config} field="maxGenes" update={update} />}
      >
        <div style={{ width: 90 }}>
          <NumberInput
            value={config.maxGenes > 0 ? config.maxGenes : 40}
            step={10}
            min={1}
            onChange={(v) => update({ maxGenes: Math.max(1, Math.round(v)) })}
          />
        </div>
      </Field>
      <div style={styles.hint}>
        Draw at most {config.maxGenes > 0 ? config.maxGenes : 40} nodes — query genes first (by
        |log₂FC|), then any first-shell interactors, each by how connected they are. Unconnected
        genes are never drawn.
      </div>
      <Field
        label="interactors"
        aside={<QuickToggle config={config} field="addInteractors" update={update} />}
      >
        <Checkbox
          label="add first-shell interactors"
          checked={config.addInteractors ?? false}
          onChange={(v) => update({ addInteractors: v })}
          title="Also include proteins that directly connect to a differential gene above the cutoff"
        />
      </Field>
      <Field label="species">
        <div style={{ width: 90 }}>
          <NumberInput
            value={config.species ?? 0}
            step={1}
            min={0}
            title="NCBI taxon id; 0 = the species detected from the annotation fetch"
            onChange={(v) => update({ species: Math.max(0, Math.round(v)) || undefined })}
          />
        </div>
      </Field>
      <div style={styles.hint}>NCBI taxon override (e.g. 9606 human); 0 = detected species.</div>
    </Section>
  )
}

function QcPanel({ config, update }: PlotPanelProps<QcConfig>) {
  const plotOpts = qcPlotOptions(config.metric)
  const plot = plotOpts.includes(config.plot) ? config.plot : plotOpts[0]
  return (
    <Section title="QC">
      <div style={styles.hint}>
        Per-sample quality: intensity distribution, %CV, or protein count.
      </div>
      <Field label="metric" aside={<QuickToggle config={config} field="metric" update={update} />}>
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
        <Field label="plot" aside={<QuickToggle config={config} field="plot" update={update} />}>
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

/** Data table: which view it opens in (the in-table switch still flips it live). */
function TablePanel({ config, update }: PlotPanelProps<TableConfig>) {
  return (
    <Section title="Table">
      <Field label="default view">
        <Select
          value={config.view ?? 'matrix'}
          onChange={(v) => update({ view: v as TableConfig['view'] })}
          options={[
            { value: 'matrix', label: 'Matrix (gene × column)' },
            { value: 'long', label: 'Long (one row per value)' }
          ]}
        />
      </Field>
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

function HeatmapPanel({ config, update, edgeNodeId }: PlotPanelProps<HeatmapConfig>) {
  // The gene cap is a fold-change concept (top-N differential genes); the intensity heatmap
  // always shows the full proteome, and log10 only applies to intensities. Gate each section on
  // the upstream kind; an unwired heatmap offers both.
  const upstreamKind = useGraph((s) => {
    const up = s.nodes.find((n) => n.id === s.edges.find((e) => e.target === edgeNodeId)?.source)
    return up && isStep(up) ? up.data.kind : undefined
  })
  return (
    <>
      {upstreamKind !== 'compare' && (
        <Section title="Heatmap">
          <Checkbox
            label="log intensities"
            checked={config.log10}
            onChange={(v) => update({ log10: v })}
          />
        </Section>
      )}
      {upstreamKind !== 'standardize' && (
        <CapSection
          title="Cap genes"
          hint="Show only the strongest differential genes."
          field="maxGenes"
          value={config.maxGenes}
          enabled={config.capEnabled}
          update={update}
          defaultValue={50}
          rule={(n) => `Keep the top ${n} differential genes by largest |log₂FC|.`}
        />
      )}
    </>
  )
}

/** A "Cap …" section in the Clean-up style: a Switch in the header; while on, the N box and a
 *  sentence restating the rule. `field` is the config key holding N; the switch itself is the
 *  shared `capEnabled` key (see `capOn` for how older configs without it are read). */
function CapSection({
  title,
  hint,
  label = 'Max genes',
  field,
  value,
  enabled,
  update,
  defaultValue = 20,
  rule
}: {
  title: string
  hint: string
  label?: string
  /** config key holding N */
  field: string
  /** current N (the value under `field`) */
  value: number
  enabled: boolean | undefined
  update: (patch: Record<string, unknown>) => void
  defaultValue?: number
  rule: (n: number) => string
}) {
  const n = value ?? 0
  const on = capOn(enabled, n)
  return (
    <Section
      title={title}
      // While off, show the default N that switching on applies; once on, the box carries it.
      subtitle={on ? undefined : `top ${n > 0 ? n : defaultValue}`}
      action={
        <OnOffSwitch
          on={on}
          label={title}
          onChange={(next) =>
            // First switch-on with no N yet → a sensible starting point.
            update({ capEnabled: next, ...(next && !(n > 0) ? { [field]: defaultValue } : null) })
          }
        />
      }
    >
      <div style={styles.hint}>{hint}</div>
      {on && (
        <>
          <Field label={label}>
            <div style={{ width: 90 }}>
              <NumberInput
                value={n}
                step={label === 'Max labels' ? 5 : 10}
                min={1}
                onChange={(v) => update({ [field]: Math.max(1, Math.round(v)) })}
              />
            </div>
          </Field>
          <div style={styles.hint}>{rule(n)}</div>
        </>
      )}
    </Section>
  )
}

// ── small controls ──────────────────────────────────────────────────────────────

/** Opens a step's configuration window (interactive import, comparison, contrast). The step can't
 *  run until that window has been filled in, so this is the panel's main action and is styled as
 *  one: accent-filled with a gear, where the panel's other buttons are plain. Disabled, it goes
 *  grey and says why on hover. */
function ConfigureButton({
  label,
  disabled,
  title,
  onClick
}: {
  label: string
  disabled?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      style={{ ...styles.configBtn, ...(disabled ? styles.configBtnOff : null) }}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <IconGear size={13} strokeWidth={2.2} />
      {label}
    </button>
  )
}

export function Section({
  title,
  subtitle,
  action,
  defaultOpen = true,
  children
}: {
  title: string
  /** small note right of the title — muted text (e.g. a cap's current N) or a StatusNote */
  subtitle?: ReactNode
  action?: ReactNode
  /** open on first render; a panel with many sections can start with the later ones folded */
  defaultOpen?: boolean
  children: ReactNode
}) {
  // Collapsing is per section and per mount: a config panel can run long (a point plot has the
  // group table, three sub-blocks and the axes), so folding what isn't being edited keeps the rest
  // reachable without scrolling.
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={styles.section}>
      <div style={styles.sectionHead}>
        {/* The title row toggles; `action` (a switch, a pill) stays outside it, so using a control
            in the header doesn't fold the section under it. */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={open ? `Collapse ${title}` : `Expand ${title}`}
          style={{ ...styles.sectionTitleRow, ...styles.sectionToggle }}
        >
          <Chevron size={9} deg={open ? 90 : 0} />
          <span style={styles.sectionTitle}>{title}</span>
          {subtitle != null &&
            (typeof subtitle === 'string' ? (
              <span style={styles.sectionSubtitle}>{subtitle}</span>
            ) : (
              subtitle
            ))}
        </button>
        {action}
      </div>
      {open && children}
    </div>
  )
}

function Field({
  label,
  top,
  aside,
  children
}: {
  label: string
  /** top-align the label (for a multi-line control, e.g. the effect-size rows) */
  top?: boolean
  /** a small control right of the field (e.g. the quick-access toggle) */
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div style={{ ...styles.field, ...(top ? { alignItems: 'flex-start' } : null) }}>
      <label style={{ ...styles.fieldLabel, ...(top ? { paddingTop: 5 } : null) }}>{label}</label>
      {/* minWidth:0 lets a flex child (e.g. the raw-data Select) shrink and ellipsis-truncate a long
          filename instead of growing past the fixed-width panel and being clipped by its border. */}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {aside}
    </div>
  )
}

/** The per-setting "quick access" switch beside a plot setting: on = the tile also shows this
 *  setting as a switch bar for one-click changes; off = the gear alone carries it. A labelled
 *  Switch (not a pill) so it reads as on/off, distinct from the setting's own control. */
function QuickToggle({
  config,
  field,
  update,
  kind
}: {
  config: { quick?: QuickAccess }
  field: string
  update: (patch: Record<string, unknown>) => void
  /** the tile's kind, for its quick-access defaults (QUICK_DEFAULTS) */
  kind?: NodeKind
}): ReactNode {
  // The same reading as the tile's switch bars, so this switch and the tile always agree.
  const on = quickOn(config, field, kind)
  return (
    <span
      style={styles.quickRow}
      title={
        on
          ? 'Quick access on: shown in the tile as a switch bar'
          : 'Quick access off: only in this settings window'
      }
    >
      <span style={styles.quickLabel}>quick access</span>
      <OnOffSwitch
        on={on}
        label="Quick access"
        onChange={(next) => update({ quick: { ...config.quick, [field]: next } })}
      />
    </span>
  )
}

/** The app's Select (ui/Select) on a config panel: its menu drawn at the canvas zoom, closing when
 *  the canvas moves — unless `unscaled`, for a fixed-position window such as the selector dialog. */
export function Select({
  unscaled,
  ...props
}: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  placeholder?: string
  /** render at screen scale (a fixed-position window such as the selector dialog), not at the
   *  canvas zoom the tile panel follows */
  unscaled?: boolean
  /** greyed and unopenable — the whole select is inert, not just some of its options */
  disabled?: boolean
}): ReactNode {
  const tf = useStore((s) => `${s.transform[0]},${s.transform[1]},${s.transform[2]}`)
  return (
    <AppSelect
      {...props}
      zoom={unscaled ? 1 : Number(tf.split(',')[2]) || 1}
      closeKey={unscaled ? undefined : tf}
    />
  )
}

function NumberInput({
  value,
  onChange,
  step,
  min,
  max,
  disabled,
  title
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  min?: number
  max?: number
  disabled?: boolean
  title?: string
}) {
  // Local draft while the field is being edited. The box is CONTROLLED by a committed number, so
  // without this an empty box (mid-edit, after deleting the last digit) reads as Number('') = 0 —
  // which callers clamp (Math.max(1, …)) and write straight back, making the last digit
  // undeletable. The draft keeps empty/partial text on screen, commits only parseable values, and
  // is dropped on blur so the field then shows whatever was actually committed.
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="number"
      className="oe-num"
      // Numbers read right-aligned (digits line up against the unit / edge).
      style={{ ...styles.input, textAlign: 'right', ...(disabled ? { opacity: 0.5 } : null) }}
      value={draft ?? String(value)}
      step={step ?? 1}
      min={min}
      max={max}
      disabled={disabled}
      title={title}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') return // empty mid-edit — keep the last committed value
        const v = Number(raw)
        if (Number.isFinite(v)) onChange(v)
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/** One group's marker as the plot draws it, for the preview block: its fill, size, opacity and
 *  outline, optionally bumped/ringed as the selection and named above. Not interactive — the
 *  settings that shape it live in the rows below. */
function MarkerPreview({
  g,
  state,
  ink,
  style
}: {
  g: ResolvedGroup
  /** 'plain' as drawn, 'selected' as the emphasis overlay draws it, 'faded' while another is */
  state: 'plain' | 'selected' | 'faded'
  ink: string
  /** grid placement (see the preview block — the cells share their area with the ground) */
  style?: CSSProperties
}): ReactNode {
  const h = g.highlight
  const sel = state === 'selected'
  const size = sel ? (h.size ?? g.size + h.bump) : g.size
  const width = sel ? h.ring : g.outline
  const color = sel ? (h.ringColor ?? ink) : (g.outlineColor ?? ink)
  const dot = Math.min(size, PREVIEW_DOT + (sel ? h.bump : 0))
  return (
    <div style={{ ...styles.hlCell, ...style }} title={`${g.name}, ${state}`}>
      {sel && h.label && (
        <span style={{ ...styles.hlName, fontSize: h.labelSize, color: ink }}>gene</span>
      )}
      <span
        style={{
          ...styles.markerDot,
          width: dot,
          height: dot,
          background: g.color,
          opacity: state === 'faded' ? h.dim : sel ? 1 : g.opacity,
          // A fill and an outline that are both clear leave nothing to see — a hairline keeps the
          // marker locatable in its cell.
          ...(g.color === CLEAR && width <= 0 ? { border: `1px dashed ${UI.textMuted}` } : null),
          // The outline is a marker.line on the plot — a box-shadow here, so it rings the dot
          // without changing its size, as Plotly's stroke does.
          boxShadow: width > 0 ? `0 0 0 ${width}px ${color}` : undefined
        }}
      />
    </div>
  )
}

// CLEAR (from ColorPicker), a transparent colour: drawn as nothing, while the width it WOULD use is
// kept — so picking a colour again brings the same outline back.

/** A colour field: a plain chip (a switch's width, an input's height, so a row of them lines up),
 *  hatched when the colour is cleared. The previews at the top of the section show what each
 *  colour does — a chip only has to say which colour it is. */
function ColorChip({
  color,
  on,
  label,
  title,
  clearLabel,
  onPick,
  onClear,
  style
}: {
  color: string
  /** false = the colour is cleared: the chip is hatched rather than showing an ink. Independent of
   *  the width beside it — a width of 0 just means nothing is drawn at the moment. */
  on: boolean
  label: string
  title: string
  clearLabel: string
  onPick: (color: string) => void
  /** clear the colour: nothing is drawn, while any width beside it is kept */
  onClear: () => void
  /** placement / sizing from the caller (the group colour heads its column, full width) */
  style?: CSSProperties
}): ReactNode {
  // On a tile the grid is drawn at the canvas zoom, and closes when the canvas moves under it.
  const tf = useStore((s) => `${s.transform[0]},${s.transform[1]},${s.transform[2]}`)
  return (
    <ColorPicker
      value={color}
      onPick={onPick}
      onClear={onClear}
      clearLabel={clearLabel}
      label={label}
      title={title}
      zoom={Number(tf.split(',')[2]) || 1}
      closeKey={tf}
      triggerStyle={{
        ...styles.swatch,
        background: on
          ? color
          : `linear-gradient(to bottom right, transparent 45%, ${UI.border} 45%, ${UI.border} 55%, transparent 55%)`,
        ...style
      }}
    >
      <span />
    </ColorPicker>
  )
}

/** A pixel size / thickness: a small number box, clamped to its range on commit. Sizes read and
 *  type better as a value than as a slider (they're a handful of px, often typed exactly), and
 *  opacity (0–1 in 0.05 steps) goes through the same box. */
function SizeBox({
  value,
  onChange,
  min,
  max,
  step = 1,
  title,
  tight,
  disabled
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  title?: string
  /** narrow variant for a box sharing its cell with a fixed control (a swatch, a switch) */
  tight?: boolean
  /** greyed and inert — the setting still shows, but whatever it belongs to is switched off */
  disabled?: boolean
}): ReactNode {
  // Width follows what the field can hold: two digits for a px size, "0.85" for a fraction.
  return (
    <div style={tight ? styles.tightBox : step < 1 ? styles.fracBox : styles.sizeBox}>
      <NumberInput
        value={value}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        title={title}
        onChange={(v) => {
          // Snap to the step, then round away the binary-float dust (0.8500000000000001).
          const snapped =
            step < 1 ? Math.round(Math.round(v / step) * step * 100) / 100 : Math.round(v)
          onChange(Math.min(max, Math.max(min, snapped)))
        }}
      />
    </div>
  )
}

/** Name box for an effect class ("down" / "up"): edits live locally and commit on blur/Enter, so
 *  each keystroke doesn't push an undo step; blank reverts to the default. */
function EffectLabelInput({
  value,
  onCommit,
  style,
  placeholder,
  title = 'Name shown for this effect class in legends and tables'
}: {
  value: string
  onCommit: (v: string) => void
  style?: CSSProperties
  placeholder?: string
  title?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft != null && draft.trim() !== value) onCommit(draft.trim())
    setDraft(null)
  }
  return (
    <input
      type="text"
      style={{ ...styles.labelInput, ...style }}
      value={draft ?? value}
      placeholder={placeholder}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(null)
      }}
      title={title}
    />
  )
}

/** A significance cutoff entered as a plain p/q value (0 < p ≤ 1) while the config keeps it as
 *  −log10 (`statMin`), which is what the classifier and every plot use. While focused the field
 *  shows the raw draft so partial input ("0.0…") isn't snapped back mid-keystroke — only a valid
 *  value commits; unfocused it always reflects the prop (undo, a dragged volcano guide, …). */
function PValueInput({
  statMin,
  onChange
}: {
  statMin: number
  onChange: (statMin: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(roundP(Math.pow(10, -statMin)))
  return (
    <input
      type="number"
      className="oe-num"
      style={{ ...styles.input, textAlign: 'right' }}
      value={shown}
      step={0.001}
      min={0}
      max={1}
      onFocus={() => setDraft(shown)}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = Number(e.target.value)
        if (Number.isFinite(v) && v > 0 && v <= 1) onChange(-Math.log10(roundP(v)))
      }}
    />
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
  // Header-slot variant of configBtn: content-sized, sits right of the section title.
  configBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    background: UI.accent,
    color: UI.accentText,
    border: `1px solid ${UI.accent}`,
    borderRadius: 5,
    padding: '4px 11px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  // Whole shorthands, so nothing is left behind when the button re-enables.
  configBtnOff: {
    background: UI.panelAlt,
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    cursor: 'not-allowed'
  },
  panel: {
    width: PANEL_WIDTH,
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
  panelEmbedded: {
    width: '100%',
    maxHeight: 'none',
    boxShadow: 'none'
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
  // Embedded: no inner scroller, so the page scrolls as one document.
  scrollEmbedded: { overflow: 'visible' },
  section: { padding: '12px 14px', borderBottom: `1px solid ${UI.border}` },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10
  },
  // Centre (not baseline): an inline StatusNote carries an icon, which baseline alignment lifts.
  sectionTitleRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted
  },
  sectionSubtitle: { fontSize: 11, color: UI.textMuted, opacity: 0.8, whiteSpace: 'nowrap' },
  /** the title row as a button: no chrome, so it still reads as a heading */
  sectionToggle: {
    background: 'transparent',
    border: 'none',
    padding: 0,
    margin: 0,
    color: UI.textMuted,
    cursor: 'pointer',
    textAlign: 'left',
    flex: 1
  },
  hint: { color: UI.textMuted, fontSize: 11, marginBottom: 8, lineHeight: 1.4 },
  subActions: { display: 'flex', alignItems: 'center', gap: 6 },
  /** one decoration's controls: switch · style dropdown · width, wrapping in a narrow dialog */
  lineRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 },
  lineWidth: { display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' },
  /** a px size / thickness box: two digits */
  sizeBox: { width: '100%', minWidth: 32, flex: '1 1 auto' },
  /** a 0–1 fraction box: "0.85" — the same width; only its step and range differ */
  fracBox: { width: '100%', minWidth: 32, flex: '1 1 auto' },
  /** an outline cell: its colour swatch and width box side by side */
  ringCell: { display: 'flex', alignItems: 'center', gap: 4, width: '100%', minWidth: 0 },
  /** a box sharing its cell with a swatch / switch: it takes the remainder, down to two digits */
  tightBox: { flex: '1 1 auto', width: '100%', minWidth: 26, maxWidth: 40 },
  /** the axis switch: a pill with one half per axis, sitting in the section heading */
  axisPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    border: `1px solid ${UI.border}`,
    borderRadius: 999,
    background: UI.panelAlt
  },
  axisPillBtn: {
    border: 'none',
    borderRadius: 999,
    padding: '2px 16px',
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.5,
    cursor: 'pointer'
  },
  /** the line-style dropdown: content-sized, so the width control keeps the rest of the row */
  lineChoice: { display: 'flex', width: 66, flex: '0 0 66px' },
  /** the quick-access switch (QuickToggle) right of a plot setting: small caption + Switch */
  quickRow: { display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto' },
  quickLabel: { color: UI.textMuted, fontSize: 10, whiteSpace: 'nowrap' },
  field: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  fieldLabel: { color: UI.textMuted, fontSize: 11, width: 90, flex: '0 0 90px' },
  // Vertical field: header line, then its controls on the line below (full-width).
  fieldCol: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, minWidth: 0 },
  fieldColLabel: { color: UI.textMuted, fontSize: 11 },
  /** small label sitting left of an inline control (e.g. "log₂FC ≤" before its box) */
  inlineTag: { color: UI.textMuted, fontSize: 11, whiteSpace: 'nowrap' },
  /** one cutoff line: tag, number box (fixed width), optional class-name box */
  cutoffRow: { display: 'flex', alignItems: 'center', gap: 6 },
  /** a side's name above its cutoff line (uppercase, like the selector's side labels) */
  sideTag: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted,
    marginTop: 2
  },
  /** the preview: the sub-blocks' indent without their rule, so every column lines up */
  previewIndent: { paddingLeft: 10, borderLeft: '1px solid transparent' },
  /** the fields under a sub-heading: indented, with a hairline rule tying them to their caption */
  subGroup: {
    paddingLeft: 10,
    marginTop: 4,
    borderLeft: `1px solid ${UI.border}`
  },
  cutoffBox: { width: 64, flex: '0 0 64px' },
  /** the group table, transposed: one column per group, one row per setting. It scrolls
   *  sideways rather than squeezing when a plot has many groups. */
  groupScroll: { overflowX: 'auto', paddingBottom: 2 },
  groupGrid: {
    display: 'grid',
    alignItems: 'center',
    // Fields stretch to the column (one width for every box); fixed-size controls — a switch, a
    // marker preview — centre themselves instead (justifySelf on the element).
    justifyItems: 'stretch',
    columnGap: 6,
    rowGap: 6,
    minWidth: 0
  },
  /** a bare switch in the table: centred in its column */
  switchCell: { display: 'flex', justifyContent: 'center' },
  /** a row's name, down the left */
  rowLabel: { color: UI.textMuted, fontSize: 11, justifySelf: 'start', whiteSpace: 'nowrap' },
  /** the old row-per-group table (its cell styles are still used by the transposed one) */
  // Fluid columns so the table fits the narrower tile dialog (340px) as well as the canvas
  // panel: the name column takes whatever the fixed swatch/box/switch columns leave.
  /** the legend table: swatch · group name · entry switch */
  // The name column is content-sized so each switch sits right after its name (not at the far edge).
  /** the group-name box: labelInput trimmed to fit its fluid grid column */
  styleName: { minWidth: 0, width: '100%', padding: '3px 6px' },
  markerDot: { display: 'block', borderRadius: '50%', flex: '0 0 auto' },
  /** the highlight preview cell: markerCell, with room for the name above the marker */
  hlCell: {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    height: PREVIEW_H,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: '3px 2px',
    boxSizing: 'border-box',
    overflow: 'hidden'
  },
  /** the preview ground: ONE grid item spanning the three state rows and every group column
   *  (rows 1-2 are the name and colour, column 1 the row labels), painted under the markers */
  previewBox: {
    gridColumn: '2 / -1',
    gridRow: '3 / span 3',
    justifySelf: 'stretch',
    alignSelf: 'stretch',
    // Bleed over the grid's ROW gaps only, so it reads as one area rather than a tile per marker;
    // horizontally it stops at the columns' own edges instead of spilling into the label column.
    marginTop: -3,
    marginBottom: -3,
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 6
  },
  /** a native colour picker trimmed to a small swatch */
  swatch: {
    position: 'relative',
    width: 28,
    height: 24,
    flex: '0 0 28px',
    padding: 0,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    background: UI.panelAlt,
    boxSizing: 'border-box',
    overflow: 'hidden',
    cursor: 'pointer'
  },
  /** the preview dots stacked vertically, one group per line (the ring gap is added inline);
   *  each entry is its name over its dot */
  dotRow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  hlLabelCell: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    width: '100%',
    minWidth: 0,
    flexWrap: 'nowrap',
    whiteSpace: 'nowrap'
  },
  hlField: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  hlFieldLabel: {
    color: UI.textMuted,
    fontSize: 11,
    width: 50,
    flex: '0 0 50px',
    whiteSpace: 'nowrap'
  },
  /** the preview's gene name, as the overlay draws it (bold, at the configured size) */
  hlName: { fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.2, flex: '0 0 auto' },
  /** small text button in a section header (drop a section's overrides) */
  resetBtn: {
    background: 'transparent',
    color: UI.textMuted,
    border: 'none',
    padding: '2px 4px',
    fontSize: 11,
    cursor: 'pointer',
    textDecoration: 'underline'
  },
  /** a small percentage box (two digits + a decimal) */
  pctBox: { width: 48, flex: '0 0 48px' },
  labelInput: {
    flex: 1,
    minWidth: 80,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '4px 7px',
    fontSize: 12,
    boxSizing: 'border-box'
  },
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
  // The "Select plots (n)" trigger: styled like an input but behaves as a dropdown button.
  menuTrigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    textAlign: 'left',
    cursor: 'pointer'
  },

  // A heading row inside a dropdown (the enrichment terms' Function / Pathway): small, muted caps.
  optionHeading: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.7
  },
  // Data scale (Clean data): the input-value histogram, its range, and the detection note.
  // Caption + detected scale on the left, the distribution on the right.
  histWrap: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  histChart: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  },
  // The plot area is boxed; its bottom edge is the x axis.
  histSvg: {
    width: '100%',
    height: 36,
    display: 'block',
    boxSizing: 'border-box',
    border: `1px solid ${UI.border}`
  },
  histHead: {
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4
  },
  histCaption: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted
  },
  histAxis: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10,
    color: UI.textMuted,
    fontVariantNumeric: 'tabular-nums'
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
