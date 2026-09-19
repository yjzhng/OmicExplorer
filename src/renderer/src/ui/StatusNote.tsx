/**
 * The one way to show a status message inline. Four kinds, each with a fixed icon + colour so the
 * meaning reads at a glance anywhere in the app:
 *   info  — (i) blue: a tip / what to do next
 *   warn  — ⚠ amber: needs attention, nothing is broken yet
 *   error — ⊗ red: something failed
 *   ok    — ✓ green: a result / ready
 * Use it instead of hand-placed "✓ …" / "⚠ …" text.
 */
import type { CSSProperties, ReactNode } from 'react'

import { UI } from './theme'

export type StatusKind = 'info' | 'warn' | 'error' | 'ok'

const COLOR: Record<StatusKind, string> = {
  info: UI.info,
  warn: UI.warn,
  error: UI.err,
  ok: UI.ok
}

const svg = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  style: { flex: '0 0 auto' } as CSSProperties
}

export function StatusIcon({ kind }: { kind: StatusKind }): ReactNode {
  switch (kind) {
    case 'info':
      return (
        <svg {...svg}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 11v6M12 7.5v.5" />
        </svg>
      )
    case 'warn':
      return (
        <svg {...svg}>
          <path d="M12 3.5 2.5 20h19L12 3.5zM12 10v4.5M12 17.5v.5" />
        </svg>
      )
    case 'error':
      return (
        <svg {...svg}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" />
        </svg>
      )
    case 'ok':
      return (
        <svg {...svg}>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )
  }
}

/** Icon + text in the kind's colour. `inline` renders as a span (e.g. beside a section title). */
export function StatusNote({
  kind,
  children,
  inline,
  style
}: {
  kind: StatusKind
  children: ReactNode
  inline?: boolean
  style?: CSSProperties
}): ReactNode {
  const base: CSSProperties = {
    display: inline ? 'inline-flex' : 'flex',
    alignItems: inline ? 'center' : 'flex-start',
    gap: 5,
    fontSize: 11,
    lineHeight: 1.4,
    color: COLOR[kind],
    overflowWrap: 'anywhere',
    ...(inline ? { whiteSpace: 'nowrap' } : { marginTop: 6 }),
    ...style
  }
  return (
    <span style={base}>
      {/* The icon box matches one text line (11px × 1.4) so it centres on the first line of a
          wrapped note and sits level with inline text. */}
      <span style={{ display: 'inline-flex', alignItems: 'center', height: 15 }}>
        <StatusIcon kind={kind} />
      </span>
      <span style={inline ? { lineHeight: '15px' } : undefined}>{children}</span>
    </span>
  )
}
