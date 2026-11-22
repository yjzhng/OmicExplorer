/** The User Guide's "Revisit interactive tutorial" button: one bar across the top of the guide, above its
 *  sections. Closes the guide and starts the tour. */
import type { CSSProperties, ReactNode } from 'react'

import { UI } from '../theme'
import { useTutorial } from './useTutorial'

export function PlayTutorial({ onStart }: { onStart: () => void }): ReactNode {
  const start = useTutorial((s) => s.start)
  return (
    <button
      className="oe-press"
      style={s.bar}
      onClick={() => {
        onStart()
        void start()
      }}
    >
      <span style={s.icon} aria-hidden>
        ▶
      </span>
      <span style={s.title}>Revisit interactive tutorial</span>
      <span style={s.text}>A short guided tour on example data: build, run, explore.</span>
    </button>
  )
}

const s: Record<string, CSSProperties> = {
  bar: {
    width: '100%',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 14px',
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    background: UI.panelAlt,
    color: UI.text,
    textAlign: 'left',
    cursor: 'pointer'
  },
  icon: { fontSize: 11, flex: '0 0 auto', color: UI.textMuted },
  title: { fontWeight: 700, fontSize: 13, flex: '0 0 auto' },
  text: {
    fontSize: 12,
    color: UI.textMuted,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  }
}
