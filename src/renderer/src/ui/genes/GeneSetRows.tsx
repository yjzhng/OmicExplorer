/** The gene menu's gene-group list rows: the Current selection, a stored group, a new group's name
 *  row, and a group's expanded member genes (see GeneSelectMenu). */
import type { ReactNode } from 'react'

import type { GeneSet } from '../../graph/types'
import type { Palette } from '../app/theme'
import { slashBackground } from '../color/slash'
import { CLEAR, ColorPicker } from '../color/ColorPicker'
import { Chevron } from '../controls/Chevron'
import { useSelection } from '../plot/useSelection'
import { VirtualList } from '../table/VirtualRows'
import {
  Eye,
  IconCheck,
  IconCross,
  IconEditGenes,
  IconRename,
  IconSaveAs,
  IconTrash
} from './GeneMenuIcons'
import { DANGER, SELECTION_ID, SELECTION_NAME } from './geneMenuModel'
import { styles } from './geneMenuStyles'
import type { ArmedConfirm, ActionTipState } from './useGeneRowActions'
import type { GeneSetEditing } from './useGeneSetEditing'
import type { GeneSetNaming } from './useGeneSetNaming'

// A group's member genes, expanded under its row (see the list below).
export function MemberList({
  gs,
  editId,
  editDraft,
  descById,
  p
}: {
  gs: GeneSet
  editId: string | null
  editDraft: (genes: GeneSet['genes']) => void
  descById: Map<string, string>
  p: Palette
}): ReactNode {
  return (
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
}

// The Current selection: a permanent first row, drawn like a group's but not one — its name isn't
// clicked to select or deselect (it IS the selection, so that would be a paradox). Save as stores
// it as a new group; Edit changes it from the gene list, kept on Confirm, put back as it was on
// Cancel. No hide, colour, rename or delete.
export function SelectionRow({
  n,
  expanded,
  onToggleExpand,
  onSaveAs,
  clearPins,
  selectionGenes,
  edit,
  tips,
  descById,
  p
}: {
  /** how many genes are selected */
  n: number
  expanded: boolean
  onToggleExpand: () => void
  onSaveAs: () => void
  clearPins: () => void
  selectionGenes: () => { id: string; label: string }[]
  edit: GeneSetEditing
  tips: ActionTipState
  descById: Map<string, string>
  p: Palette
}): ReactNode {
  const { editId, editSet, startEdit, confirmEdit, cancelEdit, editDraft } = edit
  const { showTip, setTip } = tips
  const editing = editId === SELECTION_ID
  const count = editing && editSet ? editSet.genes.length : n
  return (
    <div>
      <div
        className="oe-gs-row"
        style={{
          ...styles.gsRow,
          ...(editing ? { background: `${p.accent}22` } : {}),
          ...(editing ? { boxShadow: `inset 2px 0 0 ${p.accent}` } : {})
        }}
      >
        <button
          onClick={onToggleExpand}
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
            onClick={onSaveAs}
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
          <MemberList
            gs={
              editing && editSet
                ? editSet
                : { id: SELECTION_ID, name: SELECTION_NAME, genes: selectionGenes() }
            }
            editId={editId}
            editDraft={editDraft}
            descById={descById}
            p={p}
          />
        </div>
      )}
    </div>
  )
}

// A new group's name row — drawn exactly like a group row being renamed: its caret, eye and
// colour swatch (inert until the group exists), the name field, then save / cancel.
export function NewGroupNameRow({
  naming,
  geneSetCount,
  p
}: {
  naming: GeneSetNaming
  /** how many groups are stored (the placeholder name counts on from it) */
  geneSetCount: number
  p: Palette
}): ReactNode {
  const { nameDraft, setNameDraft, commitCreate, setCreating } = naming
  return (
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
        placeholder={`Gene group ${geneSetCount + 1}`}
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
}

// A stored gene group's row: caret, eye, colour, its name (a pick), and the hover-revealed actions
// — or, while renamed, the name field and save / cancel — then its member genes when expanded.
export function GeneSetRow({
  gs,
  active,
  expanded,
  onToggleExpand,
  onPick,
  onToggleHidden,
  onColor,
  onDelete,
  edit,
  naming,
  armed,
  tips,
  descById,
  p
}: {
  /** the group as shown (the edited one's draft while it's edited) */
  gs: GeneSet
  /** shown as selected (see activeSets) */
  active: boolean
  expanded: boolean
  onToggleExpand: () => void
  /** a click on its name: select or deselect it (see toggleGeneSet) */
  onPick: () => void
  onToggleHidden: () => void
  onColor: (color: string | undefined) => void
  onDelete: () => void
  edit: GeneSetEditing
  naming: GeneSetNaming
  armed: ArmedConfirm
  tips: ActionTipState
  descById: Map<string, string>
  p: Palette
}): ReactNode {
  const { editId, startEdit, confirmEdit, cancelEdit, editDraft } = edit
  const { nameDraft, setNameDraft, setRenameId, commitRename, startRename } = naming
  const { setConfirm, armConfirm, isArmed } = armed
  const { showTip, setTip } = tips
  // Renaming happens in the row itself: the name becomes a field and the actions
  // become save / cancel, everything else in place.
  const renaming = naming.renameId === gs.id
  return (
    <div>
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
          onClick={onToggleExpand}
          title={expanded ? 'Collapse' : 'Show its genes'}
          style={styles.gsCaret}
        >
          <Chevron deg={expanded ? 90 : 0} size={9} color={p.textMuted} />
        </button>
        <button
          onClick={onToggleHidden}
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
          onPick={(c) => onColor(c)}
          onClear={() => onColor(undefined)}
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
            onClick={onPick}
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
                ...(gs.hidden ? { textDecoration: 'line-through', opacity: 0.55 } : {})
              }}
            >
              {gs.name}
            </span>
            <span style={{ ...styles.gsCount, color: p.textMuted }}>{gs.genes.length}</span>
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
              ...(editId === gs.id ? { display: 'inline-flex', alignItems: 'center' } : null)
            }}
          >
            <button
              onMouseEnter={(e) => showTip(e, gs.id, 'rename')}
              onMouseLeave={() => setTip(null)}
              // Off while any group is being edited — Confirm first.
              disabled={!!editId}
              onClick={() => startRename(gs.id, gs.name)}
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
                  onDelete()
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
      {expanded && (
        <MemberList gs={gs} editId={editId} editDraft={editDraft} descById={descById} p={p} />
      )}
    </div>
  )
}
