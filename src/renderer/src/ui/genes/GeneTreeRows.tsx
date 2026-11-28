/** The gene menu's tree rows — category, group and pathway headers and gene rows — and the gene
 *  row the search results share (see GeneSelectMenu). */
import type { ReactNode } from 'react'

import type { Palette } from '../app/theme'
import { Chevron } from '../controls/Chevron'
import { useSelection } from '../plot/useSelection'
import type { Gene, TreeRow } from './geneMenuModel'
import { styles } from './geneMenuStyles'

/** A level's tri-state select-all box. */
function SelectBox({
  sel,
  total,
  onClick,
  title,
  p
}: {
  sel: number
  total: number
  onClick: () => void
  title: string
  p: Palette
}): ReactNode {
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

/** A level's selected-count chip. */
function CountChip({ sel, total, p }: { sel: number; total: number; p: Palette }): ReactNode {
  return (
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
}

// A gene's checkbox row, shared by flat categories, pathways and the search results (differing
// only in left indent). Checking a gene pins it into the shared selection.
export function GeneRow({
  g,
  indent,
  checkedIds,
  toggleIds,
  p
}: {
  g: Gene
  indent: number
  checkedIds: Set<string>
  toggleIds: (ids: string[]) => void
  p: Palette
}): ReactNode {
  const on = checkedIds.has(g.id)
  return (
    <label
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
export function TreeRowView({
  row: r,
  open,
  onToggle,
  tally,
  checkedIds,
  toggleIds,
  editing,
  p
}: {
  row: TreeRow
  /** a category / group / pathway row is open (see useGeneTree's rowOpen) */
  open: boolean
  onToggle: () => void
  /** the category and group tallies (see treeTally) */
  tally: Map<string, { ids: string[]; sel: number }>
  checkedIds: Set<string>
  toggleIds: (ids: string[]) => void
  /** a gene group is being edited (the boxes add to it) */
  editing: boolean
  p: Palette
}): ReactNode {
  if (r.t === 'gene')
    return <GeneRow g={r.g} indent={r.indent} checkedIds={checkedIds} toggleIds={toggleIds} p={p} />
  if (r.t === 'path') {
    // One pathway's header row (box, toggle, count), at a given indent (deeper when it sits under
    // a middle-level group); its genes, open, are rows of their own.
    const ids = r.pw.genes.map((g) => g.id)
    const sel = ids.filter((id) => checkedIds.has(id)).length
    return (
      <div style={{ ...styles.pathHead, paddingLeft: r.indent }}>
        <SelectBox
          sel={sel}
          total={ids.length}
          onClick={() => toggleIds(ids)}
          title={editing ? 'Add all in pathway to the gene group' : 'Select all in pathway'}
          p={p}
        />
        <button onClick={onToggle} style={{ ...styles.headBtn, color: p.text, fontWeight: 600 }}>
          <Chevron deg={open ? 90 : 0} size={9} color={p.textMuted} />
          <span style={styles.label}>{r.pw.name}</span>
        </button>
        <CountChip sel={sel} total={ids.length} p={p} />
      </div>
    )
  }
  if (r.t === 'group') {
    const g = tally.get(r.key) ?? { ids: [], sel: 0 }
    return (
      <div style={styles.pathHead}>
        <SelectBox
          sel={g.sel}
          total={g.ids.length}
          onClick={() => toggleIds(g.ids)}
          title={editing ? 'Add all in group to the gene group' : 'Select all in group'}
          p={p}
        />
        <button onClick={onToggle} style={{ ...styles.headBtn, color: p.text, fontWeight: 700 }}>
          <Chevron deg={open ? 90 : 0} size={9} color={p.textMuted} />
          <span style={styles.label}>{r.name}</span>
        </button>
        <CountChip sel={g.sel} total={g.ids.length} p={p} />
      </div>
    )
  }
  const c = r.c
  const cat = tally.get(c.name) ?? { ids: [], sel: 0 }
  return (
    <div style={styles.catHead}>
      <SelectBox
        sel={cat.sel}
        total={cat.ids.length}
        onClick={() => toggleIds(cat.ids)}
        title={editing ? 'Add all in category to the gene group' : 'Select all in category'}
        p={p}
      />
      <button
        onClick={onToggle}
        style={{
          ...styles.headBtn,
          color: p.text,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.3
        }}
      >
        <Chevron deg={open ? 90 : 0} size={9} color={p.textMuted} />
        <span style={styles.label}>{c.name}</span>
      </button>
      <CountChip sel={cat.sel} total={cat.ids.length} p={p} />
    </div>
  )
}
