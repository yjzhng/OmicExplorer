/**
 * The app's one section: a titled block that folds under its title. Settings panels, the selector
 * dialogs and the Settings windows all use it; only the frame differs by `variant`:
 *
 * - `panel` (default) — a settings panel's section, a rule under it;
 * - `dialog` — a selector dialog's section, a rule over it (and, as a rule, `fold={false}`);
 * - `card` — a bordered card in a window (Settings → annotations);
 * - `sub` — a section nested inside another.
 *
 * Open state is the section's own (`defaultOpen`), or the caller's (`open` + `onOpenChange`, e.g.
 * remembered across visits).
 */
import { useState, type CSSProperties, type ReactNode } from 'react'

import { Chevron } from './Chevron'
import { FORM } from './formStyles'
import { InfoTip } from './InfoTip'

export type SectionVariant = 'panel' | 'dialog' | 'card' | 'sub'

const FRAME: Record<SectionVariant, CSSProperties> = {
  panel: FORM.section,
  dialog: FORM.sectionDialog,
  card: FORM.sectionCard,
  sub: FORM.sectionSub
}
const HEAD: Record<SectionVariant, CSSProperties | null> = {
  panel: null,
  dialog: FORM.sectionHeadDialog,
  card: FORM.sectionHeadCard,
  sub: FORM.sectionHeadSub
}

export function Section({
  title,
  subtitle,
  action,
  info,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  fold = true,
  variant = 'panel',
  style,
  children
}: {
  title: string
  /** small note right of the title — muted text (e.g. a cap's current N) or a StatusNote */
  subtitle?: ReactNode
  /** a control at the head's right end (a switch, a button) — outside the fold toggle */
  action?: ReactNode
  /** what the section does, behind an (i) right of the title */
  info?: ReactNode
  /** open on first render; a panel with many sections can start with the later ones folded */
  defaultOpen?: boolean
  /** controlled open state (with `onOpenChange`) */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** false: always open, the title a plain heading (no chevron) */
  fold?: boolean
  variant?: SectionVariant
  /** frame overrides from the caller (e.g. no top rule for a section set beside another) */
  style?: CSSProperties
  children: ReactNode
}): ReactNode {
  // Collapsing is per section and per mount: a config panel can run long (a point plot has the
  // group table, three sub-blocks and the axes), so folding what isn't being edited keeps the rest
  // reachable without scrolling.
  const [ownOpen, setOwnOpen] = useState(defaultOpen)
  const open = !fold || (openProp ?? ownOpen)
  const setOpen = (v: boolean): void => {
    if (openProp === undefined) setOwnOpen(v)
    onOpenChange?.(v)
  }
  const card = variant === 'card'
  const titleStyle: CSSProperties = {
    ...FORM.sectionTitle,
    ...(card ? FORM.sectionTitleCard : null)
  }
  // A text subtitle reads as part of the title, inside the toggle; any other (a Reset button, a
  // StatusNote) sits beside it — a button can't nest in the toggle's button, and a click on it
  // mustn't fold the section.
  const textSub = typeof subtitle === 'string'
  const besideSub = subtitle != null && !textSub
  const heading = (
    <>
      {fold && <Chevron color="currentColor" size={card ? 12 : 9} deg={open ? 90 : 0} />}
      <span style={titleStyle}>{title}</span>
      {textSub && <span style={FORM.sectionSubtitle}>{subtitle}</span>}
    </>
  )
  // `grow`: the toggle fills the head (clicking beside the title folds too); without, it hugs the
  // title so an (i) can follow it.
  const toggle = (grow: boolean): ReactNode =>
    fold ? (
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={open ? `Collapse ${title}` : `Expand ${title}`}
        style={{
          ...FORM.sectionTitleRow,
          ...FORM.sectionToggle,
          ...(grow ? null : { flex: '0 1 auto' })
        }}
      >
        {heading}
      </button>
    ) : (
      <div style={{ ...FORM.sectionTitleRow, ...(grow ? { flex: 1 } : null) }}>{heading}</div>
    )
  return (
    <div style={{ ...FRAME[variant], ...style }}>
      <div style={{ ...FORM.sectionHead, ...HEAD[variant] }}>
        {/* The title row toggles; `action` (a switch, a pill) stays outside it, so using a control
            in the header doesn't fold the section under it. */}
        {info == null && !besideSub ? (
          toggle(true)
        ) : (
          // The (i) and a non-text subtitle beside the title, outside the toggle — inside the
          // button, a click on either would fold the section.
          <div style={{ ...FORM.sectionTitleRow, flex: 1 }}>
            {toggle(false)}
            {besideSub && subtitle}
            {info != null && <InfoTip label={`About ${title}`}>{info}</InfoTip>}
          </div>
        )}
        {action}
      </div>
      {open && (card ? <div style={FORM.sectionBodyCard}>{children}</div> : children)}
    </div>
  )
}
