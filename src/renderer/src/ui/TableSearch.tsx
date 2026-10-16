/** A table's search field — the magnifier inside at the left, Esc clears. Shared by the import's
 *  Metadata DB and Settings › Database's cache browser. */
import type { CSSProperties, ReactNode } from 'react'

import { IconSearch } from './GeneSelectMenu'
import { GENE_LIST_STYLES } from './geneListStyles'
import { UI } from './theme'

export function TableSearch({
  value,
  onChange,
  placeholder = 'Search all columns…',
  width = 240,
  title
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number
  title?: string
}): ReactNode {
  return (
    <div style={{ ...GENE_LIST_STYLES.searchWrap, width }}>
      <span style={{ ...GENE_LIST_STYLES.searchIcon, color: UI.textMuted }}>
        <IconSearch />
      </span>
      <input
        style={style}
        value={value}
        placeholder={placeholder}
        title={title}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !value) return
          // Clear rather than close whatever dialog the field sits in.
          e.stopPropagation()
          onChange('')
        }}
      />
    </div>
  )
}

const style: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: UI.panelAlt,
  color: UI.text,
  border: `1px solid ${UI.border}`,
  borderRadius: 5,
  // room on the left for the magnifier
  padding: '4px 9px 4px 26px',
  fontSize: 12
}
