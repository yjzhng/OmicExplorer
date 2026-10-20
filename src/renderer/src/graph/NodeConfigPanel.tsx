import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject
} from 'react'
import { PagerTrigger } from '../ui/PagerTrigger'
import { slashBackground } from '../ui/slash'
import { createPortal } from 'react-dom'
import { useStore } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'

import {
  classifyConditions,
  numericConds,
  combineStandardize,
  conditionLevels,
  sampleLevels,
  samplePasses,
  sheetSamples,
  isCustomCond,
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
  IMPUTE_DEFAULTS,
  NORMALIZE_REFERENCE_LABEL,
  type NormalizeReference,
  roundP,
  CC_Q_MIN,
  SAM_PERMUTATIONS,
  SAM_S0,
  previewCompare,
  previewContrastPair,
  previewFactorAnova,
  interactionAxes,
  analysisUnmet,
  CLUSTER_COLOR,
  CURVE_MIN_TREATED,
  condLabel,
  dataShape,
  customCond,
  isNumericCond,
  orderConds,
  type ClusterColorBy,
  type ConditionKey,
  type NumericConds,
  type SampleOrder,
  type FdrMethod,
  type StandardizeResult,
  DUMBBELL_ORDERS,
  curvesReplicated,
  RESIDUAL_DOT_CAP,
  dumbbellOrderLabel,
  manualSheetConditions,
  manualSheetIssues,
  sheetIssueLines,
  type LeafOrder
} from '../engine'
import { IconCopy, IconGear, IconJump, IconTrash } from '../ui/icons'
import { ProjectFolderViewer } from '../ui/ProjectFolderViewer'
import { GeneSearchMenu } from '../dashboard/GeneSearchMenu'
import {
  DEFAULT_OUTLINE,
  defaultGroups,
  legendOn,
  resolveGroup,
  type PointPlotKind,
  type ResolvedGroup
} from '../ui/pointStyle'
import { AUTO, AUTO_BACKGROUND, AutoMark, CLEAR, ColorPicker } from '../ui/ColorPicker'
import { Select as AppSelect, type SelectOption } from '../ui/Select'
import { CategoricalLabel, PaletteSelect } from '../ui/PaletteSelect'
import {
  BUBBLE_SIG_PALETTE,
  categoricalIds,
  toCategoricalId,
  toPaletteRef,
  type CategoricalId,
  type PaletteRef,
  type PaletteRole
} from '../ui/palettes'
import { useAppSettings, useRolePalette } from '../ui/useAppSettings'
import { OnOffSwitch, ToggleSwitch } from '../ui/ToggleSwitch'
import { HoverTip, InfoTip } from '../ui/InfoTip'
import { ValueMultiSelect } from '../ui/ValueMultiSelect'
import { StatusIcon, StatusNote } from '../ui/StatusNote'
import { entriesFor, gatePlotEntries, UNWIRED, type UpstreamFacts } from './requirements'
import { useUpstreamFacts } from './useUpstreamFacts'
import type { AxisDefaults } from '../ui/plotAxes'
import { cssVars, GUIDE_WIDTH, PALETTES, QC_FILL, UI } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'
import { contrastSummary } from './ComparisonDialog'
import { CompareDialog } from './CompareDialog'
import { analysisChoice, stdSampleRows } from './compareModel'
import { CurveDialog } from './CurveDialog'
import { ContrastDialog } from './ContrastDialog'
import {
  curveAxisOptions,
  curveSurfaceWhy,
  readAxisValue,
  surfacePairs,
  surfaceValue
} from './curveSettings'
import { fitOf } from './axisFits'
import { METRIC_IDS, METRIC_NAMES, type MetricId } from './metricBars'
import { isPairable, pairSides, selectorRowsOf, selectSource, toContrastSide } from './contrastPair'
import type { PairInput } from './PairContrastDialog'
import { InteractiveImportDialog } from './InteractiveImportDialog'
import { DataFormatDialog, type DataFormatTab } from './DataFormatDialog'
import { useConfigWindowOpen } from './dialogDock'
import {
  accentOf,
  canConnect,
  categoryOf,
  CATEGORIES,
  entryKey,
  NODE_SPECS,
  plotLabel,
  PLOT_SECTIONS,
  safeTileName,
  responseLabel,
  stepTitle,
  tileEntryKey,
  type PlotMenuEntry,
  loadAbove,
  wiredKindOf
} from './registry'
import { ApplyStageContext } from './applyStage'
import { locationOf, useGraph } from './store'
import { UnitInput } from './UnitInput'
import { nameChip, nameInput, tileNameText } from './tileNameStyles'
import { usePlotGroupTitle } from './usePlotGroupTitle'
import {
  barColorConds,
  defaultColorConds,
  qcColorConds,
  qcColorBy,
  condColorByDefault,
  primaryColorLevels,
  heatmapCondBar,
  SAMPLE_ORDERS,
  SAMPLE_ORDER_HINT,
  HEATMAP_LINKAGES,
  DENDRO_CLADES_DEFAULT,
  HEATMAP_LEAF_ORDERS,
  type HeatmapLinkage,
  sampleOrderOf,
  clusterColorConds,
  isComparisonKind,
  isCompareConfigured,
  isContrastConfigured,
  isStep,
  normalizeCompareConfig,
  anovaFactorsOf,
  numericOfResult,
  declaredNumeric,
  loadCustomConditions,
  loadNumericConditions,
  thresholdForDetection,
  curveMethodOf,
  thresholdForAnalysis,
  resolveContrastSource,
  resolveLoadMode,
  type BarConfig,
  type BubbleConfig,
  type CompareConfig,
  effectLabelsOf,
  effectColorsOf,
  plotEffectColors,
  type EffectColors,
  type EffectLabels,
  type PlotEffectColors,
  type ContrastConfig,
  type DRConfig,
  drLook,
  DR_DETAIL_CAP,
  responseDim,
  responseLook,
  responseShow,
  responseShowWhy,
  responseSlice,
  CURVE_OF_SLICE,
  SLICE_OF_CURVE,
  responseSliceable,
  type ResponseConfig,
  type TdrConfig,
  tdrPair,
  drYScale,
  DOSE_UNIT_SUGGESTIONS,
  TIME_UNIT_SUGGESTIONS,
  type PotencyConfig,
  type MetricsConfig,
  type VarianceConfig,
  type InteractionConfig,
  type CurveMadConfig,
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
  clusterStyle,
  quickOn,
  type ClusterConfig,
  type CorrConfig,
  type PlotChild,
  type PlotGroupConfig,
  type QcConfig,
  type ScatterConfig,
  type StandardizeConfig,
  type SubsetConfig,
  type StringConfig,
  STRING_OUTLINE,
  TABLE_GENE_MAX,
  type TableConfig,
  type VolcanoConfig,
  curveQcAxisOptions,
  CURVE_QC_DEFAULT_X,
  CURVE_QC_DEFAULT_Y,
  type CurveQcAxis
} from './types'

/** Detail panel width (flow units — it scales with the canvas zoom). Exported so the tile can
 *  decide which side of itself the panel fits on. */
export const PANEL_WIDTH = 402
/** A canvas tile's category strip (its top border's width) — the floating panel's matches it. */
export const TILE_STRIP = 5

/** The preset conditions, as a fallback where the data's own condition list isn't known yet.
 *  Anywhere the real list is reachable (a tile's upstream result), use that instead — it carries
 *  the custom conditions too. */
const CONDS: ConditionKey[] = ['cell', 'cmpd', 'dose', 'time']

/** The plotting ops a group subcard can be (everything in the plotting category except
 *  the group container itself — groups don't nest). */
const GROUP_CHILD_OPS: NodeKind[] = CATEGORIES.plotting.ops

/** Sub-groups for the add-plot menu, so the flat plotting list reads as labelled sections by what
 *  each plot shows. Derived from the shared PLOT_SECTIONS (single source of truth, also used by the
 *  new-step TilePicker); each kind fans out over the data's numeric conditions (`axes`) into its
 *  entries (plotEntriesFor: a Response plot per condition and per pair). Any kind not listed falls
 *  into a trailing "Other" section, so new plot kinds are never dropped. */
function plotMenuGroups(
  facts: UpstreamFacts = UNWIRED
): { label: string; entries: PlotMenuEntry[] }[] {
  const listed = new Set(PLOT_SECTIONS.flatMap((sec) => sec.kinds))
  const groups = PLOT_SECTIONS.map((sec) => ({
    label: sec.label,
    entries: sec.kinds
      .filter((k) => GROUP_CHILD_OPS.includes(k))
      .flatMap((k) => entriesFor(k, facts))
  })).filter((g) => g.entries.length > 0)
  const rest = GROUP_CHILD_OPS.filter((k) => !listed.has(k)).flatMap((k) => entriesFor(k, facts))
  return rest.length ? [...groups, { label: 'Other', entries: rest }] : groups
}
/** The menu section a plot of `kind` sits under (whatever its variant), else "Other". */
const sectionOfKind = (kind: NodeKind): string =>
  PLOT_SECTIONS.find((sec) => sec.kinds.includes(kind))?.label ?? 'Other'

/** The add-plot menu's sections for a step of `upstreamKind`: only the plots it can feed. */
function plotMenuGroupsFor(upstreamKind: NodeKind): { label: string; entries: PlotMenuEntry[] }[] {
  return plotMenuGroups()
    .map((g) => ({
      ...g,
      entries: g.entries.filter((e) => canConnect(upstreamKind, e.kind))
    }))
    .filter((g) => g.entries.length > 0)
}

/** True when a subcard is this menu entry — its kind and variant (so each Response plot matches on
 *  its own condition(s) even though they share a kind). */
const childMatchesEntry = (c: PlotChild, e: PlotMenuEntry): boolean =>
  c.kind === e.kind && tileEntryKey(c.kind, c.config) === entryKey(e)

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
  // In a config panel (ScreenScale) the menu is at screen scale, like the panel.
  const z = useContext(ScreenScale) ? 1 : Number(tf.split(',')[2]) || 1
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
      plotMenuGroups(facts)
        .map((g) => ({
          ...g,
          entries: gatePlotEntries(
            upstreamKind ? g.entries.filter((e) => canConnect(upstreamKind, e.kind)) : g.entries,
            facts
          )
        }))
        .filter((g) => g.entries.length > 0),
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
                        // A toggle: a ticked plot is taken out of the group (every copy of it),
                        // an unticked one added. The group's last plot stays — removing it would
                        // delete the tile from a menu.
                        onClick={() => {
                          const ids = children
                            .filter((c) => childMatchesEntry(c, e))
                            .map((c) => c.id)
                          if (!ids.length) onAdd([{ kind: e.kind, override: e.override }])
                          else if (ids.length < children.length) onRemove(ids)
                        }}
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

/** The tile name's size, px (tileNameText) — the plot picker after it matches. */
const NAME_PX = tileNameText.fontSize as number

/** A group's plot picker for its details panel: the tile gene pager's ‹ [name ▾] › trigger
 *  (PagerTrigger) — the arrows step through the group's plots, the name opens the list — over the
 *  plot tile's own dropdown (AddPlotMenu's window, section headers and rows, the shown plot
 *  ticked): the group's plots in tile order, a category header over each run of plots from one of
 *  the menu's categories. The panel draws at screen scale, so the window does too (no zoom). */
function PlotPicker({
  plots,
  current,
  onPick
}: {
  /** the group's plots, in tile order */
  plots: PlotChild[]
  current: string
  onPick: (id: string) => void
}): ReactNode {
  const p = PALETTES[useUiTheme((s) => s.mode)]
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const sections = useMemo(() => {
    // each plot under the first menu section holding an entry it matches, else "Other"
    const sectionOf = (c: PlotChild): string => sectionOfKind(c.kind)
    // In tile order, so the list and the arrows read as the tile does; a new header wherever the
    // category changes (a category the plots were dragged apart from heads each of its runs).
    const runs: { key: string; label: string; items: { id: string; label: string }[] }[] = []
    for (const c of plots) {
      const label = sectionOf(c)
      const name = plotLabel(c.kind, c.config)
      // two plots of one kind told apart by their place among that kind
      const same = plots.filter((o) => plotLabel(o.kind, o.config) === name)
      const item = { id: c.id, label: same.length > 1 ? `${name} ${same.indexOf(c) + 1}` : name }
      const last = runs[runs.length - 1]
      if (last?.label === label) last.items.push(item)
      else runs.push({ key: c.id, label, items: [item] })
    }
    return runs
  }, [plots])
  const items = sections.flatMap((sec) => sec.items)
  const idx = items.findIndex((it) => it.id === current)
  // Step through the plots, wrapping.
  const step = (d: -1 | 1): void => {
    const n = items.length
    if (n) onPick(items[(((idx + d) % n) + n) % n].id)
  }
  const plotAccent = accentOf('plotting')
  // Sized to the tile name it follows (tileNameText's 14px): the trigger at that size, and the
  // dropdown — the tile menu's 12px rows — scaled up to it.
  const z = NAME_PX / 12
  return (
    <>
      <PagerTrigger
        name={items[idx]?.label ?? ''}
        open={open}
        onToggle={() => {
          if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
          setOpen((o) => !o)
        }}
        btnRef={btnRef}
        onStep={step}
        canStep={items.length > 1}
        noun="plot"
        title="Jump to a plot"
        fontSize={NAME_PX}
      />
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              // Hung from whichever end of the trigger leaves it the room — from its right end in
              // the screen's right half — so the window keeps its rows' width, not squeezed by the
              // screen edge.
              ...(rect.left > window.innerWidth / 2
                ? { right: window.innerWidth - rect.right }
                : { left: rect.left }),
              top: rect.bottom + 4 * z,
              width: 'max-content',
              minWidth: Math.max(rect.width, 220 * z),
              zIndex: 5000,
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
            {sections.map((sec, si) => (
              <div key={sec.key}>
                <div
                  style={{
                    padding: `${(si === 0 ? 2 : 6) * z}px ${6 * z}px ${2 * z}px`,
                    fontSize: 9.5 * z,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5 * z,
                    color: p.textMuted
                  }}
                >
                  {sec.label}
                </div>
                {sec.items.map((it) => (
                  <AddPlotItem
                    key={it.id}
                    label={it.label}
                    checked={it.id === current}
                    z={z}
                    colors={{ text: p.text, hover: p.panel, accent: plotAccent }}
                    onClick={() => {
                      onPick(it.id)
                      setOpen(false)
                    }}
                  />
                ))}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

/** Settings › Plot defaults' plot picker: the plot tile's own "Select plots" menu (AddPlotMenu —
 *  same window, collapsible section headers with their count, rows), single-choice: the plots a
 *  step of `upstreamKind` feeds, each Response plot (Dose response, Time response…) its own entry. The
 *  section count is 1 where the picked plot sits. */
export function PlotEntryMenu({
  value,
  upstreamKind,
  onChange
}: {
  /** the picked entry's key (entryKey) */
  value: string
  upstreamKind: NodeKind
  onChange: (entry: PlotMenuEntry) => void
}): ReactNode {
  const { open, toggle, setOpen, rect, z, p, btnRef, menuRef } = useZoomDropdown()
  const menuGroups = plotMenuGroupsFor(upstreamKind)
  const picked = menuGroups.flatMap((g) => g.entries).find((e) => entryKey(e) === value)
  const plotAccent = accentOf('plotting')
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
        <span>{picked?.label ?? 'Select a plot'}</span>
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
              const active = g.entries.some((e) => entryKey(e) === value) ? 1 : 0
              const isOpen = !collapsed.has(g.label)
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
                      <Chevron size={10 * z} deg={isOpen ? 90 : 0} />
                      <span>{g.label}</span>
                    </button>
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
                        checked={entryKey(e) === value}
                        z={z}
                        colors={{ text: p.text, hover: p.panel, accent: plotAccent }}
                        onClick={() => {
                          onChange(e)
                          setOpen(false)
                        }}
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
      <AxesSection
        config={config as { axes?: PlotAxes }}
        update={update}
        defaults={axisDefaults}
        minimal={kind === 'pca' && clusterMinimalAxes(config as ClusterConfig)}
      />
    </>
  ) : (
    own
  )
}

/** Whether a cluster tile draws its embedding scatter with minimal axes (scree and loadings keep
 *  their own, so the setting doesn't reach them). */
function clusterMinimalAxes(c: ClusterConfig): boolean {
  return c.axisMode === 'minimal' && ((c.plot ?? 'pc') === 'pc' || c.method !== 'pca')
}

/** The plots whose settings carry the shared Axes section (Plotly x/y axes). */
const AXIS_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'volcano',
  'heatmap',
  'scatter',
  'ma',
  'dr',
  'potency',
  'variance',
  'interaction',
  'curveMad',
  'bubble',
  'dumbbell',
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
      return (
        <>
          <VolcanoPanel config={config as VolcanoConfig} {...props} />
          <ColourSection config={config as VolcanoConfig} {...props} />
        </>
      )
    case 'heatmap':
      return (
        <>
          <HeatmapPanel config={config as HeatmapConfig} {...props} />
          <HeatmapColourSection config={config as HeatmapConfig} {...props} />
        </>
      )
    case 'scatter':
      return (
        <>
          <ScatterPanel config={config as ScatterConfig} {...props} />
          <ColourSection config={config as ScatterConfig} {...props} />
        </>
      )
    case 'dumbbell':
      return <DumbbellPanel config={config as DumbbellConfig} {...props} />
    case 'ma':
      return (
        <>
          <MAPanel config={config as MAConfig} {...props} />
          <ColourSection config={config as MAConfig} {...props} />
        </>
      )
    case 'dr':
      return (
        <>
          <DRPanel config={config as DRConfig} {...props} />
          <ColourSection config={config as DRConfig} {...props} />
        </>
      )
    case 'potency':
      return (
        <>
          <PotencyPanel config={config as PotencyConfig} {...props} />
          <ColourSection config={config as PotencyConfig} {...props} />
        </>
      )
    case 'metrics':
      return <MetricsPanel config={config as MetricsConfig} {...props} />
    case 'variance':
      return <VariancePanel config={config as VarianceConfig} {...props} />
    case 'interaction':
      return <InteractionPanel config={config as InteractionConfig} {...props} />
    case 'curveMad':
      return <CurveMadPanel config={config as CurveMadConfig} {...props} />
    case 'response':
      return <ResponsePanel config={config as ResponseConfig} {...props} />
    case 'bubble':
      return (
        <>
          <BubblePanel config={config as BubbleConfig} {...props} />
        </>
      )
    case 'tdr':
      return <ResponsePanel config={config as TdrConfig} measured {...props} />
    case 'geneBar':
      return (
        <>
          <GeneBarPanel config={config as BarConfig} {...props} />
          <CategoricalSection config={config as BarConfig} {...props} />
        </>
      )
    case 'pca':
      return (
        <>
          <ClusterPanel config={config as ClusterConfig} {...props} />
          <CategoricalSection config={config as ClusterConfig} {...props} />
        </>
      )
    case 'enrich':
      return (
        <>
          <EnrichPanel config={config as EnrichConfig} {...props} />
          <ColourSection
            config={config as EnrichConfig}
            {...props}
            groups
            hint="The up / down colours draw the bars, stems and dots — a dot faint to full by significance, on a scale reaching at least FDR 0.05."
          />
        </>
      )
    case 'string':
      return (
        <>
          <StringPanel config={config as StringConfig} {...props} />
          <ColourSection config={config as StringConfig} {...props} />
        </>
      )
    case 'qc':
      return (
        <>
          <QcPanel config={config as QcConfig} {...props} />
          <CategoricalSection config={config as QcConfig} {...props} />
        </>
      )
    case 'corr':
      return <CorrPanel config={config as CorrConfig} {...props} />
    case 'table':
      return <TablePanel config={config as TableConfig} {...props} />
    default:
      return null
  }
}

/** The panel's title: the tile's name, exactly as the tile shows it and renames it (see
 *  tileNameStyles) — dashed outline in the accent under the pointer, click to edit, Enter or blur
 *  commits, Escape cancels, an emptied name falls back to the type. */
function HeadName({
  id,
  name,
  fallback,
  accent
}: {
  id: string
  name?: string
  fallback: string
  accent: string
}): ReactNode {
  const renameNode = useGraph((s) => s.renameNode)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [hovered, setHovered] = useState(false)
  const commit = (): void => {
    renameNode(id, safeTileName(draft))
    setEditing(false)
  }
  return (
    // Its own line, as the tile's title column is.
    <div style={styles.headName}>
      {editing ? (
        <input
          autoFocus
          value={draft}
          placeholder={fallback}
          onChange={(e) => setDraft(safeTileName(e.target.value))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') setEditing(false)
          }}
          aria-label="Step name"
          style={nameInput}
        />
      ) : (
        <span
          title="Click to rename"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => {
            setDraft(name ?? '')
            setEditing(true)
            // The span unmounts into the input without a mouseleave, so clear it here.
            setHovered(false)
          }}
          style={{
            ...tileNameText,
            ...nameChip,
            border: `1px dashed ${hovered ? accent : 'transparent'}`
          }}
        >
          {name ?? fallback}
        </span>
      )}
    </div>
  )
}

