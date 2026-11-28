/** The app's scrolling table box (the import dialog's previews, Settings › Database's browser):
 *  a bordered scroller with its header pinned (ui/useStickyGutter), a short fade on each edge
 *  where rows or columns run on out of view, and optional column-step arrows. Its tables' cells
 *  take ./tableStyles' TABLE. */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'

import { FADE } from './scrollEdges'
import { UI } from './theme'
import { TABLE_SCROLL, useStickyGutter } from './useStickyGutter'

/** A scroll box that shows a soft shadow on any edge where content is scrolled out of view — so
 *  it's clear when the table extends past the visible area. It fills a flex pane, or takes a
 *  height (or max height) from `style`. */
export function ScrollFade({
  children,
  title,
  colNav = false,
  headCenter,
  style
}: {
  children: ReactNode
  /** a heading above the table (needed for colNav, whose arrows share its row) */
  title?: string
  /** arrow buttons, right of the title, that step the view one column left / right — for tables
   *  far wider than the window. Above the table rather than on it, so they never cover a header. */
  colNav?: boolean
  /** controls centred in the heading row, between the title and the column arrows */
  headCenter?: ReactNode
  /** the box's own size (a height or max height) where no flex pane sizes it */
  style?: CSSProperties
}): ReactNode {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useStickyGutter(scrollRef)
  const [edges, setEdges] = useState({ top: false, bottom: false, left: false, right: false })
  // Height of a sticky header (if any) so the top/side fades start below it, not over it.
  const [headerH, setHeaderH] = useState(0)
  // The scrollbars' thickness (horizontal bar's height, vertical bar's width), so the bottom/right
  // fades end at the table's visible edge, not over a scrollbar. 0 where a bar is absent.
  const [bars, setBars] = useState({ x: 0, y: 0 })
  const update = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const thead = el.querySelector('thead')
    setHeaderH((h) => {
      const nh = thead instanceof HTMLElement ? thead.offsetHeight : 0
      return h === nh ? h : nh
    })
    // offset − client size − the two border widths = the bar
    const border = el.clientLeft
    const nb = {
      x: Math.max(0, el.offsetHeight - el.clientHeight - 2 * border),
      y: Math.max(0, el.offsetWidth - el.clientWidth - 2 * border)
    }
    setBars((b) => (b.x === nb.x && b.y === nb.y ? b : nb))
    const next = {
      top: el.scrollTop > 0,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
      left: el.scrollLeft > 0,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    }
    setEdges((prev) =>
      prev.top === next.top &&
      prev.bottom === next.bottom &&
      prev.left === next.left &&
      prev.right === next.right
        ? prev
        : next
    )
  }, [])
  useLayoutEffect(() => {
    update()
    const ro = new ResizeObserver(update)
    if (scrollRef.current) ro.observe(scrollRef.current)
    if (contentRef.current) ro.observe(contentRef.current)
    return () => ro.disconnect()
  }, [update])
  const heading =
    title != null ? (
      <div style={headCenter ? styles.tableHeadCentred : styles.tableHead}>
        <span style={styles.tableTitle}>{title}</span>
        {headCenter && <span style={styles.tableHeadMid}>{headCenter}</span>}
        {colNav && (edges.left || edges.right) && (
          <span style={{ ...styles.colSteps, justifySelf: 'end' }}>
            <ColStep
              dir={-1}
              disabled={!edges.left}
              onStep={() => stepColumn(scrollRef.current, -1)}
            />
            <ColStep
              dir={1}
              disabled={!edges.right}
              onStep={() => stepColumn(scrollRef.current, 1)}
            />
          </span>
        )}
      </div>
    ) : null
  const body = (
    // It fills its pane (flex), scrolling within it.
    <div style={{ ...styles.fadeWrap, ...style }}>
      {/* The scrollbars span only what scrolls — below the sticky header (ui/useStickyGutter). */}
      <div ref={scrollRef} onScroll={update} className={TABLE_SCROLL} style={styles.fadeScroll}>
        <div ref={contentRef}>{children}</div>
      </div>
      {/* Inset by the 1px border and the scrollbars, so each fade sits on the table's visible
          edge (just above the horizontal bar, left of the vertical one). */}
      {edges.top && <div style={{ ...styles.fadeTop, top: headerH + 1, right: 1 + bars.y }} />}
      {edges.bottom && (
        <div style={{ ...styles.fadeBottom, bottom: 1 + bars.x, right: 1 + bars.y }} />
      )}
      {edges.left && <div style={{ ...styles.fadeLeft, top: headerH + 1, bottom: 1 + bars.x }} />}
      {edges.right && (
        <div
          style={{
            ...styles.fadeRight,
            top: headerH + 1,
            right: 1 + bars.y,
            bottom: 1 + bars.x
          }}
        />
      )}
    </div>
  )
  return heading ? (
    <>
      {heading}
      {body}
    </>
  ) : (
    body
  )
}

