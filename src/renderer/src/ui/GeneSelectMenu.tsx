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
import { cssVars, PALETTES, UI } from './theme'
import { CLEAR, ColorPicker } from './ColorPicker'
import { Select } from './Select'
import { POPOVER_ATTR } from './usePopover'
import { ToggleSwitch } from './ToggleSwitch'
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
  return {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  }
}
/** A text field with a cursor — rename: it changes the set's NAME. Drawn unlike the gene-editing
 *  pencil on purpose; with a pencil on both, the two read as the same action. */
function IconRename(): ReactNode {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <path d="M12 4v16M10 4h4M10 20h4" />
    </svg>
  )
}
/** A pencil — edit the set's GENES, by checking them in the gene list below. */
function IconEditGenes(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M14 7l3 3" />
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
  /** a choice WITHIN the tab (Pathway: which term set groups the genes), shown as a dropdown under
   *  the tab bar while the tab is active; the caller rebuilds `categories` for the choice */
  variant?: {
    value: string
    options: { value: string; label: string }[]
    onChange: (value: string) => void
  }
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
  const setGeneSetColor = useGraph((s) => s.setGeneSetColor)
  const mode = useUiTheme((s) => s.mode)
  const p = PALETTES[mode]
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [tabKey, setTabKey] = useState(tabs[0]?.key)
  const [openCat, setOpenCat] = useState<Set<string>>(() => new Set())
  const [openPath, setOpenPath] = useState<Set<string>>(() => new Set())
  // Geneset editing state: `creating` shows the new-name input, for a set saved from the selection
  // or an empty one; `renameId` marks the row being renamed.
  const [creating, setCreating] = useState<'selection' | 'empty' | null>(null)
  // The placeholder row clicked: asking whether the new set starts empty or from the selection.
  const [choosing, setChoosing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  // The geneset being edited from the gene list: while set, the list's checkboxes show and change
  // THAT set's members instead of the shared selection — how a set is built without selecting first.
  const [editId, setEditId] = useState<string | null>(null)
  // Which genesets are expanded (showing their member genes for un-checking / removal).
  const [openGs, setOpenGs] = useState<Set<string>>(() => new Set())
  // Two-step confirm for Delete: first click arms {id, act}; a second click
  // on the same button within ~3s (or before the mouse leaves the row) commits.
  const [confirm, setConfirm] = useState<{ id: string; act: 'delete' } | null>(null)
  const confirmTimer = useRef<number | null>(null)
  const armConfirm = (id: string, act: 'delete'): void => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    setConfirm({ id, act })
    confirmTimer.current = window.setTimeout(() => setConfirm(null), 3000)
  }
  const isArmed = (id: string, act: 'delete'): boolean => confirm?.id === id && confirm.act === act
  // Portal-rendered action tooltip (so the scrollable list can't crop it). Anchored to the hovered
  // icon's screen rect; the text is derived at render time so it flips to "Confirm…" once armed.
  type TipKind = 'rename' | 'edit' | 'delete'
  const [tip, setTip] = useState<{ id: string; kind: TipKind; cx: number; top: number } | null>(
    null
  )
  const showTip = (e: ReactMouseEvent, id: string, kind: TipKind): void => {
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ id, kind, cx: r.left + r.width / 2, top: r.bottom + 4 })
  }
  const tipText = (t: { id: string; kind: TipKind }): string => {
    if (t.kind === 'rename') return 'Rename'
    if (t.kind === 'edit') return editId === t.id ? 'Done editing genes' : 'Edit genes'
    return isArmed(t.id, 'delete') ? 'Confirm delete' : 'Delete'
  }
  useEffect(ensureMenuCss, [])
  const activeTab = tabs.find((t) => t.key === tabKey) ?? tabs[0]
  const categories = useMemo(() => activeTab?.categories ?? [], [activeTab])
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
  // "Save selected genes" takes the selection; "New geneset" starts empty and opens for editing, so
  // its genes are then checked straight off the list below.
  const commitCreate = (): void => {
    const name = nameDraft.trim() || `Geneset ${geneSets.length + 1}`
    const empty = creating === 'empty' || pinnedIds.size === 0
    const id = createGeneSet(name, empty ? [] : selectionGenes())
    if (empty) startEdit(id, [])
    setCreating(null)
    setNameDraft('')
  }
  const commitRename = (id: string): void => {
    renameGeneSet(id, nameDraft)
    setRenameId(null)
    setNameDraft('')
  }
  // What the gene list's checkboxes read and write: the edited set's members, else the selection.
  const editSet = geneSets.find((g) => g.id === editId) ?? null
  // Editing keeps the selection equal to the set (startEdit / toggleIds move both together). Any
  // other change to the selection — loading another set, clearing it, picking in a plot — ends
  // editing, so later picks go to the selection and never quietly into the set.
  if (
    editSet &&
    (editSet.genes.length !== pinnedIds.size || editSet.genes.some((g) => !pinnedIds.has(g.id)))
  )
    setEditId(null)
  const checkedIds = useMemo(
    () => (editSet ? new Set(editSet.genes.map((g) => g.id)) : pinnedIds),
    [editSet, pinnedIds]
  )
  // Editing a geneset selects it, and every edit re-selects it: the plots highlight the set as
  // it's built, and the selector's label names it with its live count. (Left alone, the selection
  // would sit still while the set changed, and the label with it.)
  function startEdit(id: string, ids: string[]): void {
    setEditId(id)
    setPins(ids)
  }
  // Same all-or-nothing rule as togglePins: every id already in → take them all out, else add the rest.
  const toggleIds = (ids: string[]): void => {
    if (!editSet) return ids.length === 1 ? togglePin(ids[0]) : togglePins(ids)
    const uniq = [...new Set(ids)]
    if (uniq.length === 0) return
    const have = new Set(editSet.genes.map((g) => g.id))
    const allIn = uniq.every((id) => have.has(id))
    const genes = allIn
      ? editSet.genes.filter((g) => !uniq.includes(g.id))
      : [
          ...editSet.genes,
          ...uniq
            .filter((id) => !have.has(id))
            .map((id) => ({ id, label: labelById.get(id) ?? id }))
        ]
    updateGeneSetGenes(editSet.id, genes)
    setPins(genes.map((g) => g.id))
  }
  const [rect, setRect] = useState<{ right: number; bottom: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      // A click in a popover opened from the menu (a geneset's colour grid) is not a click away.
      const inPopover = (t as Element).closest?.(`[${POPOVER_ATTR}]`)
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t) && !inPopover) {
        setOpen(false)
        setEditId(null)
      }
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
      setEditId(null)
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
    return { ids, sel: ids.filter((id) => checkedIds.has(id)).length }
  }

  const n = pinnedIds.size
  // What the selection IS, when it's exactly one named group: a geneset first (the user's own
  // name wins), else a pathway / category from the menu's groupings — any tab, any level (a KEGG
  // category counts as the union of its pathways). Null for an ad-hoc selection.
  const selectionName = useMemo((): string | null => {
    if (pinnedIds.size === 0) return null
    const same = (ids: Iterable<string>): boolean => {
      const set = new Set(ids)
      if (set.size !== pinnedIds.size) return false
      for (const id of set) if (!pinnedIds.has(id)) return false
      return true
    }
    for (const gs of geneSets) if (same(gs.genes.map((g) => g.id))) return gs.name
    for (const t of tabs)
      for (const c of t.categories) {
        if (c.genes && same(c.genes.map((g) => g.id))) return c.name
        for (const pw of c.pathways ?? []) if (same(pw.genes.map((g) => g.id))) return pw.name
        if (c.pathways && same(c.pathways.flatMap((pw) => pw.genes.map((g) => g.id)))) return c.name
      }
    return null
  }, [pinnedIds, geneSets, tabs])
  const box = (sel: number, total: number, onClick: () => void, title: string): ReactNode => {
    const allOn = sel === total && total > 0
    return (
      <button
        title={title}
        onClick={onClick}
        style={{
          ...styles.box,
          // Empty: muted-text ink, not the border grey, which vanishes on the editing tint.
          border: `1px solid ${sel > 0 ? p.accent : p.textMuted}`,
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
        const on = checkedIds.has(g.id)
        return (
          <label
            key={g.id}
            style={{
              ...styles.geneRow,
              paddingLeft: indent,
              color: p.text,
              ...(on ? { background: `${p.accent}22` } : {})
            }}
            onMouseEnter={() => useSelection.getState().setHover(g.id)}
            onMouseLeave={() => useSelection.getState().clearHover()}
          >
            <input
              type="checkbox"
              checked={on}
              onChange={() => toggleIds([g.id])}
              style={{ accentColor: p.accent }}
            />
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
        {selectionName ? (
          // A named selection: its name (cut short in the nav, whole on hover) and the count.
          <span style={styles.triggerName} title={`${selectionName} (${n})`}>
            <span style={styles.triggerNameText}>{selectionName}</span>
            <span style={styles.triggerCount}>({n})</span>
          </span>
        ) : (
          <span>{n > 0 ? `${n} gene${n > 1 ? 's' : ''} selected` : 'Select genes'}</span>
        )}
        <Chevron deg={open ? -90 : 90} />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              ...styles.menu,
              left: menuLeft,
              top: rect.bottom + 4,
              width: MENU_W,
              // While a geneset is being edited the whole window takes an accent tint: its
              // checkboxes are changing the set, not the selection.
              background: editSet
                ? `linear-gradient(${p.accent}26, ${p.accent}26), ${p.panel}`
                : p.panel,
              border: `1px solid ${editSet ? p.accent : p.border}`
            }}
          >
            {/* Custom genesets — saved gene selections. Click a name to load it (replacing the current
                selection); per-row Rename / Edit genes (the only way a set's genes change) / Delete. */}
            <div style={{ ...styles.gsSection, borderColor: p.border }}>
              <div style={styles.gsHead}>
                <span style={{ ...styles.gsTitle, color: p.textMuted }}>Custom genesets</span>
              </div>
              {/* Cap the visible list to ~10 rows; scroll beyond. Expanded member lists scroll too. */}
              <div style={styles.gsList}>
                {geneSets.map((gs) => {
                  const ids = gs.genes.map((g) => g.id)
                  const active =
                    ids.length > 0 &&
                    ids.length === pinnedIds.size &&
                    ids.every((id) => pinnedIds.has(id))
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
                          style={{
                            ...styles.gsInput,
                            background: p.panelAlt,
                            color: p.text,
                            border: `1px solid ${p.border}`
                          }}
                        />
                        <button
                          onClick={() => commitRename(gs.id)}
                          style={{ ...styles.gsIcon, color: p.accent }}
                          title="Save"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => setRenameId(null)}
                          style={{ ...styles.gsIcon, color: p.textMuted }}
                          title="Cancel"
                        >
                          ✕
                        </button>
                      </div>
                    )
                  const expanded = openGs.has(gs.id)
                  return (
                    <div key={gs.id}>
                      <div
                        className="oe-gs-row"
                        style={{
                          ...styles.gsRow,
                          ...(active || editId === gs.id ? { background: `${p.accent}22` } : {}),
                          ...(editId === gs.id ? { boxShadow: `inset 2px 0 0 ${p.accent}` } : {})
                        }}
                        onMouseLeave={() => setConfirm((c) => (c?.id === gs.id ? null : c))}
                      >
                        <button
                          onClick={() => toggleIn(openGs, setOpenGs, gs.id)}
                          title={expanded ? 'Collapse' : 'Show its genes'}
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
                        {/* Colour: the set's point colour on volcano / MA / scatter while it's the
                            selection. The plot settings' picker (same grid, same clear chip), on a
                            chip drawn like the legend's — hatched while unset. */}
                        <ColorPicker
                          value={gs.color ?? CLEAR}
                          onPick={(c) => setGeneSetColor(gs.id, c)}
                          onClear={() => setGeneSetColor(gs.id, undefined)}
                          clearLabel="No colour (the plot's default)"
                          label={`${gs.name} colour`}
                          title={
                            gs.color
                              ? 'Point colour on volcano / MA / scatter — click to change'
                              : 'Set a point colour for this geneset on volcano / MA / scatter'
                          }
                          // Unset: a slash on the panel colour — its own fill and a stronger ink, so it
                          // still reads on a selected (tinted) row.
                          triggerStyle={{
                            ...styles.gsSwatch,
                            // Muted-text outline either way: a pale or panel-like colour still has an edge.
                            border: `1px solid ${p.textMuted}`,
                            background:
                              gs.color ??
                              `linear-gradient(to bottom right, transparent 42%, ${p.textMuted} 42%, ${p.textMuted} 58%, transparent 58%), ${p.panel}`
                          }}
                        >
                          <span />
                        </ColorPicker>
                        <button
                          onClick={() => setPins(ids)}
                          title={`Load ${gs.genes.length} gene${gs.genes.length > 1 ? 's' : ''}`}
                          style={{
                            ...styles.gsLoad,
                            color: p.text,
                            fontWeight: active ? 700 : 500
                          }}
                        >
                          <span
                            style={{
                              ...styles.label,
                              ...(gs.hidden
                                ? { textDecoration: 'line-through', opacity: 0.55 }
                                : {})
                            }}
                          >
                            {gs.name}
                          </span>
                          <span style={{ ...styles.gsCount, color: p.textMuted }}>
                            {gs.genes.length}
                          </span>
                        </button>
                        {/* Always shown while editing (the row's actions only show on hover), and
                            the way out: click to finish. */}
                        {editId === gs.id && (
                          <button
                            onClick={() => setEditId(null)}
                            title="Editing this geneset from the gene list — click to finish"
                            style={{ ...styles.editBadge, background: p.accent, color: p.panel }}
                          >
                            Editing
                          </button>
                        )}
                        <span
                          className="oe-gs-actions"
                          // Always shown while this set is edited (hover-only otherwise), so the
                          // confirming tick is in view. Inline display outranks the hover CSS.
                          style={{
                            ...styles.gsActions,
                            ...(editId === gs.id
                              ? { display: 'inline-flex', alignItems: 'center' }
                              : null)
                          }}
                        >
                          <button
                            onMouseEnter={(e) => showTip(e, gs.id, 'rename')}
                            onMouseLeave={() => setTip(null)}
                            onClick={() => {
                              setNameDraft(gs.name)
                              setCreating(null)
                              setRenameId(gs.id)
                            }}
                            style={{ ...styles.gsAct, color: p.textMuted }}
                          >
                            <IconRename />
                          </button>
                          <button
                            onMouseEnter={(e) => showTip(e, gs.id, 'edit')}
                            onMouseLeave={() => setTip(null)}
                            onClick={() =>
                              editId === gs.id ? setEditId(null) : startEdit(gs.id, ids)
                            }
                            style={{
                              ...styles.gsAct,
                              color: editId === gs.id ? p.accent : p.textMuted,
                              background: editId === gs.id ? `${p.accent}22` : undefined
                            }}
                          >
                            {/* Editing: the pencil turns into a tick — click to confirm and finish. */}
                            {editId === gs.id ? <IconCheck /> : <IconEditGenes />}
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
                      {/* Expanded: member genes with a (checked) box — while the set is being edited,
                          un-checking removes the gene; otherwise read-only. Hovering highlights it
                          across every plot/table. */}
                      {expanded && (
                        <div style={styles.gsMembers}>
                          {gs.genes.length === 0 && (
                            <div style={{ ...styles.gsEmpty, color: p.textMuted, paddingLeft: 34 }}>
                              Empty geneset
                            </div>
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
                                  // Only the set being edited can lose genes here; otherwise the
                                  // list just shows what's in it.
                                  disabled={editId !== gs.id}
                                  title={
                                    editId === gs.id
                                      ? 'Remove from the geneset'
                                      : 'Turn on Edit genes (the pencil action) to remove genes'
                                  }
                                  onChange={() => {
                                    const rest = gs.genes.filter((x) => x.id !== g.id)
                                    updateGeneSetGenes(gs.id, rest)
                                    // The set being edited stays the selection (see editSet).
                                    setPins(rest.map((x) => x.id))
                                  }}
                                  style={{ accentColor: p.accent }}
                                />
                                <span style={styles.geneName}>{g.label}</span>
                                {desc && (
                                  <span
                                    style={{ ...styles.geneDesc, color: p.textMuted }}
                                    title={desc}
                                  >
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
              {/* The way to add one: a placeholder row at the end of the list. Clicked, it asks
                  where the genes come from — none yet (then check them in the list below), or the
                  current selection — and then for a name, in the same spot. */}
              {creating ? (
                <div style={styles.gsRow}>
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitCreate()
                      else if (e.key === 'Escape') setCreating(null)
                    }}
                    placeholder={
                      creating === 'empty'
                        ? 'Name (empty — add genes after)…'
                        : `Name (${n} gene${n > 1 ? 's' : ''})…`
                    }
                    style={{
                      ...styles.gsInput,
                      background: p.panelAlt,
                      color: p.text,
                      border: `1px solid ${p.border}`
                    }}
                  />
                  <button
                    onClick={commitCreate}
                    style={{ ...styles.gsIcon, color: p.accent }}
                    title="Save"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => setCreating(null)}
                    style={{ ...styles.gsIcon, color: p.textMuted }}
                    title="Cancel"
                  >
                    ✕
                  </button>
                </div>
              ) : choosing ? (
                <div style={styles.gsChoose}>
                  <button
                    onClick={() => {
                      setChoosing(false)
                      setNameDraft('')
                      setRenameId(null)
                      setCreating('empty')
                    }}
                    title="Create an empty geneset, then check its genes in the list below"
                    style={{
                      ...styles.gsChoice,
                      color: p.text,
                      background: p.panelAlt,
                      border: `1px solid ${p.border}`
                    }}
                  >
                    Empty
                  </button>
                  <button
                    onClick={() => {
                      setChoosing(false)
                      setNameDraft('')
                      setRenameId(null)
                      setCreating('selection')
                    }}
                    disabled={n === 0}
                    title={
                      n === 0
                        ? 'Select genes first'
                        : `Save the ${n} selected gene${n > 1 ? 's' : ''} as a new geneset`
                    }
                    style={{
                      ...styles.gsChoice,
                      color: p.text,
                      background: p.panelAlt,
                      border: `1px solid ${p.border}`,
                      ...(n === 0 ? styles.gsChoiceOff : null)
                    }}
                  >
                    From selection ({n})
                  </button>
                  <button
                    onClick={() => setChoosing(false)}
                    style={{ ...styles.gsIcon, color: p.textMuted }}
                    title="Cancel"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setChoosing(true)}
                  style={{
                    ...styles.gsPlaceholder,
                    color: p.textMuted,
                    border: `1px dashed ${p.border}`
                  }}
                >
                  + New geneset
                </button>
              )}
            </div>
            {/* Search sits with what it searches: right above the grouping switch and the list. */}
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search genes / pathways…"
              style={{
                ...styles.search,
                background: p.panelAlt,
                color: p.text,
                border: `1px solid ${p.border}`
              }}
            />
            {tabs.length > 1 && (
              // The menu is portalled outside the app root, so the switch gets the theme's
              // variables here (it is styled with them, where the rest of the menu uses `p`).
              <div style={{ ...cssVars(p), display: 'flex' }}>
                <ToggleSwitch
                  fill
                  label="Group genes by"
                  value={activeTab?.key ?? ''}
                  options={tabs.map((t) => ({ value: t.key, label: t.label }))}
                  onChange={setTabKey}
                />
              </div>
            )}
            {activeTab?.variant && activeTab.variant.options.length > 0 && (
              <div style={{ ...styles.variantRow, color: p.textMuted }}>
                Group by
                {/* The app's Select, not the OS popup. Themed via the variables here — the menu
                    is portalled outside the app root. */}
                <div style={{ ...cssVars(p), ...styles.variantSelect }}>
                  <Select
                    value={activeTab.variant.value}
                    options={activeTab.variant.options}
                    onChange={(v) => activeTab.variant?.onChange(v)}
                  />
                </div>
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
                      {box(
                        cat.sel,
                        cat.ids.length,
                        () => toggleIds(cat.ids),
                        editSet ? 'Add all in category to the geneset' : 'Select all in category'
                      )}
                      <button
                        onClick={() => toggleIn(openCat, setOpenCat, c.name)}
                        style={{
                          ...styles.headBtn,
                          color: p.text,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: 0.3
                        }}
                      >
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
                        const sel = ids.filter((id) => checkedIds.has(id)).length
                        const pwOpen = searching || openPath.has(key)
                        return (
                          <div key={key}>
                            <div style={styles.pathHead}>
                              {box(
                                sel,
                                ids.length,
                                () => toggleIds(ids),
                                editSet
                                  ? 'Add all in pathway to the geneset'
                                  : 'Select all in pathway'
                              )}
                              <button
                                onClick={() => toggleIn(openPath, setOpenPath, key)}
                                style={{ ...styles.headBtn, color: p.text, fontWeight: 600 }}
                              >
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
                <div style={{ ...styles.more, color: p.textMuted, paddingLeft: 6 }}>
                  No matching genes
                </div>
              )}
            </div>
            {editSet ? (
              // Editing: finish here, at the end of the list being edited. (Clearing the selection
              // instead would end editing too — see editSet — so it's not offered meanwhile.)
              <button
                onClick={() => setEditId(null)}
                style={{ ...styles.confirm, background: p.accent, color: p.panel }}
              >
                Confirm {editSet.name} ({editSet.genes.length})
              </button>
            ) : (
              n > 0 && (
                <button style={{ ...styles.clear, color: p.textMuted }} onClick={() => clearPins()}>
                  Clear selection ({n})
                </button>
              )
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

function Chevron({
  deg,
  size = 11,
  color = UI.textMuted
}: {
  deg: number
  size?: number
  color?: string
}): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      style={{ flex: '0 0 auto', color, transform: `rotate(${deg}deg)` }}
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
  // The trigger's named-selection label: the name ellipsizes, the count always shows.
  triggerName: { display: 'inline-flex', alignItems: 'baseline', gap: 4, minWidth: 0 },
  triggerNameText: {
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  triggerCount: { color: UI.textMuted, fontWeight: 500, flex: '0 0 auto' },
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 30,
    // Pill: fully rounded ends, with a little more side padding so the text clears the curve.
    padding: '0 14px',
    fontSize: 12,
    fontWeight: 600,
    color: UI.text,
    background: 'transparent',
    border: `1px solid ${UI.border}`,
    borderRadius: 999,
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
  search: {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: 5,
    padding: '5px 8px',
    fontSize: 12
  },
  gsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    paddingBottom: 4,
    borderBottom: '1px solid transparent'
  },
  gsHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '2px 4px'
  },
  gsTitle: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 },
  // The "+ New geneset" placeholder: a dashed row the size of a geneset row, ending the list.
  gsPlaceholder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: 2,
    padding: '3px 6px',
    borderRadius: 4,
    background: 'transparent',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  // …clicked: where the new set's genes come from.
  gsChoose: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, padding: '0 4px' },
  gsChoice: {
    flex: 1,
    minWidth: 0,
    borderRadius: 4,
    padding: '3px 6px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  gsChoiceOff: { opacity: 0.45, cursor: 'not-allowed' },
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
  gsLoad: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: '3px 2px',
    textAlign: 'left',
    fontSize: 12
  },
  gsCount: { flex: '0 0 auto', fontSize: 10, fontWeight: 600 },
  // display is controlled by the injected hover CSS (oe-gs-actions) — do NOT set it inline, or the
  // inline value would override the CSS `display:none` and the actions would always take up width.
  gsActions: { gap: 1, flex: '0 0 auto' },
  // Scrollable geneset list: ~8 rows tall, then scrolls (rows are ~24px each).
  gsList: { maxHeight: 192, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  /** the geneset colour swatch (a small circle the colour input hides behind) */
  // The legend's colour chip (NodeConfigPanel's swatch), at a geneset row's scale.
  gsSwatch: {
    flex: '0 0 auto',
    width: 16,
    height: 13,
    padding: 0,
    borderRadius: 3,
    boxSizing: 'border-box',
    cursor: 'pointer'
  },

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
  gsMemberRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '2px 6px 2px 34px',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer'
  },
  gsIcon: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 12,
    lineHeight: 1,
    padding: '2px 3px'
  },
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
  gsInput: {
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    borderRadius: 5,
    padding: '4px 7px',
    fontSize: 12
  },
  gsEmpty: { fontSize: 11, padding: '2px 6px 4px' },
  // The active tab's own choice (Pathway: which term set), one line under the tab bar.
  variantRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '0 2px' },
  variantSelect: { flex: 1, minWidth: 0, display: 'flex' },

  // The editing set's row badge — always visible, unlike the hover-only actions.
  editBadge: {
    flex: '0 0 auto',
    border: 'none',
    borderRadius: 999,
    padding: '1px 7px',
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    cursor: 'pointer'
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
  geneRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '3px 6px 3px 40px',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer'
  },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // Gene name is capped so a long name can't hide the description; the description fills the rest.
  geneName: {
    flex: '0 1 auto',
    maxWidth: '55%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  geneDesc: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 11
  },
  more: { padding: '3px 6px 3px 40px', fontSize: 11 },
  // The editing mode's confirm, across the foot of the window.
  confirm: {
    border: 'none',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  clear: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 11,
    textAlign: 'left',
    padding: '2px 6px',
    textDecoration: 'underline'
  }
}