/** Whether menus draw at screen scale rather than the canvas zoom: true inside a config panel, which
 *  is always at screen scale (beside its tile it's counter-scaled by 1/zoom — GraphNode; in the
 *  form workflow it's off the canvas), so a menu matches the panel it opens from. A select on a
 *  tile itself (outside a panel) still follows the canvas zoom. */
const ScreenScale = createContext(false)

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
  const selectChildCard = useGraph((s) => s.selectChildCard)
  // An unnamed group is named as on its tile (after the step it reads from).
  const groupTitle = usePlotGroupTitle(id, !!node && isStep(node) && node.data.kind === 'plotGroup')

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
  // A Response plot is titled by its condition(s) (Dose response, Dose & Time response), like everywhere else.
  const headLabel = plotLabel(headKind, activeChild ? activeChild.config : node.data.config)
  const ops = CATEGORIES[category].ops

  return (
    // Embedded (the form workflow): flow with the page instead of floating as a fixed-width card
    // — no shadow, no width cap, and no inner scroller fighting the page's own. Either way its menus
    // are drawn at screen scale, like the panel itself (ScreenScale).
    // Floating beside its tile, the panel's own top border is the category strip, as thick as the
    // tile's and at the same outer edge, so the two line up; embedded, the head carries it.
    <ScreenScale.Provider value={true}>
      <div
        data-config-panel={id}
        style={
          embedded
            ? { ...styles.panel, ...styles.panelEmbedded }
            : {
                ...styles.panel,
                borderTopWidth: TILE_STRIP,
                borderTopColor: accentOf(category)
              }
        }
      >
        <div
          style={{
            ...styles.head,
            ...(embedded ? { borderTopColor: accentOf(category) } : { borderTopWidth: 0 })
          }}
        >
          <div style={styles.headText}>
            <span style={{ ...styles.headCat, color: accentOf(category) }}>
              {CATEGORIES[category].label}
            </span>
            {activeChild ? (
              // A group's panel holds ONE of its plots' settings: the tile's name (renamed in place,
              // as on the tile), then the switcher naming that plot — and picking another, so the
              // tile needn't be expanded to.
              <>
                <div style={styles.headNameRow}>
                  <HeadName
                    key={id}
                    id={id}
                    name={node.data.name}
                    fallback={groupTitle ?? 'Plot group'}
                    accent={accentOf(category)}
                  />
                  <PlotPicker
                    plots={children}
                    current={activeChild.id}
                    onPick={(v) => selectChildCard(id, v)}
                  />
                </div>
                <span style={styles.headId}>{node.id}</span>
              </>
            ) : (
              <>
                {/* The tile's name, renamed in place (as on the tile itself); its type stands in
                  until it's given one, and moves to the line below once it has. */}
                <HeadName
                  // fresh per tile, so a rename left open doesn't carry over to the next one
                  key={id}
                  id={id}
                  name={node.data.name}
                  fallback={isGroup ? `Group · ${headLabel}` : headLabel}
                  accent={accentOf(category)}
                />
                <span style={styles.headId}>
                  {node.data.name ? `${headLabel} · ${node.id}` : node.id}
                </span>
              </>
            )}
          </div>
          <div style={styles.headActions}>
            {/* Same chrome for both; the trash is red like the workflow/folder menus' delete. */}
            <button
              style={styles.iconBtnSm}
              // On a group it copies the whole tile, unlike delete (one plot), so it says so.
              title={isGroup ? 'Duplicate group' : 'Duplicate'}
              aria-label={isGroup ? 'Duplicate group' : 'Duplicate'}
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
            the panel shows only the active subcard's config, picked in the header. */}
          {isGroup
            ? !activeChild && <div style={styles.hint}>Empty group — add a plot on the tile.</div>
            : ops.length > 1 && (
                // The operation picker sits in the section header, right of the title. (A plot never
                // gets here: every visualisation tile is a plot group, managed on the tile.)
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
          {kind === 'subset' && <SubsetPanel id={id} config={node.data.config as SubsetConfig} />}
          {(kind === 'compare' || kind === 'curveFit') && (
            <ComparePanel
              id={id}
              config={node.data.config as CompareConfig}
              curve={kind === 'curveFit'}
            />
          )}
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
    </ScreenScale.Provider>
  )
}

// ── per-kind panels ─────────────────────────────────────────────────────────────

/** An input file's text, read from the data folder — null while it's being read, or when no file
 *  is named or it can't be read. Re-read when the name (or the data folder) changes. */
function useInputText(name: string | null | undefined): string | null {
  const dir = useGraph((s) => s.dataDir)
  const [got, setGot] = useState<{ key: string; text: string } | null>(null)
  const key = `${dir ?? ''}|${name ?? ''}`
  useEffect(() => {
    if (!dir || !name) return
    let live = true
    const wf = locationOf(useGraph.getState())?.scope
    window.api
      .readDataFile(dir, name, wf)
      .then((text) => {
        if (live && text != null) setGot({ key, text })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [dir, name, key])
  return got && got.key === key ? got.text : null
}

function LoadPanel({ id, config }: { id: string; config: LoadConfig }) {
  const update = useGraph((s) => s.updateConfig)
  const setUnits = useGraph((s) => s.setLoadUnits)
  const setNumeric = useGraph((s) => s.setLoadNumeric)
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
  // The manual samplesheet, read for two things before any run: its columns (a unit is only asked
  // for a condition the sheet carries) and the run's samplesheet check, shown as a warning — the
  // same rule the interactive import gates on (manualSheetIssues).
  // The "Manual data input" window (one section per input file), opened from the (i) beside
  // each file.
  const [formatTab, setFormatTab] = useState<DataFormatTab | null>(null)
  const formatButton = (tab: DataFormatTab): ReactNode => (
    <HoverTip tip="Manual data input — click for the columns, an example and the template">
      <button
        style={styles.formatBtn}
        onClick={() => setFormatTab(tab)}
        aria-label={`Manual data input: ${tab}`}
      >
        <StatusIcon kind="info" />
      </button>
    </HoverTip>
  )
  const sheetText = useInputText(mode === 'manual' ? config.samplesheet : null)
  const dataText = useInputText(mode === 'manual' ? config.data : null)
  // The samplesheet's conditions, as the run will read them: the presets whose column holds a value,
  // then its custom ones (detected as the run detects them) — what the Conditions section lists.
  const sheetConds = useMemo(
    () => (sheetText == null ? [] : manualSheetConditions(sheetText)),
    [sheetText]
  )
  const sheetCheck = useMemo(
    () =>
      sheetText == null
        ? null
        : manualSheetIssues(sheetText, dataText, config.data, declaredNumeric(config)),
    [sheetText, dataText, config]
  )
  // Interactive import is set up once the standard files have been generated (config.data set).
  const converted = !!config.data
  // The generated files' folder (the workflow folder's input — see convertInteractive), for the
  // jump to it in the project-folder viewer. That viewer shows the data folder, so only a folder
  // inside it can be jumped to: an unsaved project's sits in the session's temporary folder.
  const dataDir = useGraph((s) => s.dataDir)
  const dataDirMissing = useGraph((s) => s.dataDirMissing)
  const inputDir = useGraph((s) => {
    const scope = locationOf(s)?.scope
    return scope && typeof scope === 'object' ? `${scope.base}/input` : null
  })
  const canJump =
    !!dataDir &&
    !dataDirMissing &&
    !!inputDir &&
    inputDir.replace(/\\/g, '/').startsWith(dataDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/')
  const [viewerOpen, setViewerOpen] = useState(false)
  const themeMode = useUiTheme((s) => s.mode)
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
      <Section
        title="Import mode"
        info={
          mode === 'manual'
            ? 'Provide the three standard input files.'
            : 'Provide one data matrix; configure samples to generate the standard files.'
        }
      >
        <ToggleSwitch
          label="Import mode"
          value={mode}
          options={[
            { value: 'interactive' as const, label: 'Interactive' },
            { value: 'manual' as const, label: 'Manual' }
          ]}
          onChange={(m) => update(id, { mode: m })}
        />
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
            <Field label="datamatrix" labelAside={formatButton('datamatrix')}>
              <Select
                value={config.data ?? ''}
                onChange={(v) => update(id, { data: v || null })}
                options={opts}
              />
            </Field>
            <Field label="samplesheet" labelAside={formatButton('samplesheet')}>
              <Select
                value={config.samplesheet ?? ''}
                onChange={(v) => update(id, { samplesheet: v || null })}
                options={opts}
              />
            </Field>
            <Field label="metadata" labelAside={formatButton('metadata')}>
              <Select
                value={config.db ?? ''}
                onChange={(v) => update(id, { db: v || null })}
                options={opts}
              />
            </Field>
            <button style={styles.linkNote} onClick={() => setFormatTab('datamatrix')}>
              How to prepare input files?
            </button>
            {/* The samplesheet's check, as the run will make it (manualSheetIssues): what would
                stop the run, else a pass. */}
            {sheetCheck &&
              (sheetCheck.noSample || sheetCheck.issues.length > 0 ? (
                <StatusNote kind="warn">
                  {sheetCheck.noSample ? (
                    'The samplesheet needs a “sample” column naming each sample — the run will stop.'
                  ) : (
                    <>
                      Samplesheet: the run will stop until this is fixed. Every condition in use
                      needs a value for every sample, and dose and time must be numbers (a vehicle’s
                      dose is 0):
                      {sheetIssueLines(sheetCheck.issues).map((line) => (
                        <div key={line}>• {line}</div>
                      ))}
                    </>
                  )}
                </StatusNote>
              ) : (
                <StatusNote kind="ok" style={styles.doneNote}>
                  Samplesheet checked
                </StatusNote>
              ))}
            {formatTab && (
              <DataFormatDialog initialTab={formatTab} onClose={() => setFormatTab(null)} />
            )}
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
            {!converted && <StatusNote kind="warn">Not configured — pipeline blocked</StatusNote>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <ConfigureButton
                label={converted ? 'Edit samples…' : 'Configure samples…'}
                disabled={!config.matrix}
                title={config.matrix ? undefined : 'Choose the raw data file first'}
                onClick={() => setDialogOpen(true)}
              />
            </div>
            {converted && (
              <StatusNote kind="ok" style={styles.doneNote}>
                {/* The workflow folder's input: convertInteractive writes every generated file
                    (data, samplesheet, ID map) there. */}
                Ready · parsed data saved to input
                <button
                  style={{ ...styles.jumpBtn, ...(canJump ? null : { opacity: 0.4 }) }}
                  disabled={!canJump}
                  onClick={() => setViewerOpen(true)}
                  title={
                    canJump
                      ? 'Show in project folder'
                      : 'Save the project to see its folder in the project-folder viewer'
                  }
                  aria-label="Show in project folder"
                >
                  <IconJump />
                </button>
              </StatusNote>
            )}
            {/* Portalled: the panel can sit in the zoomed canvas, which would scale and clip a
                fixed-position modal inside it. */}
            {viewerOpen &&
              dataDir &&
              inputDir &&
              createPortal(
                // The theme's colour variables are set on the app root, not body: carry them over.
                <div style={cssVars(PALETTES[themeMode])}>
                  <ProjectFolderViewer
                    root={dataDir}
                    reveal={inputDir}
                    onClose={() => setViewerOpen(false)}
                  />
                </div>,
                document.body
              )}
            {dialogOpen && <InteractiveImportDialog id={id} onClose={() => setDialogOpen(false)} />}
          </>
        )}
      </Section>
      {/* A manual samplesheet has no mapping step, so its conditions' types and units are set here
          (the interactive import sets them on its Conditions step): each condition's cat/num chip
          — fixed for the presets, a click for a custom one, which re-runs what's below — and a
          numeric one's unit (display-only — no re-run). */}
      {mode === 'manual' && (
        <Section title="Conditions">
          {sheetConds.length === 0 ? (
            <span style={styles.condNone}>
              {sheetText == null
                ? 'Choose a samplesheet first.'
                : 'No conditions in the samplesheet.'}
            </span>
          ) : (
            sheetConds.map((c) => {
              const preset = c === 'cell' || c === 'cmpd' || c === 'dose' || c === 'time'
              const num = c === 'dose' || c === 'time' || declaredNumeric(config).includes(c)
              const key = preset ? c : `@${c}`
              const what = num
                ? 'Numeric: its values are numbers on a scale, with a unit'
                : 'Categorical: its values are labels'
              return (
                <Field key={c} label={c}>
                  <span style={styles.condRow}>
                    {preset ? (
                      <span style={styles.typeChip} title={`${what} (fixed for ${c}).`}>
                        {num ? 'num' : 'cat'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        style={{ ...styles.typeChip, ...styles.typeChipBtn }}
                        title={`${what}. Click to make it ${num ? 'categorical' : 'numeric'} (re-runs what's below).`}
                        onClick={() => setNumeric(id, c, !num)}
                      >
                        {num ? 'num' : 'cat'}
                      </button>
                    )}
                    {/* any text is a unit (nM, mg/mL, MIC, %, h…); the list only suggests */}
                    {num ? (
                      <UnitInput
                        style={styles.input}
                        value={(config.units as Record<string, string | undefined>)?.[key]}
                        suggestions={c === 'time' ? TIME_UNIT_SUGGESTIONS : DOSE_UNIT_SUGGESTIONS}
                        onChange={(u) => setUnits(id, { [key]: u })}
                      />
                    ) : (
                      <span style={styles.condNone}>no unit</span>
                    )}
                  </span>
                </Field>
              )
            })
          )}
        </Section>
      )}
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
  const dataFile = useGraph(
    (s) => (loadAbove(s, id)?.load.data.config as LoadConfig | undefined)?.data ?? ''
  )
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
      info={
        <>
          The scale the input arrived on is detected from its values (raw intensities, or already
          log₂ / log₁₀) and converted, so logged data is never logged twice. The transform sets the
          scale Clean data&apos;s values are shown, written and plotted on, and the scale a Compare
          tests on. Default: none.
          <br />
          <br />
          The histograms show the values as loaded and after the transform, with whether each shape
          looks normal.
        </>
      }
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

/** Pick one protein: a button showing the pick, opening the app's gene search (GeneSearchMenu, as
 *  the one-gene pager's) over the last run's genes. Before any run there are none to list. */
function ProteinPicker({
  value,
  names,
  onChange
}: {
  value: string | undefined
  /** uniqID → display name, from the Clean data step's last run */
  names: Record<string, string> | undefined
  onChange: (uid: string) => void
}): ReactNode {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setRect(null), [])
  // every gene, by name
  const genes = useMemo(
    () =>
      names
        ? Object.keys(names).sort((a, b) =>
            (names[a] ?? a).localeCompare(names[b] ?? b, undefined, { numeric: true })
          )
        : [],
    [names]
  )
  const shown = value ? (names?.[value] ?? value) : null
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={!names}
        title={!names ? 'Run Clean data once to list its proteins' : 'Pick the reference protein'}
        onClick={() =>
          setRect((r) => (r ? null : (btnRef.current?.getBoundingClientRect() ?? null)))
        }
        style={{
          ...styles.input,
          textAlign: 'left',
          cursor: names ? 'pointer' : 'not-allowed',
          color: shown ? UI.text : UI.textMuted
        }}
      >
        {shown ?? (names ? 'Pick a protein…' : 'Run Clean data first')}
      </button>
      {rect && names && (
        <GeneSearchMenu
          genes={genes}
          current={value}
          displayMap={names}
          anchor={rect}
          triggerRef={btnRef}
          onPick={onChange}
          onClose={close}
        />
      )}
    </>
  )
}

function StandardizePanel({ id, config }: { id: string; config: StandardizeConfig }) {
  const update = useGraph((s) => s.updateConfig)
  const std = useGraph((s) => {
    const r = s.results[id]
    return r?.kind === 'standardize' ? r.std : null
  })
  // The conditions the imported data actually carries, for "Coverage per": read off the upstream
  // interactive import's sample conditions (any included sample with a value), so they're right
  // before this tile has ever run. Joined into a string so the selector returns a stable value.
  // null = nothing to read there (a manual import) — then this tile's last run says, else every
  // preset is offered.
  const importConds = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === id)?.source
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    const ia = up && isStep(up) ? (up.data.config as LoadConfig).interactive : undefined
    if (!ia) return null
    const samples = Object.values(ia.conditions ?? {}).filter((c) => c.include !== false)
    const has = (v: string | undefined): boolean => !!v && v.trim() !== ''
    // A condition switched off in the import isn't written, whatever values it keeps.
    const hidden = new Set(ia.hiddenConditions ?? [])
    const keys: string[] = (['cell', 'cmpd', 'dose', 'time'] as const).filter(
      (f) => !hidden.has(f) && samples.some((c) => has(c[f]))
    )
    for (const name of ia.customConditions ?? [])
      if (!hidden.has(name) && samples.some((c) => has(c.extra?.[name])))
        keys.push(customCond(name))
    return keys.join('\u0001')
  })
  // Fed by Clean data (a second clean-up): the conditions of the table it's given, before this
  // step has run itself.
  const inputConds = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === id)?.source
    const r = upId ? s.results[upId] : undefined
    return r?.kind === 'standardize' ? r.std.activeConditions.join('\u0001') : null
  })
  const conds = useMemo(() => {
    if (importConds != null)
      return orderConds(importConds ? (importConds.split('\u0001') as ConditionKey[]) : [])
    if (std) return orderConds(std.activeConditions)
    if (inputConds != null)
      return orderConds(inputConds ? (inputConds.split('\u0001') as ConditionKey[]) : [])
    return orderConds([...CONDS])
  }, [std, importConds, inputConds])
  const geneTotal = useMemo(() => (std ? new Set(std.rows.map((r) => r.uniqID)).size : 0), [std])
  const r2 = (v: number): number => Math.round(v * 100) / 100
  return (
    <>
      <DataScaleSection id={id} config={config} std={std} />
      <Section
        title="Clean-up"
        info={
          <>
            Drop low coverage genes.{' '}
            {(() => {
              const pct = config.minSamplePct ?? 0
              // Only the conditions on offer: one the data doesn't carry groups nothing.
              const by = (config.minSamplePctBy ?? []).filter((c) => conds.includes(c))
              const where =
                by.length === 0
                  ? 'all samples'
                  : `samples in at least one ${by.map(condLabel).join(' × ')} group`
              return cleanupOn(config) ? `Keeps genes detected in ≥ ${pct}% of ${where}.` : ''
            })()}
          </>
        }
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
            {/* Which conditions the coverage is judged within. The section's (i) restates the
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
          </>
        )}
        {cleanupOn(config) && std && (std.cleanup?.droppedGenes ?? 0) > 0 && (
          <StatusNote kind="ok" style={styles.doneNote}>
            Dropped {std.cleanup.droppedGenes.toLocaleString()} of{' '}
            {(std.cleanup.droppedGenes + geneTotal).toLocaleString()} genes
          </StatusNote>
        )}
      </Section>
      {/* Normalisation runs after clean-up and before imputation, whose draws follow each
          sample's own distribution — so they're drawn from the normalised one. */}
      <Section
        title="Normalisation"
        info={
          <>
            Align samples to remove loading and batch differences. Skip for data already normalised.
            <br />
            <b>Common genes</b>: measured in every sample.
            <br />
            <b>All genes</b>: every value each sample measured.
            <br />
            <b>Reference protein</b>: one protein (e.g. a housekeeping protein) brought to the same
            level in every sample; a sample that didn't measure it is left as it is.
            <br />
            <b>Median</b>: shift each sample to the same median.
            <br />
            <b>Distribution</b>: median plus spread (Perseus width adjustment); also changes fold
            changes.
          </>
        }
        action={
          <OnOffSwitch
            on={!!config.normalizeEnabled}
            label="Normalisation"
            onChange={(on) => update(id, { normalizeEnabled: on })}
          />
        }
      >
        {config.normalizeEnabled && (
          <>
            <Field label="Applied to">
              <Select
                value={config.normalizeReference ?? 'shared'}
                onChange={(v) => update(id, { normalizeReference: v as NormalizeReference })}
                options={(['shared', 'all', 'protein'] as const).map((v) => ({
                  value: v,
                  label: NORMALIZE_REFERENCE_LABEL[v]
                }))}
              />
            </Field>
            {config.normalizeReference === 'protein' ? (
              <Field label="Protein">
                <ProteinPicker
                  value={config.normalizeProtein}
                  names={std?.displayMap}
                  onChange={(uid) => update(id, { normalizeProtein: uid })}
                />
              </Field>
            ) : (
              // (one protein has no spread to equalise: median only)
              <Field label="Method">
                <Select
                  value={config.normalizeSpread ? 'distribution' : 'median'}
                  onChange={(v) => update(id, { normalizeSpread: v === 'distribution' })}
                  options={[
                    { value: 'median', label: 'Median' },
                    { value: 'distribution', label: 'Distribution' }
                  ]}
                />
              </Field>
            )}
          </>
        )}
        {config.normalizeEnabled &&
          std?.normalization &&
          (() => {
            const nz = std.normalization
            if (nz.used === 'protein') {
              const name = nz.protein ? (std.displayMap[nz.protein] ?? nz.protein) : ''
              const missing = nz.missingSamples ?? 0
              return !nz.protein ? (
                <StatusNote kind="warn">Pick the reference protein.</StatusNote>
              ) : nz.samples === 0 ? (
                <StatusNote kind="warn">
                  {name} wasn't measured in any sample (or was dropped in clean-up): nothing was
                  normalised.
                </StatusNote>
              ) : (
                <StatusNote
                  kind={missing ? 'warn' : 'ok'}
                  style={missing ? undefined : styles.doneNote}
                >
                  {`Normalised ${nz.samples.toLocaleString()} sample${nz.samples === 1 ? '' : 's'} on ${name}`}
                  {missing
                    ? ` · ${missing.toLocaleString()} sample${missing === 1 ? '' : 's'} without it left as they are`
                    : ''}
                </StatusNote>
              )
            }
            const asked = nz.used === nz.reference
            const n = nz.samples
            // The genes the medians were taken on, of every gene kept: common ones, or all.
            const on = nz.used === 'shared' ? nz.sharedGenes : geneTotal
            const what = `sample ${nz.spread ? 'distribution' : 'median'}${n === 1 ? '' : 's'}`
            return (
              <StatusNote kind={asked ? 'ok' : 'warn'} style={asked ? styles.doneNote : undefined}>
                {asked
                  ? `Normalised ${n.toLocaleString()} ${what} on ${on.toLocaleString()}/${geneTotal.toLocaleString()} genes`
                  : `Too few common genes ${nz.sharedGenes.toLocaleString()}/${geneTotal.toLocaleString()}. Normalised ${n.toLocaleString()} ${what} on all ${geneTotal.toLocaleString()} genes`}
              </StatusNote>
            )
          })()}
      </Section>
      {/* Imputation runs after clean-up, so it fills only the gaps in genes that were kept. */}
      <Section
        title="Imputation"
        info={
          <>
            Fill missing values assuming limits of detection for each sample (Perseus): each gap is
            drawn from a normal distribution with SD of{' '}
            {config.imputeWidth ?? IMPUTE_DEFAULTS.width} × sample SD, centred at{' '}
            {config.imputeShift ?? IMPUTE_DEFAULTS.shift} × sample SD below the sample mean. Needs
            clean-up, so a gene seen once isn&apos;t mostly imputed.
          </>
        }
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
          </>
        )}
        {imputeOn(config) && std?.imputation && (
          <StatusNote kind="ok" style={styles.doneNote}>
            Imputed {std.imputation.imputed.toLocaleString()} of{' '}
            {std.imputation.total.toLocaleString()} values
          </StatusNote>
        )}
      </Section>
    </>
  )
}

