/** The gene menu's glyphs (see GeneSelectMenu). */
import type { ReactNode } from 'react'

import type { GroupCombine } from '../plot/useSelection'

/** Two overlapping circles, shaded where the combination keeps genes: both whole (union), or just
 *  their overlap (intersection). */
export function CombineIcon({ mode }: { mode: GroupCombine }): ReactNode {
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
export function Eye({ off }: { off: boolean }): ReactNode {
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
export function IconCross(): ReactNode {
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
export function IconRename(): ReactNode {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <path d="M12 4v16M10 4h4M10 20h4" />
    </svg>
  )
}
/** A pencil — edit the set's GENES, by checking them in the gene list below. */
export function IconEditGenes(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M14 7l3 3" />
    </svg>
  )
}
export function IconTrash(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  )
}
/** A box with a plus — save the current selection as a new gene group. */
export function IconSaveAs(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10l4 4v5" />
      <path d="M7 3v5h7M18 15v6M15 18h6" />
    </svg>
  )
}
/** Check — the armed "click again to confirm" state for a destructive action. */
export function IconCheck(): ReactNode {
  return (
    <svg {...iconProps()}>
      <path d="M4 12l5 5L20 6" />
    </svg>
  )
}
