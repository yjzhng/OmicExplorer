/** The results dashboard: one tab per analysis group, each a reconfigurable grid
 *  of panel tiles. Replaces the old two-level (section pill → tile tab) OutputDock
 *  that showed a single plot at a time. Grouping is derived from the pipeline DAG;
 *  tile layout is drag/resizable in edit mode (persisted with the workflow later). */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Edge } from '@xyflow/react'

import { facetContextDims, type ContextRow } from '../engine'
import { deriveGroups, expandMembers, parsePanelId, type AnalysisGroup } from '../graph/groups'
import { useGraph } from '../graph/store'
import { isStep, type NodeResult, type PlotGroupConfig, type StepNode } from '../graph/types'
import type { PanelLayoutItem } from '../graph/types'
import { UI } from '../ui/theme'
import { useAppView } from '../ui/useAppView'
import { DashboardGrid } from './DashboardGrid'
import { EMPTY_SEL, resolveFacets, useFacet } from './facet'
import { autoLayout, geometryChanged, reconcileLayout, type PanelLayout } from './panels'
import { PanelTile } from './PanelTile'

/** Prefer the concrete comparison label once a root has run; else the derived default. */
function groupLabel(group: AnalysisGroup, results: Record<string, NodeResult>): string {
  const r = results[group.rootId]
  if (r?.kind === 'compare' && r.cmp.comparisons.length) return r.cmp.comparisons.join(', ')
  if (r?.kind === 'contrast' && r.ctr.comparisons.length) return r.ctr.comparisons.join(', ')
  return group.label
}

export function ResultsView(): ReactNode {
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const results = useGraph((s) => s.results)
  const groupLayouts = useGraph((s) => s.groupLayouts)
  const setGroupLayout = useGraph((s) => s.setGroupLayout)
  const editMode = useAppView((s) => s.editMode)
  const toggleEdit = useAppView((s) => s.toggleEdit)

  const groups = useMemo(() => deriveGroups(nodes, edges), [nodes, edges])
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = groups.find((g) => g.id === activeId) ?? groups[0] ?? null
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
    setActiveId(id)
  }

  const nodeById = useMemo(() => new Map(nodes.filter(isStep).map((n) => [n.id, n])), [nodes])

  if (groups.length === 0) {
    return (
      <div style={styles.view}>
        <div style={styles.empty}>
          No analyses yet. Add a Standardize, Compare, or Contrast step with its plots on the
          canvas.
        </div>
      </div>
    )
  }

  return (
    <div style={styles.view}>
      <div style={styles.tabBar}>
        <div style={styles.tabs}>
          {groups.map((g) => {
            const isActive = g.id === active?.id
            return (
              <button
                key={g.id}
                onClick={() => openTab(g.id)}
                style={{ ...styles.tab, ...(isActive ? styles.tabActive : {}) }}
                title={groupLabel(g, results)}
              >
                {groupLabel(g, results)}
                <span style={styles.tabCount}>{g.memberIds.length}</span>
              </button>
            )
          })}
        </div>
        {/* Shared facet-context control for the active group — every plot derived from its
            comparison reads this one selection instead of showing its own tabs. */}
        {active && <FacetContextBar group={active} results={results} />}
        {/* Right-aligned dashboard layout toggle, on the tab row (not the main nav). */}
        <button
          onClick={toggleEdit}
          title={editMode ? 'Done editing layout' : 'Edit dashboard layout'}
          style={{
            ...styles.editBtn,
            background: editMode ? UI.accent : 'transparent',
            color: editMode ? UI.accentText : UI.text,
            borderColor: editMode ? UI.accent : UI.border
          }}
        >
          {editMode ? 'Done' : 'Edit layout'}
        </button>
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
                saved={groupLayouts[g.id] as PanelLayout | undefined}
                editing={editMode}
                onLayout={setGroupLayout}
              />
            </div>
          ))}
      </div>
    </div>
  )
}