/** How many comparisons the configured comparison would run (a dry-run count for the ready
 *  message): distinct num|den labels for an explicit compare; an ANOVA's overall comparisons and
 *  the terms it can test. Null if it can't be determined (not configured / incomplete). */
function comparisonCount(
  std: StandardizeResult,
  config: CompareConfig
): { n: number; on: ConditionKey[] } | null {
  try {
    if (config.analysis === 'anova') {
      const factors = anovaFactorsOf(config, numericConds(std.numericConditions ?? []))
      if (!factors.length) return null
      const pv = previewFactorAnova({
        rows: std.rows,
        factors,
        activeConditions: std.activeConditions,
        num: config.num,
        den: config.den
      })
      return {
        n: new Set(pv.rows.map((r) => r[0])).size + pv.tested.length,
        on: factors.map((f) => f.condition)
      }
    }
    const stated =
      config.analysis === 'compare' ? { compared: config.compared, pool: config.pool } : {}
    const n = previewCompare({
      rows: std.rows,
      num: config.num,
      den: config.den,
      match: config.match,
      ...stated,
      activeConditions: std.activeConditions,
      numericConditions: std.numericConditions ?? [],
      curveAxis: config.analysis === 'curve_fit' ? (config.curveAxis ?? 'dose') : undefined
    }).labels.length
    const on = classifyConditions(
      std.rows,
      config.num,
      config.den,
      std.activeConditions,
      stated.compared
    ).axis
    return { n, on }
  } catch {
    return null
  }
}

/** Subset: one searchable multi-select per condition the upstream dataset carries, keeping the
 *  samples whose conditions take the ticked values (all of a condition's values = unfiltered). */
