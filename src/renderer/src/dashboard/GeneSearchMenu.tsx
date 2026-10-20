/** The searchable gene dropdown, as the nav's gene selector: a search field, then gene rows —
 *  name and protein description, both searched. Portaled to <body> so a tile or panel doesn't clip
 *  it; closes on a pick, a click outside it (or its trigger) and Escape. Used by the one-gene
 *  pager (GeneSwitch) and by settings that pick one gene (Clean data's reference protein). */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { IconSearch } from '../ui/GeneSelectMenu'
import { GENE_LIST_STYLES } from '../ui/geneListStyles'
import { PALETTES } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'
import { useGeneDescriptions } from './useGeneMenuTabs'

/** The dropdown's width — room for a gene's name and its description, as the nav's menu. */
const MENU_W = 340

/** Rows the gene dropdown renders at once — the set can be every gene in the data. */
const LIST_CAP = 300

export function GeneSearchMenu({
  genes,
  current,
  displayMap,
  anchor,
  triggerRef,
  onPick,
  onClose
}: {
  /** the genes listed (uniqIDs), in order */
  genes: string[]
  /** the gene picked now (bold in the list), if any */
  current?: string
  displayMap: Record<string, string>
  /** the trigger's box: the menu opens under it */
  anchor: DOMRect
  /** the trigger, so a click on it toggles rather than closing and reopening */
  triggerRef: RefObject<HTMLElement | null>
  onPick: (id: string) => void
  onClose: () => void
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const p = PALETTES[mode]
  const [q, setQ] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, triggerRef])

  // Each gene's protein description, as the nav's gene selector shows it — listed and searched.
  const descs = useGeneDescriptions()
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle
      ? genes.filter(
          (id) =>
            (displayMap[id] ?? id).toLowerCase().includes(needle) ||
            id.toLowerCase().includes(needle) ||
            (descs[id]?.toLowerCase().includes(needle) ?? false)
        )
      : genes
  }, [genes, q, displayMap, descs])

  const L = GENE_LIST_STYLES
  return createPortal(
    <div
      ref={menuRef}
      style={{
        ...L.menu,
        left: anchor.left,
        top: anchor.bottom + 4,
        width: MENU_W,
        maxHeight: Math.max(160, window.innerHeight - anchor.bottom - 4 - 8),
        zIndex: 5000,
        background: p.panel,
        border: `1px solid ${p.border}`
      }}
    >
      <div style={L.searchWrap}>
        <span style={{ ...L.searchIcon, color: p.textMuted }}>
          <IconSearch />
        </span>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${genes.length.toLocaleString()} gene${genes.length === 1 ? '' : 's'}…`}
          style={{
            ...L.search,
            paddingLeft: 26,
            background: p.panelAlt,
            color: p.text,
            border: `1px solid ${p.border}`
          }}
        />
      </div>
      <div style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {filtered.length === 0 ? (
          <div style={{ ...L.more, paddingLeft: 6, color: p.textMuted }}>No match.</div>
        ) : (
          filtered.slice(0, LIST_CAP).map((id) => {
            const on = id === current
            const desc = descs[id]
            return (
              <div
                key={id}
                role="button"
                onClick={() => {
                  onPick(id)
                  onClose()
                }}
                style={{
                  ...L.geneRow,
                  paddingLeft: 6,
                  color: p.text,
                  fontWeight: on ? 700 : undefined,
                  ...(on ? { background: `${p.accent}22` } : {})
                }}
              >
                <span style={L.geneName}>{displayMap[id] ?? id}</span>
                {desc && (
                  <span style={{ ...L.geneDesc, color: p.textMuted }} title={desc}>
                    {desc}
                  </span>
                )}
              </div>
            )
          })
        )}
        {filtered.length > LIST_CAP && (
          <div style={{ ...L.more, paddingLeft: 6, color: p.textMuted }}>
            +{(filtered.length - LIST_CAP).toLocaleString()} more — refine search
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
