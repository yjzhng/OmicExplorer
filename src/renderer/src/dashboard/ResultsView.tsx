/** The results dashboard: one tab per plot group (see deriveTabs), each a reconfigurable grid
 *  of panel tiles. Replaces the old two-level (section pill → tile tab) OutputDock
 *  that showed a single plot at a time. Grouping is derived from the pipeline DAG;
 *  tile layout is drag/resizable in edit mode (persisted with the workflow later). */
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import type { Edge } from '@xyflow/react'

import {
  deriveTabs,
  expandMembers,
  parsePanelId,
  tabTitles,
  topoStepOrder,
  type AnalysisGroup
} from '../graph/groups'
import { safeTileName } from '../graph/registry'
import { useGraph } from '../graph/store'
import { isStep, type NodeResult, type PlotGroupConfig, type StepNode } from '../graph/types'
import type { PanelLayoutItem } from '../graph/types'
import { Chevron } from '../ui/Chevron'
import { UI } from '../ui/theme'
import { useAppSettings } from '../ui/useAppSettings'
import { useAppView } from '../ui/useAppView'
import { DashboardGrid } from './DashboardGrid'
import { useGroupFacets } from './facet'
import { FacetContextBar } from './FacetContextBar'
import { autoLayout, geometryChanged, reconcileLayout, type PanelLayout } from './panels'
import { PanelTile } from './PanelTile'

/** The comparison strings a run produced (compare/contrast), else none. */
function groupComparisons(group: AnalysisGroup, results: Record<string, NodeResult>): string[] {
  const r = results[group.rootId]
  if (r?.kind === 'compare') return r.cmp.comparisons
  if (r?.kind === 'contrast') return r.ctr.comparisons
  return []
}

/** Full comparison list for the tab's hover tooltip (the label itself is trimmed). */
function groupTitle(group: AnalysisGroup, results: Record<string, NodeResult>): string {
  const comps = groupComparisons(group, results)
  return comps.length ? comps.join(', ') : group.label
}