function SubsetPanel({ id, config }: { id: string; config: SubsetConfig }) {
  const updateConfig = useGraph((s) => s.updateConfig)
  const std = useGraph((s) => {
    const up = s.edges.find((e) => e.target === id)?.source
    const r = up ? s.results[up] : undefined
    return r?.kind === 'standardize' ? r.std : null
  })
  // Off Load data (wiredKindOf): the samplesheet's samples, read as Clean data will read them, less
  // what any Subsets above this one drop — there's no run to pick values from yet.
  const aboveLoad = useGraph((s) =>
    wiredKindOf(s, id) === 'load'
      ? ((loadAbove(s, id)?.load.data.config as LoadConfig | undefined) ?? null)
      : null
  )
  // (the Subsets' own selectors: stable objects, so a shallow compare holds)
  const aboveKeep = useGraph(useShallow((s) => loadAbove(s, id)?.keep ?? []))
  const above = useMemo(
    () => (aboveLoad ? { load: aboveLoad, keep: aboveKeep } : null),
    [aboveLoad, aboveKeep]
  )
  const sheetText = useInputText(above?.load.samplesheet)
  const sheet = useMemo(() => {
    if (!above || sheetText == null) return null
    try {
      const passes = above.keep.map(samplePasses)
      return sheetSamples(sheetText, loadCustomConditions(above.load)).filter((m) =>
        passes.every((pass) => pass(m))
      )
    } catch {
      return null // a samplesheet Clean data couldn't read either: its run says why
    }
  }, [above, sheetText])
  const levels = useMemo(
    () =>
      above
        ? sheet
          ? sampleLevels(sheet, loadNumericConditions(above.load))
          : {}
        : std
          ? conditionLevels(std)
          : {},
    [above, sheet, std]
  )
  const samples = above ? sheet : (std?.samples ?? null)
  const keep = useMemo(() => config.keep ?? {}, [config.keep])
  const counts = useMemo(() => {
    if (!samples) return null
    const pass = samplePasses({ keep, reps: config.reps, drop: config.drop })
    return { kept: samples.filter(pass).length, of: samples.length }
  }, [samples, keep, config.reps, config.drop])
  // The replicates on offer: as numbered at import — the samplesheet's, else Clean data's (a Subset
  // before Clean data with no rep column has none yet: it numbers them as it reads the data).
  const reps = useMemo(
    () =>
      [...new Set((samples ?? []).map((m) => m.rep).filter((r): r is number => r != null))]
        .sort((a, b) => a - b)
        .map(String),
    [samples]
  )
  const sampleNames = useMemo(() => (samples ?? []).map((m) => m.sample), [samples])

  if (above ? !sheet : !std)
    return (
      <Section title="Subset">
        <div style={styles.hint}>
          {above
            ? 'Configure the Load data tile to pick values.'
            : 'Connect and run a Clean data tile to pick values.'}
        </div>
      </Section>
    )
  const conds = orderConds(Object.keys(levels) as ConditionKey[])
  return (
    <Section
      title="Subset"
      subtitle={counts ? `${counts.kept} of ${counts.of} samples` : undefined}
      info={
        above
          ? "Keeps the samples whose conditions (and replicate) take the ticked values, less any left out by name; the Clean data step below reads only those, so its clean-up sees just them. A condition left at All isn't filtered. Replicates keep the numbers they were imported with."
          : "Keeps the samples whose conditions (and replicate) take the ticked values, less any left out by name; downstream tiles see only those. A condition left at All isn't filtered. Replicates keep the numbers they were imported with."
      }
    >
      {conds.map((c) => (
        <Field key={c} label={condLabel(c)}>
          <ValueMultiSelect
            values={levels[c] ?? []}
            selected={keep[c] ?? []}
            noun={
              c === 'cmpd'
                ? 'compound'
                : c === 'time'
                  ? 'time point'
                  : isCustomCond(c)
                    ? 'value'
                    : c
            }
            onChange={(next) => {
              const { [c]: _drop, ...rest } = keep
              void _drop
              updateConfig(id, { keep: next.length ? { ...rest, [c]: next } : rest })
            }}
          />
        </Field>
      ))}
      {/* Whole replicate sets: unticking r3 drops replicate 3 of every condition. */}
      {reps.length > 1 && (
        <Field label="replicate">
          <ValueMultiSelect
            values={reps}
            selected={config.reps ?? []}
            noun="replicate"
            onChange={(next) => updateConfig(id, { reps: next.length ? next : undefined })}
          />
        </Field>
      )}
      {/* One-off exclusions (a bad replicate of one condition): untick a sample to leave it out —
          kept as the samples left out (`drop`), so samples new upstream are kept. */}
      {sampleNames.length > 1 && (
        <Field label="samples">
          <ValueMultiSelect
            values={sampleNames}
            selected={
              config.drop?.length ? sampleNames.filter((n) => !config.drop!.includes(n)) : []
            }
            noun="sample"
            onChange={(next) => {
              const drop = next.length ? sampleNames.filter((n) => !next.includes(n)) : []
              updateConfig(id, { drop: drop.length ? drop : undefined })
            }}
          />
        </Field>
      )}
    </Section>
  )
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

/** A Compare's significance calls: the method (the p-value route — FDR control, correction,
 *  linear or hyperbolic boundary — or SAM / CurveCurator), its cutoffs, and the effect class
 *  names. Shown on the Compare step, and again on a volcano fed by it — the same settings,
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
  // In a plot's settings window, edits that need a re-run are held (with any made after them)
  // until its Apply, which then re-runs the Compare — rather than discarding its result under the
  // open window. Shown here merged over the stored threshold.
  const staging = useContext(ApplyStageContext)
  const [staged, setStaged] = useState<Partial<CompareConfig['threshold']> | null>(null)
  const t = staged ? { ...config.threshold, ...staged } : config.threshold
  // Whether what's held needs a re-run (the statistics change) or just a re-call of the genes.
  const stagedRerun =
    !!staged &&
    ('fdrMethod' in staged ||
      'samS0' in staged ||
      'permutations' in staged ||
      ('type' in staged && (staged.type === 'sam_fdr') !== (config.threshold.type === 'sam_fdr')))
  // The significance statistic the FDR switch selects — names both the switch and the cutoff row.
  // Shown as the plain P/Q value; the stored threshold (and every plot) stays −log10.
  const statLabel = t.statType === 'pQ' ? 'Q-value' : 'P-value'
  // Cutoff edits re-classify the stored result live (like dragging a volcano guide) — only the
  // correction method changes the q-values themselves, which needs a re-run.
  const setThreshold = useGraph((s) => s.setCompareThreshold)
  // SAM's settings (and switching to or from it) change the statistics themselves — a re-run.
  const changesStats = (partial: Partial<CompareConfig['threshold']>): boolean =>
    'fdrMethod' in partial ||
    'samS0' in partial ||
    'permutations' in partial ||
    ('type' in partial && (partial.type === 'sam_fdr') !== (t.type === 'sam_fdr'))
  const setT = (partial: Partial<CompareConfig['threshold']>): void => {
    // In a plot's settings window every statistic edit waits for Apply — re-calling the genes
    // (and redrawing every plot) on each keystroke is what made the window stutter. Apply then
    // re-calls them in place, or saves and re-runs the Compare when the statistics themselves
    // changed (SAM's settings, the FDR method).
    if (staging) {
      const next = { ...staged, ...partial }
      setStaged(next)
      staging.stage(`compare-threshold:${id}`, () => {
        const g = useGraph.getState()
        const node = g.nodes.find((n) => n.id === id)
        if (!node || !isStep(node)) return
        const cur = (node.data.config as CompareConfig).threshold
        const rerun =
          'fdrMethod' in next ||
          'samS0' in next ||
          'permutations' in next ||
          ('type' in next && (next.type === 'sam_fdr') !== (cur.type === 'sam_fdr'))
        if (rerun) {
          g.updateConfig(id, { threshold: { ...cur, ...next } })
          void g.rerunFrom(id)
        } else g.setCompareThreshold(id, next)
      })
      return
    }
    if (changesStats(partial)) update(id, { threshold: { ...t, ...partial } })
    else setThreshold(id, partial)
  }
  const r2 = (v: number): number => Math.round(v * 100) / 100
  const asym = t.asymmetric ?? false
  const mirrorTitle = asym ? undefined : 'Mirrors the up cutoff — switch on asymmetric to edit'
  // First line of the effect-size block (same level as the cutoff rows): the asymmetric switch.
  const asymRow = (
    // As tall as a cutoff line (a number box), so it lines up with the field's top-aligned label.
    <div style={{ ...styles.cutoffRow, minHeight: 25 }}>
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
  // Each class's colour, just after its name: every plot this Compare feeds colours the class with
  // it unless the plot sets its own. Display-only too.
  // Automatic: sampled from the fold-change (objects) role's palette.
  const colors = effectColorsOf(config, useRolePalette('fcObject'))
  const setColors = useGraph((s) => s.setCompareEffectColors)
  const effectChip = (key: 'up' | 'down' | 'none'): ReactNode => (
    <ColorChip
      color={colors[key]}
      on
      label={`${labels[key]} colour`}
      title={`${labels[key]} colour — inherited by every plot this Compare feeds`}
      onPick={(c) => setColors(id, { [key]: c })}
      onAuto={() => setColors(id, { [key]: undefined })}
      autoLabel="Automatic (from the FC palette)"
    />
  )

  const curveCurator = t.type === 'curvecurator'
  const ccByFdr = curveCurator && t.ccCallBy === 'fdr'
  // Testing response changes with a 4PL along the picked axis: its F's null is a choice.
  const changesNull = (() => {
    if (config.analysis !== 'curve_fit' || !config.surface || config.surfaceIntent !== 'changes')
      return false
    const pair = config.surfacePair ?? ['dose', 'time']
    const resp = config.responseAxis
    if (!resp || !pair.includes(resp)) return false
    const own = curveMethodOf(config) === 'custom' ? config.axisFits : undefined
    const det = config.detection === 'spline' ? 'spline' : '4pl'
    return fitOf(own, pair, pair.indexOf(resp), det).detect === '4pl'
  })()
  const sam = t.type === 'sam_fdr'
  // The run's target–decoy FDR for CurveCurator's calls (follows its cutoffs live).
  const curveFdr = useGraph((s) => {
    const r = s.results[id]
    return r?.kind === 'compare' ? r.cmp.curveFdr : undefined
  })
  // A curve fit run before the decoy FDR existed has no decoys (so no q-values) until re-run.
  const noDecoys = useGraph((s) => {
    const r = s.results[id]
    return r?.kind === 'compare' && r.cmp.rows.some((x) => x.curve || x.rs?.cc) && !r.cmp.decoys
  })
  const method = sam ? 'sam' : curveCurator ? 'curvecurator' : 'pvalue'
  // The methods this analysis offers: SAM needs the t-test's per-sample values, CurveCurator a
  // curve fit's per-curve F; a two-way ANOVA has the p-value route only.
  const methods: Array<{ value: typeof method; label: string; title: string }> = [
    {
      value: 'pvalue',
      label: 'P-value',
      title:
        'The per-gene test’s p-value, optionally FDR-corrected, under a linear or hyperbolic boundary'
    },
    ...(config.analysis === 'compare'
      ? [
          {
            value: 'sam' as const,
            label: 'SAM',
            title: 'SAM: moderated t with a permutation-estimated FDR (as in Perseus)'
          }
        ]
      : []),
    // The relevance score needs a 4PL F-test — a 4PL curve's or a 4PL surface's (its decoys are
    // surfaces) — not the response surface method's (model Spline), which calls by its own q.
    ...(config.analysis === 'curve_fit' && config.detection !== 'spline'
      ? [
          {
            value: 'curvecurator' as const,
            label: 'Relevance score',
            title:
              'CurveCurator’s relevance score — the curve’s F-test shrunk by its fold change; called by its α cutoff or by a target FDR from decoy curves'
          }
        ]
      : [])
  ]
  return (
    <Section title="Statistic" subtitle={subtitle}>
      {staged && (
        <StatusNote kind="info">
          {stagedRerun
            ? 'Changes the statistic — re-runs the Compare on Apply.'
            : 'Applies on Apply.'}
        </StatusNote>
      )}
      {/* The significance method first: the per-gene test's p (with or without an FDR correction,
          under a linear or hyperbolic boundary), or a method with its own statistic, FDR and
          boundary — SAM for a t-test, CurveCurator for a curve fit. */}
      {methods.length > 1 && (
        <Field
          label="method"
          info={
            <>
              <b>P-value</b> — each gene’s own test (
              {config.analysis === 'curve_fit'
                ? 'the curve’s F-test against a flat line'
                : 'the t-test or ANOVA'}
              ), optionally FDR-corrected (q), with a fold-change cutoff: a linear cutoff, or a
              hyperbolic boundary that asks smaller effects for stronger significance.
              {methods.some((m) => m.value === 'sam') && (
                <>
                  <br />
                  <b>SAM</b> — a moderated t (a fudge factor s0 added to every gene’s error, so tiny
                  variances can’t make tiny effects significant), with the FDR estimated by
                  shuffling the sample labels (as in Perseus).
                </>
              )}
              {methods.some((m) => m.value === 'curvecurator') && (
                <>
                  <br />
                  <b>Relevance score</b> — CurveCurator’s (Bayer et al., 2023): the curve’s F-test
                  and its fold change (lowest → highest dose) combined into one score, SAM style — a
                  fudge factor s0, set from the fold-change limit and α, so the smaller a curve’s
                  fold change the stronger its F-test must be (a hyperbolic boundary on the
                  volcano). Called by its α cutoff, with the FDR then estimated from decoys —
                  simulated flat curves (or surfaces) plus noise, fitted and scored the same way —
                  or by a target FDR, the cutoff set where the decoys say that FDR is reached.
                </>
              )}
            </>
          }
        >
          <ToggleSwitch
            label="Significance method"
            value={method}
            options={methods}
            onChange={(m) =>
              setT(
                m === 'sam'
                  ? { type: 'sam_fdr', statType: 'pP' }
                  : m === 'curvecurator'
                    ? // CurveCurator works on raw p (its FDR is estimated separately, not by BH).
                      { type: 'curvecurator', statType: 'pP' }
                    : { type: 'non-linear', statType: 'pQ' }
              )
            }
          />
        </Field>
      )}
      {changesNull && (
        // Testing response changes with 4PL curves: the F's null (a non-linear fit has no exact one).
        <Field
          label="null"
          info={
            <>
              Testing response changes with a 4PL along the axis: one 4PL shared by every level of
              the other against a 4PL at each, by F = (ΔRSS / d1) / (RSS / d2). A non-linear fit has
              no exact null for it, so the F is read against one of:
              <br />
              <b>NPARC df</b> — NPARC’s (Childs et al., 2019): the RSS reduction and the residual
              RSS taken as scaled χ², their scale and degrees of freedom estimated across the genes
              of the run; then the F distribution with those df. Fast.
              <br />
              <b>adjusted F</b> — the null simulated: each design’s genes refitted on their shared
              4PL plus noise at their own residual level, many times, scored the same way; the p
              from the simulated F’s tail (as the 4PL surface’s adjusted F). Slower.
            </>
          }
        >
          <ToggleSwitch
            label="Null"
            value={config.changesStat ?? 'adjusted'}
            options={[
              {
                value: 'adjusted' as const,
                label: 'adjusted F',
                title: 'the null simulated on each design (slower)'
              },
              {
                value: 'nparc' as const,
                label: 'NPARC df',
                title:
                  'df estimated across the genes from the RSS distributions (Childs et al. 2019)'
              }
            ]}
            onChange={(v) =>
              v !== (config.changesStat ?? 'adjusted') && update(id, { changesStat: v })
            }
          />
        </Field>
      )}
      {method === 'curvecurator' && (
        // Call by its α cutoff (the FDR is then measured), or by a target FDR (the cutoff follows).
        <Field label="call by">
          <ToggleSwitch
            label="Call by"
            value={ccByFdr ? 'fdr' : 'alpha'}
            options={[
              {
                value: 'alpha' as const,
                label: 'α',
                title: 'CurveCurator’s cutoff on the relevance score; the FDR is then estimated'
              },
              {
                value: 'fdr' as const,
                label: 'target FDR',
                title: 'Call the curves whose target–decoy q is within a target FDR'
              }
            ]}
            onChange={(v) => setT({ ccCallBy: v })}
          />
        </Field>
      )}
      {method === 'curvecurator' && noDecoys && (
        <StatusNote kind="warn">
          This result has no FDR estimate (it was run before one existed) — re-run the Compare
          {ccByFdr ? ' to call by target FDR' : ''}.
        </StatusNote>
      )}
      {method === 'curvecurator' && curveFdr != null && Number.isFinite(curveFdr) && (
        // CurveCurator's FDR: how many simulated null (decoy) curves these cutoffs would also call.
        <StatusNote kind="info">
          Estimated FDR of these calls: {(curveFdr * 100).toPrecision(2)}% (target–decoy)
        </StatusNote>
      )}
      {ccByFdr && !noDecoys && curveFdr != null && !Number.isFinite(curveFdr) && (
        <StatusNote kind="info">No curve reaches the target FDR.</StatusNote>
      )}
      {method === 'pvalue' && (
        <>
          {/* Which statistic drives the calls: raw p (off), or the adjusted q (on). Where the q is
              fixed by the method — the response surface method's BH × Storey's π₀ over every
              curve, a 4PL surface's BH over every surface — the info says which. */}
          <Field
            label="FDR control"
            info={
              <>
                Off: calls by each gene’s raw p. On: by its q, the p corrected for testing many
                genes.
                {(config.detection === 'spline' || config.surface) && (
                  <>
                    <br />
                    {config.detection === 'spline'
                      ? 'q: Benjamini–Hochberg × π₀ over every curve (Hybrid model).'
                      : 'q: Benjamini–Hochberg over every surface (4PL surface, adjusted F).'}
                  </>
                )}
              </>
            }
          >
            <OnOffSwitch
              on={t.statType === 'pQ'}
              label="FDR control"
              onChange={(on) => setT({ statType: on ? 'pQ' : 'pP' })}
            />
          </Field>
          {t.statType === 'pQ' && config.detection !== 'spline' && !config.surface && (
            <Field label="correction">
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
          <Field label="boundary">
            <Select
              value={t.type}
              onChange={(v) => setT({ type: v as 'linear' | 'non-linear' })}
              options={[
                { value: 'linear', label: 'linear cutoff' },
                { value: 'non-linear', label: 'hyperbolic boundary' }
              ]}
            />
          </Field>
        </>
      )}
      {/* Effect size: asymmetric switch, then one line per class (up first) — the cutoff and
          the name the class shows under. Symmetric (default): the down cutoff mirrors the up one
          (store keeps them in lock-step), so its box is read-only. */}
      {sam ? (
        <>
          <Field label="FDR">
            <div style={styles.cutoffRow}>
              <span style={styles.inlineTag}>q ≤</span>
              <div style={styles.cutoffBox}>
                <PValueInput statMin={t.statMin} onChange={(v) => setT({ statMin: v })} />
              </div>
            </div>
          </Field>
          {/* s0 sets the boundary's fold-change wall: larger keeps small-variance, small-change
              genes out. */}
          <Field label="s0">
            <div style={styles.cutoffBox}>
              <NumberInput
                value={t.samS0 ?? SAM_S0}
                step={0.05}
                onChange={(v) => setT({ samS0: Math.max(0, r2(v)) })}
              />
            </div>
          </Field>
          <Field label="permutations">
            <div style={styles.cutoffBox}>
              <NumberInput
                value={t.permutations ?? SAM_PERMUTATIONS}
                step={50}
                onChange={(v) => setT({ permutations: Math.max(10, Math.round(v)) })}
              />
            </div>
          </Field>
          <Field label="labels" top>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>up</span>
                <EffectLabelInput value={labels.up} onCommit={(v) => setLabels(id, { up: v })} />
                {effectChip('up')}
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>down</span>
                <EffectLabelInput
                  value={labels.down}
                  onCommit={(v) => setLabels(id, { down: v })}
                />
                {effectChip('down')}
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>none</span>
                <EffectLabelInput
                  value={labels.none}
                  onCommit={(v) => setLabels(id, { none: v })}
                  title="Name shown for the genes called neither up nor down"
                />
                {effectChip('none')}
              </div>
            </div>
          </Field>
        </>
      ) : t.type !== 'non-linear' ? (
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
                {effectChip('up')}
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
                {effectChip('down')}
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>otherwise</span>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput
                  value={labels.none}
                  onCommit={(v) => setLabels(id, { none: v })}
                  title="Name shown for the genes called neither up nor down"
                />
                {effectChip('none')}
              </div>
            </div>
          </Field>
          {/* Named after the statistic the FDR switch selects, so the cutoff reads as one unit. */}
          <Field label="significance">
            <div style={styles.cutoffRow}>
              <span style={styles.inlineTag}>
                {ccByFdr ? 'FDR q ≤' : curveCurator ? 'α =' : `${statLabel} ≤`}
              </span>
              <div style={styles.cutoffBox}>
                {ccByFdr ? (
                  <PValueInput
                    statMin={t.ccQMin ?? CC_Q_MIN}
                    onChange={(v) => setT({ ccQMin: v })}
                  />
                ) : (
                  <PValueInput statMin={t.statMin} onChange={(v) => setT({ statMin: v })} />
                )}
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
                {effectChip('up')}
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
                {effectChip('down')}
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>otherwise</span>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput
                  value={labels.none}
                  onCommit={(v) => setLabels(id, { none: v })}
                  title="Name shown for the genes called neither up nor down"
                />
                {effectChip('none')}
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

/** A Compare's panel — and a Curve fit's (`curve`): the same num/den model, with the treatments as
 *  the numerator and the control as the denominator, and no analysis to switch. */
function ComparePanel({
  id,
  config: rawConfig,
  curve = false
}: {
  id: string
  config: CompareConfig
  curve?: boolean
}) {
  const config = normalizeCompareConfig(rawConfig)
  const configured = isCompareConfigured(config)
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
  const shape = useMemo(() => (std ? dataShape(std) : null), [std])

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
      config.compared,
      config.pool,
      config.condition,
      config.condition2,
      config.pairNum,
      config.pairDen,
      config.pair2Num,
      config.pair2Den,
      config.curveAxis
    ]
  )
  // Switch the analysis from here as well as from the dialog. The comparison carries over when it
  // fits the new analysis — one compared condition for a t-test, two for a 2-way ANOVA (its
  // factors); otherwise the dialog opens on the new analysis to finish setting it up.
  const update = useGraph((s) => s.updateConfig)
  // A fresh (unconfigured) Compare starts on the first analysis its data can take, rather than a
  // t-test the data can't support. A fresh Curve fit starts on the widest fit its data can take —
  // the dose × time surface, else the first axis it can fit over — until the user picks one (a
  // pick sets `surface`, so it's never overridden); after that it only moves off an axis its data
  // can't fit over. A configured one keeps its pick and shows why it can't run.
  useEffect(() => {
    if (configured || !shape) return
    if (curve) {
      const pair =
        config.surface === undefined
          ? surfacePairs(shape.numeric).find((p) => !curveSurfaceWhy(shape, p))
          : undefined
      if (pair) {
        const patch: Record<string, unknown> = { surface: true, surfacePair: pair }
        const t = thresholdForDetection(config.detection ?? '4pl', config.threshold, true)
        if (t) patch.threshold = t
        update(id, patch)
        return
      }
      if (config.surface) return
      const fits = (a: ConditionKey): boolean =>
        (shape.levels[a] ?? 0) >= 2 && (shape.treated[a] ?? 0) >= CURVE_MIN_TREATED
      if (fits(config.curveAxis ?? 'dose')) return
      const ax = shape.numeric.find(fits)
      if (ax) update(id, { curveAxis: ax })
      return
    }
    if (!analysisUnmet(shape, config.analysis)) return
    const next = (['compare', 'anova'] as const).find((a) => !analysisUnmet(shape, a))
    if (!next) return
    const patch: Record<string, unknown> = { analysis: next }
    const t = thresholdForAnalysis(config.analysis, next, config.threshold)
    if (t) patch.threshold = t
    update(id, patch)
  }, [
    configured,
    curve,
    shape,
    config.analysis,
    config.curveAxis,
    config.surface,
    config.threshold,
    config.detection,
    id,
    update
  ])
  const switchAnalysis = (a: CompareConfig['analysis']): void => {
    if (a === config.analysis) return
    const axis = std
      ? classifyConditions(std.rows, config.num, config.den, std.activeConditions, config.compared)
          .axis
      : []
    const patch: Record<string, unknown> = { analysis: a }
    const t = thresholdForAnalysis(config.analysis, a, config.threshold)
    if (t) patch.threshold = t
    // the ANOVA's factors are the compared conditions (inferred on a config saved without them)
    if (a === 'anova' && !config.compared?.length && axis.length) patch.compared = axis
    update(id, patch)
    if (!configured && std) setDialogOpen(true)
  }
  // The analysis is the user's only where the comparison leaves a choice: several test values, or several
  // compared conditions (one at two values is a t-test either way).
  const comparedNow = config.compared?.length
    ? config.compared
    : std
      ? classifyConditions(std.rows, config.num, config.den, std.activeConditions).axis
      : []
  const noChoice = configured && !analysisChoice(comparedNow, config.num)
  // What the data can't take: the picked analysis (a Curve fit's own), and — on a Compare — whether
  // neither of its analyses fits (e.g. no replicates), which a Curve fit may still take.
  const unmet = shape ? analysisUnmet(shape, curve ? 'curve_fit' : config.analysis) : null
  const noCompare =
    !curve && !!shape && !!analysisUnmet(shape, 'compare') && !!analysisUnmet(shape, 'anova')
  const curveFits = !!shape && !analysisUnmet(shape, 'curve_fit')
  // A reason ("Needs …") inside a sentence.
  const inline = (why: string | null): string => (why ? why[0].toLowerCase() + why.slice(1) : '')
  const unit = curve ? 'curve set' : 'comparison'
  // A Curve fit's detection model picks its method: 4PL = the CurveCurator method, Spline = the
  // response surface method (which can also fit one dose × time surface per gene × compound).
  const detection = config.detection ?? '4pl'
  // A dose × time surface, under either model (4PL: the 4PL surface detector, adjusted F).
  const surfaceRun = curve && !!config.surface
  const pair = config.surfacePair ?? ['dose', 'time']
  const pairName = `${condLabel(pair[0])} × ${condLabel(pair[1])}`
  const readyMsg = surfaceRun
    ? `Ready, one ${pairName} surface per gene × compound`
    : nComparisons
      ? `Ready, ${nComparisons.n} ${unit}${nComparisons.n === 1 ? '' : 's'}${nComparisons.on.length ? ` on ${nComparisons.on.join(', ')}` : ''}`
      : 'Ready'
  // The axis a curve runs over, or the dose × time surface. An axis the data can't fit over (too
  // few levels — unknown until Clean data has run) is offered greyed.
  const axisValue = surfaceRun ? surfaceValue(pair) : (config.curveAxis ?? 'dose')

  return (
    <>
      <Section title={curve ? 'Curve fit' : 'Comparison'}>
        {curve ? (
          <>
            {(() => {
              // Only the fit's dimensions and its axis here; everything else in the Configure
              // window. Options the data has too few levels for are offered greyed.
              const opts = curveAxisOptions(shape, detection)
              const twoD = opts.filter((o) => o.value.startsWith('surface:'))
              const oneD = opts.filter((o) => !o.value.startsWith('surface:'))
              const firstOk = (os: typeof opts): string | undefined =>
                (os.find((o) => !o.disabled) ?? os[0])?.value
              const pick = (v: string): void => {
                const p = readAxisValue(v)
                const surface = 'pair' in p
                const patch: Record<string, unknown> =
                  'pair' in p
                    ? { surface: true, surfacePair: p.pair }
                    : { curveAxis: p.axis, surface: false }
                // onto or off a surface under 4PL: q-value calls ⇄ the relevance score
                const t = thresholdForDetection(detection, config.threshold, surface)
                if (t) patch.threshold = t
                update(id, patch)
              }
              const no2d = !twoD.some((o) => !o.disabled)
              return (
                <>
                  <Field
                    label="dimensions"
                    info={
                      <>
                        <b>1D</b> — one curve per gene × compound over one numeric condition, at
                        each level of the others.
                        <br />
                        <b>2D</b> — one surface per gene × compound over two, tested once.
                      </>
                    }
                  >
                    <ToggleSwitch
                      label="Dimensions"
                      value={surfaceRun ? '2d' : '1d'}
                      options={[
                        { value: '1d', label: '1D' },
                        {
                          value: '2d',
                          label: '2D',
                          disabled: no2d,
                          title: no2d ? 'Needs two numeric conditions that vary' : undefined
                        }
                      ]}
                      onChange={(v) => {
                        if ((v === '2d') === surfaceRun) return
                        const keep = v === '2d' ? surfaceValue(pair) : (config.curveAxis ?? 'dose')
                        const own = v === '2d' ? twoD : oneD
                        const ok = own.some((o) => o.value === keep && !o.disabled)
                        const next = ok ? keep : firstOk(own)
                        if (next) pick(next)
                      }}
                    />
                  </Field>
                  <Field
                    label="axis"
                    info={
                      surfaceRun
                        ? 'The two numeric conditions the surface runs over.'
                        : 'The numeric condition each curve runs over.'
                    }
                  >
                    <ToggleSwitch
                      label="Axis"
                      value={axisValue}
                      options={surfaceRun ? twoD : oneD}
                      onChange={pick}
                    />
                  </Field>
                </>
              )
            })()}
            {shape && analysisUnmet(shape, 'curve_fit') && (
              <StatusNote kind="warn">{analysisUnmet(shape, 'curve_fit')}</StatusNote>
            )}
          </>
        ) : (
          <>
            <Field label="analysis">
              <ToggleSwitch
                label="Analysis"
                // No highlight on an analysis the data can't take — nothing is really picked.
                value={
                  unmet ? ('' as CompareConfig['analysis']) : noChoice ? 'compare' : config.analysis
                }
                options={(
                  [
                    ['compare', 't-test', 'Each test group against its control'],
                    [
                      'anova',
                      'ANOVA',
                      'Whether the compared conditions change a gene at all, and which: an ANOVA'
                    ]
                  ] as const
                ).map(([value, label, what]) => {
                  // An analysis the data's shape can't support is offered greyed, with why (unknown
                  // until the upstream Clean data has run — then every one is offered); so is
                  // the ANOVA on a comparison that leaves no choice.
                  const why =
                    (shape ? analysisUnmet(shape, value) : null) ??
                    (value === 'anova' && noChoice
                      ? 'One condition at two values: the t-test answers both'
                      : null)
                  return { value, label, disabled: !!why, title: why ?? what }
                })}
                onChange={switchAnalysis}
              />
            </Field>
            {/* The analysis already picked, but the data can't support it (e.g. no replicates) —
                and when neither analysis can, where this data can go instead. */}
            {noCompare ? (
              <StatusNote kind="warn">
                {`This data can’t take a t-test or an ANOVA — it ${inline(shape && analysisUnmet(shape, 'compare'))}.`}
                {curveFits && ' For a dose or time series, use a Curve fit tile.'}
              </StatusNote>
            ) : (
              unmet && <StatusNote kind="warn">{unmet}</StatusNote>
            )}
          </>
        )}
        {/* The comparison itself (what's compared, matched, and over what) — for the analysis above. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <ConfigureButton
            label="Configure…"
            disabled={!std || !!unmet}
            title={
              !std
                ? 'Run the upstream Clean data first'
                : unmet
                  ? `The data can’t take this analysis — it ${inline(unmet)}`
                  : undefined
            }
            onClick={() => setDialogOpen(true)}
          />
        </div>
        {dialogOpen && std && !curve && (
          // Compare (t-test / 2-way ANOVA): the condition-row window.
          <CompareDialog
            id={id}
            // one row per sample, cached per result: all the window reads of the rows
            rows={stdSampleRows(std)}
            active={std.activeConditions}
            numericConditions={std.numericConditions ?? []}
            shape={shape ?? undefined}
            initial={{
              num: config.num,
              den: config.den,
              match: config.match,
              compared: config.compared,
              pool: config.pool,
              analysis: config.analysis,
              asFactor: config.asFactor,
              axisScale: config.axisScale
            }}
            onClose={() => setDialogOpen(false)}
          />
        )}
        {dialogOpen && std && curve && (
          <CurveDialog
            id={id}
            // one row per sample, cached per result: all the window reads of the rows
            rows={stdSampleRows(std)}
            active={std.activeConditions}
            numericConditions={std.numericConditions ?? []}
            shape={shape ?? undefined}
            initial={{
              num: config.num,
              den: config.den,
              match: config.match,
              curveAxis: config.curveAxis,
              controlBackground: config.controlBackground,
              surface: config.surface,
              surfaceDescription: config.surfaceDescription,
              surfaceIntent: config.surfaceIntent,
              responseAxis: config.responseAxis,
              describeAll: config.describeAll,
              interpolation: config.interpolation,
              axisScale: config.axisScale,
              axisBaseline: config.axisBaseline,
              detection: config.detection,
              curveMethod: config.curveMethod
            }}
            detection={detection}
            onClose={() => setDialogOpen(false)}
          />
        )}
        {configured ? (
          <StatusNote kind="ok" style={styles.doneNote}>
            {readyMsg}
          </StatusNote>
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
            <StatusNote kind="ok" style={styles.doneNote}>
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
            <StatusNote kind="ok" style={styles.doneNote}>
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
        <ContrastDialog
          // Keyed on the wiring: the window reads its inputs and source mode at mount, and docked in
          // the form workflow it stays open while the inputs are rewired beside it.
          key={inputIds.join(',')}
          id={id}
          rows={selRows}
          active={present}
          numeric={numericOfResult(inputs.find((i) => i.id === from)?.result)}
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
 *  diverge) or, off, a linear cutoff per axis (robust z → BH q, plus an optional |value| floor).
 *  Shown on the Contrast step, and again on a scatter fed by it — the same settings, written to
 *  the Contrast (`subtitle` then says whose they are). */
function ContrastStatPanel({
  id,
  config: stored,
  subtitle
}: {
  id: string
  config: ContrastConfig
  subtitle?: ReactNode
}) {
  const update = useGraph((s) => s.updateConfig)
  // In a plot's settings window (a scatter fed by this Contrast) every edit is held until its
  // Apply, which then saves them and re-runs the Contrast and what follows it — as a Compare's
  // statistic is there; Close drops them. Shown here merged over the stored settings. Outside such
  // a window, an edit lands as it's made.
  const staging = useContext(ApplyStageContext)
  type Held = { relationship?: ContrastConfig['relationship']; stat?: Partial<ContrastStat> }
  const [held, setHeld] = useState<Held | null>(null)
  const config: ContrastConfig = held
    ? {
        ...stored,
        ...(held.relationship ? { relationship: held.relationship } : null),
        stat: { ...stored.stat, ...held.stat } as ContrastStat
      }
    : stored
  const write = (patch: Held): void => {
    if (!staging) {
      update(id, {
        ...(patch.relationship ? { relationship: patch.relationship } : null),
        ...(patch.stat ? { stat: { ...stored.stat, ...patch.stat } } : null)
      })
      return
    }
    const next: Held = {
      ...held,
      ...(patch.relationship ? { relationship: patch.relationship } : null),
      stat: { ...held?.stat, ...patch.stat }
    }
    setHeld(next)
    staging.stage(`contrast-stat:${id}`, () => {
      const g = useGraph.getState()
      const node = g.nodes.find((n) => n.id === id)
      if (!node || !isStep(node)) return
      const cur = node.data.config as ContrastConfig
      g.updateConfig(id, {
        ...(next.relationship ? { relationship: next.relationship } : null),
        stat: { ...cur.stat, ...next.stat }
      })
      void g.rerunFrom(id)
    })
  }
  const correlated = config.relationship !== 'independent'
  const setStat = (patch: Partial<ContrastStat>): void => write({ stat: patch })
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
    <Section title="Statistic" subtitle={subtitle}>
      {/* How the two sides relate: correlated (one response, scattered about a fitted line — the
          genes outside its prediction band diverge) or independent (each axis judged on its own). */}
      <Field label="relationship">
        <ToggleSwitch
          label="relationship"
          value={correlated ? 'correlated' : 'independent'}
          onChange={(v) => write({ relationship: v })}
          options={[
            { value: 'correlated', label: 'correlated' },
            { value: 'independent', label: 'independent' }
          ]}
        />
      </Field>
      {/* Correlated: what the band is centred on — a line fitted through the two sides, or y = x
          itself. Independent has one model (a selector anyway, so it reads as a choice). */}
      <Field label="model">
        <Select
          value={correlated ? (config.stat?.model ?? 'linear') : 'cutoff'}
          onChange={(v) =>
            correlated && write({ stat: { model: v as NonNullable<ContrastStat['model']> } })
          }
          options={
            correlated
              ? [
                  { value: 'linear', label: 'linear correlation (fitted line)' },
                  { value: 'identity', label: 'identity (y = x)' }
                ]
              : [{ value: 'cutoff', label: 'linear cutoff' }]
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
function useEffectNames(edgeNodeId: string): EffectLabels {
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
function useEffectColors(edgeNodeId: string, plotPalette?: PaletteRef): EffectColors {
  const up = useUpstreamNode(edgeNodeId)
  const globalFc = useRolePalette('fcObject')
  const cfg =
    up && isStep(up) && isComparisonKind(up.data.kind)
      ? (up.data.config as CompareConfig)
      : undefined
  return plotEffectColors(undefined, cfg, globalFc, plotPalette)
}

/** The y-axis stat and guide lines come from the upstream Compare's threshold, so its Statistic
 *  settings are offered here too — written to that Compare, and shared with every plot it feeds.
 *  Per tile there's the label cap and the look (per-group markers, highlight, legend). */
function VolcanoPanel({ config, update, edgeNodeId }: PlotPanelProps<VolcanoConfig>) {
  const names = useEffectNames(edgeNodeId)
  const colors = useEffectColors(edgeNodeId, config.fcPalette)
  const up = useUpstreamNode(edgeNodeId)
  const compare = up && isStep(up) && isComparisonKind(up.data.kind) ? up : undefined
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
      <PointStyleSections
        kind="volcano"
        names={names}
        colors={colors}
        style={config.style}
        update={update}
      />
    </>
  )
}

function ScatterPanel({ config, update, edgeNodeId }: PlotPanelProps<ScatterConfig>) {
  const names = useEffectNames(edgeNodeId)
  const colors = useEffectColors(edgeNodeId, config.fcPalette)
  // An independent (marginal) contrast colours by quadrant, so the look is per quadrant group.
  const up = useUpstreamNode(edgeNodeId)
  const contrast = up && isStep(up) && up.data.kind === 'contrast' ? up : undefined
  const compare = up && isStep(up) && isComparisonKind(up.data.kind) ? up : undefined
  const quad = !!contrast && (contrast.data.config as ContrastConfig).relationship === 'independent'
  return (
    <>
      {/* The statistic behind the colours, written to the step that computes it (as the volcano
          offers its Compare's) — so the calls can be tuned from the plot that shows them. */}
      {contrast && (
        <ContrastStatPanel
          id={contrast.id}
          config={contrast.data.config as ContrastConfig}
          subtitle={`from ${stepTitle(contrast)}`}
        />
      )}
      {compare && (
        <CompareStatisticSection
          id={compare.id}
          config={normalizeCompareConfig(compare.data.config as CompareConfig)}
          subtitle={`from ${stepTitle(compare)}`}
        />
      )}
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
        colors={colors}
        style={config.style}
        update={update}
      />
    </>
  )
}

function MAPanel({ config, update, edgeNodeId }: PlotPanelProps<MAConfig>): ReactNode {
  const names = useEffectNames(edgeNodeId)
  const colors = useEffectColors(edgeNodeId, config.fcPalette)
  return (
    <>
      <Section title="MA">
        {/* The fold-change lines are driven by (and drag) the upstream Compare's threshold — shared
            with volcano — so there are no per-tile FC cutoffs to set here. */}
        <div style={styles.hint}>Fold-change lines follow the upstream Compare threshold.</div>
      </Section>
      <PointStyleSections
        kind="ma"
        names={names}
        colors={colors}
        style={config.style}
        update={update}
      />
    </>
  )
}

/** The Curve metrics plot: which of the fit's parameters it draws (also the tile's switch). */
function MetricsPanel({ config, update }: PlotPanelProps<MetricsConfig>): ReactNode {
  return (
    <Section title="Curve metrics">
      <Field
        label="metric"
        aside={<QuickToggle config={config} field="metric" update={update} />}
        info={
          <>
            The fitted parameter drawn for the gene on show: the potency (EC50 on a linear axis,
            pEC50 on a log one), the slope or a plateau. A 2-D fit’s per slice, one bar per level.
          </>
        }
      >
        <Select
          value={
            config.metric && (METRIC_IDS as readonly string[]).includes(config.metric)
              ? config.metric
              : 'potency'
          }
          onChange={(v) => update({ metric: v as MetricId })}
          options={METRIC_IDS.map((m) => ({ value: m, label: METRIC_NAMES[m] }))}
        />
      </Field>
      <Field
        label="show"
        aside={<QuickToggle config={config} field="show" update={update} />}
        info={
          <>
            A 2-D fit’s per-slice values <b>as they are</b>, or as their <b>change</b> (Δ) from the
            reference slice — the compared axis’s control level as the Curve fit sets it (dose 0:
            the vehicle’s curve), e.g. a melt’s Tm shift per dose. A curve has no reference: its
            values as they are.
          </>
        }
      >
        <ToggleSwitch
          label="Show"
          value={config.show ?? 'value'}
          options={[
            { value: 'value', label: 'value' },
            { value: 'delta', label: 'change' }
          ]}
          onChange={(v) => update({ show: v })}
        />
      </Field>
    </Section>
  )
}

function PotencyPanel({ config, update, edgeNodeId }: PlotPanelProps<PotencyConfig>): ReactNode {
  const names = useEffectNames(edgeNodeId)
  const colors = useEffectColors(edgeNodeId, config.fcPalette)
  return (
    <>
      <Section title="Potency">
        <Field label="curves" aside={<QuickToggle config={config} field="show" update={update} />}>
          <Select
            value={config.show ?? 'all'}
            onChange={(v) => update({ show: v as PotencyConfig['show'] })}
            options={[
              { value: 'called', label: 'significant only' },
              { value: 'all', label: 'all' }
            ]}
          />
        </Field>
      </Section>
      <CapSection
        title="Cap labels"
        hint="Label only the curves with the largest fold change."
        label="Max labels"
        field="labelTop"
        value={config.labelTop}
        enabled={config.capEnabled}
        update={update}
        rule={(n) => `Label the top ${n} curves by |fold change|.`}
      />
      <PointStyleSections
        kind="potency"
        names={names}
        colors={colors}
        style={config.style}
        update={update}
      />
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
  colors,
  style,
  update,
  selection = true
}: {
  kind: PointPlotKind
  names: { up: string; down: string; none?: string }
  /** the upstream's effect colours — what a group's automatic colour follows */
  colors?: EffectColors
  style: PointStyle | undefined
  update: (patch: Record<string, unknown>) => void
  /** the points are genes, so the gene selection applies: the label switch and the selected /
   *  not-selected looks (off for a plot of samples) */
  selection?: boolean
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const ink = PALETTES[mode].text
  const defaults = defaultGroups(kind, names, colors)
  const groups = defaults.map((d) => resolveGroup(style, d))
  /** A group's colour as its chip shows it: what the user picked (or cleared), else Automatic. */
  // Where a group's automatic colour comes from: an effect group follows the upstream tile.
  const autoSource = (key: string): string =>
    key === 'up' || key === 'down' || key === 'none' ? "the upstream tile's" : "the plot's default"
  const chipColor = (key: string): string => {
    const c = style?.groups?.[key]?.color
    return c && c !== AUTO ? c : AUTO
  }
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
    tight = false,
    /** the snap step — whole pixels, or 0.5 for a line width (outlines run thin) */
    step = 1
  ): ReactNode => (
    <SizeBox
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
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
                  color={chipColor(g.key)}
                  on={g.color !== CLEAR}
                  label={`${g.name} colour`}
                  title={
                    chipColor(g.key) === AUTO
                      ? `${g.name} colour: automatic (${autoSource(g.key)})`
                      : `${g.name} colour`
                  }
                  clearLabel="No fill (a hollow marker)"
                  onPick={(c) => setGroup(g.key, { color: c })}
                  onClear={() => setGroup(g.key, { color: CLEAR })}
                  onAuto={() => setGroup(g.key, { color: undefined })}
                  autoLabel={`Automatic (${autoSource(g.key)})`}
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

              {/* Marker outline — a thin 0.5px by default (DEFAULT_OUTLINE). */}
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
                    true,
                    0.5
                  )}
                </div>
              ))}

              {selection && (
                <>
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
                </>
              )}

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
          {selection && <div style={{ ...styles.sideTag, marginTop: 12 }}>Selected</div>}
          {selection && (
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
                      true,
                      0.5
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
          )}

          {/* How each group fades while something ELSE is selected. */}
          {selection && <div style={{ ...styles.sideTag, marginTop: 12 }}>Not selected</div>}
          {selection && (
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
          )}
        </div>
        {/* The threshold / reference guide lines — the plot's dashed cutoffs. */}
        <Field label="threshold line">
          <div style={{ width: 64 }}>
            <SizeBox
              value={style?.guideWidth ?? GUIDE_WIDTH}
              onChange={(v) => setStyle({ guideWidth: v })}
              min={0.5}
              max={4}
              step={0.5}
              title="Threshold line width (px)"
            />
          </div>
        </Field>
      </Section>
    </>
  )
}

/** The DR panel: a Compare-fed DR's view (global, with its top-genes colour cap underneath, or
 *  focused), and — one gene at a time (a Contrast, or a
 *  focused Compare) — the value axis's scale. In the global view every gene is drawn as
 *  background; the cap decides how many of the strongest responders are coloured. */
/** An ANOVA's variance plot: its view, and how many genes the detailed view shows. */
function VariancePanel({ config, update }: PlotPanelProps<VarianceConfig>) {
  const view = config.view ?? 'overview'
  return (
    <Section title="Variance">
      <Field label="view" aside={<QuickToggle config={config} field="view" update={update} />}>
        <Select
          value={view}
          onChange={(v) => update({ view: v as VarianceConfig['view'] })}
          options={[
            { value: 'overview', label: 'global (every gene, per factor)' },
            { value: 'detail', label: 'detailed (genes side by side)' },
            { value: 'focus', label: 'focused (one gene)' }
          ]}
        />
      </Field>
      {view === 'detail' && (
        <Field label="top genes">
          <div style={{ width: 90 }}>
            <NumberInput
              value={config.topGenes || 20}
              step={5}
              min={1}
              max={60}
              onChange={(v) => update({ topGenes: Math.max(1, Math.min(60, Math.round(v))) })}
            />
          </div>
        </Field>
      )}
      <div style={styles.hint}>
        {view === 'overview'
          ? 'Each factor’s share of every gene’s variation, as a violin per factor — which factor drives this dataset.'
          : view === 'detail'
            ? 'The selected genes’ shares, else the most significant genes’ (smallest q of any factor), up to 60.'
            : 'One gene’s shares, each factor’s q beside it — a share says how the change splits, the q whether it’s above noise.'}
      </div>
    </Section>
  )
}

/** An ANOVA's interaction plot: the factors along x and as lines, and its look (the DR plot's). */
function InteractionPanel({ config, update, edgeNodeId }: PlotPanelProps<InteractionConfig>) {
  // the model's factors, from the upstream's result (unknown until it has run)
  const factors = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    const r = upId ? s.results[upId] : undefined
    return r?.kind === 'compare' ? r.cmp.anova?.factors : undefined
  })
  const axes = factors ? interactionAxes({ factors }, config.xFactor, config.lineFactor) : null
  return (
    <>
      <Section title="Interaction">
        {factors && factors.length >= 2 && (
          <Field
            label="x axis"
            aside={<QuickToggle config={config} field="xFactor" update={update} />}
          >
            <Select
              value={factors[axes!.x].condition}
              onChange={(v) => update({ xFactor: v })}
              options={factors.map((f) => ({ value: f.condition, label: condLabel(f.condition) }))}
            />
          </Field>
        )}
        {factors && factors.length >= 3 && axes?.line != null && (
          <Field label="lines">
            <Select
              value={factors[axes.line].condition}
              onChange={(v) => update({ lineFactor: v })}
              options={factors
                .filter((_, i) => i !== axes.x)
                .map((f) => ({ value: f.condition, label: condLabel(f.condition) }))}
            />
          </Field>
        )}
        <div style={styles.hint}>
          One gene at a time: each cell’s mean (the model’s fit) across the x factor, a line per
          level of the other, its replicates as points and the mean’s standard error. Parallel
          lines: no interaction; lines that diverge or cross: an interaction. With three or more
          factors, the others are averaged (the model’s marginal means). A slope along x is drawn to
          its scale: the model’s straight lines.
        </div>
      </Section>
      <DRStyleSection
        config={config}
        update={update}
        focused
        detailed={false}
        fromContrast={false}
        curveFit={false}
        texts={{
          autoLine: 'one per level of the line factor',
          points: 'Each cell’s replicates',
          error: 'Each cell mean’s standard error (the model’s residual variance)'
        }}
      />
    </>
  )
}

