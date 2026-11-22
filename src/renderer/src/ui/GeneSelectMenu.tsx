import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import { slashBackground } from './slash'
import { createPortal } from 'react-dom'

import { useGraph } from '../graph/store'
import { cssVars, EASE, NOTICE_MS, PALETTES, UI } from './theme'
import { Chevron } from './Chevron'
import { GENE_LIST_STYLES } from './geneListStyles'
import { CLEAR, ColorPicker } from './ColorPicker'
import { Select } from './Select'
import { POPOVER_ATTR } from './usePopover'
import { ToggleSwitch } from './ToggleSwitch'
import { commonGenes, selectedGeneSets, useSelection, type GroupCombine } from './useSelection'
import type { GeneSet } from '../graph/types'
import { useUiTheme } from './useUiTheme'
import { VirtualList } from './VirtualRows'

// A geneset row's edit/delete actions are hover-revealed, which needs a :hover rule (inline styles
// can't). Injected once. Using display (not opacity) so hidden actions consume NO width — the
// geneset name then gets the full row width when the row isn't hovered (no premature truncation).
function ensureMenuCss(): void {
  if (typeof document === 'undefined') return
  // (rewritten when present, so a reload of this module brings its rules up to date)
  let el = document.getElementById('oe-gs-css')
  if (!el) {
    el = document.createElement('style')
    el.id = 'oe-gs-css'
    document.head.appendChild(el)
  }
  el.textContent =
    '.oe-gs-row .oe-gs-actions{display:none}' +
    '.oe-gs-row:hover .oe-gs-actions{display:inline-flex;align-items:center;gap:1px}' +
    // The trigger's nudge when the selection changes from outside the menu (a plot click): the pill
    // takes the editing tint, deepened so a moment of it reads — in, held, then out — with nothing
    // drawn outside it.
    '@keyframes oe-gs-nudge{0%,100%{background:transparent}20%,55%{background:var(--oe-nudge-bg)}}'
  // The action-name tooltip is portal-rendered (see ActionTip) so the scroll container can't crop it.
}

/** Two overlapping circles, shaded where the combination keeps genes: both whole (union), or just
 *  their overlap (intersection). */
