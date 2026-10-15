/**
 * The condition-row system shared by the Compare and Contrast windows: the window shell, collapsible
 * sections whose (i) carries the hint and a legend, one row per condition (a fold chevron, its name,
 * its switchers, and a two-sided value box under them unless folded), the
 * value chips, the preview table, and how a group of samples reads ("cmpd A · 1 · 8h", with what it
 * pools as a subtitle).
 */
import { type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { condLabel, orderConds, type ConditionKey, type StandardRow } from '../engine'
import { Chevron } from '../ui/Chevron'
import { InfoTip } from '../ui/InfoTip'
import { cssVars, PALETTES, UI } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'
import { valuesOf } from './compareModel'
import { DOCKED_CARD, DOCKED_WRAP, useDialogDock } from './dialogDock'
import { AU, type CondUnits } from './types'
import { selectorStyles as S } from './selectorParts'

/** The window: a modal over the app, or docked into the form workflow's details column. */
export function SelectorShell({
  title,
  mode,
  canApply,
  onApply,
  onClose,
  children
}: {
  title: string
  /** the header's switch (t-test | 2-way ANOVA, intra- | inter-dataset) */
  mode?: ReactNode
  canApply: boolean
  onApply: () => void
  onClose: () => void
  children: ReactNode
}): ReactNode {
  const theme = useUiTheme((s) => s.mode)
  const dock = useDialogDock()
  return createPortal(
    // The theme's CSS variables again inside the portal (document.body is outside the app root).
    <div style={dock ? { ...cssVars(PALETTES[theme]), ...DOCKED_WRAP } : cssVars(PALETTES[theme])}>
      <style>{`.oe-chip:focus{outline:none}.oe-chip:focus-visible{box-shadow:0 0 0 2px var(--accent)}@keyframes oe-fade-in{from{opacity:0.25}to{opacity:1}}`}</style>
      {!dock && <div style={styles.scrim} onClick={onClose} />}
      <div style={dock ? { ...styles.modal, ...DOCKED_CARD } : styles.modal} role="dialog" aria-label={title}>
        <div style={styles.head}>
          <span style={styles.title}>{title}</span>
          <span style={styles.modeSwitch}>{mode}</span>
          <button style={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={styles.body}>{children}</div>
        <div style={styles.foot}>
          <button style={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            style={{ ...styles.apply, ...(canApply ? null : styles.applyDisabled) }}
            disabled={!canApply}
            title={canApply ? undefined : 'Resolve the warnings before applying'}
            onClick={onApply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    dock ?? document.body
  )
}

/** A section: its title with an (i) holding the hint and a legend of
 *  its modes; its rows sit in a grid whose name column is only as wide as the longest name. */
export function Section({
  title,
  hint,
  legend,
  grid = true,
  shade,
  style,
  aside,
  children
}: {
  title: string
  hint?: string
  legend?: Array<[string, string]>
  /** rows in the shared name | body grid (off for free content, e.g. the preview) */
  grid?: boolean
  /** the preview's lighter ground */
  shade?: boolean
  /** e.g. no top rule for a section set beside another */
  style?: CSSProperties
  /** beside the title (e.g. a tip) */
  aside?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <div style={{ ...styles.sec, ...(shade ? styles.secShade : null), ...style }}>
      <div style={styles.shead}>
        <span style={styles.sname}>{title}</span>
        {(hint || legend) && (
          <InfoTip label={`About ${title}`}>
            {hint}
            {legend && (
              <div style={{ marginTop: hint ? 6 : 0 }}>
                {legend.map(([name, text]) => (
                  <div key={name}>
                    <b>{name}</b>: {text}
                  </div>
                ))}
              </div>
            )}
          </InfoTip>
        )}
        {aside}
      </div>
      <div style={grid ? styles.secGrid : styles.secFree}>{children}</div>
    </div>
  )
}

/** One condition's row: a fold chevron and its name, its switchers on the first line, and (unless
 *  folded) the value box under them. */
export function CondRow({
  name,
  toggle,
  badge,
  line,
  folded,
  onFold,
  box,
  swapKey,
  first
}: {
  name: string
  /** a switch right of the name, at the name column's right edge so they line up (Compare's compared on / off) */
  toggle?: ReactNode
  /** a chip opening the body column, after the name (Compare's compared / context condition) */
  badge?: ReactNode
  line?: ReactNode
  /** absent: no chevron (e.g. one value only) — its space is kept, so names line up */
  folded?: boolean
  onFold?: () => void
  box?: ReactNode
  /** what the row is (e.g. compared or context): when it changes, the badge and the box fade in anew */
  swapKey?: string
  /** the section's first row: no rule above it */
  first?: boolean
}): ReactNode {
  return (
    <div style={{ ...styles.row, ...(first ? { borderTop: 'none' } : null) }}>
      <span style={{ ...styles.name, gridRow: 1 }}>
        {onFold ? (
          <button style={styles.fold} aria-expanded={!folded} aria-label={`${folded ? 'Show' : 'Hide'} ${name} values`} onClick={onFold}>
            <Chevron deg={folded ? 0 : 90} size={10} />
          </button>
        ) : (
          <span style={styles.fold} />
        )}
        {name}
        {toggle && <span style={styles.toggle}>{toggle}</span>}
      </span>
      {/* the badge opens the body column, so badges and value boxes share one left edge across rows */}
      <div style={{ ...styles.line, gridColumn: 2, gridRow: 1 }}>
        {badge && (
          <span key={swapKey} style={styles.swap}>
            {badge}
          </span>
        )}
        {line}
      </div>
      {onFold && (
        // always mounted, so opening and folding can slide: the row's height eases between 0 and the box's
        <div style={{ ...styles.foldBody, gridTemplateRows: folded ? '0fr' : '1fr' }} inert={folded}>
          <div style={styles.foldClip}>
            <div key={swapKey} style={{ ...styles.swap, display: 'block', paddingTop: 5 }}>
              {box}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** The two-sided value box: left | right, each a label and its chips. */
export function SidesBox({ left, right }: { left: [string, ReactNode]; right: [string, ReactNode] }): ReactNode {
  const side = ([label, kids]: [string, ReactNode]): ReactNode => (
    <div style={styles.side}>
      <span style={styles.slabel} title={label}>
        {label}
      </span>
      <div style={S.chips}>{kids}</div>
    </div>
  )
  return (
    <div style={styles.sides}>
      {side(left)}
      <div style={styles.vs} />
      {side(right)}
    </div>
  )
}

/** A value chip: picked (accent), matched (green), left out (dashed, struck), plain, or a radio. */
export type ChipLook = 'on' | 'matched' | 'out' | 'plain'
export function ValChip({
  label,
  look,
  radio,
  title,
  onClick,
  disabled,
  width
}: {
  label: string
  look: ChipLook
  radio?: boolean
  title?: string
  onClick?: () => void
  disabled?: boolean
  /** a fixed width (a set of chips normalised to one), label centred */
  width?: number
}): ReactNode {
  const style: CSSProperties = {
    ...S.valChip,
    ...(look === 'on' ? S.valChipOn : look === 'matched' ? S.valChipIncluded : look === 'out' ? styles.chipOut : null),
    ...(disabled ? S.valChipDisabled : null),
    ...(!onClick ? { cursor: 'default' } : null),
    ...(width ? { width, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', paddingLeft: 4, paddingRight: 4 } : null)
  }
  const dot = radio ? <span style={{ ...styles.dot, ...(look === 'on' ? styles.dotOn : null) }} /> : null
  return onClick ? (
    <button className="oe-chip" style={style} title={title} disabled={disabled} onClick={onClick}>
      {dot}
      {label}
    </button>
  ) : (
    <span style={style} title={title}>
      {dot}
      {label}
    </span>
  )
}

/** A row's tag: compared, own control (matched), shared control, pooled, contrasted, matched. */
export function Tag({ kind, children }: { kind: 'cmp' | 'ctx' | 'own' | 'shared' | 'pool'; children: ReactNode }): ReactNode {
  return <span style={{ ...styles.tag, ...TAGS[kind] }}>{children}</span>
}

/** How a group of samples reads in the preview: its conditions in canonical order, one value each;
 *  a condition it merges several values of moves to a subtitle, "pooled: cond first–last (n)". */
export function SideCell({
  rows,
  conds,
  units
}: {
  rows: readonly StandardRow[]
  conds: readonly ConditionKey[]
  /** the imported dose / time units, shown after their values ("10 µM", "8 h"); a.u. shows none */
  units?: CondUnits
}): ReactNode {
  const main: string[] = []
  const sub: string[] = []
  for (const c of orderConds(conds)) {
    const vs = valuesOf(rows, c)
    if (!vs.length) continue
    const u = c === 'dose' ? units?.dose : c === 'time' ? units?.time : undefined
    const unit = u && u !== AU ? ` ${u}` : ''
    if (vs.length === 1) main.push(vs[0] + unit)
    else sub.push(`${condLabel(c)} ${vs[0]}–${vs[vs.length - 1]}${unit} (${vs.length})`)
  }
  return (
    <div>
      {main.join(' · ')}
      {sub.length > 0 && <div style={styles.pooled}>pooled: {sub.join(' · ')}</div>}
    </div>
  )
}

/** The preview table (cells may be nodes): test | vs | control, one row per comparison. */
export function NodeTable({ columns, rows, more }: { columns: string[]; rows: ReactNode[][]; more?: number }): ReactNode {
  return (
    <div style={S.tableOuter}>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              {columns.map((c, j) => (
                <th key={j} style={S.th}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j} style={{ ...S.td, ...styles.tdNode, ...(columns[j] === '' ? S.tdSep : null) }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {!!more && more > 0 && (
              <tr>
                <td colSpan={columns.length} style={{ ...S.td, ...S.tdSep, textAlign: 'left' }}>
                  + {more} more
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const TAGS: Record<'cmp' | 'ctx' | 'own' | 'shared' | 'pool', CSSProperties> = {
  cmp: { background: UI.accent, color: UI.accentText },
  ctx: { background: UI.ok, color: '#fff' },
  own: { background: 'rgba(63,174,90,0.16)', color: UI.ok },
  shared: { background: 'rgba(80,140,200,0.16)', color: UI.info },
  // pooled: the app has no orange token; a fixed orange that reads on both themes
  pool: { background: 'rgba(220,110,30,0.16)', color: '#d0661a' }
}

const styles: Record<string, CSSProperties> = {
  scrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 70 },
  modal: {
    position: 'fixed',
    inset: 0,
    margin: 'auto',
    // a fixed size, so expanding or collapsing a section scrolls the body instead of resizing the window
    width: 860,
    maxWidth: '94vw',
    height: 720,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 71,
    overflow: 'hidden'
  },
  head: { display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: `1px solid ${UI.border}`, background: UI.panelAlt },
  title: { fontWeight: 700, fontSize: 14, color: UI.text },
  modeSwitch: { marginLeft: 'auto', display: 'inline-flex' },
  close: { marginLeft: 12, background: 'transparent', border: 'none', color: UI.textMuted, fontSize: 14, cursor: 'pointer' },
  // the scrollbar's space kept whether or not it shows, so content doesn't shift when it appears
  body: { overflow: 'auto', scrollbarGutter: 'stable', minHeight: 0, flex: 1 },
  foot: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: `1px solid ${UI.border}`, background: UI.panelAlt },
  cancel: { background: 'transparent', color: UI.text, border: `1px solid ${UI.border}`, borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' },
  apply: { background: UI.accent, color: UI.accentText, border: 'none', borderRadius: 6, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  applyDisabled: { opacity: 0.4, cursor: 'not-allowed' },

  sec: { padding: '12px 16px 14px', borderTop: `1px solid ${UI.border}` },
  secShade: { background: UI.bg },
  shead: { display: 'flex', alignItems: 'center', gap: 6 },
  sname: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 },
  // the rows, indented under the title (past the chevron)
  secGrid: { display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 10, marginLeft: 6, marginTop: 8 },
  secFree: { display: 'flex', flexDirection: 'column', gap: 8, marginLeft: 6, marginTop: 8 },
  row: {
    gridColumn: '1 / -1',
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    rowGap: 0,
    padding: '11px 0',
    borderTop: `1px dashed ${UI.border}`,
    alignItems: 'start'
  },
  // centred on the line, whose height varies with what it holds (toggle only, or toggle + context switch)
  name: { gridColumn: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: UI.text, alignSelf: 'center' },
  toggle: { marginLeft: 'auto', paddingLeft: 4, display: 'inline-flex' },
  swap: { display: 'inline-flex', animation: 'oe-fade-in 350ms ease-out' },
  foldBody: { gridColumn: 2, gridRow: 2, minWidth: 0, display: 'grid', transition: 'grid-template-rows 200ms ease' },
  foldClip: { overflow: 'hidden', minHeight: 0 },
  fold: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 12, flex: '0 0 auto', background: 'none', border: 'none', padding: 0, color: UI.textMuted, cursor: 'pointer' },
  line: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0 },
  sides: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 1px minmax(0, 1fr)',
    gap: 10,
    padding: '8px 10px',
    background: UI.bg,
    border: `1px solid ${UI.border}`,
    borderRadius: 6
  },
  vs: { background: UI.border },
  side: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  // one line whatever the mode, so switching it doesn't change the row's height (full text on hover)
  slabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: UI.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  chipOut: { color: UI.textMuted, textDecoration: 'line-through', borderStyle: 'dashed' },
  dot: { display: 'inline-block', width: 7, height: 7, borderRadius: '50%', border: '1px solid currentColor', marginRight: 5, verticalAlign: 0 },
  dotOn: { background: 'currentColor' },
  tag: { fontSize: 10, fontWeight: 'normal', textTransform: 'uppercase', letterSpacing: 0.4, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap' },
  pooled: { color: UI.textMuted, fontStyle: 'italic', fontSize: 10.5, fontFamily: 'inherit' },
  tdNode: { verticalAlign: 'top' }
}