function DRPanel({ config, update, edgeNodeId }: PlotPanelProps<DRConfig>) {
  // Its axis (a numeric condition) is the plot's own — one Response plot per condition — so it's
  // never offered here.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  // From a Contrast the tile shows one gene at a time, so its value axis can be per gene.
  const fromContrast = useGraph((s) => {
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    return !!up && isStep(up) && up.data.kind === 'contrast'
  })
  // From a Compare or a Curve fit: every gene at once, or one gene at a time (with its points /
  // fitted curve).
  const fromCompare = useGraph((s) => {
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    return !!up && isStep(up) && isComparisonKind(up.data.kind)
  })
  // A curve fit's error is its fit's confidence band, not a fold change's SE.
  const curveFit = useGraph((s) => {
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    return !!up && isStep(up) && up.data.kind === 'curveFit'
  })
  const focused = fromContrast || config.view === 'focus'
  // The detailed view: the global view's coloured genes, each drawn as the focused view draws one.
  const detailed = fromCompare && config.view === 'detail'
  return (
    <>
      {(fromContrast || fromCompare) && (
        <Section title="Response">
          {fromCompare && (
            <Field
              label="view"
              aside={<QuickToggle config={config} field="view" update={update} />}
            >
              <Select
                value={config.view ?? 'overview'}
                onChange={(v) => update({ view: v as DRConfig['view'] })}
                options={[
                  { value: 'overview', label: 'global (every gene)' },
                  { value: 'detail', label: 'detailed (the coloured genes, in full)' },
                  { value: 'focus', label: 'focused (one gene)' }
                ]}
              />
            </Field>
          )}
          {/* Top genes is a setting OF the global view (it only decides which of the every-gene
              curves are coloured — or, detailed, which are drawn), so it sits under view and goes
              away when focused. */}
          {fromCompare && config.view !== 'focus' && (
            <div style={styles.subGroup}>
              <Field label="top genes">
                <OnOffSwitch
                  on={capOn(config.capEnabled, config.topGenes)}
                  label="Top genes"
                  onChange={(next) =>
                    // First switch-on with no N yet → a sensible starting point.
                    update({
                      capEnabled: next,
                      ...(next && !(config.topGenes > 0) ? { topGenes: 10 } : null)
                    })
                  }
                />
              </Field>
              {capOn(config.capEnabled, config.topGenes) && (
                <Field label="n">
                  <div style={{ width: 90 }}>
                    <NumberInput
                      value={config.topGenes}
                      step={10}
                      min={1}
                      onChange={(v) => update({ topGenes: Math.max(1, Math.round(v)) })}
                    />
                  </div>
                </Field>
              )}
              <div style={styles.hint}>
                {detailed ? (
                  <>
                    {capOn(config.capEnabled, config.topGenes)
                      ? `Draw the top ${config.topGenes} genes by response`
                      : 'Draw the top genes by response'}
                    {` (up to ${DR_DETAIL_CAP})`}; picked from the selected genes while any are
                    selected.
                  </>
                ) : (
                  <>
                    {capOn(config.capEnabled, config.topGenes)
                      ? `Colour the top ${config.topGenes} genes by response`
                      : 'Colour every significant gene'}
                    ; every gene stays drawn in the background. Selected genes are coloured instead
                    while any are selected.
                  </>
                )}
              </div>
            </div>
          )}
          {(fromContrast || (fromCompare && (focused || detailed))) && (
            <Field
              label="axis scale"
              aside={<QuickToggle config={config} field="yScale" update={update} />}
            >
              <Select
                value={drYScale(config, fromContrast)}
                onChange={(v) => update({ yScale: v as DRConfig['yScale'] })}
                options={[
                  { value: 'gene', label: 'adjusted (each gene’s own range)' },
                  {
                    value: 'global',
                    label: fromContrast ? 'global (whole contrast)' : 'global (all genes)'
                  }
                ]}
              />
            </Field>
          )}
        </Section>
      )}
      <DRStyleSection
        config={config}
        update={update}
        focused={focused}
        detailed={detailed}
        fromContrast={fromContrast}
        curveFit={curveFit}
      />
    </>
  )
}

/** The DR settings that make up its look, persisted with the tile (see DRConfig / drLook). */
const DR_LOOK_FIELDS = [
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

/** A DR's line / points / error look, one row each: an on/off where the element can be hidden,
 *  then — while shown — its colour, size and opacity (%), as the gene bar's replicate row does.
 *  Points and error are drawn only in the gene-by-gene views (focused, detailed, or from a
 *  Contrast), so they're offered only there. An automatic colour is the gene's effect group
 *  (focused, one comparison), one per comparison (focused, several), per gene (global, detailed),
 *  or per side (from a Contrast). */
function DRStyleSection({
  config,
  update,
  focused,
  detailed,
  fromContrast,
  curveFit,
  texts
}: {
  config: Partial<DRConfig>
  update: (patch: Record<string, unknown>) => void
  focused: boolean
  /** the detailed view: points and error as focused, colours per gene as global */
  detailed: boolean
  fromContrast: boolean
  curveFit: boolean
  /** another plot with the DR's look (the interaction plot): what its automatic line colour is,
   *  and what its points and error are */
  texts?: { autoLine: string; points: string; error: string }
}): ReactNode {
  const look = drLook(config, curveFit)
  const autoLine =
    texts?.autoLine ??
    (fromContrast
      ? 'one per side'
      : focused
        ? 'by effect group; one per comparison when several'
        : 'one per gene')
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }
  const custom = DR_LOOK_FIELDS.some((f) => config[f] !== undefined)
  const color = (field: string, value: string, what: string, auto: string): ReactNode => (
    <ColorChip
      color={value}
      on
      label={`${what} colour`}
      title={value === AUTO ? `${what} colour: automatic (${auto})` : `${what} colour`}
      onPick={(c) => update({ [field]: c })}
      onAuto={() => update({ [field]: AUTO })}
      autoLabel={`Automatic (${auto})`}
    />
  )
  const px = (field: string, value: number, title: string, min: number, max: number): ReactNode => (
    <div style={{ width: 52, flex: '0 0 auto' }}>
      <NumberInput
        value={value}
        step={field === 'lineWidth' ? 0.5 : 1}
        min={min}
        max={max}
        title={title}
        onChange={(v) => update({ [field]: Math.min(max, Math.max(min, Math.round(v * 2) / 2)) })}
      />
    </div>
  )
  const pct = (field: string, value: number, title: string): ReactNode => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: 64, flex: '0 0 auto' }}>
      <NumberInput
        value={Math.round(value * 100)}
        step={10}
        min={5}
        max={100}
        title={title}
        onChange={(v) => update({ [field]: Math.min(100, Math.max(5, Math.round(v))) / 100 })}
      />
      <span style={{ color: UI.textMuted, fontSize: 12 }}>%</span>
    </div>
  )
  return (
    <Section
      title="Style"
      subtitle={
        custom ? (
          <button
            style={styles.resetBtn}
            onClick={() => update(Object.fromEntries(DR_LOOK_FIELDS.map((f) => [f, undefined])))}
            title="Restore the default line, point and error look"
          >
            Reset
          </button>
        ) : null
      }
    >
      <Field label="line">
        <div style={row}>
          {color('lineColor', look.lineColor, 'Line', autoLine)}
          {px('lineWidth', look.lineWidth, 'Line width (px)', 0.5, 8)}
          {pct('lineOpacity', look.lineOpacity, 'Line opacity (%)')}
        </div>
      </Field>
      {(focused || detailed) && (
        <>
          <Field label="points">
            <div style={row}>
              <OnOffSwitch
                on={look.points}
                label="Points"
                title={
                  texts?.points ??
                  (fromContrast
                    ? "Each side's replicates behind its line"
                    : curveFit
                      ? 'The measured points the curve was fitted to'
                      : 'The replicates behind each fold change')
                }
                onChange={(v) => update({ points: v })}
              />
              {look.points && (
                <>
                  {color('pointColor', look.pointColor, 'Point', 'the line colour')}
                  {px('pointSize', look.pointSize, 'Point size (px)', 2, 16)}
                  {pct('pointOpacity', look.pointOpacity, 'Point opacity (%)')}
                </>
              )}
            </div>
          </Field>
          <Field label="error">
            <div style={row}>
              <OnOffSwitch
                on={look.errors}
                label="Error"
                title={
                  texts?.error ??
                  (fromContrast
                    ? "Each side's standard error (its fold change's, or its abundance's)"
                    : curveFit
                      ? 'The fit’s 95% confidence band: where the true curve plausibly lies'
                      : "The fold change's standard error")
                }
                onChange={(v) => update({ errors: v })}
              />
              {look.errors && (
                <>
                  <div style={{ width: 92, flex: '0 0 auto' }}>
                    <Select
                      value={look.errorStyle}
                      onChange={(v) => update({ errorStyle: v as DRConfig['errorStyle'] })}
                      options={[
                        { value: 'whisker', label: 'whisker' },
                        { value: 'band', label: 'band' }
                      ]}
                    />
                  </div>
                  {color('errorColor', look.errorColor, 'Error', 'the line colour')}
                  {pct('errorOpacity', look.errorOpacity, 'Error opacity (%)')}
                </>
              )}
            </div>
          </Field>
          {curveFit && (
            <Field label="pEC50 line">
              <OnOffSwitch
                on={look.ec50Line}
                label="pEC50 line"
                title="A dotted line at each curve's EC50 (the 4PL's midpoint), within the tested range"
                onChange={(v) => update({ ec50Line: v })}
              />
            </Field>
          )}
        </>
      )}
      {!focused && !detailed && (
        <div style={styles.hint}>
          Styles the coloured curves; points and error show in the detailed and focused views.
        </div>
      )}
    </Section>
  )
}

/** The Response plot's settings that make up its look (see ResponseConfig / responseLook). */
const RESPONSE_LOOK_FIELDS = [
  'lineWidth',
  'lineColor',
  'lineOpacity',
  'linePalette',
  'linePaletteReverse',
  'fcPalette',
  'colorScale',
  'points',
  'pointSize',
  'pointSize3d',
  'pointColor',
  'pointOpacity',
  'surfaceOpacity',
  'curves',
  'curveWidth',
  'curveColor',
  'curveOpacity',
  'errors',
  'errorStyle',
  'errorColor',
  'errorOpacity'
] as const

