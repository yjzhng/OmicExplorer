/**
 * The plot side of form mode: the step's tile in the middle, the picked plot's chart on the right.
 *
 * Its own module so it can be loaded on demand — it reaches Plotly, which touches `document` as it
 * loads, and pulling that into the workflow view would make the whole view undrawable without a
 * DOM (and untestable without one).
 *
 * The chart is the dashboard's own tile, so its header, facet tabs, copy/download, gene selection
 * and config gear all behave exactly as they do in a grid.
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react'

import { TileBody } from '../graph/GraphNode'
import { Section } from '../graph/NodeConfigPanel'
import { deriveGroups, parsePanelId } from '../graph/groups'
import {
  accentOf,
  categoryOf,
  CATEGORIES,
  maxInputsFor,
  NODE_SPECS,
  plotLabel,
  stepTitle
} from '../graph/registry'
import { useGraph } from '../graph/store'
import type { PlotGroupConfig, StepNode } from '../graph/types'
import { EMPTY_SEL, useFacet } from '../dashboard/facet'
import { FacetContextBar } from '../dashboard/FacetContextBar'
import { PanelTile } from '../dashboard/PanelTile'
import { IconCopy, IconTrash } from '../ui/icons'
import { UI } from '../ui/theme'
import { clampWidth, PLOT_NAV_WIDTH, useAppSettings } from '../ui/useAppSettings'
import { Inputs } from './Inputs'
import { derivePages } from './pages'
import { Splitter } from './Splitter'

/** A plot step: the step's tile in the middle — the canvas tile's own body, so a group's add-plots
 *  menu and plot cards work as they do there — and the chart of the picked plot on the right. The
 *  chart is the dashboard's own tile, so its header, facet tabs, copy/download, gene selection and
 *  config gear all behave exactly as they do in a grid. */
export default function PlotPanel({ node }: { node: StepNode }): ReactNode {
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const results = useGraph((s) => s.results)
  // The picked plot is the store's subcard selection — the same one the canvas tile sets — so the
  // tile's cards and the chart can't disagree.
  const selectedSub = useGraph((s) => s.selectedSub)
  const plotNavWidth = useAppSettings((s) => s.plotNavWidth)
  const updateSettings = useAppSettings((s) => s.update)

  const pages = useMemo(() => derivePages(nodes, edges), [nodes, edges])
  const analyses = useMemo(() => deriveGroups(nodes, edges), [nodes, edges])
  // This step's pages (a group has one per plot); the picked one, else the first.
  const mine = pages.filter((p) => parsePanelId(p.panelId).nodeId === node.id)
  const page = mine.find((p) => parsePanelId(p.panelId).childId === selectedSub) ?? mine[0]
  const analysis = analyses.find((g) => g.id === page?.groupId)
  const facetSel = useFacet((s) => (page ? (s.sel[page.groupId] ?? EMPTY_SEL) : EMPTY_SEL))

  const childId = page ? parsePanelId(page.panelId).childId : undefined
  const child = childId
    ? (node.data.config as PlotGroupConfig).children.find((c) => c.id === childId)
    : undefined

  return (
    <>
      <div className="oe-scroll" style={{ ...styles.tileColumn, width: plotNavWidth }}>
        <StepTileCard node={node} activeChild={childId} />
      </div>
      <Splitter
        ariaLabel="Resize the plot tile"
        onDelta={(dx) =>
          updateSettings({ plotNavWidth: clampWidth(plotNavWidth + dx, PLOT_NAV_WIDTH) })
        }
      />
      {page ? (
        <div style={styles.plot}>
          {/* The condition switcher for this analysis. Not optional decoration: handing `facetSel`
              to a plot suppresses that plot's own tabs, so without this the context would be
              pinned to whatever level resolved first. */}
          {analysis && (
            <div style={styles.facets}>
              <FacetContextBar group={analysis} results={results} />
            </div>
          )}
          <div style={styles.plotBody}>
            <PanelTile
              // Remount per page so a chart never inherits the previous one's sizing.
              key={page.panelId}
              node={node}
              edges={edges}
              results={results}
              editing={false}
              child={child}
              facetSel={facetSel}
            />
          </div>
        </div>
      ) : (
        <div style={styles.empty}>This plot has no data yet — run the step that feeds it.</div>
      )}
    </>
  )
}

