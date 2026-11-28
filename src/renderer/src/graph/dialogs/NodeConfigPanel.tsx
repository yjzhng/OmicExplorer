import { useStore } from '@xyflow/react'
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { PagerTrigger } from '../../ui/controls/PagerTrigger'

import { PlotWindow, ScreenScale, type PlotWindowSlots } from '../../nodes/kit/settings/hooks'
import { clusterMinimalAxes } from '../../nodes/kit/settings/plotHooks'
import { styles } from '../../nodes/kit/settings/styles'
import { Chevron, Section } from '../../nodes/kit/settings/controls'
import { AxesSection, LegendRow, PlotRowsSection } from '../../nodes/kit/settings/plotSections'
import { SETTINGS } from '../../nodes/settings'
import { ErrorBoundary } from '../../shared/ErrorBoundary'
import { IconCopy, IconTrash } from '../../ui/controls/icons'
import { type AxisDefaults } from '../../ui/plot/plotAxes'
import { Select } from '../../ui/controls/Select'
import { PALETTES, UI } from '../../ui/app/theme'
import { useUiTheme } from '../../ui/app/useUiTheme'
import {
  accentOf,
  canConnect,
  CATEGORIES,
  categoryOf,
  entryKey,
  NODE_SPECS,
  PLOT_SECTIONS,
  plotLabel,
  safeTileName,
  tileEntryKey,
  type PlotMenuEntry
} from '../registry'
import { entriesFor, gatePlotEntries, UNWIRED, type UpstreamFacts } from '../run/requirements'
import { useGraph } from '../store'
import { nameChip, nameInput, tileNameText } from '../canvas/tileNameStyles'
import {
  isStep,
  type NodeConfig,
  type NodeKind,
  type PlotChild,
  type PlotGroupConfig
} from '../types'
import type { ClusterConfig } from '../config/cluster'
import type { LegendConfig, PlotAxes, PointStyle } from '../config/plotStyle'
import { usePlotGroupTitle } from '../results/usePlotGroupTitle'

/** A canvas tile's category strip (its top border's width) — the floating panel's matches it. */
export const TILE_STRIP = 5

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
  const entry = SETTINGS[kind]
  const facts = NODE_SPECS[kind].plot
  // The window's own parts — the legend switch (every plot with a legend; a row of General) and
  // Axes and lines (every plot with axes; else only the plot's whole-plot rows, if it has any) —
  // handed to the plot's settings, whose PlotSections puts them in the one order (the legend in
  // General, before its palettes; Axes and lines last of all).
  const slots: PlotWindowSlots = {
    legend: facts?.legend ? (
      <LegendRow config={config as LegendConfig} update={update} />
    ) : undefined,
    axes: (plotRows) =>
      facts?.axes ? (
        <AxesSection
          config={config as { axes?: PlotAxes }}
          update={update}
          defaults={axisDefaults}
          minimal={kind === 'pca' && clusterMinimalAxes(config as ClusterConfig)}
          plotRows={plotRows}
          guides={
            facts.guides
              ? {
                  style: (config as { style?: PointStyle }).style,
                  set: (patch) =>
                    update({ style: { ...(config as { style?: PointStyle }).style, ...patch } })
                }
              : undefined
          }
        />
      ) : plotRows ? (
        <PlotRowsSection>{plotRows}</PlotRowsSection>
      ) : null
  }
  return entry && 'plot' in entry ? (
    <ErrorBoundary
      label={`${plotLabel(kind, config)} settings`}
      kind={kind}
      nodeId={edgeNodeId}
      title="These settings couldn’t be shown."
    >
      <PlotWindow.Provider value={slots}>
        <entry.plot config={config} update={update} edgeNodeId={edgeNodeId} />
      </PlotWindow.Provider>
    </ErrorBoundary>
  ) : null
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
        {/* The app's scrollbar in its own gutter (oe-scroll, scrollbarGutter: stable), not over the
            right edge of the settings. */}
        <div
          className={embedded ? undefined : 'oe-scroll'}
          style={embedded ? styles.scrollEmbedded : styles.scroll}
        >
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
          {/* A step's own settings (nodes/<kind>/Settings.tsx, by kind in nodes/settings.ts). */}
          {(() => {
            const entry = SETTINGS[kind]
            return entry && 'step' in entry ? (
              <ErrorBoundary
                label={`${NODE_SPECS[kind].label} settings`}
                kind={kind}
                nodeId={id}
                title="These settings couldn’t be shown."
              >
                <entry.step id={id} config={node.data.config} />
              </ErrorBoundary>
            ) : null
          })()}
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