/** Response plot: 2-D or 3-D, what to show (a heatmap is 2-D only, a surface 3-D only), and the
 *  look of what the view draws — its lines, points, surface and value colour scale. `measured`:
 *  the Time & Dose-response plot, the same views of a Compare's measured log₂FC (no model). */
function ResponsePanel({
  config,
  update,
  edgeNodeId,
  measured = false
}: PlotPanelProps<TdrConfig> & { measured?: boolean }): ReactNode {
  const globalFc = useRolePalette('fc')
  const dim = responseDim(config)
  const show = responseShow(config)
  // The view by time or by dose slices: every line view, and a slices description's surface too
  // (its dose and time curves are separate fits); never the heatmap — see responseSliceable.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { result } = useUpstreamFacts(upId)
  const rows = !measured && result?.kind === 'compare' ? result.cmp.rows : undefined
  const joint = !!rows?.some((r) => r.rs?.surface?.method === 'joint')
  const sliceable = responseSliceable(dim, show, rows)
  const slice = responseSlice(config, rows)
  // A measured plot is over its own pair (the first in the dose slot, the second in the time slot);
  // a fitted surface over dose × time.
  const [px0, py0]: [ConditionKey, ConditionKey] = measured ? tdrPair(config) : ['dose', 'time']
  // What the lines are per — their Automatic palette is that levels' role (time's for time, dose's
  // for dose and any other numeric condition, as the heatmap's level tracks).
  const linesPer = slice === 'dose' ? px0 : py0
  const lineRole = useRolePalette(linesPer === 'time' ? 'time' : 'dose')
  const look = responseLook(config)
  const lines = show === 'line'
  const valueScale = show !== 'line'
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }
  const custom = RESPONSE_LOOK_FIELDS.some((f) => config[f] !== undefined)
  const color = (field: string, value: string, what: string, auto: string): ReactNode => (
    <ColorChip
      color={value}
      on
      label={`${what} colour`}
      title={value === AUTO ? `${what} colour: automatic (${auto})` : `${what} colour`}
      onPick={(c) => update({ [field]: c })}
      onAuto={() => update({ [field]: AUTO })}
      autoLabel={`Automatic (${auto})`}
    />
  )
  const px = (field: string, value: number, title: string, min: number, max: number): ReactNode => (
    <div style={{ width: 52, flex: '0 0 auto' }}>
      <NumberInput
        value={value}
        step={field === 'lineWidth' || field === 'curveWidth' ? 0.5 : 1}
        min={min}
        max={max}
        title={title}
        onChange={(v) => update({ [field]: Math.min(max, Math.max(min, Math.round(v * 2) / 2)) })}
      />
    </div>
  )
  const pct = (field: string, value: number, title: string): ReactNode => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: 64, flex: '0 0 auto' }}>
      <NumberInput
        value={Math.round(value * 100)}
        step={10}
        min={5}
        max={100}
        title={title}
        onChange={(v) => update({ [field]: Math.min(100, Math.max(5, Math.round(v))) / 100 })}
      />
      <span style={{ color: UI.textMuted, fontSize: 12 }}>%</span>
    </div>
  )
  return (
    <>
      <Section title={responseLabel([px0, py0])}>
        <Field label="view" aside={<QuickToggle config={config} field="dim" update={update} />}>
          <ToggleSwitch
            label="View"
            value={dim}
            options={[
              { value: '2d', label: '2D' },
              { value: '3d', label: '3D' }
            ]}
            onChange={(v) => update({ dim: v })}
          />
        </Field>
        <Field label="show" aside={<QuickToggle config={config} field="show" update={update} />}>
          {/* A dropdown, not a switch: three options don't fit the field. The one the view can't
              draw is greyed, its label saying which view it needs. */}
          <Select
            value={show}
            options={(['line', 'surface', 'heatmap'] as const).map((v) => {
              const off = !!responseShowWhy(dim, v)
              return {
                value: v,
                label: off ? `${v} (${v === 'surface' ? '3D' : '2D'} only)` : v,
                disabled: off
              }
            })}
            onChange={(v) => update({ show: v as ResponseConfig['show'] })}
          />
        </Field>
        {sliceable && (
          <Field
            label="curve"
            aside={<QuickToggle config={config} field="slice" update={update} />}
          >
            {/* named by the curves drawn: dose curves (a slice at each time) or time curves */}
            <ToggleSwitch
              label="Curve"
              value={CURVE_OF_SLICE[slice]}
              options={[
                { value: 'dose', label: condLabel(px0) },
                { value: 'time', label: condLabel(py0) }
              ]}
              onChange={(v) => update({ slice: SLICE_OF_CURVE[v] })}
            />
          </Field>
        )}
        {/* Perspective draws the far side smaller; orthographic keeps parallels parallel, so a
            level lines up with its tick across the box. */}
        {dim === '3d' && (
          <Field
            label="projection"
            aside={
              <QuickToggle
                config={config}
                field="projection"
                update={update}
                kind={measured ? 'tdr' : 'response'}
              />
            }
          >
            <Select
              value={config.projection ?? 'orthographic'}
              options={[
                { value: 'orthographic', label: 'orthographic' },
                { value: 'perspective', label: 'perspective' }
              ]}
              onChange={(v) => update({ projection: v as ResponseConfig['projection'] })}
            />
          </Field>
        )}
        {/* The value axis per gene, or across every gene in the facet. */}
        <Field
          label="axis scale"
          aside={<QuickToggle config={config} field="yScale" update={update} />}
        >
          <Select
            value={config.yScale ?? 'gene'}
            onChange={(v) => update({ yScale: v as TdrConfig['yScale'] })}
            options={[
              { value: 'gene', label: 'adjusted (each gene’s own range)' },
              { value: 'global', label: 'global (all genes in the facet)' }
            ]}
          />
        </Field>
        <div style={styles.hint}>
          {measured
            ? show === 'line'
              ? dim === '3d'
                ? slice === 'dose'
                  ? 'Each dose’s time curve through its measured log₂FC, drawn at its dose in dose × time × effect.'
                  : 'Each time point’s dose curve through its measured log₂FC, drawn at its time in dose × time × effect.'
                : 'Each time point’s dose curve through its measured log₂FC, coloured early → late.'
              : show === 'surface'
                ? 'The measured log₂FC, joined by straight lines across dose and time.'
                : 'The measured log₂FC over dose × time.'
            : show === 'line'
              ? dim === '3d'
                ? joint
                  ? slice === 'dose'
                    ? 'Slices of the joint model at each dose: its time curves.'
                    : 'Slices of the joint model at each time: its dose curves.'
                  : slice === 'dose'
                    ? 'Each dose’s 4PL time curve, drawn at its dose in dose × time × effect.'
                    : 'Each time’s 4PL dose curve, drawn at its time in dose × time × effect.'
                : 'Each time point’s dose curve, coloured early → late.'
              : show === 'surface'
                ? joint
                  ? 'The joint model over dose × time, with the measured means.'
                  : slice === 'dose'
                    ? 'Each dose’s 4PL time curve, joined across doses, with the measured means.'
                    : 'Each time’s 4PL dose curve, joined across times, with the measured means.'
                : 'The measured effect over dose × time.'}
        </div>
      </Section>
      <Section
        title="Style"
        subtitle={
          custom ? (
            <button
              style={styles.resetBtn}
              onClick={() =>
                update(Object.fromEntries(RESPONSE_LOOK_FIELDS.map((f) => [f, undefined])))
              }
              title="Restore the default look"
            >
              Reset
            </button>
          ) : null
        }
      >
        {lines && (
          <Field label="line">
            <div style={row}>
              {color(
                'lineColor',
                look.lineColor,
                'Line',
                `one per ${condLabel(linesPer)}, along the line palette`
              )}
              {px('lineWidth', look.lineWidth, 'Line width (px)', 0.5, 8)}
              {pct('lineOpacity', look.lineOpacity, 'Line opacity (%)')}
            </div>
          </Field>
        )}
        {/* The palette the automatic line colours run along, low → high (early → late). */}
        {lines && look.lineColor === AUTO && (
          <Field label="line palette">
            <PanelPaletteSelect
              value={look.linePalette}
              onChange={(v) => update({ linePalette: v, linePaletteReverse: undefined })}
              auto={{
                palette: lineRole,
                label: `${paletteLabel(lineRole)} (${condLabel(linesPer)})`
              }}
            />
          </Field>
        )}
        {show !== 'heatmap' && (
          <Field label="points">
            <div style={row}>
              <OnOffSwitch
                on={look.points}
                label="Points"
                title={
                  measured ? 'The replicates behind each fold change' : 'The measured level means'
                }
                onChange={(v) => update({ points: v })}
              />
              {look.points && (
                <>
                  {color(
                    'pointColor',
                    look.pointColor,
                    'Point',
                    show === 'surface' ? 'by log₂, on the FC palette' : 'the line colour'
                  )}
                  {/* its own size in each view: the 3-D scene's points read smaller */}
                  {px(
                    dim === '3d' ? 'pointSize3d' : 'pointSize',
                    (dim === '3d' ? look.pointSize3d : look.pointSize) ?? (dim === '3d' ? 3 : 7),
                    `Point size in ${dim === '3d' ? '3D' : '2D'} (px)`,
                    1,
                    16
                  )}
                  {pct('pointOpacity', look.pointOpacity, 'Point opacity (%)')}
                </>
              )}
            </div>
          </Field>
        )}
        {/* The measured values' error, as the Dose/time-response plot's focused view draws it. */}
        {measured && lines && (
          <Field label="error">
            <div style={row}>
              <OnOffSwitch
                on={look.errors}
                label="Error"
                title="The fold change's standard error"
                onChange={(v) => update({ errors: v })}
              />
              {look.errors && (
                <>
                  <div style={{ width: 92, flex: '0 0 auto' }}>
                    <Select
                      value={look.errorStyle}
                      onChange={(v) => update({ errorStyle: v as TdrConfig['errorStyle'] })}
                      options={[
                        { value: 'whisker', label: 'whisker' },
                        { value: 'band', label: 'band' }
                      ]}
                    />
                  </div>
                  {color('errorColor', look.errorColor, 'Error', 'the line colour')}
                  {pct('errorOpacity', look.errorOpacity, 'Error opacity (%)')}
                </>
              )}
            </div>
          </Field>
        )}
        {show === 'surface' && (
          <Field label="surface">
            <div style={row}>
              {pct('surfaceOpacity', look.surfaceOpacity, 'Surface opacity (%)')}
            </div>
          </Field>
        )}
        {show === 'surface' && (
          <Field label="curves">
            <div style={row}>
              <OnOffSwitch
                on={look.curves}
                label="Curves"
                title="The surface's curves traced on it: a dose curve at each time, a time curve at each dose"
                onChange={(v) => update({ curves: v })}
              />
              {look.curves && (
                <>
                  {color('curveColor', look.curveColor, 'Curve', 'the text colour')}
                  {px('curveWidth', look.curveWidth, 'Curve width (px)', 0.5, 8)}
                  {pct('curveOpacity', look.curveOpacity, 'Curve opacity (%)')}
                </>
              )}
            </div>
          </Field>
        )}
        {valueScale && (
          <Field label="FC palette">
            <PanelPaletteSelect
              value={look.valuePalette}
              onChange={(v) => update({ fcPalette: v, colorScale: undefined })}
              auto={autoOf(globalFc)}
            />
          </Field>
        )}
      </Section>
    </>
  )
}

/** A fold-change plot's colours: its palette (Automatic = the global one, Settings → Customisation) —
 *  the continuous scale, and what the up / down / none colours are sampled from — and, where the
 *  plot draws those groups without point styles to carry them (enrichment's bars), the groups'
 *  own colours: Automatic by default (from the palette), or the plot's own. */
function ColourSection({
  config,
  update,
  edgeNodeId,
  groups = false,
  hint,
  role = 'fcObject'
}: PlotPanelProps<{ effectColors?: PlotEffectColors; fcPalette?: PaletteRef }> & {
  /** offer the up / down / none colours too */
  groups?: boolean
  /** the palette role Automatic follows (default: fold change on objects) */
  role?: PaletteRole
  /** a line under the palette, when it needs saying what it colours */
  hint?: string
}): ReactNode {
  const names = useEffectNames(edgeNodeId)
  const rolePalette = useRolePalette(role)
  const inherited = useEffectColors(edgeNodeId, config.fcPalette)
  const own = config.effectColors
  const chip = (k: 'up' | 'down' | 'none'): ReactNode => {
    const c = own?.[k]
    const set = c && c !== AUTO ? c : AUTO
    return (
      <ColorChip
        color={set}
        on
        label={`${names[k]} colour`}
        title={
          set === AUTO
            ? `${names[k]} colour: automatic (${inherited[k]}, from the palette)`
            : `${names[k]} colour`
        }
        onPick={(v) => update({ effectColors: { ...own, [k]: v } })}
        onAuto={() => update({ effectColors: { ...own, [k]: undefined } })}
        autoLabel="Automatic (from the palette)"
      />
    )
  }
  return (
    <Section title="Colour">
      <Field label="FC palette">
        <PanelPaletteSelect
          value={toPaletteRef(config.fcPalette)}
          onChange={(v) => update({ fcPalette: v })}
          auto={autoOf(rolePalette)}
        />
      </Field>
      {hint && <div style={styles.hint}>{hint}</div>}
      {groups && (
        <Field label="groups">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={styles.inlineTag}>{names.up}</span>
            {chip('up')}
            <span style={{ ...styles.inlineTag, marginLeft: 6 }}>{names.down}</span>
            {chip('down')}
            <span style={{ ...styles.inlineTag, marginLeft: 6 }}>{names.none}</span>
            {chip('none')}
          </div>
        </Field>
      )}
    </Section>
  )
}

/** A heatmap's palette follows what it draws: from a Compare, log₂FC on the fold-change palette
 *  (Automatic = the global one); from Clean data, abundance on its value palette (Automatic =
 *  viridis). */
function HeatmapColourSection(props: PlotPanelProps<HeatmapConfig>): ReactNode {
  // Decided as the plot decides (PanelBody: the upstream RESULT is a comparison's — a Compare's or
  // a Curve fit's), so the panel's Automatic always names what's drawn; the upstream node's kind
  // covers a tile not yet run.
  const upId = useGraph((s) => s.edges.find((e) => e.target === props.edgeNodeId)?.source)
  const { kind: upKind, result } = useUpstreamFacts(upId)
  const fromCompare = result ? result.kind === 'compare' : isComparisonKind(upKind)
  const dataRole = useRolePalette('data')
  if (fromCompare) return <ColourSection {...props} role="fc" />
  return (
    <Section title="Colour">
      <Field label="palette">
        <PanelPaletteSelect
          value={toPaletteRef(props.config.valuePalette)}
          onChange={(v) => props.update({ valuePalette: v })}
          auto={autoOf(dataRole)}
        />
      </Field>
    </Section>
  )
}

/** A plot's categorical palette (QC, cluster, bar): Automatic = the global one (Settings → Customisation),
 *  or its own. */
function CategoricalSection({
  config,
  update
}: PlotPanelProps<{ categorical?: CategoricalId }>): ReactNode {
  return (
    <Section title="Colour">
      <Field label="palette">
        <CategoricalSelect config={config} update={update} />
      </Field>
    </Section>
  )
}

/** The categorical palette picker itself (the plot's `categorical`, or another `field`):
 *  Automatic = the global one. */
function CategoricalSelect({
  config,
  update,
  field = 'categorical'
}: Pick<PlotPanelProps<Record<string, unknown>>, 'config' | 'update'> & {
  field?: string
}): ReactNode {
  const global = useAppSettings((s) => s.categorical)
  const own = toCategoricalId(config[field])
  return (
    <Select
      value={own ?? AUTO}
      onChange={(v) => update({ [field]: v === AUTO ? undefined : v })}
      options={[
        {
          value: AUTO,
          label: `auto · ${global}`,
          render: <CategoricalLabel id={global} name={`auto · ${global}`} />
        },
        ...categoricalIds().map((id) => ({
          value: id,
          label: id,
          render: <CategoricalLabel id={id} />
        }))
      ]}
    />
  )
}

/** One side of a fold-change heatmap's clustering (its genes, or its conditions): a caption, and
 *  under it, indented, the most clusters, the modules (a coloured bar per cluster), the tree, and
 *  the bars' palette. `fields` names the config keys the side's settings live in. */
function ClusterSideFields({
  caption,
  noun,
  fields,
  config,
  update
}: Pick<PlotPanelProps<HeatmapConfig>, 'config' | 'update'> & {
  caption: string
  noun: string
  fields: {
    max: keyof HeatmapConfig
    modules: keyof HeatmapConfig
    tree: keyof HeatmapConfig
    palette: keyof HeatmapConfig
  }
}): ReactNode {
  const cfg = config as unknown as Record<string, unknown>
  const max = cfg[fields.max]
  return (
    <>
      <div style={{ ...styles.sideTag, marginTop: 12 }}>{caption}</div>
      <div style={styles.subGroup}>
        <Field
          label="max"
          info={`Cut the tree into this many clusters (one per row when there are fewer ${noun}), each a module.`}
        >
          <NumberInput
            value={typeof max === 'number' ? max : DENDRO_CLADES_DEFAULT}
            step={1}
            min={2}
            onChange={(v) => update({ [fields.max]: Math.max(2, Math.round(v)) })}
          />
        </Field>
        <Field
          label="module"
          aside={
            <QuickToggle config={config} field={fields.modules} update={update} kind="heatmap" />
          }
        >
          <OnOffSwitch
            on={!!cfg[fields.modules]}
            label={`${caption} modules`}
            title={`A coloured bar over each cluster's ${noun}${noun === 'genes' ? ' — click one to select its genes' : ''}`}
            onChange={(v) => update({ [fields.modules]: v })}
          />
        </Field>
        <Field
          label="tree"
          aside={<QuickToggle config={config} field={fields.tree} update={update} kind="heatmap" />}
        >
          <OnOffSwitch
            on={!!cfg[fields.tree]}
            label={`${caption} tree`}
            title={`The clustering tree of the ${noun}`}
            onChange={(v) => update({ [fields.tree]: v })}
          />
        </Field>
        <Field label="palette">
          <CategoricalSelect config={cfg} update={update} field={fields.palette} />
        </Field>
      </div>
    </>
  )
}

/** A palette's name as an Automatic option shows it (reversed noted). */
const paletteLabel = (palette: PaletteRef): string =>
  palette.reverse ? `${palette.id} (reversed)` : palette.id
/** The Automatic option of a palette picker: following `palette`, named for it. */
const autoOf = (palette: PaletteRef): { palette: PaletteRef; label: string } => ({
  palette,
  label: paletteLabel(palette)
})

/** PaletteSelect on a config panel: its menu at the canvas zoom, closing when the canvas moves
 *  (as Select) — unless `unscaled` (a fixed window such as Settings). */
export function PanelPaletteSelect({
  unscaled,
  ...props
}: Omit<Parameters<typeof PaletteSelect>[0], 'zoom' | 'closeKey'> & {
  unscaled?: boolean
}): ReactNode {
  const tf = useStore((s) => `${s.transform[0]},${s.transform[1]},${s.transform[2]}`)
  const flat = useContext(ScreenScale) || unscaled
  return (
    <PaletteSelect
      {...props}
      zoom={flat ? 1 : Number(tf.split(',')[2]) || 1}
      closeKey={unscaled ? undefined : tf}
    />
  )
}

/** The bubbles' look: what their size, colour and outline width show — |log₂FC| or −log₁₀ of the
 *  Compare's P/Q — the colour's palette (Automatic: the global FC one, or Purples), the
 *  outline's colour (Automatic: a darker shade of each bubble's own), and a ∗ on the significant. */
