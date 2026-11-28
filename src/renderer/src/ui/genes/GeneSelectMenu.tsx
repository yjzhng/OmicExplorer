import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useGraph } from '../../graph/store'
import { cssVars, PALETTES } from '../app/theme'
import { Select } from '../controls/Select'
import { ToggleSwitch } from '../controls/ToggleSwitch'
import { useSelection } from '../plot/useSelection'
import { useUiTheme } from '../app/useUiTheme'
import { VirtualList } from '../table/VirtualRows'
import { CombineIcon, IconSearch } from './GeneMenuIcons'
import { ActionTip, GeneMenuTrigger } from './GeneMenuTrigger'
import {
  COMBINE_TIP,
  MENU_W,
  NEXT_COMBINE,
  SELECTION_ID,
  toggleIn,
  type GeneGroupTab,
  type TipKind
} from './geneMenuModel'
import { ensureMenuCss, styles } from './geneMenuStyles'
import { GeneSetRow, NewGroupNameRow, SelectionRow } from './GeneSetRows'
import { GeneRow, TreeRowView } from './GeneTreeRows'
import { useGeneGroupPicking } from './useGeneGroupPicking'
import { useMenuPlacement, useSelectionNudge } from './useGeneMenuPopup'
import { useActionTip, useArmedConfirm } from './useGeneRowActions'
import { useGeneSetEditing } from './useGeneSetEditing'
import { useGeneSetNaming } from './useGeneSetNaming'
import { useGeneIndex, useGeneTree } from './useGeneTree'
import { useShrinkFloor } from './useShrinkFloor'

