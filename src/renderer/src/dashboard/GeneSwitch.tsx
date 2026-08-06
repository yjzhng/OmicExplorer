/** One-gene switch-tab shared by TDR and the gene bar. Focus genes get tabs; genes pinned
 *  elsewhere are appended (dashed) so a selection made in another plot/table becomes
 *  switchable here; a hovered gene transiently drives the figure so it tracks the linked
 *  selection. Renders `children(gene)` for the currently-shown gene. */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import { UI } from '../ui/theme'
import { useSelection } from '../ui/useSelection'

export function GeneSwitch({
  genes,
  present,
  displayMap,
  children
}: {
  genes: string[]
  /** uniqIDs that actually have data — a hovered/pinned gene only shows if present */
  present: Set<string>
  displayMap: Record<string, string>
  children: (gene: string) => ReactNode
}): ReactNode {
  const [selId, setSelId] = useState<string | null>(null)
  const hoverId = useSelection((s) => s.hoverId)
  const pinnedIds = useSelection((s) => s.pinnedIds)
  // Tabs = focus genes, with pinned (selected) genes appended at the end.
  const tabGenes = useMemo(() => {
    const seen = new Set(genes)
    const extra = [...pinnedIds].filter((id) => !seen.has(id) && present.has(id))
    return [...genes, ...extra]
  }, [genes, pinnedIds, present])
  // A hovered gene (even one not yet a tab) transiently drives the figure; otherwise the
  // picked tab, else the first gene.
  const hoverActive = hoverId && present.has(hoverId) ? hoverId : null
  const gene = hoverActive ?? (selId && tabGenes.includes(selId) ? selId : tabGenes[0])
  const body = children(gene)

  if (tabGenes.length <= 1) return body

  return (
    <div style={styles.root}>
      <div style={styles.bars}>
        <div style={styles.bar} role="tablist" aria-label="gene">
          <span style={styles.barLabel}>gene</span>
          {tabGenes.map((id) => {
            const active = id === gene
            const pinnedExtra = !genes.includes(id)
            return (
              <button
                key={id}
                role="tab"
                aria-selected={active}
                onClick={() => setSelId(id)}
                title={pinnedExtra ? 'selected gene' : undefined}
                style={{
                  ...styles.tab,
                  ...(pinnedExtra ? styles.tabPinned : null),
                  ...(active ? styles.tabActive : null)
                }}
              >
                {displayMap[id] ?? id}
              </button>
            )
          })}
        </div>
      </div>
      <div style={styles.body}>{body}</div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  bars: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: 6,
    columnGap: 20,
    padding: '6px 10px',
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto'
  },
  bar: { display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto' },
  barLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  tab: {
    background: 'transparent',
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: '2px 12px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  },
  tabActive: { background: UI.accent, color: UI.accentText, borderColor: UI.accent },
  // Appended (pinned-elsewhere) genes read as dashed so they're distinct from focus genes.
  tabPinned: { borderStyle: 'dashed', color: UI.text },
  body: { flex: 1, minHeight: 0 }
}