export function ResultsView(): ReactNode {
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const results = useGraph((s) => s.results)
  const groupLayouts = useGraph((s) => s.groupLayouts)
  const setGroupLayout = useGraph((s) => s.setGroupLayout)
  const groupMeta = useGraph((s) => s.groupMeta)
  const reorderGroups = useGraph((s) => s.reorderGroups)
  // Active tab lives in the app-view store (not local state) so it survives Results unmounting
  // when you switch to the canvas — returning lands on the same tab, not the first.
  const activeId = useAppView((s) => s.resultsTab)
  const setResultsTab = useAppView((s) => s.setResultsTab)
  const setView = useAppView((s) => s.setView)
  // Back to the canvas — the counterpart of the canvas's "Results →" button.
  const backToWorkflow = (
    <button
      className="oe-view-btn oe-press"
      style={styles.backBtn}
      onClick={() => setView('canvas')}
      title="Back to the workflow canvas"
    >
      ← Workflow
    </button>
  )
  // Tab being dragged (rootId) and the insertion index a drop would land at (0..n), for the live
  // placeholder shown between tabs while dragging.
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  // One tab per plot group, named after it (tabTitles).
  const groups = useMemo(() => {
    const derived = deriveTabs(nodes, edges)
    // Default order follows workflow TOPOLOGY (upstream analyses first, then the plot groups
    // under each), not creation order.
    const topo = topoStepOrder(nodes, edges)
    const rank = new Map(topo.map((id, i) => [id, i]))
    const rankOf = (g: AnalysisGroup): number =>
      (rank.get(g.rootId) ?? Infinity) * 1e6 + (rank.get(g.id) ?? 0)
    // A user-set `order` (from drag-reorder) wins — the tab's own, else (a workflow from before
    // tabs were per plot group) its step's; otherwise the topological rank.
    const orderOf = (g: AnalysisGroup): number =>
      groupMeta[g.id]?.order ?? groupMeta[g.rootId]?.order ?? Infinity
    return derived
      .map((g) => ({ g, rank: rankOf(g), order: orderOf(g) }))
      .sort((a, b) => a.order - b.order || a.rank - b.rank)
      .map((x) => x.g)
  }, [nodes, edges, groupMeta])
  const titles = useMemo(() => tabTitles(groups, nodes), [groups, nodes])

  // Whether the tabs overflow their row: then a menu button at its right end lists every tab, to
  // jump to one or drag it to a new place (TabMenu).
  const tabsRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    const el = tabsRef.current
    if (!el) return
    const check = (): void => setOverflow(el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [groups, titles])

  // Drop `fromId` into insertion slot `index` (0..n in the current order) and persist.
  const dropTabAt = (fromId: string, index: number): void => {
    const ids = groups.map((g) => g.id)
    const from = ids.indexOf(fromId)
    if (from < 0) return
    ids.splice(from, 1)
    // Removing the dragged tab shifts later slots left by one.
    const to = from < index ? index - 1 : index
    if (to === from) return // no-op (dropped back onto its own slot)
    ids.splice(to, 0, fromId)
    reorderGroups(ids)
  }
  const endDrag = (): void => {
    setDragId(null)
    setDropIndex(null)
  }
  // (A remembered tab from before tabs were per plot group names its step: its first plot group.)
  const active =
    groups.find((g) => g.id === activeId) ??
    groups.find((g) => g.rootId === activeId) ??
    groups[0] ??
    null
  // Tabs are kept alive once opened: building a tab's plots costs ~1s, and
  // unmounting on every switch made you pay it again each time you came back.
  // Panes are only created on first visit, so unopened tabs still cost nothing.
  // Results changing (a re-run) flows into the mounted panes as new props, and
  // leaving Results unmounts the lot — so nothing here can go stale.
  const [visited, setVisited] = useState<string[]>([])
  const openTab = (id: string): void => {
    // Remember the tab being left as well as the one being opened, so the pane we are
    // navigating away from stays mounted (that is the whole point of keeping them).
    const keep = [...visited, active?.id, id].filter((v): v is string => !!v)
    setVisited([...new Set(keep)])
    setResultsTab(id)
  }

  const nodeById = useMemo(() => new Map(nodes.filter(isStep).map((n) => [n.id, n])), [nodes])
  // Clicking the open tab again renames it — its plot group's name, the same name the group's
  // canvas tile shows (and its downloads' folder takes). Enter / leaving the field saves, Esc
  // cancels; an empty name goes back to the default (the step it reads from).
  const renameNode = useGraph((s) => s.renameNode)
  // `width`: the tab's own, so the field takes its place without growing the chip.
  const [renaming, setRenaming] = useState<{
    id: string
    draft: string
    width: number
  } | null>(null)
  const commitTabName = (): void => {
    if (renaming) renameNode(renaming.id, safeTileName(renaming.draft).trim())
    setRenaming(null)
  }

  if (groups.length === 0) {
    return (
      <div style={styles.view}>
        <div style={styles.tabRow}>{backToWorkflow}</div>
        <div style={styles.empty}>
          No plots yet. Add a Clean data, Compare, or Contrast step with its plots on the canvas.
        </div>
      </div>
    )
  }

  return (
    <div style={styles.view}>
      <div style={styles.header}>
        <div style={styles.tabRow}>
          {backToWorkflow}
          {/* Named like the condition switchers below ("DOSE", "TIME", …): this row picks the plot
              group. */}
          <span style={styles.tabLabel}>Group</span>
          <div
            ref={tabsRef}
            className="oe-tabscroll"
            style={styles.tabs}
            // A plain mouse wheel only scrolls vertically; turn it sideways here so a long row of
            // tabs can be scrolled without a trackpad or shift. Horizontal input passes through.
            onWheel={(e) => {
              const el = e.currentTarget
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth)
                el.scrollLeft += e.deltaY
            }}
            // Dropping anywhere in the row uses the last-computed insertion index.
            onDragOver={(e) => {
              if (dragId) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId && dropIndex != null) dropTabAt(dragId, dropIndex)
              endDrag()
            }}
          >
            {groups.map((g, i) => {
              const isActive = g.id === active?.id
              return (
                <Fragment key={g.id}>
                  {dropIndex === i && dragId && <div style={styles.dropMark} />}
                  {renaming?.id === g.id ? (
                    <input
                      autoFocus
                      value={renaming.draft}
                      placeholder={titles.get(g.id)}
                      // File-name-safe, like the tile's own rename (the name leads downloads).
                      onChange={(e) =>
                        setRenaming({ ...renaming, draft: safeTileName(e.target.value) })
                      }
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={commitTabName}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitTabName()
                        else if (e.key === 'Escape') setRenaming(null)
                      }}
                      style={{ ...styles.tab, ...styles.tabInput, width: renaming.width }}
                    />
                  ) : (
                    <button
                      draggable
                      data-tab={g.id}
                      onClick={(e) => {
                        const own = nodeById.get(g.id)
                        if (isActive && own)
                          setRenaming({
                            id: g.id,
                            draft: own.data.name ?? '',
                            width: e.currentTarget.getBoundingClientRect().width
                          })
                        else openTab(g.id)
                      }}
                      onDragStart={(e) => {
                        setDragId(g.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragOver={(e) => {
                        if (!dragId) return
                        e.preventDefault() // allow the drop
                        e.dataTransfer.dropEffect = 'move'
                        // Insert before this tab or after it, by which half the cursor is over.
                        const r = e.currentTarget.getBoundingClientRect()
                        const after = e.clientX > r.left + r.width / 2
                        const idx = i + (after ? 1 : 0)
                        if (idx !== dropIndex) setDropIndex(idx)
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        if (dragId && dropIndex != null) dropTabAt(dragId, dropIndex)
                        endDrag()
                      }}
                      onDragEnd={endDrag}
                      style={{
                        ...styles.tab,
                        ...(isActive ? styles.tabActive : {}),
                        ...(dragId === g.id ? { opacity: 0.4 } : {})
                      }}
                      title={
                        isActive
                          ? `${groupTitle(g, results)} — click to rename`
                          : groupTitle(g, results)
                      }
                    >
                      {titles.get(g.id)}
                      {/* Real panel count: plot groups unfold into one panel per subcard, so this
                        matches the tiles actually shown (a folded group is not counted as 1). */}
                      <span style={styles.tabCount}>
                        {expandMembers(g.memberIds, nodes).length}
                      </span>
                    </button>
                  )}
                </Fragment>
              )
            })}
            {dropIndex === groups.length && dragId && <div style={styles.dropMark} />}
          </div>
          {overflow && (
            <TabMenu
              tabs={groups.map((g) => ({
                id: g.id,
                title: titles.get(g.id) ?? g.label,
                tip: groupTitle(g, results),
                count: expandMembers(g.memberIds, nodes).length
              }))}
              activeId={active?.id}
              onOpen={(id) => {
                openTab(id)
                // bring it into view in the row
                tabsRef.current
                  ?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id)}"]`)
                  ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
              }}
              onMove={dropTabAt}
            />
          )}
        </div>
        {/* Controls row below the tabs: the shared condition switchers. Kept off the tab row so
            the tabs scroll horizontally on their own when many analyses don't fit. The gene
            selector lives in the top nav, shared with the workflow view. */}
        <div style={styles.controlRow}>
          {active && <FacetContextBar group={active} results={results} />}
        </div>
      </div>
      <div style={styles.panes}>
        {groups
          .filter((g) => visited.includes(g.id) || g.id === active?.id)
          .map((g) => (
            <div
              key={g.id}
              // `display:none` rather than `visibility:hidden`: it makes the charts
              // inside report `offsetParent === null`, which is how PlotlyChart knows
              // to skip highlight work for a tab nobody is looking at. The grid
              // remembers its measured width across the hide (see DashboardGrid).
              style={{
                ...styles.pane,
                ...(g.id === active?.id ? null : styles.paneHidden)
              }}
              aria-hidden={g.id !== active?.id}
            >
              <GroupPane
                group={g}
                nodeById={nodeById}
                edges={edges}
                results={results}
                // its own layout, else (a workflow from before tabs were per plot group) its
                // step's, which reconcileLayout narrows to this group's panels
                saved={(groupLayouts[g.id] ?? groupLayouts[g.rootId]) as PanelLayout | undefined}
                onLayout={setGroupLayout}
              />
            </div>
          ))}
      </div>
    </div>
  )
}