function BubbleLookSection({
  config,
  update,
  statName
}: Pick<PlotPanelProps<BubbleConfig>, 'config' | 'update'> & {
  /** the Compare's significance column, named (P-value / Q-value) */
  statName: string
}): ReactNode {
  const sig = `−log₁₀ ${statName === 'P-value' ? 'P' : 'Q'}`
  const measures = (abs: boolean) => [
    { value: 'fc' as const, label: abs ? '|log₂FC|' : 'log₂FC' },
    { value: 'sig' as const, label: sig }
  ]
  const colorBy = config.colorBy ?? 'fc'
  const fcRole = useRolePalette('fcObject')
  const outlineBy = config.outlineBy ?? 'none'
  const outline = config.outlineColor && config.outlineColor !== AUTO ? config.outlineColor : AUTO
  return (
    <Section title="Look">
      <Field label="size">
        <ToggleSwitch
          label="Size"
          value={config.sizeBy ?? 'fc'}
          options={measures(true)}
          onChange={(v) => update({ sizeBy: v })}
        />
      </Field>
      <Field label="colour">
        <ToggleSwitch
          label="Colour"
          value={colorBy}
          options={measures(false)}
          onChange={(v) => update({ colorBy: v })}
        />
      </Field>
      <Field label="palette">
        {colorBy === 'fc' ? (
          <PanelPaletteSelect
            value={toPaletteRef(config.fcPalette)}
            onChange={(v) => update({ fcPalette: v })}
            auto={autoOf(fcRole)}
          />
        ) : (
          <PanelPaletteSelect
            value={toPaletteRef(config.sigPalette)}
            onChange={(v) => update({ sigPalette: v })}
            auto={autoOf(BUBBLE_SIG_PALETTE)}
          />
        )}
      </Field>
      <Field label="outline">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ToggleSwitch
            label="Outline"
            value={outlineBy}
            options={[{ value: 'none' as const, label: 'none' }, ...measures(true)]}
            onChange={(v) => update({ outlineBy: v })}
          />
          {outlineBy !== 'none' && (
            <ColorChip
              color={outline}
              on
              label="Outline colour"
              title={
                outline === AUTO
                  ? 'Outline colour: automatic (a darker shade of each bubble)'
                  : 'Outline colour'
              }
              onPick={(v) => update({ outlineColor: v })}
              onAuto={() => update({ outlineColor: undefined })}
              autoLabel="Automatic (darker bubble colour)"
            />
          )}
        </div>
      </Field>
      <Field
        label="asterisk"
        info="A ∗ at the centre of each bubble significant at its dose or time."
      >
        <OnOffSwitch
          on={!!config.asterisk}
          label="Asterisk"
          onChange={(v) => update({ asterisk: v })}
        />
      </Field>
    </Section>
  )
}

function BubblePanel({ config, update, edgeNodeId }: PlotPanelProps<BubbleConfig>) {
  // Only offer the numeric conditions the upstream data actually carries; with one axis there's
  // nothing to choose, so the selector is hidden and the config snaps to it.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { axes: avail, result } = useUpstreamFacts(upId)
  const axes = avail.map((c) => ({ value: c, label: condLabel(c) }))
  // the significance column the upstream Compare calls by — the rank's other option
  const statName =
    result?.kind === 'compare' && result.cmp.threshold?.statType === 'pP' ? 'P-value' : 'Q-value'
  const byFc = (config.rank ?? 'fc') === 'fc'
  const over = config.over ?? 'peak'
  useEffect(() => {
    if (axes.length > 0 && !axes.some((o) => o.value === config.axis))
      update({ axis: axes[0].value as BubbleConfig['axis'] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail.join('|'), config.axis])
  return (
    <>
      <Section title="Bubble">
        {axes.length > 1 && (
          <Field label="axis" aside={<QuickToggle config={config} field="axis" update={update} />}>
            <Select
              value={config.axis}
              onChange={(v) => update({ axis: v as BubbleConfig['axis'] })}
              options={axes}
            />
          </Field>
        )}
        <Field
          label="rank"
          info="What picks and orders the top genes: their log₂FC, or their significance (the Compare's own P or Q value, in the fold change's direction)."
          aside={<QuickToggle config={config} field="rank" update={update} />}
        >
          <ToggleSwitch
            label="Rank"
            value={config.rank ?? 'fc'}
            options={[
              { value: 'fc', label: 'log₂FC' },
              { value: 'sig', label: statName }
            ]}
            onChange={(v) => update({ rank: v })}
          />
        </Field>
        <Field
          label="over levels"
          info="How a gene's rank score is taken over its doses or times: its peak (the level scoring furthest from 0, its direction kept), or its total (summed, so up and down levels cancel to the net direction)."
          aside={<QuickToggle config={config} field="over" update={update} />}
        >
          <ToggleSwitch
            label="Over levels"
            value={over}
            options={[
              { value: 'peak', label: 'peak' },
              { value: 'total', label: 'total' }
            ]}
            onChange={(v) => update({ over: v })}
          />
        </Field>
      </Section>
      <BubbleLookSection config={config} update={update} statName={statName} />
      <CapSection
        title="Cap genes"
        hint="Show only the strongest genes."
        field="topGenes"
        value={config.topGenes}
        enabled={config.capEnabled}
        update={update}
        defaultValue={20}
        rule={(n) =>
          byFc
            ? `Keep the top ${n} genes by largest ${over} |log₂FC|.`
            : `Keep the top ${n} genes by ${over === 'peak' ? 'smallest' : 'largest total −log₁₀'} ${statName}.`
        }
      />
    </>
  )
}

/** QC plots: the check, how it's drawn, the axis scale (the metrics check: its two metrics), and
 *  the look. By sample is offered only where it can differ from by dose (curvesReplicated of the
 *  upstream curve fit). */
function CurveMadPanel({ config, update, edgeNodeId }: PlotPanelProps<CurveMadConfig>) {
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { result } = useUpstreamFacts(upId)
  const replicated = result?.kind === 'compare' ? curvesReplicated(result.cmp.rows) : true
  const check = config.check === 'sample' && !replicated ? 'dose' : (config.check ?? 'dose')
  const metrics = check === 'metrics'
  return (
    <>
      <Section title="QC">
        <Field label="check" aside={<QuickToggle config={config} field="check" update={update} />}>
          <Select
            value={check}
            onChange={(v) => update({ check: v as CurveMadConfig['check'] })}
            options={[
              { value: 'dose', label: 'dose' },
              ...(replicated ? [{ value: 'sample', label: 'sample' }] : []),
              { value: 'fitted', label: 'fitted' },
              { value: 'normality', label: 'normality' },
              { value: 'metrics', label: 'metrics (curve against curve)' }
            ]}
          />
        </Field>
        {metrics && (
          <>
            <Field label="x">
              <Select
                value={config.metricX ?? CURVE_QC_DEFAULT_X}
                onChange={(v) => update({ metricX: v as CurveQcAxis })}
                options={curveQcAxisOptions(config.metricY ?? CURVE_QC_DEFAULT_Y, 'y')}
              />
            </Field>
            <Field label="y">
              <Select
                value={config.metricY ?? CURVE_QC_DEFAULT_Y}
                onChange={(v) => update({ metricY: v as CurveQcAxis })}
                options={curveQcAxisOptions(config.metricX ?? CURVE_QC_DEFAULT_X, 'x')}
              />
            </Field>
          </>
        )}
        {!metrics && (
          <>
            <Field
              label="show"
              aside={<QuickToggle config={config} field="show" update={update} />}
            >
              <Select
                value={config.show ?? 'dot'}
                onChange={(v) => update({ show: v as CurveMadConfig['show'] })}
                options={[
                  { value: 'violin', label: 'violin' },
                  { value: 'dot', label: 'dot' }
                ]}
              />
            </Field>
            <Field
              label="axis scale"
              aside={<QuickToggle config={config} field="yScale" update={update} />}
            >
              <Select
                value={config.yScale ?? 'fit'}
                onChange={(v) => update({ yScale: v as CurveMadConfig['yScale'] })}
                options={[
                  { value: 'fit', label: 'adjusted (99.9% of residuals, about 0)' },
                  { value: 'range', label: 'global (every residual)' }
                ]}
              />
            </Field>
          </>
        )}
      </Section>
      <CapSection
        title="Cap points"
        hint="Dot views draw only this many residuals, so they stay quick. Every outlier is kept; boxes, medians and trend lines use them all."
        label="Max points"
        field="maxPoints"
        value={config.maxPoints ?? RESIDUAL_DOT_CAP}
        enabled={config.capEnabled ?? true}
        update={update}
        defaultValue={RESIDUAL_DOT_CAP}
        max={RESIDUAL_DOT_CAP}
        rule={(n) =>
          `Draw at most ${n.toLocaleString()} residuals (up to ${RESIDUAL_DOT_CAP.toLocaleString()}).`
        }
      />
      <PointStyleSections
        kind="curveMad"
        names={{ up: 'up', down: 'down' }}
        style={config.style}
        update={update}
        selection={false}
      />
    </>
  )
}

function DumbbellPanel({ config, update, edgeNodeId }: PlotPanelProps<DumbbellConfig>) {
  // The side names (the contrast's cmp1/cmp2) label the order choices, as on the tile.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { result } = useUpstreamFacts(upId)
  const rows = result?.kind === 'contrast' ? result.ctr.rows : undefined
  return (
    <>
      <Section title="Dumbbell">
        <Field
          label="order by"
          aside={<QuickToggle config={config} field="order" update={update} />}
        >
          <Select
            value={config.order ?? 'diff'}
            onChange={(v) => update({ order: v as DumbbellConfig['order'] })}
            options={DUMBBELL_ORDERS.map((o) => ({ value: o, label: dumbbellOrderLabel(o, rows) }))}
          />
        </Field>
      </Section>
      <CapSection
        title="Cap genes"
        hint="Show only the most divergent significant genes."
        field="topGenes"
        value={config.topGenes}
        enabled={config.capEnabled}
        update={update}
        rule={(n) => `Keep the top ${n} significant genes by |FC difference|.`}
      />
    </>
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
  onWidth,
  locked,
  disabled
}: {
  label: string
  /** the line can't be switched or restyled, only its width set (a cluster's minimal axes) */
  locked?: boolean
  /** the whole row greyed: the plot doesn't draw this line at all */
  disabled?: boolean
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
        <OnOffSwitch on={on} label={label} onChange={onShow} disabled={locked || disabled} />
        {style && onStyle && (
          <LineStyleChoice value={style} onChange={onStyle} disabled={locked || disabled || !on} />
        )}
        <div style={styles.lineWidth}>
          <SizeBox
            value={width}
            min={0.5}
            max={4}
            step={0.5}
            disabled={disabled || (!locked && !on)}
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
  title,
  disabled
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  step?: number
  placeholder?: string
  title?: string
  disabled?: boolean
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
      disabled={disabled}
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
  defaults,
  minimal = false
}: {
  config: { axes?: PlotAxes }
  update: (patch: Record<string, unknown>) => void
  /** a cluster's minimal axes: only the title size and the axis line's width apply, so every other
   *  field is greyed (its value kept for when the axes go back to standard) */
  minimal?: boolean
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
            disabled={minimal}
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
                disabled={minimal}
                onChange={(v) => set({ min: v })}
              />
            </div>
            <span style={styles.inlineTag}>to</span>
            <div style={styles.cutoffBox}>
              <OptNumberInput
                value={st.max}
                placeholder={round(def.max) ?? 'auto'}
                title="Upper bound (blank = the plot's own)"
                disabled={minimal}
                onChange={(v) => set({ max: v })}
              />
            </div>
          </div>
        </Field>
        <Field label="Ticks">
          <div style={styles.cutoffRow}>
            <Select
              value={st.ticks ?? 'auto'}
              disabled={minimal}
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
                disabled={minimal}
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
              disabled={minimal}
            />
            {(st.tickLabels ?? true) && (
              <SizeBox
                value={st.tickSize ?? 12}
                min={8}
                max={18}
                title="Tick label font size (px)"
                disabled={minimal}
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
          locked={minimal}
          on={minimal || (st.lineWidth != null ? st.lineWidth > 0 : (def.line ?? true))}
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
          disabled={minimal}
          on={st.mirror ?? false}
          onShow={(on) => set({ mirror: on })}
          style={st.frameStyle ?? 'solid'}
          onStyle={(v) => set({ frameStyle: v === 'solid' ? undefined : v })}
          width={st.frameWidth ?? (st.lineWidth || 1)}
          onWidth={(v) => set({ frameWidth: v })}
        />
        <LineRow
          label="Gridlines"
          disabled={minimal}
          on={st.grid ?? def.grid ?? false}
          onShow={(on) => set({ grid: on })}
          style={st.gridStyle ?? 'solid'}
          onStyle={(v) => set({ gridStyle: v === 'solid' ? undefined : v })}
          width={st.gridWidth ?? 1}
          onWidth={(v) => set({ gridWidth: v })}
        />
        <LineRow
          label="Zero line"
          disabled={minimal}
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

function GeneBarPanel({ config, update, edgeNodeId }: PlotPanelProps<BarConfig>): ReactNode {
  // The conditions the upstream data carries, to colour by (see ClusterPanel on selecting the
  // result rather than a fresh array).
  const upstream = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    return upId ? s.results[upId] : undefined
  })
  const active = useMemo(
    () => (upstream?.kind === 'standardize' ? upstream.std.activeConditions : CONDS),
    [upstream]
  )
  // the primary colour condition's levels, for the colouring's default (condColorByDefault)
  const levels = upstream?.kind === 'standardize' ? primaryColorLevels(upstream.std) : 0
  // the data's numeric conditions (its schema): what the fade can take
  const numeric = useMemo(() => numericOfResult(upstream), [upstream])
  const colorConds = barColorConds(config, active, levels, numeric)
  const byCondition =
    colorConds.length > 0 ||
    (config.colorBy ?? (condColorByDefault(levels) ? 'condition' : 'value')) === 'condition'
  const repColor = config.repColor ?? 'auto'
  const errorColor = config.errorColor ?? 'auto'
  return (
    <>
      <Section title="Bar">
        <Field
          label="axis scale"
          aside={<QuickToggle config={config} field="yScale" update={update} />}
        >
          <Select
            value={config.yScale ?? 'gene'}
            onChange={(v) => update({ yScale: v as BarConfig['yScale'] })}
            options={[
              { value: 'gene', label: 'adjusted (each gene’s own range)' },
              { value: 'global', label: 'global (all genes)' }
            ]}
          />
        </Field>
        <SampleOrderField config={config} update={update} label="condition order" />
        {/* Replicates as dots over the bars: on/off, then — while on — colour, size (px),
            opacity (%) and jitter, on one line like the error bar's. */}
        <Field label="replicate">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <OnOffSwitch
              on={!!config.replicates}
              label="Replicates"
              title="Each replicate as a dot over its bar"
              onChange={(v) => update({ replicates: v })}
            />
            {config.replicates && (
              <>
                <ColorChip
                  color={repColor}
                  on
                  label="Replicate colour"
                  title={
                    repColor === AUTO
                      ? 'Replicate colour: automatic (the group colour)'
                      : 'Replicate colour'
                  }
                  onPick={(c) => update({ repColor: c })}
                  onAuto={() => update({ repColor: AUTO })}
                  autoLabel="Automatic (the group colour)"
                />
                <div style={{ width: 48, flex: '0 0 auto' }}>
                  <NumberInput
                    value={config.repSize ?? 6}
                    min={2}
                    max={16}
                    title="Dot size (px)"
                    onChange={(v) => update({ repSize: Math.min(16, Math.max(2, Math.round(v))) })}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    width: 64,
                    flex: '0 0 auto'
                  }}
                >
                  <NumberInput
                    value={Math.round((config.repOpacity ?? 0.6) * 100)}
                    step={10}
                    min={10}
                    max={100}
                    title="Dot opacity (%)"
                    onChange={(v) =>
                      update({ repOpacity: Math.min(100, Math.max(10, Math.round(v))) / 100 })
                    }
                  />
                  <span style={{ color: UI.textMuted, fontSize: 12 }}>%</span>
                </div>
                <span style={{ color: UI.textMuted, fontSize: 11, marginLeft: 2 }}>jitter</span>
                <OnOffSwitch
                  on={config.repJitter ?? true}
                  label="Jittered"
                  title="Jittered: spread the dots sideways across the bar (off: one column over its centre)"
                  onChange={(v) => update({ repJitter: v })}
                />
              </>
            )}
          </div>
        </Field>
        {/* One line: the error bars' colour, line width (px), then what they show. */}
        <Field label="error bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <ColorChip
              color={errorColor}
              on
              label="Error bar colour"
              title={
                errorColor === AUTO
                  ? 'Error bar colour: automatic (the group colour)'
                  : 'Error bar colour'
              }
              onPick={(c) => update({ errorColor: c })}
              onAuto={() => update({ errorColor: AUTO })}
              autoLabel="Automatic (the group colour)"
            />
            <div style={{ width: 56, flex: '0 0 auto' }}>
              <NumberInput
                value={config.errorWidth ?? 1.4}
                step={0.5}
                min={0.5}
                max={6}
                title="Error bar line width (px)"
                onChange={(v) =>
                  update({ errorWidth: Math.min(6, Math.max(0.5, Math.round(v * 10) / 10)) })
                }
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Select
                value={config.error ?? 'sd'}
                onChange={(v) => update({ error: v as BarConfig['error'] })}
                options={[
                  { value: 'sd', label: 'SD' },
                  { value: 'sem', label: 'SEM' },
                  { value: 'ci95', label: '95% CI' }
                ]}
              />
            </div>
          </div>
        </Field>
        <Field label="colour by">
          <Select
            value={byCondition ? 'condition' : 'value'}
            onChange={(v) =>
              update(
                v === 'value'
                  ? { colorBy: 'value' }
                  : {
                      colorBy: 'condition',
                      // Start from what was there, else the first categorical condition.
                      colorConds: colorConds.length
                        ? colorConds
                        : defaultColorConds(active, numeric)
                    }
              )
            }
            options={[
              { value: 'value', label: 'value' },
              { value: 'condition', label: 'condition' }
            ]}
          />
        </Field>
        {byCondition && (
          <ConditionColorFields
            active={active}
            numeric={numeric}
            selected={colorConds}
            onChange={(next) => update({ colorBy: 'condition', colorConds: next })}
          />
        )}
      </Section>
    </>
  )
}

/** Colour by condition's picks (gene bar, QC, cluster), indented under the colour-by: a single
 *  `colour` condition (categorical) and a single `fade` (dose or time: light = low, dark = high).
 *  Stored together as `colorConds`. `colour: false` leaves the colour to the colour-by itself (the
 *  cluster's, which picks the condition directly) and offers the fade alone. */
function ConditionColorFields({
  active,
  numeric,
  selected,
  onChange,
  colour = true
}: {
  /** the conditions the upstream data carries */
  active: ConditionKey[]
  /** of those, the numeric ones (the data's schema): what the fade can take */
  numeric: NumericConds
  selected: ConditionKey[]
  onChange: (next: ConditionKey[]) => void
  colour?: boolean
}): ReactNode {
  const NONE = ''
  const cats = active.filter((c) => !isNumericCond(c, numeric))
  const nums = active.filter((c) => isNumericCond(c, numeric))
  const cat = selected.find((c) => !isNumericCond(c, numeric)) ?? NONE
  const num = selected.find((c) => isNumericCond(c, numeric)) ?? NONE
  const pick = (c: string, n: string): void =>
    onChange([c, n].filter((k) => k !== NONE) as ConditionKey[])
  const opts = (keys: ConditionKey[], none: boolean): Array<{ value: string; label: string }> => [
    ...(none ? [{ value: NONE, label: 'none' }] : []),
    ...keys.map((k) => ({ value: k, label: condLabel(k) }))
  ]
  return (
    <div style={styles.subGroup}>
      {colour && (
        <Field label="colour">
          <Select
            value={cat}
            onChange={(v) => pick(v, num)}
            // none only while a fade carries the colouring (dose / time alone: shades of one hue)
            options={opts(cats, num !== NONE || cat === NONE)}
          />
        </Field>
      )}
      {nums.length > 0 && (
        <Field label="fade">
          <Select
            value={num}
            onChange={(v) => pick(cat, v)}
            // the fade can't go too when it alone carries the colouring
            options={opts(nums, cat !== NONE || !colour)}
          />
        </Field>
      )}
    </div>
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
  const numeric = useMemo(() => numericOfResult(upstream), [upstream])
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
    <>
      {/* By category: what is plotted, how the data are prepared for it (in processing order),
          how it is coloured, and how the data and their territories are drawn. */}
      <Section title="Plot">
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
            Variance explained per component — a steep drop after PC1–2 means the PC plot summarises
            the data well; a flat scree means it doesn’t.
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
              The most influential features in the same PC1/PC2 plane, as vectors from the origin —
              which measurements drive the separation, not just that there is one. Same direction =
              moves together; opposite = trades off; longer = stronger.
            </div>
          </>
        )}
      </Section>
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
        <Field label="features">
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
      <Section title="Colour">
        <Field
          label="color by"
          aside={<QuickToggle config={config} field="colorBy" update={update} kind="pca" />}
        >
          <Select
            value={config.colorBy}
            onChange={(v) => update({ colorBy: v as ClusterColorBy })}
            options={[
              ...active.map((c) => ({ value: c, label: condLabel(c) })),
              { value: CLUSTER_COLOR, label: 'cluster' }
            ]}
          />
        </Field>
        {/* Coloured by a categorical condition (cmpd, cell…): a dose/time fade under it, as QC
            and the gene bar — the colour-by above is the colour. */}
        {config.colorBy !== CLUSTER_COLOR && !isNumericCond(config.colorBy, numeric) && (
          <ConditionColorFields
            colour={false}
            active={active}
            numeric={numeric}
            selected={clusterColorConds(config, numeric)}
            onChange={(next) =>
              next.length > 0 &&
              update({
                colorConds: next,
                // colorBy follows: the colour condition, else the one picked
                colorBy: next.find((k) => !isNumericCond(k, numeric)) ?? next[0]
              })
            }
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
                Cuts the dendrogram at its largest gap, so the count follows the data. Convenient,
                but it can change between datasets.
              </div>
            )}
          </>
        )}
      </Section>
      <Section title="Display">
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
              ? 'The convex hull of each condition’s replicates — only where measurements landed.'
              : 'A ~95% covariance ellipse per condition — smoother and comparable, but extrapolated beyond the replicates.'}
            {(config.replicates ?? 'individual') === 'mean' &&
              ' With replicate means (one point per condition), it spans each colour group’s condition means instead — e.g. a compound over its doses.'}
          </div>
        )}
        <ClusterMarkerField config={config} update={update} centroid={look.data === 'centroid'} />
        {/* the embedding scatter's axes (scree and loadings keep their own) */}
        {(config.plot ?? 'pc') === 'pc' || config.method !== 'pca' ? (
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
        ) : null}
      </Section>
    </>
  )
}

