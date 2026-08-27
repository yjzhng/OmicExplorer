/** The results dashboard: one tab per analysis group, each a reconfigurable grid
 *  of panel tiles. Replaces the old two-level (section pill → tile tab) OutputDock
 *  that showed a single plot at a time. Grouping is derived from the pipeline DAG;
 *  tile layout is drag/resizable in edit mode (persisted with the workflow later). */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Edge } from '@xyflow/react'

import { facetDims, type ContextRow } from '../engine'
import { deriveGroups, expandMembers, parsePanelId, type AnalysisGroup } from '../graph/groups'
import { NODE_SPECS } from '../graph/registry'
import { useGraph } from '../graph/store'
import { isStep, type NodeResult, type PlotGroupConfig, type StepNode } from '../graph/types'
import type { PanelLayoutItem } from '../graph/types'
import { UI } from '../ui/theme'
import { useAppView } from '../ui/useAppView'
import { DashboardGrid } from './DashboardGrid'
import { EMPTY_SEL, resolveFacets, useFacet } from './facet'
import { autoLayout, geometryChanged, reconcileLayout, type PanelLayout } from './panels'
import { PanelTile } from './PanelTile'

/** The comparison strings a run produced (compare/contrast), else none. */
function groupComparisons(group: AnalysisGroup, results: Record<string, NodeResult>): string[] {
  const r = results[group.rootId]
  if (r?.kind === 'compare') return r.cmp.comparisons
  if (r?.kind === 'contrast') return r.ctr.comparisons
  return []
}

/** Tab label = the step tile's user-given name if set, else its type label (kind, e.g.
 *  "Compare"). What's actually being compared lives in the hover tooltip (groupTitle). */
function groupLabel(group: AnalysisGroup, name?: string): string {
  return name || NODE_SPECS[group.kind].label
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
  const editMode = useAppView((s) => s.editMode)
  const toggleEdit = useAppView((s) => s.toggleEdit)
  // Active tab lives in the app-view store (not local state) so it survives Results unmounting
  // when you switch to the canvas — returning lands on the same tab, not the first.
  const activeId = useAppView((s) => s.resultsTab)
  const setResultsTab = useAppView((s) => s.setResultsTab)

  const groups = useMemo(() => deriveGroups(nodes, edges), [nodes, edges])
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
    setResultsTab(id)
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
      <div style={styles.header}>
        <div style={styles.tabRow}>
          <div style={styles.tabs}>
            {groups.map((g) => {
              const isActive = g.id === active?.id
              return (
                <button
                  key={g.id}
                  onClick={() => openTab(g.id)}
                  style={{ ...styles.tab, ...(isActive ? styles.tabActive : {}) }}
                  title={groupTitle(g, results)}
                >
                  {groupLabel(g, nodeById.get(g.rootId)?.data.name)}
                  {/* Real panel count: plot groups unfold into one panel per subcard, so this
                      matches the tiles actually shown (a folded group is not counted as 1). */}
                  <span style={styles.tabCount}>{expandMembers(g.memberIds, nodes).length}</span>
                </button>
              )
            })}
          </div>
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
        {/* Shared facet-context control for the active group, on its own row below the
            analysis tabs — every plot derived from the comparison reads this one selection.
            A dedicated row lets many condition switchers wrap without crowding the tabs.
            Renders nothing for a non-faceted group. */}
        {active && <FacetContextBar group={active} results={results} />}
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
    const dims = facetDims(rows)
    return dims.length ? resolveFacets(rows, dims, sel).bars : []
  }, [rows, sel])
  if (!bars.length) return null
  return (
    <div style={styles.facetBar}>
      {bars.map(({ dim, value, options }) => (
        <div key={dim} style={styles.facetGroup} role="tablist" aria-label={`${dim} level`}>
          <span style={styles.facetLabel}>{dim}</span>
          {/* Fused pill, matching the main-nav Workflow/Results switch and the in-plot
              SwitchBar: a rounded track whose active level is an accent-filled chip. */}
          <div style={styles.facetPill}>
            {options.map((v) => {
              const on = String(v) === String(value)
              return (
                <button
                  key={String(v)}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setLevel(group.id, dim, String(v))}
                  style={{
                    ...styles.facetTab,
                    background: on ? UI.accent : 'transparent',
                    color: on ? UI.accentText : UI.text
                  }}
                >
                  {String(v)}
                </button>
              )
            })}
          </div>
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
  // The results header: analysis tabs on top, context-condition switchers on their own
  // row below (so many switchers wrap instead of crowding the tabs).
  header: {
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 auto',
    borderBottom: `1px solid ${UI.border}`
  },
  // The tab row: tabs scroll on the left, the layout toggle stays pinned right.
  tabRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px'
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
  // Shared facet control on its own row below the tabs: one labelled pill group per context
  // dim. Wraps to multiple lines when many switchers don't fit, rather than crowding a
  // single row. No divider from the tabs above — the two rows read as one header block.
  facetBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 16,
    rowGap: 8,
    padding: '2px 14px 8px',
    minWidth: 0
  },
  facetGroup: { display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto' },
  facetLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  // Fused pill: a rounded track holding the level chips (active = accent fill).
  facetPill: {
    display: 'inline-flex',
    gap: 4,
    border: `1px solid ${UI.border}`,
    borderRadius: 999,
    padding: 2,
    background: UI.panel,
    flex: '0 0 auto'
  },
  facetTab: {
    border: 'none',
    borderRadius: 999,
    padding: '3px 12px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  },
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
