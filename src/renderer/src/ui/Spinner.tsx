import { type CSSProperties } from 'react'

import { UI } from './theme'

// One-time spinner keyframes (self-contained so it works regardless of stylesheet load order).
if (typeof document !== 'undefined' && !document.getElementById('oe-spin-kf')) {
  const el = document.createElement('style')
  el.id = 'oe-spin-kf'
  el.textContent = '@keyframes oe-spin{to{transform:rotate(360deg)}}'
  document.head.appendChild(el)
}

/** Centered buffering spinner, absolutely filling its (positioned) parent. */
export function Spinner({ size = 26 }: { size?: number }) {
  return (
    <div style={wrap}>
      <div
        className="oe-spin"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: `3px solid ${UI.border}`,
          borderTopColor: UI.accent,
          animation: 'oe-spin 0.8s linear infinite'
        }}
      />
    </div>
  )
}

const wrap: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none'
}