/** A size box (px) and an opacity box (%), as the DR's style rows. */
function styleBoxes(update: (patch: Record<string, unknown>) => void): {
  px: (field: string, value: number, title: string, min: number, max: number) => ReactNode
  pct: (field: string, value: number, title: string) => ReactNode
} {
  return {
    px: (field, value, title, min, max) => (
      <div style={{ width: 52, flex: '0 0 auto' }}>
        <NumberInput
          value={value}
          step={field === 'arrowSize' ? 0.25 : 0.5}
          min={min}
          max={max}
          title={title}
          onChange={(v) => update({ [field]: Math.min(max, Math.max(min, Math.round(v * 4) / 4)) })}
        />
      </div>
    ),
    pct: (field, value, title) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: 64, flex: '0 0 auto' }}>
        <NumberInput
          value={Math.round(value * 100)}
          step={10}
          min={5}
          max={100}
          title={title}
          onChange={(v) => update({ [field]: Math.min(100, Math.max(5, Math.round(v))) / 100 })}
        />
        <span style={{ color: UI.textMuted, fontSize: 12 }}>%</span>
      </div>
    )
  }
}

/** The markers' look — the mark on show (replicate dots or centroids): size, opacity, outline
 *  width and colour ('auto' = the panel's). */
function ClusterMarkerField({
  config,
  update,
  centroid
}: {
  config: ClusterConfig
  update: (patch: Record<string, unknown>) => void
  centroid: boolean
}): ReactNode {
  const st = clusterStyle(config)
  const { px, pct } = styleBoxes(update)
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }
  return (
    <Field label="markers">
      <div style={row}>
        {centroid
          ? px('centroidSize', st.centroidSize, 'Centroid size (px)', 2, 30)
          : px('markerSize', st.markerSize, 'Dot size (px)', 2, 24)}
        {centroid
          ? pct('centroidOpacity', st.centroidOpacity, 'Centroid opacity (%)')
          : pct('markerOpacity', st.markerOpacity, 'Dot opacity (%)')}
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
        />
      </div>
    </Field>
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
          value={config.confidence ?? 'auto'}
          onChange={(v) =>
            update({ confidence: v === 'auto' ? undefined : (v as StringConfig['confidence']) })
          }
          options={[
            { value: 'auto', label: 'auto (highest with a network)' },
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
      <StringOutlineField
        label="query outline"
        width={config.queryOutline}
        color={config.queryOutlineColor}
        auto="black"
        onWidth={(v) => update({ queryOutline: v })}
        onColor={(c) => update({ queryOutlineColor: c })}
      />
      <StringOutlineField
        label="interactor outline"
        width={config.interactorOutline}
        color={config.interactorOutlineColor}
        auto="the background"
        onWidth={(v) => update({ interactorOutline: v })}
        onColor={(c) => update({ interactorOutlineColor: c })}
      />
    </Section>
  )
}

/** One kind of STRING node's outline: width (px) and colour (AUTO = `auto`, its default ink). */
function StringOutlineField({
  label,
  width,
  color,
  auto,
  onWidth,
  onColor
}: {
  label: string
  width: number | undefined
  color: string | undefined
  auto: string
  onWidth: (v: number) => void
  onColor: (c: string) => void
}): ReactNode {
  const ink = color ?? AUTO
  return (
    <Field label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={{ width: 52, flex: '0 0 auto' }}>
          <NumberInput
            value={width ?? STRING_OUTLINE}
            step={0.5}
            min={0}
            max={4}
            title={`${label} width (px)`}
            onChange={(v) => onWidth(Math.min(4, Math.max(0, Math.round(v * 4) / 4)))}
          />
        </div>
        <ColorChip
          color={ink}
          on
          label={`${label} colour`}
          title={ink === AUTO ? `${label} colour: automatic (${auto})` : `${label} colour`}
          onPick={onColor}
          onAuto={() => onColor(AUTO)}
          autoLabel={`Automatic (${auto})`}
        />
      </div>
    </Field>
  )
}

function QcPanel({ config, update, edgeNodeId }: PlotPanelProps<QcConfig>) {
  const plotOpts = qcPlotOptions(config.metric)
  const plot = plotOpts.includes(config.plot) ? config.plot : plotOpts[0]
  // The conditions the upstream Clean data carries, to colour by (as the gene bar does).
  const upstream = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    return upId ? s.results[upId] : undefined
  })
  const active = useMemo(
    () => (upstream?.kind === 'standardize' ? upstream.std.activeConditions : CONDS),
    [upstream]
  )
  // the primary colour condition's levels, for the colouring's default (condColorByDefault)
  const levels = upstream?.kind === 'standardize' ? primaryColorLevels(upstream.std) : 0
  const numeric = useMemo(() => numericOfResult(upstream), [upstream])
  const byCondition = qcColorBy(config, levels) === 'condition'
  const color = config.color ?? QC_FILL
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
      {config.metric === 'proteins' && (
        <Field
          label="axis scale"
          aside={<QuickToggle config={config} field="yScale" update={update} />}
        >
          <Select
            value={config.yScale ?? 'global'}
            onChange={(v) => update({ yScale: v as QcConfig['yScale'] })}
            options={[
              { value: 'range', label: 'adjusted (fit to the counts)' },
              { value: 'global', label: 'global (from 0)' }
            ]}
          />
        </Field>
      )}
      <SampleOrderField config={config} update={update} />
      {/* One chip, as the gene bar's replicate/error colours: Automatic colours by condition (the
          picks below), a picked colour fills every sample with it. */}
      <Field label="colour">
        <ColorChip
          color={byCondition ? AUTO : color}
          on
          label="QC colour"
          title={byCondition ? 'QC colour: automatic (by condition)' : 'QC colour'}
          onPick={(c) => update({ colorBy: 'single', color: c })}
          onAuto={() =>
            update({
              colorBy: 'condition',
              // Start from what was there, else the first categorical condition.
              colorConds: config.colorConds?.length
                ? config.colorConds
                : defaultColorConds(active, numeric)
            })
          }
          autoLabel="Automatic (by condition)"
        />
      </Field>
      {byCondition && (
        <ConditionColorFields
          active={active}
          numeric={numeric}
          selected={qcColorConds(config, active, levels, numeric)}
          onChange={(next) => update({ colorConds: next })}
        />
      )}
    </Section>
  )
}

/** Data table: which view it opens in (the in-table switch still flips it live). */
function TablePanel({ config, update, edgeNodeId }: PlotPanelProps<TableConfig>) {
  // The cells' automatic palette follows what the table shows: Clean data's abundance → viridis
  // (as its heatmap); a Compare's or Contrast's signed values → RdBu reversed.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { kind: upKind, result } = useUpstreamFacts(upId)
  // As the tile decides (by the upstream result), the node's kind for one not yet run.
  const fromClean = result ? result.kind === 'standardize' : !upKind || upKind === 'standardize'
  const dataRole = useRolePalette('data')
  const fcRole = useRolePalette('fc')
  const colored = config.colored ?? true
  return (
    <>
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
        {/* Display only: a longer id or name is cut with "…" and shown whole on hover; search,
          filters, sort and copy use it in full. */}
        {(
          [
            ['uniqID max length', 'idMaxLen', 'Longer uniqIDs'],
            ['gene name max length', 'geneMaxLen', 'Longer gene names']
          ] as const
        ).map(([label, field, what]) => (
          <Field key={field} label={label}>
            <div style={{ width: 90 }}>
              <NumberInput
                value={config[field] ?? TABLE_GENE_MAX}
                step={5}
                min={4}
                max={500}
                title={`${what} are cut with … (shown in full on hover)`}
                onChange={(v) => update({ [field]: Math.min(500, Math.max(4, Math.round(v))) })}
              />
            </div>
          </Field>
        ))}
      </Section>
      <Section title="Colour">
        <Field label="colour cells">
          <OnOffSwitch
            on={colored}
            label="Colour cells"
            title="Colour the value cells (the tile's Colour switch is the same setting)"
            onChange={(v) => update({ colored: v })}
          />
        </Field>
        {colored && (
          <Field label="palette">
            <PanelPaletteSelect
              value={toPaletteRef(config.palette)}
              onChange={(v) => update({ palette: v })}
              auto={autoOf(fromClean ? dataRole : fcRole)}
            />
          </Field>
        )}
      </Section>
    </>
  )
}

function CorrPanel({ config, update }: PlotPanelProps<CorrConfig>) {
  const corrRole = useRolePalette('corr')
  return (
    <>
      <Section title="Correlation">
        <div style={styles.hint}>All-samples × all-samples Pearson correlation.</div>
        <Checkbox
          label="cluster samples"
          checked={config.cluster ?? true}
          onChange={(v) => update({ cluster: v })}
        />
      </Section>
      <Section title="Colour">
        <Field label="palette">
          <PanelPaletteSelect
            value={toPaletteRef(config.palette)}
            onChange={(v) => update({ palette: v })}
            auto={autoOf(corrRole)}
          />
        </Field>
      </Section>
    </>
  )
}

function HeatmapPanel({ config, update, edgeNodeId }: PlotPanelProps<HeatmapConfig>) {
  // The gene cap is a fold-change concept (top-N differential genes); the intensity heatmap
  // always shows the full proteome, on Clean data's own log-transform scale (no setting here).
  // Gate the cap on the upstream kind; an unwired heatmap offers it.
  const upstreamKind = useGraph((s) => {
    const up = s.nodes.find((n) => n.id === s.edges.find((e) => e.target === edgeNodeId)?.source)
    return up && isStep(up) ? up.data.kind : undefined
  })
  // The Clean data's primary colour condition's levels, for the condition bar's default (on while
  // they fit the palette). A number, so the selector stays stable.
  const condLevels = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    const r = upId ? s.results[upId] : undefined
    return r?.kind === 'standardize' ? primaryColorLevels(r.std) : 0
  })
  return (
    <>
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
      {upstreamKind === 'compare' && (
        <Section
          title="Clustering"
          info="Hierarchical clustering of the genes and the comparison columns, on the euclidean distance between their log₂FC (capped at the colour limit)."
        >
          <Field
            label="linkage"
            aside={<QuickToggle config={config} field="linkage" update={update} kind="heatmap" />}
          >
            <Select
              value={config.linkage ?? 'ward'}
              onChange={(v) => update({ linkage: v as HeatmapLinkage })}
              options={Object.entries(HEATMAP_LINKAGES).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field
            label="leaf order"
            aside={<QuickToggle config={config} field="leafOrder" update={update} kind="heatmap" />}
          >
            <Select
              value={config.leafOrder ?? 'mean'}
              onChange={(v) => update({ leafOrder: v as LeafOrder })}
              options={Object.entries(HEATMAP_LEAF_ORDERS).map(([value, label]) => ({
                value,
                label
              }))}
            />
          </Field>
          <ClusterSideFields
            caption="gene cluster"
            noun="genes"
            fields={{
              max: 'dendroClades',
              modules: 'geneModules',
              tree: 'geneTree',
              palette: 'geneCategorical'
            }}
            config={config}
            update={update}
          />
          <ClusterSideFields
            caption="condition cluster"
            noun="comparisons"
            fields={{
              max: 'dendroColClades',
              modules: 'condModules',
              tree: 'condTree',
              palette: 'condCategorical'
            }}
            config={config}
            update={update}
          />
        </Section>
      )}
      {/* The condition bar belongs to the Clean-data heatmap (a fold-change one has none). */}
      {upstreamKind !== 'compare' && (
        <Section title="Heatmap">
          <Field
            label="Show conditions"
            aside={<QuickToggle config={config} field="condBar" update={update} />}
          >
            <OnOffSwitch
              on={heatmapCondBar(config, condLevels)}
              label="Show conditions"
              title="A coloured track per condition along the samples"
              onChange={(v) => update({ condBar: v })}
            />
          </Field>
          <SampleOrderField config={config} update={update} />
        </Section>
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
  max,
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
  /** the largest N the box takes (unset = no limit) */
  max?: number
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
                max={max}
                onChange={(v) =>
                  update({ [field]: Math.min(max ?? Infinity, Math.max(1, Math.round(v))) })
                }
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
  info,
  defaultOpen = true,
  children
}: {
  title: string
  /** small note right of the title — muted text (e.g. a cap's current N) or a StatusNote */
  subtitle?: ReactNode
  action?: ReactNode
  /** what the section does, behind an (i) right of the title */
  info?: ReactNode
  /** open on first render; a panel with many sections can start with the later ones folded */
  defaultOpen?: boolean
  children: ReactNode
}) {
  // Collapsing is per section and per mount: a config panel can run long (a point plot has the
  // group table, three sub-blocks and the axes), so folding what isn't being edited keeps the rest
  // reachable without scrolling.
  const [open, setOpen] = useState(defaultOpen)
  // `grow`: the toggle fills the head (clicking beside the title folds too); without, it hugs the
  // title so an (i) can follow it.
  const toggle = (grow: boolean): ReactNode => (
    <button
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      title={open ? `Collapse ${title}` : `Expand ${title}`}
      style={{
        ...styles.sectionTitleRow,
        ...styles.sectionToggle,
        ...(grow ? null : { flex: '0 1 auto' })
      }}
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
  )
  return (
    <div style={styles.section}>
      <div style={styles.sectionHead}>
        {/* The title row toggles; `action` (a switch, a pill) stays outside it, so using a control
            in the header doesn't fold the section under it. */}
        {info == null ? (
          toggle(true)
        ) : (
          // The (i) beside the title, outside the toggle — a tip inside the button would fold the
          // section when clicked.
          <div style={{ ...styles.sectionTitleRow, flex: 1 }}>
            {toggle(false)}
            <InfoTip label={`About ${title}`}>{info}</InfoTip>
          </div>
        )}
        {action}
      </div>
      {open && children}
    </div>
  )
}

export function Field({
  label,
  top,
  aside,
  info,
  labelAside,
  children
}: {
  label: string
  /** top-align the label (for a multi-line control, e.g. the effect-size rows) */
  top?: boolean
  /** a small control right of the field (e.g. the quick-access toggle) */
  aside?: ReactNode
  /** what the setting does, as an (i) tip beside the label */
  info?: ReactNode
  /** a small control beside the label, in place of the (i) tip (e.g. one opening a window) */
  labelAside?: ReactNode
  children: ReactNode
}) {
  return (
    <div style={{ ...styles.field, ...(top ? { alignItems: 'flex-start' } : null) }}>
      <label style={{ ...styles.fieldLabel, ...(top ? { paddingTop: 5 } : null) }}>
        {label}
        {info != null && (
          <span style={styles.fieldInfo}>
            <InfoTip label={`About ${label}`}>{info}</InfoTip>
          </span>
        )}
        {labelAside != null && <span style={styles.fieldInfo}>{labelAside}</span>}
      </label>
      {/* minWidth:0 lets a flex child (e.g. the raw-data Select) shrink and ellipsis-truncate a long
          filename instead of growing past the fixed-width panel and being clipped by its border. */}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {aside}
    </div>
  )
}

/** The sample axis' order (heatmap, gene bar, QC): natural (by condition) or the data's own. */
function SampleOrderField({
  config,
  update,
  label = 'sample order'
}: {
  config: { sampleOrder?: SampleOrder; quick?: QuickAccess }
  update: (patch: Record<string, unknown>) => void
  label?: string
}): ReactNode {
  return (
    <Field
      label={label}
      aside={<QuickToggle config={config} field="sampleOrder" update={update} />}
    >
      <Select
        value={sampleOrderOf(config)}
        onChange={(v) => update({ sampleOrder: v as SampleOrder })}
        options={SAMPLE_ORDERS.map((o) => ({ value: o, label: SAMPLE_ORDER_HINT[o] }))}
      />
    </Field>
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
  // In a settings window, a setting on quick access applies live (the rest wait for Apply).
  const staging = useContext(ApplyStageContext)
  useEffect(() => staging?.quick(field, on), [staging, field, on])
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
  const flat = useContext(ScreenScale) || unscaled
  return (
    <AppSelect
      {...props}
      zoom={flat ? 1 : Number(tf.split(',')[2]) || 1}
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
  onAuto,
  autoLabel,
  style
}: {
  /** a colour, or AUTO (shown as the letter A — see the picker's Automatic row) */
  color: string
  /** false = the colour is cleared: the chip is hatched rather than showing an ink. Independent of
   *  the width beside it — a width of 0 just means nothing is drawn at the moment. */
  on: boolean
  label: string
  title: string
  clearLabel?: string
  onPick: (color: string) => void
  /** clear the colour: nothing is drawn, while any width beside it is kept (no clear chip unset) */
  onClear?: () => void
  /** offer the Automatic option (sets AUTO) on top of the grid */
  onAuto?: () => void
  autoLabel?: string
  /** placement / sizing from the caller (the group colour heads its column, full width) */
  style?: CSSProperties
}): ReactNode {
  // On a tile the grid is drawn at the canvas zoom; in a panel (ScreenScale), at screen scale. It
  // closes when the canvas moves under it either way.
  const tf = useStore((s) => `${s.transform[0]},${s.transform[1]},${s.transform[2]}`)
  const flat = useContext(ScreenScale)
  // The slash is an SVG (see slashBackground), which can't read a CSS variable: the theme's literal.
  const border = PALETTES[useUiTheme((s) => s.mode)].border
  return (
    <ColorPicker
      value={color}
      onPick={onPick}
      onClear={onClear}
      clearLabel={clearLabel}
      onAuto={onAuto}
      autoLabel={autoLabel}
      label={label}
      title={title}
      zoom={flat ? 1 : Number(tf.split(',')[2]) || 1}
      closeKey={tf}
      triggerStyle={{
        ...styles.swatch,
        background: color === AUTO ? AUTO_BACKGROUND : on ? color : slashBackground(border),
        ...(color === AUTO
          ? {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center'
            }
          : null),
        ...style
      }}
    >
      {color === AUTO ? <AutoMark /> : <span />}
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
  title = 'Name shown for this effect class in legends and tables',
  disabled
}: {
  value: string
  onCommit: (v: string) => void
  style?: CSSProperties
  placeholder?: string
  title?: string
  disabled?: boolean
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
      disabled={disabled}
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
  // Fills the header (up to the action buttons), so the rename field has a set width to take and
  // doesn't resize the header as it swaps in for the name.
  headText: { flex: 1, minWidth: 0 },
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
  // A line of its own holding the name or its rename field (see tileNameStyles).
  headName: { display: 'flex', lineHeight: '20px', minWidth: 0 },
  // A group's header line: the tile's name, then the plot switcher after it.
  headNameRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
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
  /** a success note: last in its section, bottom right */
  doneNote: { justifyContent: 'flex-end', textAlign: 'right' },
  /** a small icon button trailing a note's text (e.g. jump to the folder it names) */
  jumpBtn: {
    background: 'transparent',
    border: 'none',
    padding: '0 0 0 5px',
    color: 'inherit',
    cursor: 'pointer',
    verticalAlign: 'middle',
    lineHeight: 0
  },
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
  fieldInfo: { marginLeft: 4, verticalAlign: 'middle' },
  // A link-styled note opening a window (the manual import's "How to prepare input files?").
  linkNote: {
    alignSelf: 'flex-start',
    display: 'block',
    margin: '6px 0',
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: UI.info,
    fontSize: 11,
    textDecoration: 'underline',
    cursor: 'pointer'
  },
  // An (i) that opens a window rather than showing a tip: InfoTip's look, as a bare button.
  formatBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: UI.info,
    cursor: 'pointer'
  },
  // Vertical field: header line, then its controls on the line below (full-width).
  fieldCol: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, minWidth: 0 },
  fieldColLabel: { color: UI.textMuted, fontSize: 11 },
  /** small label sitting left of an inline control (e.g. "log₂FC ≤" before its box) */
  inlineTag: { color: UI.textMuted, fontSize: 11, whiteSpace: 'nowrap' },
  /** one cutoff line: tag, number box (fixed width), optional class-name box */
  cutoffRow: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
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
    // shrinks with a narrow panel rather than pushing the row past it
    minWidth: 40,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '4px 7px',
    fontSize: 12,
    boxSizing: 'border-box'
  },
  condRow: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' },
  condNone: { fontSize: 12, color: UI.textMuted },
  typeChip: {
    flex: 'none',
    fontSize: 10,
    fontWeight: 600,
    lineHeight: '14px',
    padding: '1px 6px',
    borderRadius: 9,
    border: `1px solid ${UI.border}`,
    color: UI.textMuted,
    whiteSpace: 'nowrap'
  },
  typeChipBtn: { background: 'transparent', cursor: 'pointer', color: UI.text },
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
    border: `1px solid ${UI.accent}`
  },
  footer: { display: 'flex', gap: 8, padding: 12, borderTop: `1px solid ${UI.border}` }
}