function CombineIcon({ mode }: { mode: GroupCombine }): ReactNode {
  return (
    <svg width={18} height={12} viewBox="0 0 18 12" aria-hidden>
      <defs>
        <clipPath id="oe-combine-a">
          <circle cx={6} cy={6} r={5} />
        </clipPath>
      </defs>
      {mode === 'union' ? (
        <>
          <circle cx={6} cy={6} r={5} fill="currentColor" fillOpacity={0.35} />
          <circle cx={12} cy={6} r={5} fill="currentColor" fillOpacity={0.35} />
        </>
      ) : mode === 'switch' ? (
        // one group at a time: only the one picked is filled
        <circle cx={6} cy={6} r={5} fill="currentColor" fillOpacity={0.6} />
      ) : (
        <circle
          cx={12}
          cy={6}
          r={5}
          fill="currentColor"
          fillOpacity={0.6}
          clipPath="url(#oe-combine-a)"
        />
      )}
      <circle cx={6} cy={6} r={5} fill="none" stroke="currentColor" strokeWidth={1.2} />
      <circle cx={12} cy={6} r={5} fill="none" stroke="currentColor" strokeWidth={1.2} />
    </svg>
  )
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
function IconCross(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}
export function IconSearch(): ReactNode {
  return (
    <svg {...iconProps()}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
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
/** A box with a plus — save the current selection as a new gene group. */
function IconSaveAs(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10l4 4v5" />
      <path d="M7 3v5h7M18 15v6M15 18h6" />
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

/** A row of the gene tree as shown (see treeRows). */
type TreeRow =
  | { t: 'cat'; key: string; c: GeneCategory }
  | { t: 'group'; key: string; c: GeneCategory; name: string }
  | { t: 'path'; key: string; c: GeneCategory; pw: GenePathway; indent: number }
  | { t: 'gene'; key: string; g: Gene; indent: number }

interface Gene {
  id: string
  label: string
  /** Protein description (UniProt `proteinName`), shown right of the gene name and searchable. */
  desc?: string
}
/** A pathway group of genes. */
export interface GenePathway {
  name: string
  /** the middle level it sits under within its category (KEGG pathway group, Reactome level 2) —
   *  pathways sharing one are shown together under its own header; none = directly in the category */
  group?: string
  genes: Gene[]
}
/** A category's pathways as consecutive runs sharing a middle-level group (or none). */
function runsByGroup(pathways: GenePathway[]): { group?: string; pathways: GenePathway[] }[] {
  const runs: { group?: string; pathways: GenePathway[] }[] = []
  for (const pw of pathways) {
    const last = runs[runs.length - 1]
    if (last && last.group === pw.group) last.pathways.push(pw)
    else runs.push({ group: pw.group, pathways: [pw] })
  }
  return runs
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

/** Shortest search text acted on — one character matches nearly everything. */
const MIN_SEARCH = 2
/** Destructive-action colour (matches the app's red used elsewhere). */
const DANGER = '#e15759'
/** The Current selection row: always first in the gene-group list, never stored, renamed or
 *  deleted. Its id can't clash with a stored group's. */
const SELECTION_ID = '\u0000selection'
const SELECTION_NAME = 'Current selection'

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
  const combine = useSelection((s) => s.groupCombine)
  const setCombine = useSelection((s) => s.setGroupCombine)
  const picked = useSelection((s) => s.pickedGroups)
  const setPicked = useSelection((s) => s.setPickedGroups)
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
  // A nudge on the trigger when the selection changes while the menu is closed — a click on a plot
  // or a table row selects genes, and without it that went unnoticed. `key` restarts the animation
  // on every change.
  const [nudge, setNudge] = useState<{ key: number } | null>(null)
  const prevPins = useRef(pinnedIds)
  const nudgeTimer = useRef<number | null>(null)
  useEffect(() => {
    const prev = prevPins.current
    prevPins.current = pinnedIds
    if (prev === pinnedIds || open) return
    setNudge((x) => ({ key: (x?.key ?? 0) + 1 }))
    if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current)
    nudgeTimer.current = window.setTimeout(() => setNudge(null), NOTICE_MS.cue)
  }, [pinnedIds, open])
  useEffect(
    () => () => {
      if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current)
    },
    []
  )
  const [q, setQ] = useState('')
  const [tabKey, setTabKey] = useState(tabs[0]?.key)
  const [openCat, setOpenCat] = useState<Set<string>>(() => new Set())
  const [openPath, setOpenPath] = useState<Set<string>>(() => new Set())
  // Geneset editing state: `creating` shows the new-name input — under the Current selection row
  // for its Save as ('selection'), at the list's foot for a new empty group ('empty');
  // `renameId` marks the row being renamed.
  const [creating, setCreating] = useState<'selection' | 'empty' | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  // The geneset being edited from the gene list: while set, the list's checkboxes show and change
  // THAT set's members instead of the shared selection — how a set is built without selecting first.
  const [editId, setEditId] = useState<string | null>(null)
  // The edited set's members as edited so far — a draft: the group itself (and every plot, mask
  // and count that reads it) changes only on Confirm; Cancel drops it. Mirrored in a ref for the
  // selection subscription below, which runs before React re-renders.
  const [draft, setDraft] = useState<GeneSet['genes'] | null>(null)
  const draftRef = useRef<GeneSet['genes'] | null>(null)
  const writeDraft = useCallback((genes: GeneSet['genes'] | null): void => {
    draftRef.current = genes
    setDraft(genes)
  }, [])
  // Which genesets are expanded (showing their member genes for un-checking / removal).
  const [openGs, setOpenGs] = useState<Set<string>>(() => new Set())
  // Two-step confirm for Delete: first click arms {id, act}; a second click
  // on the same button within ~3s (or before the mouse leaves the row) commits.
  const [confirm, setConfirm] = useState<{ id: string; act: 'delete' } | null>(null)
  const confirmTimer = useRef<number | null>(null)
  const armConfirm = (id: string, act: 'delete'): void => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    setConfirm({ id, act })
    confirmTimer.current = window.setTimeout(() => setConfirm(null), NOTICE_MS.warn)
  }
  const isArmed = (id: string, act: 'delete'): boolean => confirm?.id === id && confirm.act === act
  // Portal-rendered action tooltip (so the scrollable list can't crop it). Anchored to the hovered
  // icon's screen rect; the text is derived at render time so it flips to "Confirm…" once armed.
  type TipKind = 'rename' | 'edit' | 'delete' | 'saveas'
  const [tip, setTip] = useState<{ id: string; kind: TipKind; cx: number; top: number } | null>(
    null
  )
  const showTip = (e: ReactMouseEvent, id: string, kind: TipKind): void => {
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ id, kind, cx: r.left + r.width / 2, top: r.bottom + 4 })
  }
  const tipText = (t: { id: string; kind: TipKind }): string => {
    if (editId && t.kind !== 'edit') return 'Confirm the gene group being edited first'
    if (t.kind === 'saveas')
      return pinnedIds.size ? 'Save as a new gene group' : 'Nothing selected to save'
    if (t.kind === 'rename') return 'Rename'
    if (t.kind === 'edit') return editId === t.id ? 'Done editing genes' : 'Edit genes'
    return isArmed(t.id, 'delete') ? 'Confirm delete' : 'Delete'
  }
  useEffect(ensureMenuCss, [])
  const activeTab = tabs.find((t) => t.key === tabKey) ?? tabs[0]
  // The active grouping, minus empty pathways and categories (nothing to show or select there).
  const categories = useMemo(
    () =>
      (activeTab?.categories ?? [])
        .map((c) =>
          c.pathways ? { ...c, pathways: c.pathways.filter((pw) => pw.genes.length > 0) } : c
        )
        .filter((c) => (c.genes ?? c.pathways ?? []).length > 0),
    [activeTab]
  )
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
  // The Current selection row's Save as takes the selection; "+ New gene group" starts empty and
  // opens for editing, so its genes are then checked straight off the list below.
  const commitCreate = (): void => {
    const name = nameDraft.trim() || `Gene group ${geneSets.length + 1}`
    const empty = creating !== 'selection' || pinnedIds.size === 0
    const id = createGeneSet(name, empty ? [] : selectionGenes())
    if (empty) startEdit(id)
    setCreating(null)
    setNameDraft('')
  }
  const commitRename = (id: string): void => {
    renameGeneSet(id, nameDraft)
    setRenameId(null)
    setNameDraft('')
  }
  // What the gene list's checkboxes read and write: the edited set's members (the draft), else
  // the selection.
  // (Editing the Current selection: no stored group — its draft is the selection's genes.)
  const storedEdit = useMemo(
    (): GeneSet | null =>
      editId === SELECTION_ID
        ? { id: SELECTION_ID, name: SELECTION_NAME, genes: [] }
        : (geneSets.find((g) => g.id === editId) ?? null),
    [editId, geneSets]
  )
  const editSet = useMemo(
    () => (storedEdit ? { ...storedEdit, genes: draft ?? storedEdit.genes } : null),
    [storedEdit, draft]
  )
  // While a group is edited, the SELECTION is its draft: every view highlights it live through the
  // ordinary selection, and a pick made anywhere else meanwhile — a dot in a plot, a table row, a
  // legend entry — goes into the draft, so a group can be built straight from the plots. The group
  // itself takes the draft only on Confirm; Cancel puts the selection back as it was before.
  // Clearing the selection (a plot's double-click) is undone rather than emptying the draft.
  // The group the subscription below may write to. Cleared synchronously when editing ends from an
  // in-menu action, since the store notifies before React re-renders and unsubscribes.
  const syncTo = useRef<string | null>(null)
  // the selection before editing began, for Cancel
  const before = useRef<string[]>([])
  useEffect(() => {
    syncTo.current = editId
    if (!editId) return
    return useSelection.subscribe((st, prev) => {
      if (st.pinnedIds === prev.pinnedIds || syncTo.current !== editId) return
      const genes = draftRef.current
      if (!genes) return
      const pins = st.pinnedIds
      if (genes.length === pins.size && genes.every((g) => pins.has(g.id))) return
      if (pins.size === 0 && genes.length > 0)
        return useSelection.getState().setPins(genes.map((g) => g.id))
      const kept = genes.filter((g) => pins.has(g.id))
      const have = new Set(kept.map((g) => g.id))
      const added = [...pins]
        .filter((id) => !have.has(id))
        .map((id) => ({ id, label: labelById.get(id) ?? id }))
      writeDraft([...kept, ...added])
    })
  }, [editId, labelById, writeDraft])
  const checkedIds = useMemo(
    () => (editSet ? new Set(editSet.genes.map((g) => g.id)) : pinnedIds),
    [editSet, pinnedIds]
  )
  // Editing starts a draft of the group's members and selects it.
  function startEdit(id: string): void {
    // Read from the store, not this render: a set just created isn't in `geneSets` yet. The
    // Current selection starts from the selection.
    const genes =
      id === SELECTION_ID
        ? selectionGenes()
        : (useGraph.getState().geneSets.find((g) => g.id === id)?.genes ?? [])
    before.current = [...useSelection.getState().pinnedIds]
    writeDraft(genes)
    setEditId(id)
    setPins(genes.map((g) => g.id))
  }
  // A draft edit: the draft and, with it, the selection (the live highlight).
  const editDraft = (genes: GeneSet['genes']): void => {
    writeDraft(genes)
    setPins(genes.map((g) => g.id))
  }
  // Confirm: the draft becomes the group's members — only now does anything that reads the group
  // change. (The Current selection's draft already is the selection: nothing to store.)
  function confirmEdit(): void {
    syncTo.current = null
    if (editId && editId !== SELECTION_ID && draftRef.current)
      updateGeneSetGenes(editId, draftRef.current)
    writeDraft(null)
    setEditId(null)
  }
  // Cancel: drop the draft — the group was never touched — and put the selection back as it was.
  function cancelEdit(): void {
    syncTo.current = null
    writeDraft(null)
    setEditId(null)
    setPins(before.current)
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
    editDraft(genes)
  }
  // A geneset is selected while all its genes are; several can be at once. Intersecting, the
  // picked ones are — while the selection is still the genes they share (a pick made elsewhere
  // since, in a plot or the list, leaves them unpicked).
  const setsOf = (ids: string[]): GeneSet[] =>
    ids.map((id) => geneSets.find((g) => g.id === id)).filter((g): g is GeneSet => !!g)
  const pickedLive =
    combine === 'intersect' &&
    picked.length > 0 &&
    (() => {
      const common = commonGenes(setsOf(picked))
      return common.length === pinnedIds.size && common.every((id) => pinnedIds.has(id))
    })()
  const activeSets = pickedLive
    ? new Set(picked)
    : new Set(
        geneSets
          .filter((gs) => gs.genes.length > 0 && gs.genes.every((g) => pinnedIds.has(g.id)))
          .map((gs) => gs.id)
      )
  /** Switch how picked groups combine, keeping the groups picked: union → their shared genes,
   *  intersect → all their genes; switch keeps the selection as it is (the next pick replaces it). */
  const switchCombine = (mode: GroupCombine): void => {
    if (mode === combine) return
    const sets = [...activeSets]
    setCombine(mode)
    if (mode === 'intersect') {
      setPicked(sets)
      if (sets.length) setPins(commonGenes(setsOf(sets)))
    } else {
      setPicked([])
      if (pickedLive) setPins(setsOf(sets).flatMap((gs) => gs.genes.map((g) => g.id)))
    }
  }
  // The mode button cycles union → intersect → switch.
  const NEXT_COMBINE: Record<GroupCombine, GroupCombine> = {
    union: 'intersect',
    intersect: 'switch',
    switch: 'union'
  }
  const COMBINE_TIP: Record<GroupCombine, string> = {
    union: 'Union: the groups picked select all their genes',
    intersect: 'Intersection: the groups picked select only the genes they share',
    switch: 'Switch: one group at a time — picking a group replaces the selection with it'
  }
  // Select a set → add its genes. Deselect → take them out, except genes another selected set
  // still holds (so overlapping sets stay whole). A set that contains this one doesn't count: it
  // would hold every gene, and the click would do nothing.
  const toggleGeneSet = (id: string): void => {
    const gs = geneSets.find((g) => g.id === id)
    if (!gs) return
    // Intersecting (not while editing a set, whose picks add genes to it): the selection is the
    // genes every picked group shares.
    if (combine === 'intersect' && !editSet) {
      const base = [...activeSets]
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
      setPicked(next)
      setPins(commonGenes(setsOf(next)))
      return
    }
    // Switching (likewise not while editing): the group becomes the selection — or, when it already
    // is exactly the selection, the selection clears.
    if (combine === 'switch' && !editSet) {
      const ids = [...new Set(gs.genes.map((g) => g.id))]
      const exact = ids.length === pinnedIds.size && ids.every((g) => pinnedIds.has(g))
      return exact ? clearPins() : setPins(ids)
    }
    // While editing, this adds (or removes) the group's genes in the one being edited — the
    // selection change flows into it like any other pick.
    const ids = new Set(gs.genes.map((g) => g.id))
    if (!activeSets.has(id)) return setPins([...pinnedIds, ...ids])
    const keep = new Set(
      geneSets
        .filter((o) => o.id !== id && activeSets.has(o.id))
        .filter((o) => ![...ids].every((g) => o.genes.some((og) => og.id === g)))
        .flatMap((o) => o.genes.map((g) => g.id))
    )
    setPins([...pinnedIds].filter((g) => !ids.has(g) || keep.has(g)))
  }
  const [rect, setRect] = useState<{ right: number; bottom: number } | null>(null)
  // The menu stays mounted a moment after closing, so it can animate out (see .oe-menu-in / -out);
  // `menuLeaving` is that moment, ended by its animation.
  const [menuMounted, setMenuMounted] = useState(false)
  if (open && !menuMounted) setMenuMounted(true)
  const menuLeaving = menuMounted && !open
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // The lists shrink to keep the menu inside the window, but never below a few rows: squeezed to
  // nothing they'd leave nothing to see, and the menu — whose content would then fit — nothing to
  // scroll. Past that floor, the menu itself scrolls. The gene groups keep that room even when
  // they're fewer (`reserve`), so a new group has space to land; the tree and the search results
  // hug their content.
  const gsListRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  useShrinkFloor(gsListRef, 88, true)
  useShrinkFloor(listRef, 160)
  useShrinkFloor(resultsRef, 120)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      // A click in a popover opened from the menu (a geneset's colour grid) is not a click away.
      const inPopover = (t as Element).closest?.(`[${POPOVER_ATTR}]`)
      // While a group is edited the menu stays open: clicks out there are picks in the plots,
      // building the group. Confirm (or the Editing badge) finishes.
      if (editId) return
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t) && !inPopover)
        setOpen(false)
    }
    // Only a scroll that moves the trigger detaches the menu from it. Any other scroll is left
    // alone — notably a data table bringing the hovered gene's row into view, which hovering a
    // gene here sets off (that used to close the menu mid-search).
    const onScroll = (e: Event): void => {
      if (editId) return
      const t = e.target
      const moved = t === document || (t instanceof Node && !!t.contains(btnRef.current))
      if (moved) setOpen(false)
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
  }, [open, editId])

  const toggle = (): void => {
    if (open) {
      setTip(null)
      // Closing keeps a group's editing going (the button shows Editing / Confirm); only Confirm
      // ends it.
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

  // Search. The box updates as typed; the filtering follows a deferred copy of the text, so a
  // keystroke never waits on the list. One character matches nearly everything and isn't searched.
  // A search shows matching genes as a flat, capped list above the tabs, and filters the grouped
  // tree below (treeCats), its pathways collapsed. Expanding the whole tree around every match drew
  // tens of thousands of rows per keystroke (one letter matches nearly every GO term) and froze
  // the app.
  const deferredQ = useDeferredValue(q)
  const needle = deferredQ.trim().toLowerCase()
  const searching = needle.length >= MIN_SEARCH
  // Built once per grouping while the menu is open: each gene once, its text lower-cased once.
  const searchIndex = useMemo(() => {
    if (!open) return null
    const genes = new Map<string, { gene: Gene; hay: string }>()
    const addGene = (g: Gene): void => {
      if (!genes.has(g.id))
        genes.set(g.id, { gene: g, hay: `${g.label}\n${g.id}\n${g.desc ?? ''}`.toLowerCase() })
    }
    // Every tab, so the gene results — shown above the tabs — don't depend on which one is open.
    for (const t of tabs)
      for (const c of t.categories) {
        for (const g of c.genes ?? []) addGene(g)
        for (const pw of c.pathways ?? []) for (const g of pw.genes) addGene(g)
      }
    return [...genes.values()]
  }, [open, tabs])
  const found = useMemo(() => {
    if (!searching || !searchIndex) return null
    return { genes: searchIndex.filter((e) => e.hay.includes(needle)).map((e) => e.gene) }
  }, [searching, searchIndex, needle])

  // The tree follows the search too: only categories / groups / pathways holding a matching gene
  // (narrowed to those genes), or whose own name matches (kept whole). Categories and groups open,
  // pathways stay collapsed (see levelOpen), and the chips count the matches.
  const treeCats = useMemo((): GeneCategory[] => {
    if (!found) return categories
    const hit = new Set(found.genes.map((g) => g.id))
    const named = (name?: string): boolean => !!name && name.toLowerCase().includes(needle)
    const narrow = (genes: Gene[]): Gene[] => genes.filter((g) => hit.has(g.id))
    return categories
      .map((c): GeneCategory => {
        if (named(c.name)) return c
        if (c.genes) return { ...c, genes: narrow(c.genes) }
        const pathways = (c.pathways ?? [])
          .map((pw) =>
            named(pw.name) || named(pw.group) ? pw : { ...pw, genes: narrow(pw.genes) }
          )
          .filter((pw) => pw.genes.length > 0)
        return { ...c, pathways }
      })
      .filter((c) => (c.genes ?? c.pathways ?? []).length > 0)
  }, [found, categories, needle])

  // The tree's category and group tallies (selected/total, deduped — for the count chips and
  // tri-state boxes), worked out once per selection (or grouping) change, not
  // on every render — a hover or tooltip re-renders the menu, and these walk every gene.
  const treeTally = useMemo(() => {
    const m = new Map<string, { ids: string[]; sel: number }>()
    if (!open) return m
    const count = (idLists: string[][]): { ids: string[]; sel: number } => {
      const ids = [...new Set(idLists.flat())]
      return { ids, sel: ids.filter((id) => checkedIds.has(id)).length }
    }
    for (const c of treeCats) {
      const pws = c.pathways ?? []
      m.set(
        c.name,
        c.genes
          ? count([c.genes.map((g) => g.id)])
          : count(pws.map((pw) => pw.genes.map((g) => g.id)))
      )
      const byGroup = new Map<string, string[][]>()
      for (const pw of pws)
        if (pw.group) {
          const lists = byGroup.get(pw.group) ?? []
          lists.push(pw.genes.map((g) => g.id))
          byGroup.set(pw.group, lists)
        }
      for (const [g, lists] of byGroup) m.set(`${c.name}::grp::${g}`, count(lists))
    }
    return m
  }, [open, treeCats, checkedIds])

  const n = pinnedIds.size
  // What the selection IS, when it's exactly one named group: a geneset first (the user's own
  // name wins; several genesets read as their count), else a pathway / category from the menu's groupings — any tab, any level (a KEGG
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
    // Several genesets selected together (and nothing else): how many.
    if (pickedLive && picked.length > 1) return `${picked.length} gene groups, shared`
    const sets = selectedGeneSets(pinnedIds, geneSets)
    if (sets.length > 1) return `${sets.length} gene groups`
    for (const t of tabs)
      for (const c of t.categories) {
        if (c.genes && same(c.genes.map((g) => g.id))) return c.name
        for (const pw of c.pathways ?? []) if (same(pw.genes.map((g) => g.id))) return pw.name
        // a middle-level group: the union of its pathways
        const byGroup = new Map<string, string[]>()
        for (const pw of c.pathways ?? [])
          if (pw.group)
            byGroup.set(pw.group, [...(byGroup.get(pw.group) ?? []), ...pw.genes.map((g) => g.id)])
        for (const [g, ids] of byGroup) if (same(ids)) return g
        if (c.pathways && same(c.pathways.flatMap((pw) => pw.genes.map((g) => g.id)))) return c.name
      }
    return null
  }, [pinnedIds, geneSets, tabs, pickedLive, picked.length])
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
  // While searching, categories and groups open by themselves (pathways stay collapsed — their genes
  // are what would run to thousands of rows; categories and groups page their pathways). A level
  // collapsed during a search stays collapsed until the search text changes; clearing the search
  // goes back to what was open before.
  const [searchShut, setSearchShut] = useState<{ needle: string; keys: Set<string> }>({
    needle: '',
    keys: new Set()
  })
  const shut = searchShut.needle === needle ? searchShut.keys : null
  const levelOpen = (key: string, opened: Set<string>): boolean =>
    found ? !shut?.has(key) : opened.has(key)
  const toggleLevel = (
    key: string,
    opened: Set<string>,
    setOpened: (s: Set<string>) => void
  ): void => {
    if (!found) return toggleIn(opened, setOpened, key)
    const keys = new Set(shut ?? [])
    if (keys.has(key)) keys.delete(key)
    else keys.add(key)
    setSearchShut({ needle, keys })
  }
  // The tree as the rows it shows, in order — categories, groups, pathways and the genes of the
  // open ones — so it renders as one windowed list (ui/VirtualRows): however many pathways a
  // category holds (GO puts thousands straight under each aspect) or genes a pathway, every row
  // is reachable by scrolling and only those in view are drawn.
  const treeRows = useMemo((): TreeRow[] => {
    const rows: TreeRow[] = []
    const genes = (parent: string, gs: Gene[], indent: number): void => {
      for (const g of gs) rows.push({ t: 'gene', key: `${parent}//${g.id}`, g, indent })
    }
    const pathway = (c: GeneCategory, pw: GenePathway, head: number, geneIndent: number): void => {
      const key = `${c.name}::${pw.name}`
      rows.push({ t: 'path', key, c, pw, indent: head })
      if (openPath.has(key)) genes(key, pw.genes, geneIndent)
    }
    for (const c of treeCats) {
      rows.push({ t: 'cat', key: c.name, c })
      if (!levelOpen(c.name, openCat)) continue
      if (c.genes) {
        genes(c.name, c.genes, 26)
        continue
      }
      // Pathways in order, a run sharing a middle-level group gathered under its own header (one
      // more indent level); ungrouped ones sit directly in the category.
      for (const run of runsByGroup(c.pathways ?? [])) {
        if (!run.group) {
          for (const pw of run.pathways) pathway(c, pw, 18, 40)
          continue
        }
        const gKey = `${c.name}::grp::${run.group}`
        rows.push({ t: 'group', key: gKey, c, name: run.group })
        if (levelOpen(gKey, openPath)) for (const pw of run.pathways) pathway(c, pw, 32, 54)
      }
    }
    return rows
    // levelOpen reads found / shut, listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeCats, openCat, openPath, found, shut])
  const treeKey = useCallback((i: number) => treeRows[i].key, [treeRows])
  // One pathway's header row (box, toggle, count), at a given indent (deeper when it sits under a
  // middle-level group); its genes, open, are rows of their own.
  const pathwayRow = (key: string, pw: GenePathway, headIndent: number): ReactNode => {
    const ids = pw.genes.map((g) => g.id)
    const sel = ids.filter((id) => checkedIds.has(id)).length
    const pwOpen = openPath.has(key)
    return (
      <div key={key} style={{ ...styles.pathHead, paddingLeft: headIndent }}>
        {box(
          sel,
          ids.length,
          () => toggleIds(ids),
          editSet ? 'Add all in pathway to the gene group' : 'Select all in pathway'
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
    )
  }
  // A gene's checkbox row, shared by flat categories, pathways and the search results (differing
  // only in left indent). Checking a gene pins it into the shared selection.
  const geneRow = (g: Gene, indent: number, key: string = g.id): ReactNode => {
    const on = checkedIds.has(g.id)
    return (
      <label
        key={key}
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
  }
  // One row of the tree (see treeRows).
  const treeRow = (r: TreeRow): ReactNode => {
    if (r.t === 'gene') return geneRow(r.g, r.indent, r.key)
    if (r.t === 'path') return pathwayRow(r.key, r.pw, r.indent)
    if (r.t === 'group') {
      const g = treeTally.get(r.key) ?? { ids: [], sel: 0 }
      const gOpen = levelOpen(r.key, openPath)
      return (
        <div key={r.key} style={styles.pathHead}>
          {box(
            g.sel,
            g.ids.length,
            () => toggleIds(g.ids),
            editSet ? 'Add all in group to the gene group' : 'Select all in group'
          )}
          <button
            onClick={() => toggleLevel(r.key, openPath, setOpenPath)}
            style={{ ...styles.headBtn, color: p.text, fontWeight: 700 }}
          >
            <Chevron deg={gOpen ? 90 : 0} size={9} color={p.textMuted} />
            <span style={styles.label}>{r.name}</span>
          </button>
          {chip(g.sel, g.ids.length)}
        </div>
      )
    }
    const c = r.c
    const cat = treeTally.get(c.name) ?? { ids: [], sel: 0 }
    const catOpen = levelOpen(c.name, openCat)
    return (
      <div key={r.key} style={styles.catHead}>
        {box(
          cat.sel,
          cat.ids.length,
          () => toggleIds(cat.ids),
          editSet ? 'Add all in category to the gene group' : 'Select all in category'
        )}
        <button
          onClick={() => toggleLevel(c.name, openCat, setOpenCat)}
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
    )
  }

  // A group's member genes, expanded under its row (see the list below).
  const memberList = (gs: GeneSet): ReactNode => (
    <div style={styles.gsMembers}>
      {gs.genes.length === 0 && (
        <div style={{ ...styles.gsEmpty, color: p.textMuted, paddingLeft: 34 }}>
          {gs.id === SELECTION_ID ? 'Nothing selected' : 'Empty gene group'}
        </div>
      )}
      <VirtualList
        count={gs.genes.length}
        style={styles.rows}
        row={(i) => {
          const g = gs.genes[i]
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
                    ? 'Remove from the gene group'
                    : 'Turn on Edit genes (the pencil action) to remove genes'
                }
                onChange={() => {
                  const rest = gs.genes.filter((x) => x.id !== g.id)
                  editDraft(rest)
                }}
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
        }}
      />
    </div>
  )
  // The Current selection: a permanent first row, drawn like a group's but not one — its name isn't
  // clicked to select or deselect (it IS the selection, so that would be a paradox). Save as stores
  // it as a new group; Edit changes it from the gene list, kept on Confirm, put back as it was on
  // Cancel. No hide, colour, rename or delete.
  const selectionRow = (): ReactNode => {
    const editing = editId === SELECTION_ID
    const expanded = openGs.has(SELECTION_ID)
    const count = editing && editSet ? editSet.genes.length : n
    return (
      <div key={SELECTION_ID}>
        <div
          className="oe-gs-row"
          style={{
            ...styles.gsRow,
            ...(editing ? { background: `${p.accent}22` } : {}),
            ...(editing ? { boxShadow: `inset 2px 0 0 ${p.accent}` } : {})
          }}
        >
          <button
            onClick={() => toggleIn(openGs, setOpenGs, SELECTION_ID)}
            title={expanded ? 'Collapse' : 'Show its genes'}
            style={styles.gsCaret}
          >
            <Chevron deg={expanded ? 90 : 0} size={9} color={p.textMuted} />
          </button>
          {/* Its name: a label, not a pick (see above). */}
          <span style={{ ...styles.gsLoad, color: p.text, cursor: 'default' }}>
            <span style={{ ...styles.label, fontStyle: 'italic' }}>{SELECTION_NAME}</span>
            <span style={{ ...styles.gsCount, color: p.textMuted }}>{count}</span>
            {/* Clear, right of the count. Not offered while editing: clearing the selection would
                end editing too (see editSet), and Confirm is the way out. */}
            {!editSet && n > 0 && (
              <button
                style={{ ...styles.clear, color: p.textMuted }}
                onClick={() => clearPins()}
                title="Clear the selection"
              >
                Clear
              </button>
            )}
          </span>
          {editing && (
            <button
              onClick={confirmEdit}
              title="Editing the selection from the gene list — click to finish"
              style={{ ...styles.editBadge, background: p.accent, color: p.panel }}
            >
              Editing
            </button>
          )}
          <span
            className="oe-gs-actions"
            style={{
              ...styles.gsActions,
              ...(editing ? { display: 'inline-flex', alignItems: 'center' } : null)
            }}
          >
            <button
              onMouseEnter={(e) => showTip(e, SELECTION_ID, 'saveas')}
              onMouseLeave={() => setTip(null)}
              disabled={!!editId || n === 0}
              onClick={() => {
                setNameDraft('')
                setRenameId(null)
                setCreating('selection')
              }}
              style={{
                ...styles.gsAct,
                color: p.textMuted,
                ...(editId || n === 0 ? styles.gsActOff : null)
              }}
            >
              <IconSaveAs />
            </button>
            <button
              onMouseEnter={(e) => showTip(e, SELECTION_ID, 'edit')}
              onMouseLeave={() => setTip(null)}
              disabled={!!editId && !editing}
              onClick={() => (editing ? confirmEdit() : startEdit(SELECTION_ID))}
              style={{
                ...styles.gsAct,
                color: editing ? p.accent : p.textMuted,
                background: editing ? `${p.accent}22` : undefined,
                ...(editId && !editing ? styles.gsActOff : null)
              }}
            >
              {editing ? <IconCheck /> : <IconEditGenes />}
            </button>
            {editing && (
              <button
                onClick={cancelEdit}
                title="Cancel: put the selection back as it was"
                aria-label="Cancel editing the selection"
                style={{ ...styles.gsAct, color: p.textMuted }}
              >
                <IconCross />
              </button>
            )}
          </span>
        </div>
        {/* Pinned, so its genes scroll in a box of their own rather than pushing the groups away. */}
        {expanded && (
          <div style={styles.gsSelMembers}>
            {memberList(
              editing && editSet
                ? editSet
                : { id: SELECTION_ID, name: SELECTION_NAME, genes: selectionGenes() }
            )}
          </div>
        )}
      </div>
    )
  }
  // A new group's name row — drawn exactly like a group row being renamed: its caret, eye and
  // colour swatch (inert until the group exists), the name field, then save / cancel.
  const nameRow = (): ReactNode => (
    <div style={{ ...styles.gsRow, ...styles.gsFoot }}>
      <span style={{ ...styles.gsCaret, cursor: 'default' }}>
        <Chevron deg={0} size={9} color={p.textMuted} />
      </span>
      <span style={{ ...styles.gsEye, color: p.textMuted, cursor: 'default' }}>
        <Eye off={false} />
      </span>
      <span
        style={{
          ...styles.gsSwatch,
          display: 'inline-block',
          boxSizing: 'border-box',
          border: `1px solid ${p.textMuted}`,
          background: slashBackground(p.textMuted, p.panel),
          cursor: 'default'
        }}
      />
      <input
        autoFocus
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitCreate()
          else if (e.key === 'Escape') setCreating(null)
        }}
        // The name it gets if left blank (see commitCreate).
        placeholder={`Gene group ${geneSets.length + 1}`}
        style={{
          ...styles.gsRenameInput,
          background: p.panelAlt,
          color: p.text,
          border: `1px solid ${p.border}`
        }}
      />
      <span style={styles.gsRenameActs}>
        <button onClick={commitCreate} style={{ ...styles.gsAct, color: p.accent }} title="Save">
          <IconCheck />
        </button>
        <button
          onClick={() => setCreating(null)}
          style={{ ...styles.gsAct, color: p.textMuted }}
          title="Cancel"
        >
          <IconCross />
        </button>
      </span>
    </div>
  )
  return (
    <div style={{ flex: '0 0 auto' }}>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-expanded={open}
        style={{
          ...styles.trigger,
          // Open, or editing a group (even with the menu closed): an accent tint, so the button
          // reads as the menu's owner and the edit as still in progress.
          ...(open || editSet ? { background: `${p.accent}22` } : null)
        }}
      >
        {/* The selection just changed from outside the menu: the editing tint, in and out (see
            ensureMenuCss), keyed so each change plays it again. */}
        {nudge && (
          <span
            key={nudge.key}
            aria-hidden
            style={
              {
                ...styles.triggerNudge,
                // the trigger's editing / open tint (accent at 22), deepened: that faint a tint
                // passing in a moment went unseen
                '--oe-nudge-bg': `${p.accent}59`,
                animation: `oe-gs-nudge ${NOTICE_MS.cue}ms ${EASE.move} forwards`
              } as CSSProperties
            }
          />
        )}
        {editSet ? (
          // Editing a group: say so, with the group's name and live count.
          // Centred, not baseline-aligned: the tag is a box, and baselines left it (and with it the
          // name and count) off the Confirm chip's centre line.
          <span
            style={{ ...styles.triggerName, alignItems: 'center', gap: 8 }}
            title={`Editing ${editSet.name} (${editSet.genes.length})`}
          >
            {/* The group row's Editing tag, at the Confirm chip's height so the two line up. */}
            <span
              style={{
                ...styles.editBadge,
                display: 'inline-flex',
                alignItems: 'center',
                height: 18,
                padding: '0 7px',
                cursor: 'inherit',
                background: p.accent,
                color: p.panel
              }}
            >
              Editing
            </span>
            <span style={styles.triggerNameText}>{editSet.name}</span>
            <span style={styles.triggerCount}>({editSet.genes.length})</span>
          </span>
        ) : selectionName ? (
          // A named selection: its name (cut short in the nav, whole on hover) and the count.
          <span style={styles.triggerName} title={`${selectionName} (${n})`}>
            <span style={styles.triggerNameText}>{selectionName}</span>
            <span style={styles.triggerCount}>({n})</span>
          </span>
        ) : (
          <span>{n > 0 ? `${n} gene${n > 1 ? 's' : ''} highlighted` : 'Highlight genes'}</span>
        )}
        {/* Clear without opening the menu. A span, not a button (no buttons inside a button);
            hidden while a geneset is edited, as the menu's own Clear is. */}
        {/* Editing: finish from here too, without opening the menu. */}
        {editSet && (
          <span
            role="button"
            aria-label={`Confirm ${editSet.name}`}
            title="Finish editing this gene group"
            // The Clear chip's look: it takes Clear's place while editing.
            style={styles.triggerClear}
            onClick={(e) => {
              e.stopPropagation()
              confirmEdit()
            }}
          >
            Confirm
          </span>
        )}
        {n > 0 && !editSet && (
          <span
            role="button"
            aria-label="Clear selection"
            title="Clear selection"
            style={styles.triggerClear}
            onClick={(e) => {
              e.stopPropagation()
              clearPins()
            }}
          >
            Clear
          </span>
        )}
        <Chevron deg={open ? -90 : 90} />
      </button>
      {menuMounted &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            className={menuLeaving ? 'oe-menu-out' : 'oe-menu-in'}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget && menuLeaving) setMenuMounted(false)
            }}
            style={{
              ...styles.menu,
              ...(menuLeaving ? { pointerEvents: 'none' } : null),
              left: menuLeft,
              top: rect.bottom + 4,
              width: MENU_W,
              // Never past the window's bottom edge: the lists inside shrink to fit (a resize
              // closes the menu, so the height read here stays current).
              maxHeight: window.innerHeight - rect.bottom - 4 - 8,
              // While a geneset is being edited the whole window takes an accent tint: its
              // checkboxes are changing the set, not the selection.
              background: editSet
                ? `linear-gradient(${p.accent}26, ${p.accent}26), ${p.panel}`
                : p.panel,
              border: `1px solid ${editSet ? p.accent : p.border}`
            }}
          >
            {/* Custom genesets — saved gene selections. Click a name to add it to the selection (several
                can be selected), and again to take it out; per-row Rename / Edit genes (the only way a set's genes change) / Delete. */}
            <div style={{ ...styles.gsSection, borderColor: p.border }}>
              <div style={styles.gsHead}>
                <span style={{ ...styles.gsTitle, color: p.textMuted }}>Custom gene groups</span>
                <span style={styles.gsHeadEnd}>
                  {/* How picked groups combine: all their genes, only those they share, or one
                      group at a time. Clicked, it moves on to the next mode. */}
                  <button
                    onClick={() => switchCombine(NEXT_COMBINE[combine])}
                    title={`${COMBINE_TIP[combine]} — click for ${NEXT_COMBINE[combine]}`}
                    style={{
                      ...styles.combineBtn,
                      color: combine === 'union' ? p.textMuted : p.accent,
                      borderColor: combine === 'union' ? p.border : p.accent
                    }}
                  >
                    <CombineIcon mode={combine} />
                    {combine}
                  </button>
                </span>
              </div>
              {/* The Current selection, pinned above the groups (it never scrolls away), with its
                  Save as name row under it. */}
              {selectionRow()}
              {creating === 'selection' && nameRow()}
              {/* Cap the visible list to ~10 rows; scroll beyond. Expanded member lists scroll too. */}
              <div ref={gsListRef} style={styles.gsList}>
                {geneSets.map((stored) => {
                  // the group being edited shows its draft (see `draft`)
                  const gs = stored.id === editId && editSet ? editSet : stored
                  const active = activeSets.has(gs.id)
                  const expanded = openGs.has(gs.id)
                  // Renaming happens in the row itself: the name becomes a field and the actions
                  // become save / cancel, everything else in place.
                  const renaming = renameId === gs.id
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
                              : 'Set a point colour for this gene group on volcano / MA / scatter'
                          }
                          // Unset: a slash on the panel colour — its own fill and a stronger ink, so it
                          // still reads on a selected (tinted) row.
                          triggerStyle={{
                            ...styles.gsSwatch,
                            // Muted-text outline either way: a pale or panel-like colour still has an edge.
                            border: `1px solid ${p.textMuted}`,
                            background: gs.color ?? slashBackground(p.textMuted, p.panel)
                          }}
                        >
                          <span />
                        </ColorPicker>
                        {renaming ? (
                          <input
                            autoFocus
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(gs.id)
                              else if (e.key === 'Escape') setRenameId(null)
                            }}
                            style={{
                              ...styles.gsRenameInput,
                              background: p.panelAlt,
                              color: p.text,
                              border: `1px solid ${p.border}`
                            }}
                          />
                        ) : (
                          <button
                            // Several sets can be selected: a click adds the set's genes to the
                            // selection, and clicking a selected set again takes them out.
                            onClick={() => toggleGeneSet(gs.id)}
                            title={
                              active
                                ? 'Deselect this gene group'
                                : `Load ${gs.genes.length} gene${gs.genes.length > 1 ? 's' : ''}`
                            }
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
                        )}
                        {/* Always shown while editing (the row's actions only show on hover), and
                            the way out: click to finish. */}
                        {editId === gs.id && (
                          <button
                            onClick={confirmEdit}
                            title="Editing this gene group from the gene list — click to finish"
                            style={{ ...styles.editBadge, background: p.accent, color: p.panel }}
                          >
                            Editing
                          </button>
                        )}
                        {renaming ? (
                          <span style={styles.gsRenameActs}>
                            <button
                              onClick={() => commitRename(gs.id)}
                              title="Save name"
                              style={{ ...styles.gsAct, color: p.accent }}
                            >
                              <IconCheck />
                            </button>
                            <button
                              onClick={() => setRenameId(null)}
                              title="Cancel"
                              style={{ ...styles.gsAct, color: p.textMuted }}
                            >
                              <IconCross />
                            </button>
                          </span>
                        ) : (
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
                              // Off while any group is being edited — Confirm first.
                              disabled={!!editId}
                              onClick={() => {
                                setNameDraft(gs.name)
                                setCreating(null)
                                setRenameId(gs.id)
                              }}
                              style={{
                                ...styles.gsAct,
                                color: p.textMuted,
                                ...(editId ? styles.gsActOff : null)
                              }}
                            >
                              <IconRename />
                            </button>
                            <button
                              onMouseEnter={(e) => showTip(e, gs.id, 'edit')}
                              onMouseLeave={() => setTip(null)}
                              onClick={() => (editId === gs.id ? confirmEdit() : startEdit(gs.id))}
                              style={{
                                ...styles.gsAct,
                                color: editId === gs.id ? p.accent : p.textMuted,
                                background: editId === gs.id ? `${p.accent}22` : undefined
                              }}
                            >
                              {/* Editing: the pencil turns into a tick — click to confirm and finish. */}
                              {editId === gs.id ? <IconCheck /> : <IconEditGenes />}
                            </button>
                            {editId === gs.id && (
                              <button
                                onClick={cancelEdit}
                                title="Cancel: put the gene group back as it was"
                                aria-label={`Cancel editing ${gs.name}`}
                                style={{ ...styles.gsAct, color: p.textMuted }}
                              >
                                <IconCross />
                              </button>
                            )}
                            <button
                              onMouseEnter={(e) => showTip(e, gs.id, 'delete')}
                              onMouseLeave={() => setTip(null)}
                              disabled={!!editId}
                              onClick={() => {
                                if (isArmed(gs.id, 'delete')) {
                                  deleteGeneSet(gs.id)
                                  setConfirm(null)
                                } else armConfirm(gs.id, 'delete')
                              }}
                              style={{
                                ...styles.gsAct,
                                color: DANGER,
                                background: isArmed(gs.id, 'delete') ? `${DANGER}22` : undefined,
                                ...(editId ? styles.gsActOff : null)
                              }}
                            >
                              {isArmed(gs.id, 'delete') ? <IconCheck /> : <IconTrash />}
                            </button>
                          </span>
                        )}
                      </div>
                      {/* Expanded: member genes with a (checked) box — while the set is being edited,
                          un-checking removes the gene; otherwise read-only. Hovering highlights it
                          across every plot/table. */}
                      {expanded && memberList(gs)}
                    </div>
                  )
                })}
                {/* The way to add one: a placeholder row as the list's last row (it scrolls with the
                    groups, not pinned under them). Clicked, it asks for the new (empty) group's name
                    in the same spot, then opens it for editing — its genes checked in the list below.
                    The selection is saved from its own row (Save as). */}
                {creating === 'empty' ? (
                  nameRow()
                ) : (
                  <button
                    onClick={() => {
                      setNameDraft('')
                      setRenameId(null)
                      setCreating('empty')
                    }}
                    disabled={!!editId}
                    title={editId ? 'Confirm the gene group being edited first' : undefined}
                    style={{
                      ...styles.gsPlaceholder,
                      ...styles.gsFoot,
                      color: p.textMuted,
                      border: `1px dashed ${p.border}`,
                      ...(editId ? styles.gsActOff : null)
                    }}
                  >
                    + New gene group
                  </button>
                )}
              </div>
            </div>
            {/* Search sits with what it searches: right above the grouping switch and the list. */}
            <div style={styles.searchWrap}>
              <span style={{ ...styles.searchIcon, color: p.textMuted }}>
                <IconSearch />
              </span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search genes / pathways…"
                style={{
                  ...styles.search,
                  paddingLeft: 26,
                  background: p.panelAlt,
                  color: p.text,
                  border: `1px solid ${p.border}`
                }}
              />
            </div>
            {found && found.genes.length > 0 && (
              <div ref={resultsRef} style={{ ...styles.results, borderColor: p.border }}>
                <div style={{ ...styles.resultHead, color: p.textMuted }}>
                  Genes ({found.genes.length.toLocaleString()})
                </div>
                <VirtualList
                  count={found.genes.length}
                  style={styles.rows}
                  row={(i) => geneRow(found.genes[i], 6)}
                />
              </div>
            )}
            {/* The grouped tree: its own heading, like Custom gene groups above. */}
            <div style={styles.browseHead}>
              <span style={{ ...styles.gsTitle, color: p.textMuted }}>Browse genome</span>
            </div>
            {tabs.length > 1 && (
              // The menu is portalled outside the app root, so the switch gets the theme's
              // variables here (it is styled with them, where the rest of the menu uses `p`).
              <div style={{ ...styles.variantRow, color: p.textMuted }}>
                <span style={styles.rowLabel}>View by</span>
                <div style={{ ...cssVars(p), ...styles.variantSelect }}>
                  <ToggleSwitch
                    fill
                    label="View genes by"
                    value={activeTab?.key ?? ''}
                    options={tabs.map((t) => ({ value: t.key, label: t.label }))}
                    onChange={setTabKey}
                  />
                </div>
              </div>
            )}
            {activeTab?.variant && activeTab.variant.options.length > 0 && (
              <div style={{ ...styles.variantRow, color: p.textMuted }}>
                <span style={styles.rowLabel}>Group by</span>
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
            <div ref={listRef} style={styles.list}>
              {/* The list keeps its own window, so a scroll re-renders the rows, not this menu. */}
              <VirtualList
                keyOf={treeKey}
                count={treeRows.length}
                style={styles.rows}
                row={(i) => treeRow(treeRows[i])}
              />
              {found && treeCats.length === 0 && (
                <div style={{ ...styles.more, color: p.textMuted, paddingLeft: 6 }}>
                  No matches in this grouping
                </div>
              )}
            </div>
            {editSet && (
              // Editing: finish here, at the end of the list being edited.
              <button
                onClick={confirmEdit}
                style={{ ...styles.confirm, background: p.accent, color: p.panel }}
              >
                Confirm {editSet.name} ({editSet.genes.length})
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
/** Give a scrolling list a shrink floor: `floor` px, or its whole content when that's shorter (so a
 *  short list isn't padded out) — unless `reserve`, which keeps the whole floor as room to grow. Re-applied after every render, as the content changes with it;
 *  written straight to the element (React never sets its min-height), so it costs no re-render.
 *  The content is measured with the old floor lifted: read under it, a list whose content had
 *  shrunk measured as the old floor (scrollHeight is at least the box), so the floor never came
 *  down — and with a border (box-sizing: border-box) it crept down a pixel per render, the menu
 *  visibly shrinking with each keystroke. */
function useShrinkFloor(
  ref: { current: HTMLElement | null },
  floor: number,
  /** keep the floor even when the content is shorter (empty room below it) */
  reserve = false
): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (reserve) {
      el.style.minHeight = `${floor}px`
      return
    }
    el.style.minHeight = ''
    // scrollHeight leaves out the border; min-height (border-box) includes it
    const border = el.offsetHeight - el.clientHeight
    el.style.minHeight = `${Math.min(floor, el.scrollHeight + border)}px`
  })
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
  triggerClear: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 18,
    padding: '0 7px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 600,
    color: UI.textMuted,
    background: UI.panelAlt,
    cursor: 'pointer'
  },
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
    whiteSpace: 'nowrap',
    // (the nudge ring is laid over it)
    position: 'relative'
  },
  // the nudge: the pill's own shape, laid over it (inside its border)
  triggerNudge: { position: 'absolute', inset: 0, borderRadius: 999, pointerEvents: 'none' },
  menu: GENE_LIST_STYLES.menu,
  searchWrap: GENE_LIST_STYLES.searchWrap,
  searchIcon: GENE_LIST_STYLES.searchIcon,
  search: GENE_LIST_STYLES.search,
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
    minHeight: 26,
    padding: '2px 4px'
  },
  // The heading's right end: Clear selection, then the union / intersection switch.
  gsHeadEnd: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  combineBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    background: 'transparent',
    border: '1px solid',
    borderRadius: 5,
    padding: '1px 6px 1px 4px',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer'
  },
  // A heading sitting right on the switch below it: no row height, and the menu's 6px gap pulled in.
  browseHead: { display: 'flex', alignItems: 'center', padding: '4px 4px 0', marginBottom: -4 },
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
  // One box for the list's last row in every state — "+ New gene group" or the new group's name
  // row — so switching between them doesn't nudge anything: a group row's height (20px content +
  // 1px padding each side), 2px below the row above. Never squeezed by the scrolling list.
  gsFoot: { height: 22, marginTop: 2, boxSizing: 'border-box', flexShrink: 0 },
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
  // the pinned Current selection's expanded genes: a few rows, then they scroll
  gsSelMembers: { maxHeight: 120, overflowY: 'auto', flexShrink: 0 },
  gsList: {
    maxHeight: 192,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column'
  },
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
  /** a windowed list's rows (ui/VirtualRows), stacked */
  rows: { display: 'flex', flexDirection: 'column' },
  gsMemberRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '2px 6px 2px 34px',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer'
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
  // The name field while renaming in the row: the name button's footprint, so the row keeps its height.
  gsRenameInput: {
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    // the row's own height (its icons are 20px, the name button ~21px): any taller pushes it
    height: 20,
    borderRadius: 4,
    padding: '0 6px',
    margin: 0,
    fontSize: 12
  },
  gsRenameActs: { display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' },
  gsEmpty: { fontSize: 11, padding: '2px 6px 4px' },
  // The active tab's own choice (Pathway: which term set), one line under the tab bar.
  variantRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '0 2px' },
  variantSelect: { flex: 1, minWidth: 0, display: 'flex' },
  // "View by" / "Group by": one width, so the switch and the dropdown line up.
  rowLabel: { flex: '0 0 48px', whiteSpace: 'nowrap' },

  // The editing set's row badge — always visible, unlike the hover-only actions.
  // Rename / Delete while a group is being edited.
  gsActOff: { opacity: 0.35, cursor: 'not-allowed' },
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

  // Shrinks first (flexShrink above the genesets list's) when the menu meets the window's bottom.
  list: {
    maxHeight: 380,
    flexShrink: 4,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column'
  },
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
  geneRow: GENE_LIST_STYLES.geneRow,
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  geneName: GENE_LIST_STYLES.geneName,
  geneDesc: GENE_LIST_STYLES.geneDesc,
  more: GENE_LIST_STYLES.more,
  // Search results, between the search box and the tabs: their own scroll, shrinking with the
  // menu like the lists.
  results: {
    maxHeight: 280,
    flexShrink: 4,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    borderBottom: '1px solid',
    paddingBottom: 4
  },

  // A search result section's heading (Genes / Pathways & categories).
  resultHead: {
    padding: '6px 6px 2px',
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
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
    padding: '0 2px',
    textDecoration: 'underline'
  }
}
