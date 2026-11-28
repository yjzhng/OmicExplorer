/** A gene-group row's action helpers (see GeneSelectMenu): the two-step Delete confirm, and the
 *  portal tooltip naming the hovered action. */
import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import { NOTICE_MS } from '../app/theme'
import type { TipKind } from './geneMenuModel'

type Armed = { id: string; act: 'delete' } | null

export interface ArmedConfirm {
  setConfirm: (next: Armed | ((c: Armed) => Armed)) => void
  armConfirm: (id: string, act: 'delete') => void
  isArmed: (id: string, act: 'delete') => boolean
}

// Two-step confirm for Delete: first click arms {id, act}; a second click
// on the same button within ~3s (or before the mouse leaves the row) commits.
export function useArmedConfirm(): ArmedConfirm {
  const [confirm, setConfirm] = useState<Armed>(null)
  const confirmTimer = useRef<number | null>(null)
  const armConfirm = (id: string, act: 'delete'): void => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    setConfirm({ id, act })
    confirmTimer.current = window.setTimeout(() => setConfirm(null), NOTICE_MS.warn)
  }
  const isArmed = (id: string, act: 'delete'): boolean => confirm?.id === id && confirm.act === act
  return { setConfirm, armConfirm, isArmed }
}

export type Tip = { id: string; kind: TipKind; cx: number; top: number }

export interface ActionTipState {
  tip: Tip | null
  setTip: (tip: Tip | null) => void
  showTip: (e: ReactMouseEvent, id: string, kind: TipKind) => void
}

// Portal-rendered action tooltip (so the scrollable list can't crop it). Anchored to the hovered
// icon's screen rect; the text is derived at render time so it flips to "Confirm…" once armed.
export function useActionTip(): ActionTipState {
  const [tip, setTip] = useState<Tip | null>(null)
  const showTip = (e: ReactMouseEvent, id: string, kind: TipKind): void => {
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ id, kind, cx: r.left + r.width / 2, top: r.bottom + 4 })
  }
  return { tip, setTip, showTip }
}
