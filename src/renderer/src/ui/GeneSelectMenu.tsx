import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import { useGraph } from '../graph/store'
import { PALETTES, UI } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

// A geneset row's edit/delete actions are hover-revealed, which needs a :hover rule (inline styles
// can't). Injected once. Using display (not opacity) so hidden actions consume NO width — the
// geneset name then gets the full row width when the row isn't hovered (no premature truncation).
function ensureMenuCss(): void {
  if (typeof document === 'undefined' || document.getElementById('oe-gs-css')) return
  const el = document.createElement('style')
  el.id = 'oe-gs-css'
  el.textContent =
    '.oe-gs-row .oe-gs-actions{display:none}' +
    '.oe-gs-row:hover .oe-gs-actions{display:inline-flex;align-items:center;gap:1px}'
  // The action-name tooltip is portal-rendered (see ActionTip) so the scroll container can't crop it.
  document.head.appendChild(el)
}

/** Eye glyph for the geneset visibility toggle; a diagonal slash when `off` (hidden = masked). */
function Eye({ off }: { off: boolean }): ReactNode {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z" />
      <circle cx="8" cy="8" r="1.9" />
      {off && <line x1="2.5" y1="13.5" x2="13.5" y2="2.5" />}
    </svg>
  )
}

/** Minimalist 13px line icons for the per-geneset row actions (match App.tsx's icon set). */
function iconProps(): Record<string, string | number> {
  return { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
}
function IconRename(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M14 7l3 3" />
    </svg>
  )
}
/** Plus — add the current selection to the set. */
function IconAdd(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
/** Circular arrow — overwrite (rewrite) the set with the current selection. */
function IconRewrite(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M4 12a8 8 0 1 1 2.4 5.7" />
      <path d="M4 20v-5h5" />
    </svg>
  )
}
function IconTrash(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  )
}
/** Check — the armed "click again to confirm" state for a destructive action. */
function IconCheck(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M4 12l5 5L20 6" />
    </svg>
  )
}

interface Gene {
  id: string
  label: string
  /** Protein description (UniProt `proteinName`), shown right of the gene name and searchable. */
  desc?: string
}
/** A pathway group of genes. */
export interface GenePathway {
  name: string
  genes: Gene[]
}
/** A gene category. Either nested (`pathways`, e.g. a KEGG BRITE top level holding pathways) or
 *  flat (`genes` directly, e.g. an essentiality class with no pathway sublevel). */
export interface GeneCategory {
  name: string
  pathways?: GenePathway[]
  genes?: Gene[]
}
/** A named grouping the menu can switch between via the tab bar (e.g. Pathway / Essentiality). */
export interface GeneGroupTab {
  key: string
  label: string
  categories: GeneCategory[]
}

const CAP = 200
/** Destructive-action colour (matches the app's red used elsewhere). */
const DANGER = '#e15759'

/** Searchable multi-select of every gene, grouped pathway-category → pathway → gene, driving the
 *  shared (pinned) selection. Each level has a select-all checkbox + a selected-count chip and is
 *  collapsible (like the plot-selector dropdown). Checking a gene pins it (highlighting it across
 *  all plots/tables). */