/** The shared facet switcher for one analysis group, shown on the results tab row. Reads
 *  the group's comparison rows for the full context (strain/dose/time) and writes the one
 *  selection every FacetedPlot in the group follows. Renders nothing for a non-faceted
 *  group (e.g. a Standardize's heatmap/bar/cluster). */
function FacetContextBar({
  group,
  results
}: {
  group: AnalysisGroup
  results: Record<string, NodeResult>
}): ReactNode {
  const r = results[group.rootId]
  const rows: ContextRow[] | null =
    r?.kind === 'compare' ? r.cmp.rows : r?.kind === 'contrast' ? r.ctr.rows : null
  const sel = useFacet((s) => s.sel[group.id]) ?? EMPTY_SEL
  const setLevel = useFacet((s) => s.setLevel)
  const bars = useMemo(() => {
    if (!rows) return []
    const dims = facetContextDims(rows)
    return dims.length ? resolveFacets(rows, dims, sel).bars : []
  }, [rows, sel])
  if (!bars.length) return null
  return (
    <div style={styles.facetBar}>
      {bars.map(({ dim, value, options }) => (
        <div key={dim} style={styles.facetGroup} role="tablist" aria-label={`${dim} level`}>
          <span style={styles.facetLabel}>{dim}</span>
          {options.map((v) => (
            <button
              key={String(v)}
              role="tab"
              aria-selected={String(v) === String(value)}
              onClick={() => setLevel(group.id, dim, String(v))}
              style={{
                ...styles.facetTab,
                ...(String(v) === String(value) ? styles.facetTabActive : null)
              }}
            >
              {String(v)}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/** One tab's grid. Split out so each pane owns its own layout/handler and a hidden
 *  pane re-renders no more than a visible one. */
function GroupPane({
  group,
  nodeById,
  edges,
  results,
  saved,
  editing,
  onLayout
}: {
  group: AnalysisGroup
  nodeById: Map<string, StepNode>
  edges: Edge[]
  results: Record<string, NodeResult>
  saved: PanelLayout | undefined
  editing: boolean
  onLayout: (id: string, layout: PanelLayoutItem[]) => void
}): ReactNode {
  // Group tiles are transparent in Results: each subcard becomes its own panel.
  const nodes = [...nodeById.values()]
  const panelIds = expandMembers(group.memberIds, nodes)
  const layout = reconcileLayout(saved ?? autoLayout(panelIds), panelIds)
  // The shared facet selection for this group (from the header control); every faceted
  // plot reads it in place of its own tabs. Stable EMPTY_SEL until the user picks a level.
  const facetSel = useFacet((s) => s.sel[group.id]) ?? EMPTY_SEL
  return (
    <DashboardGrid
      ids={panelIds}
      layout={layout}
      editing={editing}
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
            editing={editing}
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
  // The tab row: tabs scroll on the left, the layout toggle stays pinned right.
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    flex: '0 0 auto',
    borderBottom: `1px solid ${UI.border}`
  },
  tabs: {
    display: 'flex',
    gap: 6,
    flex: 1,
    minWidth: 0,
    overflowX: 'auto'
  },
  editBtn: {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    height: 30,
    padding: '0 12px',
    fontSize: 12,
    fontWeight: 600,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    cursor: 'pointer'
  },
  // Shared facet control: one labelled pill group per context dim, sitting left of Edit.
  // Scrolls internally if the context is wide, so the toolbar stays a single row.
  facetBar: {
    flex: '0 1 auto',
    display: 'flex',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 14,
    minWidth: 0,
    overflowX: 'auto'
  },
  facetGroup: { display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto' },
  facetLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  facetTab: {
    background: 'transparent',
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: '2px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  },
  facetTabActive: { background: UI.accent, color: UI.accentText, borderColor: UI.accent },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    whiteSpace: 'nowrap',
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
  tabActive: { color: UI.accentText, background: UI.accent, borderColor: UI.accent },
  tabCount: { fontSize: 10, opacity: 0.7 },
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
