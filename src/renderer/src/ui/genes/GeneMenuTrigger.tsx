/** The gene menu's trigger pill in the nav, and its portal tooltip for a gene-group row's actions
 *  (see GeneSelectMenu). */
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'

import type { GeneSet } from '../../graph/types'
import { EASE, NOTICE_MS, type Palette } from '../app/theme'
import { Chevron } from '../controls/Chevron'
import { styles } from './geneMenuStyles'

export function GeneMenuTrigger({
  btnRef,
  onClick,
  open,
  editSet,
  nudge,
  selectionName,
  n,
  onConfirm,
  onClear,
  p
}: {
  btnRef: RefObject<HTMLButtonElement | null>
  onClick: () => void
  open: boolean
  /** the gene group being edited, if any */
  editSet: GeneSet | null
  /** the selection just changed from outside the menu (see useSelectionNudge) */
  nudge: { key: number } | null
  /** what the selection IS, when it's exactly one named group */
  selectionName: string | null
  /** how many genes are selected */
  n: number
  onConfirm: () => void
  onClear: () => void
  p: Palette
}): ReactNode {
  return (
    <button
      ref={btnRef}
      onClick={onClick}
      aria-expanded={open}
      style={{
        ...styles.trigger,
        // Open, or editing a group (even with the menu closed): an accent tint, so the button
        // reads as the menu's owner and the edit as still in progress.
        ...(open || editSet ? { background: `${p.accent}22` } : null)
      }}
    >
      {/* The selection just changed from outside the menu: the editing tint, in and out (see
          app.css oe-cue), keyed so each change plays it again. */}
      {nudge && (
        <span
          key={nudge.key}
          aria-hidden
          style={
            {
              ...styles.triggerNudge,
              // the trigger's editing / open tint (accent at 22), deepened: that faint a tint
              // passing in a moment went unseen
              background: `${p.accent}59`,
              animation: `oe-cue ${NOTICE_MS.cue}ms ${EASE.move} both`
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
            onConfirm()
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
            onClear()
          }}
        >
          Clear
        </span>
      )}
      <Chevron deg={open ? -90 : 90} />
    </button>
  )
}

/** The hovered row action's name, portalled to the body so the scrolling list can't crop it. */
export function ActionTip({
  tip,
  text
}: {
  tip: { cx: number; top: number }
  text: string
}): ReactNode {
  return createPortal(
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
      {text}
    </div>,
    document.body
  )
}