export function GeneSelectMenu({ tabs }: { tabs: GeneGroupTab[] }): ReactNode {
  const pinnedIds = useSelection((s) => s.pinnedIds)
  const togglePin = useSelection((s) => s.togglePin)
  const togglePins = useSelection((s) => s.togglePins)
  const clearPins = useSelection((s) => s.clearPins)
  const setPins = useSelection((s) => s.setPins)
  const geneSets = useGraph((s) => s.geneSets)
  const createGeneSet = useGraph((s) => s.createGeneSet)
  const renameGeneSet = useGraph((s) => s.renameGeneSet)
  const updateGeneSetGenes = useGraph((s) => s.updateGeneSetGenes)
  const deleteGeneSet = useGraph((s) => s.deleteGeneSet)
  const toggleGeneSetHidden = useGraph((s) => s.toggleGeneSetHidden)
  const mode = useUiTheme((s) => s.mode)
  const p = PALETTES[mode]
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [tabKey, setTabKey] = useState(tabs[0]?.key)
  const [openCat, setOpenCat] = useState<Set<string>>(() => new Set())
  const [openPath, setOpenPath] = useState<Set<string>>(() => new Set())
  // Geneset editing state: `creating` shows the new-name input; `renameId` marks the row being renamed.
  const [creating, setCreating] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  // Which genesets are expanded (showing their member genes for un-checking / removal).
  const [openGs, setOpenGs] = useState<Set<string>>(() => new Set())
  // Two-step confirm for destructive per-row actions: first click arms {id, act}; a second click
  // on the same button within ~3s (or before the mouse leaves the row) commits.
  const [confirm, setConfirm] = useState<{ id: string; act: 'rewrite' | 'delete' } | null>(null)
  const confirmTimer = useRef<number | null>(null)
  const armConfirm = (id: string, act: 'rewrite' | 'delete'): void => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    setConfirm({ id, act })
    confirmTimer.current = window.setTimeout(() => setConfirm(null), 3000)
  }
  const isArmed = (id: string, act: 'rewrite' | 'delete'): boolean =>
    confirm?.id === id && confirm.act === act
  // Portal-rendered action tooltip (so the scrollable list can't crop it). Anchored to the hovered
  // icon's screen rect; the text is derived at render time so it flips to "Confirm…" once armed.
  type TipKind = 'rename' | 'add' | 'rewrite' | 'delete'
  const [tip, setTip] = useState<{ id: string; kind: TipKind; cx: number; top: number } | null>(null)
  const showTip = (e: ReactMouseEvent, id: string, kind: TipKind): void => {
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ id, kind, cx: r.left + r.width / 2, top: r.bottom + 4 })
  }
  const tipText = (t: { id: string; kind: TipKind }): string => {
    if (t.kind === 'rename') return 'Rename'
    if (t.kind === 'add') return 'Add selection'
    if (t.kind === 'rewrite') return isArmed(t.id, 'rewrite') ? 'Confirm rewrite' : 'Rewrite'
    return isArmed(t.id, 'delete') ? 'Confirm delete' : 'Delete'
  }
  useEffect(ensureMenuCss, [])
  const activeTab = tabs.find((t) => t.key === tabKey) ?? tabs[0]
  const categories = activeTab?.categories ?? []
  // id → label across every tab, so a geneset saved from the selection carries display labels.
  const labelById = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tabs)
      for (const c of t.categories) {
        for (const g of c.genes ?? []) m.set(g.id, g.label)
        for (const pw of c.pathways ?? []) for (const g of pw.genes) m.set(g.id, g.label)
      }
    return m
  }, [tabs])
  // id → protein description (UniProt), so both the gene list and expanded geneset members can show
  // it right of the name.
  const descById = useMemo(() => {
    const m = new Map<string, string>()
    const put = (g: Gene): void => {
      if (g.desc && !m.has(g.id)) m.set(g.id, g.desc)
    }
    for (const t of tabs)
      for (const c of t.categories) {
        for (const g of c.genes ?? []) put(g)
        for (const pw of c.pathways ?? []) for (const g of pw.genes) put(g)
      }
    return m
  }, [tabs])
  // The current selection as geneset members (id + captured label).
  const selectionGenes = (): { id: string; label: string }[] =>
    [...pinnedIds].map((id) => ({ id, label: labelById.get(id) ?? id }))
  const commitCreate = (): void => {
    if (pinnedIds.size === 0) return
    createGeneSet(nameDraft.trim() || `Geneset ${geneSets.length + 1}`, selectionGenes())
    setCreating(false)
    setNameDraft('')
  }
  const commitRename = (id: string): void => {
    renameGeneSet(id, nameDraft)
    setRenameId(null)
    setNameDraft('')
  }
  const [rect, setRect] = useState<{ right: number; bottom: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    const onScroll = (e: Event): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onResize = (): void => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const toggle = (): void => {
    if (open) {
      setTip(null)
      return setOpen(false)
    }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setRect({ right: r.right, bottom: r.bottom })
    setQ('')
    setOpen(true)
  }
  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, key: string): void => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setter(next)
  }

  const MENU_W = 340
  const menuLeft = rect
    ? Math.max(8, Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - 8))
    : 0

  // Filter genes by the search; keep pathways/categories that still have genes. A matching category
  // or pathway name keeps all its genes.
  const searching = q.trim() !== ''
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const matchGene = (g: Gene): boolean =>
      g.label.toLowerCase().includes(needle) ||
      g.id.toLowerCase().includes(needle) ||
      (g.desc?.toLowerCase().includes(needle) ?? false)
    return categories
      .map((c) => {
        const catMatch = needle && c.name.toLowerCase().includes(needle)
        // Flat category (essentiality): genes hang directly off the category, no pathway sublevel.
        if (c.genes) {
          const genes = !needle || catMatch ? c.genes : c.genes.filter(matchGene)
          return { name: c.name, pathways: [] as GenePathway[], genes }
        }
        const pathways = (c.pathways ?? [])
          .map((pw) => {
            const pwMatch = needle && pw.name.toLowerCase().includes(needle)
            const genes = !needle || catMatch || pwMatch ? pw.genes : pw.genes.filter(matchGene)
            return { name: pw.name, genes }
          })
          .filter((pw) => pw.genes.length > 0)
        return { name: c.name, pathways, genes: [] as Gene[] }
      })
      .filter((c) => c.pathways.length > 0 || c.genes.length > 0)
  }, [categories, q])

  // Selected/total over a set of gene-id lists (deduped) — for the count chips + tri-state boxes.
  const tally = (idLists: string[][]): { ids: string[]; sel: number } => {
    const ids = [...new Set(idLists.flat())]
    return { ids, sel: ids.filter((id) => pinnedIds.has(id)).length }
  }

  const n = pinnedIds.size
  const box = (sel: number, total: number, onClick: () => void, title: string): ReactNode => {
    const allOn = sel === total && total > 0
    return (
      <button
        title={title}
        onClick={onClick}
        style={{
          ...styles.box,
          border: `1px solid ${sel > 0 ? p.accent : p.border}`,
          background: allOn ? p.accent : 'transparent',
          color: allOn ? p.panel : p.accent
        }}
      >
        {allOn ? '✓' : sel > 0 ? '–' : ''}
      </button>
    )
  }
  const chip = (sel: number, total: number): ReactNode => (
    <span
      style={{
        ...styles.chip,
        color: sel > 0 ? p.accent : p.textMuted,
        background: sel > 0 ? `${p.accent}22` : `${p.textMuted}22`
      }}
    >
      {sel}/{total}
    </span>
  )
  // Gene checkbox rows, shared by flat categories and pathways (differing only in left indent).
  // Checking a gene pins it into the shared selection.
  const geneRows = (genes: Gene[], indent: number): ReactNode => (
    <>
      {genes.slice(0, CAP).map((g) => {
        const on = pinnedIds.has(g.id)
        return (
          <label
            key={g.id}
            style={{ ...styles.geneRow, paddingLeft: indent, color: p.text, ...(on ? { background: `${p.accent}22` } : {}) }}
            onMouseEnter={() => useSelection.getState().setHover(g.id)}
            onMouseLeave={() => useSelection.getState().clearHover()}
          >
            <input type="checkbox" checked={on} onChange={() => togglePin(g.id)} style={{ accentColor: p.accent }} />
            <span style={styles.geneName}>{g.label}</span>
            {g.desc && (
              <span style={{ ...styles.geneDesc, color: p.textMuted }} title={g.desc}>
                {g.desc}
              </span>
            )}
          </label>
        )
      })}
      {genes.length > CAP && (
        <div style={{ ...styles.more, paddingLeft: indent, color: p.textMuted }}>
          +{(genes.length - CAP).toLocaleString()} more — refine search
        </div>
      )}
    </>
  )

  return (
    <div style={{ flex: '0 0 auto' }}>
      <button ref={btnRef} onClick={toggle} style={styles.trigger}>
        <span>{n > 0 ? `${n} gene${n > 1 ? 's' : ''} selected` : 'Select genes'}</span>
        <Chevron deg={open ? -90 : 90} />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{ ...styles.menu, left: menuLeft, top: rect.bottom + 4, width: MENU_W, background: p.panel, border: `1px solid ${p.border}` }}
          >
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search genes / pathways…"
              style={{ ...styles.search, background: p.panelAlt, color: p.text, border: `1px solid ${p.border}` }}
            />
            {/* Custom genesets — saved gene selections. Click a name to load it (replacing the current
                selection); per-row Rename / Rewrite (overwrite with current selection) / Delete. */}
            <div style={{ ...styles.gsSection, borderColor: p.border }}>
              <div style={styles.gsHead}>
                <span style={{ ...styles.gsTitle, color: p.textMuted }}>Custom genesets</span>
                <button
                  onClick={() => {
                    setNameDraft('')
                    setRenameId(null)
                    setCreating(true)
                  }}
                  disabled={n === 0}
                  title={n === 0 ? 'Select genes first' : 'Save the current selection as a new geneset'}
                  style={{ ...styles.gsNew, color: n === 0 ? p.textMuted : p.accent, cursor: n === 0 ? 'default' : 'pointer' }}
                >
                  + New from selection
                </button>
              </div>
              {creating && (
                <div style={styles.gsRow}>
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitCreate()
                      else if (e.key === 'Escape') setCreating(false)
                    }}
                    placeholder={`Name (${n} gene${n > 1 ? 's' : ''})…`}
                    style={{ ...styles.gsInput, background: p.panelAlt, color: p.text, border: `1px solid ${p.border}` }}
                  />
                  <button onClick={commitCreate} style={{ ...styles.gsIcon, color: p.accent }} title="Save">
                    ✓
                  </button>
                  <button onClick={() => setCreating(false)} style={{ ...styles.gsIcon, color: p.textMuted }} title="Cancel">
                    ✕
                  </button>
                </div>
              )}
              {/* Cap the visible list to ~10 rows; scroll beyond. Expanded member lists scroll too. */}
              <div style={styles.gsList}>
                {geneSets.map((gs) => {
                  const ids = gs.genes.map((g) => g.id)
                  const active =
                    ids.length > 0 && ids.length === pinnedIds.size && ids.every((id) => pinnedIds.has(id))
                  if (renameId === gs.id)
                    return (
                      <div key={gs.id} style={styles.gsRow}>
                        <input
                          autoFocus
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(gs.id)
                            else if (e.key === 'Escape') setRenameId(null)
                          }}
                          style={{ ...styles.gsInput, background: p.panelAlt, color: p.text, border: `1px solid ${p.border}` }}
                        />
                        <button onClick={() => commitRename(gs.id)} style={{ ...styles.gsIcon, color: p.accent }} title="Save">
                          ✓
                        </button>
                        <button onClick={() => setRenameId(null)} style={{ ...styles.gsIcon, color: p.textMuted }} title="Cancel">
                          ✕
                        </button>
                      </div>
                    )
                  const expanded = openGs.has(gs.id)
                  return (
                    <div key={gs.id}>
                      <div
                        className="oe-gs-row"
                        style={{ ...styles.gsRow, ...(active ? { background: `${p.accent}22` } : {}) }}
                        onMouseLeave={() => setConfirm((c) => (c?.id === gs.id ? null : c))}
                      >
                        <button
                          onClick={() => toggleIn(openGs, setOpenGs, gs.id)}
                          title={expanded ? 'Collapse' : 'Expand to edit genes'}
                          style={styles.gsCaret}
                        >
                          <Chevron deg={expanded ? 90 : 0} size={9} color={p.textMuted} />
                        </button>
                        <button
                          onClick={() => toggleGeneSetHidden(gs.id)}
                          title={
                            gs.hidden
                              ? 'Hidden — its genes are masked non-significant across every comparison / contrast. Click to show.'
                              : 'Visible. Click to hide — mask its genes as non-significant everywhere (e.g. drop inherently-variable genes).'
                          }
                          style={{ ...styles.gsEye, color: gs.hidden ? DANGER : p.textMuted }}
                        >
                          <Eye off={!!gs.hidden} />
                        </button>
                        <button
                          onClick={() => setPins(ids)}
                          title={`Load ${gs.genes.length} gene${gs.genes.length > 1 ? 's' : ''}`}
                          style={{ ...styles.gsLoad, color: p.text, fontWeight: active ? 700 : 500 }}
                        >
                          <span
                            style={{
                              ...styles.label,
                              ...(gs.hidden ? { textDecoration: 'line-through', opacity: 0.55 } : {})
                            }}
                          >
                            {gs.name}
                          </span>
                          <span style={{ ...styles.gsCount, color: p.textMuted }}>{gs.genes.length}</span>
                        </button>
                        <span className="oe-gs-actions" style={styles.gsActions}>
                          <button
                            onMouseEnter={(e) => showTip(e, gs.id, 'rename')}
                            onMouseLeave={() => setTip(null)}
                            onClick={() => {
                              setNameDraft(gs.name)
                              setCreating(false)
                              setRenameId(gs.id)
                            }}
                            style={{ ...styles.gsAct, color: p.textMuted }}
                          >
                            <IconRename />
                          </button>
                          <button
                            onMouseEnter={(e) => showTip(e, gs.id, 'add')}
                            onMouseLeave={() => setTip(null)}
                            onClick={() => {
                              const have = new Set(ids)
                              updateGeneSetGenes(gs.id, [
                                ...gs.genes,
                                ...selectionGenes().filter((g) => !have.has(g.id))
                              ])
                            }}
                            disabled={n === 0}
                            style={{ ...styles.gsAct, color: n === 0 ? p.border : p.accent, cursor: n === 0 ? 'default' : 'pointer' }}
                          >
                            <IconAdd />
                          </button>
                          <button
                            onMouseEnter={(e) => showTip(e, gs.id, 'rewrite')}
                            onMouseLeave={() => setTip(null)}
                            onClick={() => {
                              if (n === 0) return
                              if (isArmed(gs.id, 'rewrite')) {
                                updateGeneSetGenes(gs.id, selectionGenes())
                                setConfirm(null)
                              } else armConfirm(gs.id, 'rewrite')
                            }}
                            disabled={n === 0}
                            style={{
                              ...styles.gsAct,
                              color: n === 0 ? p.border : isArmed(gs.id, 'rewrite') ? DANGER : p.textMuted,
                              background: isArmed(gs.id, 'rewrite') ? `${DANGER}22` : undefined,
                              cursor: n === 0 ? 'default' : 'pointer'
                            }}
                          >
                            {isArmed(gs.id, 'rewrite') ? <IconCheck /> : <IconRewrite />}
                          </button>
                          <button
                            onMouseEnter={(e) => showTip(e, gs.id, 'delete')}
                            onMouseLeave={() => setTip(null)}
                            onClick={() => {
                              if (isArmed(gs.id, 'delete')) {
                                deleteGeneSet(gs.id)
                                setConfirm(null)
                              } else armConfirm(gs.id, 'delete')
                            }}
                            style={{
                              ...styles.gsAct,
                              color: DANGER,
                              background: isArmed(gs.id, 'delete') ? `${DANGER}22` : undefined
                            }}
                          >
                            {isArmed(gs.id, 'delete') ? <IconCheck /> : <IconTrash />}
                          </button>
                        </span>
                      </div>
                      {/* Expanded: member genes with a (checked) box — un-checking removes the gene
                          from the geneset. Hovering highlights it across every plot/table. */}
                      {expanded && (
                        <div style={styles.gsMembers}>
                          {gs.genes.length === 0 && (
                            <div style={{ ...styles.gsEmpty, color: p.textMuted, paddingLeft: 34 }}>Empty geneset</div>
                          )}
                          {gs.genes.slice(0, CAP).map((g) => {
                            const desc = descById.get(g.id)
                            return (
                              <label
                                key={g.id}
                                style={{ ...styles.gsMemberRow, color: p.text }}
                                onMouseEnter={() => useSelection.getState().setHover(g.id)}
                                onMouseLeave={() => useSelection.getState().clearHover()}
                              >
                                <input
                                  type="checkbox"
                                  checked
                                  onChange={() =>
                                    updateGeneSetGenes(gs.id, gs.genes.filter((x) => x.id !== g.id))
                                  }
                                  style={{ accentColor: p.accent }}
                                />
                                <span style={styles.geneName}>{g.label}</span>
                                {desc && (
                                  <span style={{ ...styles.geneDesc, color: p.textMuted }} title={desc}>
                                    {desc}
                                  </span>
                                )}
                              </label>
                            )
                          })}
                          {gs.genes.length > CAP && (
                            <div style={{ ...styles.more, paddingLeft: 34, color: p.textMuted }}>
                              +{(gs.genes.length - CAP).toLocaleString()} more
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {geneSets.length === 0 && !creating && (
                <div style={{ ...styles.gsEmpty, color: p.textMuted }}>
                  Select genes below, then “New from selection”.
                </div>
              )}
            </div>
            {tabs.length > 1 && (
              <div style={{ ...styles.tabPill, border: `1px solid ${p.border}`, background: p.panelAlt }}>
                {tabs.map((t) => {
                  const on = t.key === activeTab?.key
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTabKey(t.key)}
                      style={{
                        ...styles.tabBtn,
                        background: on ? p.accent : 'transparent',
                        color: on ? p.panel : p.text
                      }}
                    >
                      {t.label}
                    </button>
                  )
                })}
              </div>
            )}
            <div style={styles.list}>
              {shown.map((c) => {
                const flat = c.genes.length > 0 && c.pathways.length === 0
                const cat = flat
                  ? tally([c.genes.map((g) => g.id)])
                  : tally(c.pathways.map((pw) => pw.genes.map((g) => g.id)))
                const catOpen = searching || openCat.has(c.name)
                return (
                  <div key={c.name}>
                    <div style={styles.catHead}>
                      {box(cat.sel, cat.ids.length, () => togglePins(cat.ids), 'Select all in category')}
                      <button onClick={() => toggleIn(openCat, setOpenCat, c.name)} style={{ ...styles.headBtn, color: p.text, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                        <Chevron deg={catOpen ? 90 : 0} size={9} color={p.textMuted} />
                        <span style={styles.label}>{c.name}</span>
                      </button>
                      {chip(cat.sel, cat.ids.length)}
                    </div>
                    {catOpen && flat && geneRows(c.genes, 26)}
                    {catOpen &&
                      !flat &&
                      c.pathways.map((pw) => {
                        const key = `${c.name}::${pw.name}`
                        const ids = pw.genes.map((g) => g.id)
                        const sel = ids.filter((id) => pinnedIds.has(id)).length
                        const pwOpen = searching || openPath.has(key)
                        return (
                          <div key={key}>
                            <div style={styles.pathHead}>
                              {box(sel, ids.length, () => togglePins(ids), 'Select all in pathway')}
                              <button onClick={() => toggleIn(openPath, setOpenPath, key)} style={{ ...styles.headBtn, color: p.text, fontWeight: 600 }}>
                                <Chevron deg={pwOpen ? 90 : 0} size={9} color={p.textMuted} />
                                <span style={styles.label}>{pw.name}</span>
                              </button>
                              {chip(sel, ids.length)}
                            </div>
                            {pwOpen && geneRows(pw.genes, 40)}
                          </div>
                        )
                      })}
                  </div>
                )
              })}
              {shown.length === 0 && (
                <div style={{ ...styles.more, color: p.textMuted, paddingLeft: 6 }}>No matching genes</div>
              )}
            </div>
            {n > 0 && (
              <button style={{ ...styles.clear, color: p.textMuted }} onClick={() => clearPins()}>
                Clear selection ({n})
              </button>
            )}
          </div>,
          document.body
        )}
      {open &&
        tip &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: Math.max(40, Math.min(tip.cx, window.innerWidth - 40)),
              top: tip.top,
              transform: 'translateX(-50%)',
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              background: '#222',
              color: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              pointerEvents: 'none',
              zIndex: 5000
            }}
          >
            {tipText(tip)}
          </div>,
          document.body
        )}
    </div>
  )
}