// What other modules take from here (the menu's pieces live in the files beside it).
export { IconSearch } from './GeneMenuIcons'
export type { GeneCategory, GeneGroupTab, GenePathway } from './geneMenuModel'

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
  const nudge = useSelectionNudge(pinnedIds, open)
  const [q, setQ] = useState('')
  const [tabKey, setTabKey] = useState(tabs[0]?.key)
  // Which genesets are expanded (showing their member genes for un-checking / removal).
  const [openGs, setOpenGs] = useState<Set<string>>(() => new Set())
  const armed = useArmedConfirm()
  const tips = useActionTip()
  const { tip, setTip } = tips
  useEffect(ensureMenuCss, [])
  const { activeTab, categories, labelById, descById } = useGeneIndex(tabs, tabKey)
  // The current selection as geneset members (id + captured label).
  const selectionGenes = (): { id: string; label: string }[] =>
    [...pinnedIds].map((id) => ({ id, label: labelById.get(id) ?? id }))
  const edit = useGeneSetEditing({
    geneSets,
    labelById,
    pinnedIds,
    selectionGenes,
    setPins,
    togglePin,
    togglePins,
    updateGeneSetGenes
  })
  const { editId, editSet, checkedIds, confirmEdit, toggleIds } = edit
  const naming = useGeneSetNaming({
    geneSetCount: geneSets.length,
    selectedCount: pinnedIds.size,
    selectionGenes,
    createGeneSet,
    renameGeneSet,
    startEdit: edit.startEdit
  })
  const { creating } = naming
  const { activeSets, selectionName, switchCombine, toggleGeneSet } = useGeneGroupPicking({
    tabs,
    geneSets,
    pinnedIds,
    editing: !!editSet,
    combine,
    picked,
    setCombine,
    setPicked,
    setPins,
    clearPins
  })
  const { rect, menuLeft, menuMounted, setMenuMounted, menuLeaving, btnRef, menuRef, place } =
    useMenuPlacement(open, setOpen, editId)
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

  const toggle = (): void => {
    if (open) {
      setTip(null)
      // Closing keeps a group's editing going (the button shows Editing / Confirm); only Confirm
      // ends it.
      return setOpen(false)
    }
    place()
    setQ('')
    setOpen(true)
  }

  const { found, treeCats, treeTally, treeRows, treeKey, rowOpen, toggleRow } = useGeneTree({
    open,
    tabs,
    categories,
    q,
    checkedIds
  })

  const n = pinnedIds.size
  const tipText = (t: { id: string; kind: TipKind }): string => {
    if (editId && t.kind !== 'edit') return 'Confirm the gene group being edited first'
    if (t.kind === 'saveas')
      return pinnedIds.size ? 'Save as a new gene group' : 'Nothing selected to save'
    if (t.kind === 'rename') return 'Rename'
    if (t.kind === 'edit') return editId === t.id ? 'Done editing genes' : 'Edit genes'
    return armed.isArmed(t.id, 'delete') ? 'Confirm delete' : 'Delete'
  }
  return (
    <div style={{ flex: '0 0 auto' }}>
      <GeneMenuTrigger
        btnRef={btnRef}
        onClick={toggle}
        open={open}
        editSet={editSet}
        nudge={nudge}
        selectionName={selectionName}
        n={n}
        onConfirm={confirmEdit}
        onClear={() => clearPins()}
        p={p}
      />
      {menuMounted &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            data-tour="gene-menu"
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
              <SelectionRow
                key={SELECTION_ID}
                n={n}
                expanded={openGs.has(SELECTION_ID)}
                onToggleExpand={() => toggleIn(openGs, setOpenGs, SELECTION_ID)}
                onSaveAs={() => naming.startCreate('selection')}
                clearPins={clearPins}
                selectionGenes={selectionGenes}
                edit={edit}
                tips={tips}
                descById={descById}
                p={p}
              />
              {creating === 'selection' && (
                <NewGroupNameRow naming={naming} geneSetCount={geneSets.length} p={p} />
              )}
              {/* Cap the visible list to ~10 rows; scroll beyond. Expanded member lists scroll too. */}
              <div ref={gsListRef} style={styles.gsList}>
                {geneSets.map((stored) => {
                  // the group being edited shows its draft (see `draft`)
                  const gs = stored.id === editId && editSet ? editSet : stored
                  return (
                    <GeneSetRow
                      key={gs.id}
                      gs={gs}
                      active={activeSets.has(gs.id)}
                      expanded={openGs.has(gs.id)}
                      onToggleExpand={() => toggleIn(openGs, setOpenGs, gs.id)}
                      onPick={() => toggleGeneSet(gs.id)}
                      onToggleHidden={() => toggleGeneSetHidden(gs.id)}
                      onColor={(c) => setGeneSetColor(gs.id, c)}
                      onDelete={() => deleteGeneSet(gs.id)}
                      edit={edit}
                      naming={naming}
                      armed={armed}
                      tips={tips}
                      descById={descById}
                      p={p}
                    />
                  )
                })}
                {/* The way to add one: a placeholder row as the list's last row (it scrolls with the
                    groups, not pinned under them). Clicked, it asks for the new (empty) group's name
                    in the same spot, then opens it for editing — its genes checked in the list below.
                    The selection is saved from its own row (Save as). */}
                {creating === 'empty' ? (
                  <NewGroupNameRow naming={naming} geneSetCount={geneSets.length} p={p} />
                ) : (
                  <button
                    onClick={() => naming.startCreate('empty')}
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
                  row={(i) => (
                    <GeneRow
                      key={found.genes[i].id}
                      g={found.genes[i]}
                      indent={6}
                      checkedIds={checkedIds}
                      toggleIds={toggleIds}
                      p={p}
                    />
                  )}
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
                row={(i) => {
                  const r = treeRows[i]
                  return (
                    <TreeRowView
                      key={r.key}
                      row={r}
                      open={rowOpen(r)}
                      onToggle={() => toggleRow(r)}
                      tally={treeTally}
                      checkedIds={checkedIds}
                      toggleIds={toggleIds}
                      editing={!!editSet}
                      p={p}
                    />
                  )
                }}
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
      {open && tip && <ActionTip tip={tip} text={tipText(tip)} />}
    </div>
  )
}
