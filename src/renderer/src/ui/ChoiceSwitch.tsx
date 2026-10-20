/**
 * Pick one of several options: the pill switch (ToggleSwitch) while there are few, a searchable
 * dropdown — the one-gene picker's look (PagerTrigger), with its ‹ › stepping — once there are more than
 * `PILL_CAP`, so a condition with many levels (compounds, cell lines, a custom axis) doesn't run
 * the pills across the tile.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { IconSearch } from './GeneSelectMenu'
import { GENE_LIST_STYLES } from './geneListStyles'
import { PagerTrigger } from './PagerTrigger'
import { placeMenu } from './placeMenu'
import { PALETTES } from './theme'
import { ToggleSwitch, type ToggleOption } from './ToggleSwitch'
import { useUiTheme } from './useUiTheme'

/** The most options shown as pills; beyond it, the dropdown. */
export const PILL_CAP = 10

export function ChoiceSwitch<V extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  cap = PILL_CAP,
  counter = false
}: {
  value: V
  options: readonly ToggleOption<V>[]
  onChange: (value: V) => void
  /** accessible name; also what the search field says it searches */
  label: string
  size?: 'sm' | 'md'
  /** the most options shown as pills (Infinity: always pills) */
  cap?: number
  /** the dropdown shows the "n/m" position readout (a condition's levels, as the gene pager) */
  counter?: boolean
}): ReactNode {
  if (options.length <= cap)
    return (
      <ToggleSwitch size={size} label={label} value={value} options={options} onChange={onChange} />
    )
  return (
    <ChoicePicker
      value={value}
      options={options}
      onChange={onChange}
      label={label}
      size={size}
      counter={counter}
    />
  )
}

/** An option's text, for the button, the search and the list (labels are text in practice). */
const textOf = <V extends string>(o: ToggleOption<V>): string =>
  typeof o.label === 'string' || typeof o.label === 'number' ? String(o.label) : o.value

function ChoicePicker<V extends string>({
  value,
  options,
  onChange,
  label,
  size,
  counter
}: {
  value: V
  options: readonly ToggleOption<V>[]
  onChange: (value: V) => void
  label: string
  size: 'sm' | 'md'
  counter: boolean
}): ReactNode {
  const p = PALETTES[useUiTheme((s) => s.mode)]
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onResize = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? options.filter((o) => textOf(o).toLowerCase().includes(needle)) : options
  }, [options, q])

  const idx = options.findIndex((o) => o.value === value)
  const current = idx >= 0 ? options[idx] : undefined
  const pickable = options.filter((o) => !o.disabled)
  const many = pickable.length > 1
  // Step to the next / previous pickable option, wrapping.
  const go = (d: number): void => {
    const n = options.length
    for (let k = 1; k <= n; k++) {
      const o = options[(((idx + d * k) % n) + n) % n]
      if (!o.disabled) return onChange(o.value)
    }
  }
  const toggle = (): void => {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setQ('')
    setOpen((o) => !o)
  }

  const place = rect ? placeMenu(rect, MENU_W, MENU_H) : null

  const L = GENE_LIST_STYLES
  const fontSize = size === 'sm' ? 11 : 12
  return (
    <>
      <PagerTrigger
        name={current ? textOf(current) : '—'}
        pos={counter ? { index: idx, total: options.length } : undefined}
        open={open}
        onToggle={toggle}
        btnRef={btnRef}
        onStep={go}
        canStep={many}
        noun={label}
        title={`Pick a ${label} (${options.length})`}
        fontSize={fontSize}
      />
      {open &&
        place &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              ...L.menu,
              ...place,
              width: MENU_W,
              zIndex: 5000,
              background: p.panel,
              border: `1px solid ${p.border}`
            }}
          >
            <div style={L.searchWrap}>
              <span style={{ ...L.searchIcon, color: p.textMuted }}>
                <IconSearch />
              </span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  // Enter takes the first pickable match.
                  const first = e.key === 'Enter' ? filtered.find((o) => !o.disabled) : undefined
                  if (first) {
                    onChange(first.value)
                    setOpen(false)
                  }
                }}
                placeholder={`Search ${options.length} ${label}…`}
                style={{
                  ...L.search,
                  paddingLeft: 26,
                  background: p.panelAlt,
                  color: p.text,
                  border: `1px solid ${p.border}`
                }}
              />
            </div>
            <div
              style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
            >
              {filtered.length === 0 ? (
                <div style={{ ...L.more, paddingLeft: 6, color: p.textMuted }}>No match.</div>
              ) : (
                filtered.map((o) => {
                  const on = o.value === value
                  return (
                    <div
                      key={o.value}
                      role="button"
                      aria-disabled={o.disabled || undefined}
                      title={o.title}
                      onClick={() => {
                        if (o.disabled) return
                        onChange(o.value)
                        setOpen(false)
                      }}
                      style={{
                        ...L.geneRow,
                        paddingLeft: 6,
                        color: p.text,
                        fontWeight: on ? 700 : undefined,
                        ...(on ? { background: `${p.accent}22` } : null),
                        ...(o.disabled ? { opacity: 0.4, cursor: 'default' } : null)
                      }}
                    >
                      <span style={styles.optText}>{o.label}</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

/** The dropdown's width and tallest height. */
const MENU_W = 240
const MENU_H = 360

const styles: Record<string, CSSProperties> = {
  optText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
}