function Chevron({ deg, size = 11, color = UI.textMuted }: { deg: number; size?: number; color?: string }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" style={{ flex: '0 0 auto', color, transform: `rotate(${deg}deg)` }}>
      <polyline points="3.5,1.5 7,5 3.5,8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const headBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  flex: 1,
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 0,
  textAlign: 'left'
}
const styles: Record<string, CSSProperties> = {
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 30,
    padding: '0 10px',
    fontSize: 12,
    fontWeight: 600,
    color: UI.text,
    background: 'transparent',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  menu: {
    position: 'fixed',
    zIndex: 4000,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
    padding: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  search: { width: '100%', boxSizing: 'border-box', borderRadius: 5, padding: '5px 8px', fontSize: 12 },
  gsSection: { display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: 4, borderBottom: '1px solid transparent' },
  gsHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' },
  gsTitle: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 },
  gsNew: { border: 'none', background: 'transparent', fontSize: 11, fontWeight: 600, padding: 0 },
  gsRow: { display: 'flex', alignItems: 'center', gap: 4, padding: '1px 4px', borderRadius: 4 },
  gsEye: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: 20,
    height: 20,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 0
  },
  gsLoad: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, border: 'none', background: 'transparent', cursor: 'pointer', padding: '3px 2px', textAlign: 'left', fontSize: 12 },
  gsCount: { flex: '0 0 auto', fontSize: 10, fontWeight: 600 },
  // display is controlled by the injected hover CSS (oe-gs-actions) — do NOT set it inline, or the
  // inline value would override the CSS `display:none` and the actions would always take up width.
  gsActions: { gap: 1, flex: '0 0 auto' },
  // Scrollable geneset list: ~8 rows tall, then scrolls (rows are ~24px each).
  gsList: { maxHeight: 192, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  gsCaret: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: 16,
    height: 20,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 0
  },
  gsMembers: { display: 'flex', flexDirection: 'column', paddingBottom: 2 },
  gsMemberRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px 2px 34px', borderRadius: 4, fontSize: 12, cursor: 'pointer' },
  gsIcon: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: '2px 3px' },
  // Square icon button for the per-row actions (rename / add / rewrite / delete).
  gsAct: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: 18,
    height: 20,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1
  },
  gsInput: { flex: 1, minWidth: 0, boxSizing: 'border-box', borderRadius: 5, padding: '4px 7px', fontSize: 12 },
  gsEmpty: { fontSize: 11, padding: '2px 6px 4px' },
  tabPill: { display: 'flex', gap: 2, borderRadius: 999, padding: 2 },
  tabBtn: {
    flex: 1,
    border: 'none',
    borderRadius: 999,
    padding: '3px 0',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  list: { maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  catHead: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px 2px' },
  pathHead: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 2px 18px' },
  headBtn: { ...headBtn, fontSize: 11 },
  box: {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 15,
    height: 15,
    borderRadius: 4,
    fontSize: 10,
    lineHeight: 1,
    cursor: 'pointer',
    padding: 0
  },
  chip: {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 22,
    height: 14,
    padding: '0 4px',
    borderRadius: 7,
    fontSize: 9,
    fontWeight: 700,
    lineHeight: 1
  },
  geneRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '3px 6px 3px 40px', borderRadius: 4, fontSize: 12, cursor: 'pointer' },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // Gene name is capped so a long name can't hide the description; the description fills the rest.
  geneName: { flex: '0 1 auto', maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  geneDesc: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 },
  more: { padding: '3px 6px 3px 40px', fontSize: 11 },
  clear: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 11, textAlign: 'left', padding: '2px 6px', textDecoration: 'underline' }
}