/** The plot step as its canvas tile: category and name over the tile's own body (for a group, the
 *  add-plots menu and the draggable plot cards; picking a card picks the chart) under its input,
 *  with duplicate and delete in the header. Its status is left to the step's row in the workflow column. */
function StepTileCard({ node, activeChild }: { node: StepNode; activeChild?: string }): ReactNode {
  const id = node.id
  const data = node.data
  const category = categoryOf(data.kind)
  const accent = accentOf(category)
  const deleteNode = useGraph((s) => s.deleteNode)
  const duplicateNode = useGraph((s) => s.duplicateNode)
  const group = data.kind === 'plotGroup'
  const type = group
    ? `${NODE_SPECS[data.kind].label} · ${(data.config as PlotGroupConfig).children.length}`
    : plotLabel(data.kind, data.config)
  return (
    <div style={{ ...styles.card, borderTopColor: accent }}>
      <div style={styles.head}>
        <span style={styles.titleWrap}>
          <span style={{ ...styles.catTag, color: accent }}>{CATEGORIES[category].label}</span>
          <span style={styles.name} title={stepTitle(node)}>
            {stepTitle(node)}
          </span>
          {data.name && <span style={styles.typeSub}>{type}</span>}
        </span>
        <div style={styles.headRight}>
          <button
            style={styles.iconBtn}
            title="Duplicate step"
            aria-label="Duplicate step"
            onClick={() => duplicateNode(id)}
          >
            <IconCopy />
          </button>
          {/* The whole step — every plot in a group. One plot comes off a group from its menu. */}
          <button
            style={{ ...styles.iconBtn, color: '#e15759' }}
            title={group ? 'Delete step (all its plots)' : 'Delete step'}
            aria-label="Delete step"
            onClick={() => deleteNode(id)}
          >
            <IconTrash />
          </button>
        </div>
      </div>
      {/* What feeds it, headed like the settings card's sections — the settings card being where
          every other step shows its input. */}
      <Section title={maxInputsFor(data.kind) > 1 ? 'Inputs' : 'Input'}>
        <Inputs node={node} />
      </Section>
      <TileBody id={id} data={data} accent={accent} activeChild={activeChild} />
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  plot: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12
  },
  facets: { display: 'flex' },
  // Padded like the form's other columns; the card inside takes the column's width.
  tileColumn: { flex: '0 0 auto', boxSizing: 'border-box', overflowY: 'auto', padding: 12 },
  // The canvas tile's card (GraphNode's `card`): accent top strip, 8px corners — less the fixed
  // width and the drop shadow, which only a floating tile needs.
  card: {
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderTop: '3px solid',
    borderRadius: 8,
    color: UI.text,
    fontSize: 12
  },
  head: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 10px',
    borderBottom: `1px solid ${UI.border}`
  },
  titleWrap: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  catTag: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 },
  name: {
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  typeSub: { fontSize: 10, color: UI.textMuted, fontWeight: 500 },
  headRight: { display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' },
  // Same chrome as the settings card's duplicate / delete (NodeConfigPanel's iconBtnSm).
  iconBtn: {
    width: 24,
    height: 24,
    borderRadius: 5,
    border: `1px solid ${UI.border}`,
    background: 'transparent',
    color: UI.text,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto'
  },
  // An explicit flex column, so the tile stretches across it by the cross axis rather than by
  // block-level auto width — the dashboard hands the same tile an absolutely-sized box, and this
  // is the nearest equivalent that doesn't depend on the surrounding layout mode.
  plotBody: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' },
  empty: { padding: 24, color: UI.textMuted, fontSize: 13 }
}