/** The tab row's overflow menu: a button at the row's right end (shown while the tabs don't fit)
 *  opening a list of every tab — click one to open it, drag one up or down to move it (the same
 *  order the row shows). Closes on a pick, a click outside, or Escape. */
function TabMenu({
  tabs,
  activeId,
  onOpen,
  onMove
}: {
  tabs: Array<{ id: string; title: string; tip: string; count: number }>
  activeId: string | undefined
  onOpen: (id: string) => void
  /** drop tab `id` into insertion slot `index` (0..n in the current order) */
  onMove: (id: string, index: number) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [drag, setDrag] = useState<string | null>(null)
  const [slot, setSlot] = useState<number | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const end = (): void => {
    setDrag(null)
    setSlot(null)
  }
  const drop = (): void => {
    if (drag && slot != null) onMove(drag, slot)
    end()
  }
  return (
    <div ref={boxRef} style={styles.menuBox}>
      <button
        className="oe-press"
        style={{ ...styles.menuBtn, ...(open ? styles.menuBtnOpen : null) }}
        title="All groups — pick one, or drag to reorder"
        onClick={() => setOpen((o) => !o)}
      >
        {tabs.length}
        <Chevron deg={open ? -90 : 90} size={10} color="currentColor" />
      </button>
      {open && (
        <div
          className="oe-tabscroll"
          style={styles.menu}
          onDragOver={(e) => {
            if (drag) e.preventDefault()
          }}
          onDrop={(e) => {
            e.preventDefault()
            drop()
          }}
        >
          {tabs.map((t, i) => (
            <Fragment key={t.id}>
              {slot === i && drag && <div style={styles.menuDropMark} />}
              <div
                draggable
                role="button"
                title={t.tip}
                onClick={() => {
                  onOpen(t.id)
                  setOpen(false)
                }}
                onDragStart={(e) => {
                  setDrag(t.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  if (!drag) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  // before this row or after it, by which half the cursor is over
                  const r = e.currentTarget.getBoundingClientRect()
                  const idx = i + (e.clientY > r.top + r.height / 2 ? 1 : 0)
                  if (idx !== slot) setSlot(idx)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  drop()
                }}
                onDragEnd={end}
                onMouseEnter={() => setHover(t.id)}
                onMouseLeave={() => setHover((h) => (h === t.id ? null : h))}
                style={{
                  ...styles.menuItem,
                  ...(hover === t.id ? { background: UI.panelAlt } : null),
                  ...(t.id === activeId ? styles.menuItemActive : null),
                  ...(drag === t.id ? { opacity: 0.4 } : null)
                }}
              >
                <span style={styles.menuGrip}>⋮⋮</span>
                <span style={styles.menuTitle}>{t.title}</span>
                <span style={styles.tabCount}>{t.count}</span>
              </div>
            </Fragment>
          ))}
          {slot === tabs.length && drag && <div style={styles.menuDropMark} />}
        </div>
      )}
    </div>
  )
}

function GroupPane({
  group,
  nodeById,
  edges,
  results,
  saved,
  onLayout
}: {
  group: AnalysisGroup
  nodeById: Map<string, StepNode>
  edges: Edge[]
  results: Record<string, NodeResult>
  saved: PanelLayout | undefined
  onLayout: (id: string, layout: PanelLayoutItem[]) => void
}): ReactNode {
  // Group tiles are transparent in Results: each subcard becomes its own panel.
  const nodes = [...nodeById.values()]
  const panelIds = expandMembers(group.memberIds, nodes)
  // Laid out `plotsPerRow` across (Settings) until arranged by hand; new plots join that way too.
  const perRow = useAppSettings((s) => s.plotsPerRow)
  const layout = reconcileLayout(saved ?? autoLayout(panelIds, perRow), panelIds, perRow)
  // The shared facet selection for this group as the header control resolves it (every dim's level
  // on show, picked or not); every faceted plot reads it in place of its own tabs.
  const facetSel = useGroupFacets(group, results).resolved
  return (
    <DashboardGrid
      ids={panelIds}
      layout={layout}
      onLayoutChange={(next) => {
        // RGL emits on mount and every drag frame; only persist a real geometry change.
        if (geometryChanged(layout, next)) onLayout(group.id, next as PanelLayoutItem[])
      }}
    >
      {(panelId) => {
        const { nodeId, childId } = parsePanelId(panelId)
        const n = nodeById.get(nodeId)
        if (!n) return null
        const child = childId
          ? (n.data.config as PlotGroupConfig).children.find((c) => c.id === childId)
          : undefined
        // A stale child id (subcard removed after the layout was saved) → skip.
        if (childId && !child) return null
        return (
          <PanelTile
            node={n}
            edges={edges}
            results={results}
            // The dashboard is always editable: tiles drag by the header and resize at any edge.
            editing
            child={child}
            facetSel={facetSel}
          />
        )
      }}
    </DashboardGrid>
  )
}

const styles: Record<string, CSSProperties> = {
  view: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: UI.bg },
  panes: { flex: 1, minHeight: 0, position: 'relative' },
  pane: { position: 'absolute', inset: 0, overflow: 'auto', padding: '8px 10px 40px' },
  paneHidden: { display: 'none' },
  // The results header: analysis tabs on top (scrolling horizontally on overflow), then a
  // controls row — condition switchers left, gene selector + Edit-layout right.
  header: {
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 auto',
    borderBottom: `1px solid ${UI.border}`
  },
  // The tab row: the way back to the workflow, then the analysis tabs, which fill the rest of the
  // row and scroll horizontally on overflow.
  tabRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 14px 2px'
  },
  // The data switcher's label — FacetContextBar's facetLabel, so it reads like the condition
  // switchers' labels. Its gap to the tabs matches theirs (7px) via a negative trim of the row gap.
  tabLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto',
    marginRight: -3
  },
  // A rounded square like the canvas's "Results →", sized to the tabs beside it.
  backBtn: {
    flex: '0 0 auto',
    // Extra space after it: it leaves the dashboard, the rest of the row works within it.
    marginRight: 14,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  // Controls row under the tabs: the condition switchers.
  controlRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '2px 14px 8px',
    minWidth: 0
  },

  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
    overflowX: 'auto',
    // Room under the tabs for the slim scrollbar (.oe-tabscroll in app.css), so it never touches
    // them — matched above, so the tabs stay centred on the button and label beside them (the
    // scrollbar itself, when there is one, adds 4px more below). The row's own padding gives
    // these 4px back.
    padding: '4px 0'
  },
  // Live insertion marker shown between tabs while dragging one — a thin accent bar. It must not
  // intercept drag events (else the underlying tab's dragOver stops firing), hence pointerEvents.
  dropMark: {
    flex: '0 0 auto',
    alignSelf: 'stretch',
    width: 3,
    minHeight: 22,
    margin: '0 -3px',
    borderRadius: 2,
    background: UI.accent,
    pointerEvents: 'none'
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    whiteSpace: 'nowrap',
    // Never shrink: `overflow: hidden` drops a flex item's minimum width to 0, so without this a
    // long row squeezed every tab to a sliver instead of overflowing into the scroller. Long names
    // still ellipsize at the max width.
    flex: '0 0 auto',
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    background: 'transparent',
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 16,
    padding: '5px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  // The whole `border`, not just its colour: React clears a longhand (borderColor) set over the
  // shorthand when the style drops it, which left the last active tab with a dark outline.
  // A click on the open tab renames it, so it shows the text cursor like the app's other names.
  tabActive: {
    color: UI.accentText,
    background: UI.accent,
    border: `1px solid ${UI.accent}`,
    cursor: 'text'
  },
  tabCount: { fontSize: 10, opacity: 0.7 },
  // The overflow menu (TabMenu): its button at the tab row's right end, sized like a tab, and the
  // list it opens below, right-aligned to it.
  // Shown only while the tabs overflow, so the tabs' scrollbar strip (4px, .oe-tabscroll) sits under
  // them: the same strip under the button keeps it level with them.
  menuBox: { position: 'relative', flex: '0 0 auto', paddingBottom: 4 },
  menuBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    background: 'transparent',
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 16,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  menuBtnOpen: { color: UI.text, background: UI.panelAlt },
  menu: {
    position: 'absolute',
    top: 'calc(100% + 2px)',
    right: 0,
    zIndex: 50,
    minWidth: 220,
    maxWidth: 360,
    maxHeight: '60vh',
    overflowY: 'auto',
    padding: 4,
    background: UI.panelRaised,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.3)'
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px 6px 6px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    color: UI.text,
    cursor: 'pointer'
  },
  // The open tab, as the row shows it.
  menuItemActive: { background: UI.accent, color: UI.accentText },
  menuGrip: { fontSize: 10, letterSpacing: -2, opacity: 0.45, cursor: 'grab' },
  menuTitle: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  // Where a dragged row would land: a thin accent bar between rows.
  menuDropMark: {
    height: 3,
    margin: '-2px 4px',
    borderRadius: 2,
    background: UI.accent,
    pointerEvents: 'none'
  },
  // The open tab while it's being renamed: the tab itself, as a text field.
  // The open tab while it's being renamed: the same chip, its colours flipped (the accent becomes
  // the text and outline, the accent's text colour the fill), so it reads as being edited.
  tabInput: {
    outline: 'none',
    cursor: 'text',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    background: UI.accentText,
    color: UI.accent,
    border: `1px solid ${UI.accent}`
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: UI.textMuted,
    fontSize: 13,
    textAlign: 'center',
    padding: 24
  }
}
