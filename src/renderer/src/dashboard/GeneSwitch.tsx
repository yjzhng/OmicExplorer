/** One-gene pager shared by the single-gene tiles (TDR, gene bar, contrast DR/TR). The navigable
 *  set is the tile's focus genes plus any genes pinned elsewhere (present in the data); a header
 *  shows "‹ n/m › gene_name", the arrows step through the set, and the gene-name button opens a
 *  searchable dropdown to jump straight to any gene. A gene hovered in another plot/table
 *  transiently drives the figure (linked selection) without moving the pager. Renders
 *  `children(gene)` for the currently-shown gene. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { PALETTES, UI } from '../ui/theme'
import { useSelection } from '../ui/useSelection'
import { useUiTheme } from '../ui/useUiTheme'

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
  const [pos, setPos] = useState(0)
  const hoverId = useSelection((s) => s.hoverId)
  const pinnedIds = useSelection((s) => s.pinnedIds)
  // Navigable set = focus genes, with pinned (selected) genes present in the data appended.
  const set = useMemo(() => {
    const seen = new Set(genes)
    const extra = [...pinnedIds].filter((id) => !seen.has(id) && present.has(id))
    return [...genes.filter((id) => present.has(id)), ...extra]
  }, [genes, pinnedIds, present])

  const safePos = set.length ? Math.min(pos, set.length - 1) : 0
  // A hovered gene (even one outside the set) transiently drives the figure; otherwise the paged
  // gene, else the first.
  const hoverActive = hoverId && present.has(hoverId) ? hoverId : null
  const displayed = hoverActive ?? set[safePos] ?? null

  if (!displayed)
    return <div style={styles.placeholder}>Hover or select a gene to display.</div>

  const idx = set.indexOf(displayed)
  const many = set.length > 1
  // Step through the set, wrapping within [0, set.length).
  const go = (d: number): void => {
    if (set.length) setPos((((idx >= 0 ? idx : safePos) + d) % set.length + set.length) % set.length)
  }

  return (
    <div style={styles.root}>
      <div style={styles.bar}>
        <button
          onClick={() => go(-1)}
          disabled={!many}
          title="Previous gene"
          style={{ ...styles.arrow, opacity: many ? 1 : 0.35, cursor: many ? 'pointer' : 'default' }}
        >
          ‹
        </button>
        <span style={styles.pos}>
          {idx >= 0 ? `${idx + 1}/${set.length}` : `–/${set.length}`}
        </span>
        <button
          onClick={() => go(1)}
          disabled={!many}
          title="Next gene"
          style={{ ...styles.arrow, opacity: many ? 1 : 0.35, cursor: many ? 'pointer' : 'default' }}
        >
          ›
        </button>
        <GenePicker
          set={set}
          current={displayed}
          displayMap={displayMap}
          onPick={(id) => {
            const i = set.indexOf(id)
            if (i >= 0) setPos(i)
          }}
        />
      </div>
      <div style={styles.body}>{children(displayed)}</div>
    </div>
  )
}

/** The gene-name button + searchable jump-to dropdown (portaled to <body> so it isn't clipped by
 *  the tile). */
function GenePicker({
  set,
  current,
  displayMap,
  onPick
}: {
  set: string[]
  current: string
  displayMap: Record<string, string>
  onPick: (id: string) => void
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const p = PALETTES[mode]
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle
      ? set.filter((id) => (displayMap[id] ?? id).toLowerCase().includes(needle))
      : set
  }, [set, q, displayMap])

  const toggle = (): void => {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setQ('')
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title="Jump to a gene"
        style={{ ...styles.nameBtn, color: UI.text, borderColor: open ? UI.accent : UI.border }}
      >
        <span style={styles.name}>{displayMap[current] ?? current}</span>
        <span style={{ color: UI.textMuted, fontSize: 9 }}>▾</span>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              left: rect.left,
              top: rect.bottom + 4,
              minWidth: Math.max(rect.width, 160),
              maxWidth: 320,
              zIndex: 5000,
              background: p.panelAlt,
              border: `1px solid ${p.border}`,
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${set.length} gene${set.length === 1 ? '' : 's'}…`}
              style={{
                border: 'none',
                borderBottom: `1px solid ${p.border}`,
                background: 'transparent',
                color: p.text,
                fontSize: 12,
                padding: '7px 9px',
                outline: 'none'
              }}
            />
            <div style={{ maxHeight: 240, overflowY: 'auto', padding: 3 }}>
              {filtered.length === 0 ? (
                <div style={{ color: p.textMuted, fontSize: 11, padding: '8px 9px' }}>No match.</div>
              ) : (
                filtered.map((id) => {
                  const on = id === current
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        onPick(id)
                        setOpen(false)
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        borderRadius: 4,
                        background: on ? UI.accent : 'transparent',
                        color: on ? UI.accentText : p.text,
                        fontSize: 12,
                        fontWeight: on ? 700 : 500,
                        padding: '5px 8px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {displayMap[id] ?? id}
                    </button>
                  )
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto'
  },
  arrow: {
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    width: 20,
    height: 20,
    lineHeight: 1,
    fontSize: 15,
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    padding: 0
  },
  pos: {
    fontSize: 10,
    fontWeight: 600,
    color: UI.textMuted,
    flex: '0 0 auto',
    fontVariantNumeric: 'tabular-nums'
  },
  nameBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    background: 'transparent',
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '3px 8px',
    cursor: 'pointer',
    marginLeft: 2
  },
  name: {
    fontSize: 12,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  body: { flex: 1, minHeight: 0 },
  placeholder: {
    height: '100%',
    display: 'grid',
    placeItems: 'center',
    color: UI.textMuted,
    fontSize: 12,
    padding: 12,
    textAlign: 'center'
  }
}