/** Where each table viewport's column-step scroll is heading while its smooth scroll runs — so a
 *  quick second click steps on from the target instead of re-measuring mid-animation. Cleared when
 *  the scroll ends. */
const stepTarget = new WeakMap<HTMLElement, number>()

/** Step a table viewport by column. The view's LEFT edge always lands on a column's start (never
 *  mid-column). Next (dir 1): the first column not FULLY in view on the right (cut off by the edge,
 *  or past it) comes fully into view — the smallest such step. Previous (dir −1): the column
 *  before the left-most one in view comes in at the left. */
function stepColumn(el: HTMLDivElement | null, dir: 1 | -1): void {
  const table = el?.querySelector('table')
  if (!el || !table) return
  // Each header's span in the viewport's own scroll coordinates (0 = the content's left edge), from
  // its on-screen box: offsetLeft can't be trusted here — the headers are sticky, which makes their
  // offsetParent a box outside the viewport (its border then shifts every column by a pixel).
  const origin = el.getBoundingClientRect().left + el.clientLeft - el.scrollLeft
  const spans = [...table.querySelectorAll<HTMLElement>('thead th')].map((th) => {
    const r = th.getBoundingClientRect()
    return { left: r.left - origin, right: r.right - origin }
  })
  if (spans.length === 0) return
  const at = stepTarget.get(el) ?? el.scrollLeft
  const view = el.clientWidth
  const max = el.scrollWidth - view
  let target: number
  if (dir > 0) {
    const next = spans.find((c) => c.right > at + view + 0.5)
    // the first column start far enough right to show `next` whole
    const fit = next ? spans.find((c) => c.left >= next.right - view - 0.5) : undefined
    target = fit ? fit.left : max
  } else {
    const prev = [...spans].reverse().find((c) => c.left < at - 0.5)
    target = prev ? prev.left : 0
  }
  target = Math.round(Math.max(0, Math.min(max, target)))
  if (target === Math.round(el.scrollLeft)) {
    stepTarget.delete(el)
    return
  }
  stepTarget.set(el, target)
  el.addEventListener('scrollend', () => stepTarget.delete(el), { once: true })
  el.scrollTo({ left: target, behavior: 'smooth' })
}

/** A small round arrow button beside a table's title, for stepping a wide table a column. */
function ColStep({
  dir,
  disabled,
  onStep
}: {
  dir: 1 | -1
  disabled: boolean
  onStep: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onStep}
      disabled={disabled}
      title={dir > 0 ? 'Next column' : 'Previous column'}
      aria-label={dir > 0 ? 'Next column' : 'Previous column'}
      style={{ ...styles.colStep, opacity: disabled ? 0.35 : 1 }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path
          d={dir > 0 ? 'M3.5 1.5 L7 5 L3.5 8.5' : 'M6.5 1.5 L3 5 L6.5 8.5'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  fadeWrap: { position: 'relative', flex: 1, minHeight: 0, display: 'flex' },
  fadeScroll: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    border: `1px solid ${UI.border}`,
    borderRadius: 6
  },
  // the shared fades (./scrollEdges), each 1px in past the box's border
  fadeTop: { ...FADE.top, left: 1 },
  fadeBottom: { ...FADE.bottom, left: 1 },
  fadeLeft: { ...FADE.left, left: 1 },
  fadeRight: FADE.right,
  tableHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  // Title left, the centred controls in the middle, the column arrows right.
  tableHeadCentred: {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    alignItems: 'center',
    gap: 12
  },
  tableTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted
  },
  tableHeadMid: { display: 'inline-flex', alignItems: 'center', gap: 12 },
  colSteps: { display: 'inline-flex', gap: 4 },
  colStep: {
    width: 20,
    height: 20,
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: `1px solid ${UI.border}`,
    background: UI.panel,
    color: UI.text,
    cursor: 'pointer'
  }
}
