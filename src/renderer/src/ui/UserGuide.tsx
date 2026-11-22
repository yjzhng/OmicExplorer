/** Sectioned User Guide dialog: a left section list + one scrolling document. The content lives in
 *  `user-guide.md` (edit that, not this file); this renders it, pictures included. */
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'

import {
  FolderTree,
  GroupDiagram,
  Levels,
  MiniTable,
  RunStates,
  ShapePair,
  StepCards
} from './guideVisuals'
import {
  parseGuide,
  parseInline,
  searchGuide,
  searchWords,
  type FixedVisual,
  type GuideBlock,
  type GuideHit
} from './guideMarkdown'
import { GuideUi, TileRow } from './guideUi'
import { LayoutPicker } from '../app/NavBar'
import { PlayTutorial } from './tutorial/PlayTutorial'
import { motion, UI } from './theme'
import guideMd from './user-guide.md?raw'

const SECTIONS = parseGuide(guideMd)

const VISUALS: Record<FixedVisual, () => ReactNode> = {
  layouts: LayoutPicker,
  'run-states': RunStates,
  'protein-groups': GroupDiagram,
  'log-shapes': ShapePair
}

function Block({ block }: { block: GuideBlock }): ReactNode {
  switch (block.type) {
    case 'p':
      return <P>{inline(block.text)}</P>
    case 'h':
      return <H>{inline(block.text)}</H>
    case 'ul':
      return <UL items={block.items.map(inline)} />
    case 'visual': {
      const Visual = VISUALS[block.name]
      return <Visual />
    }
    case 'steps':
      return <StepCards steps={block.steps} />
    case 'tiles':
      return <TileRow tiles={block.tiles} />
    case 'folder':
      return <FolderTree entries={block.entries} />
    case 'table':
      return (
        <MiniTable
          head={block.head}
          kinds={block.kinds}
          rows={block.rows}
          missingZero={block.missingZero}
        />
      )
    case 'levels':
      return <Levels source={block.source} levels={block.levels} />
    case 'unknown':
      return <pre style={styles.unknown}>{block.text}</pre>
  }
}

function inline(text: string): ReactNode {
  return parseInline(text).map((part, i) =>
    part.kind === 'bold' ? (
      <B key={i}>{part.text}</B>
    ) : part.kind === 'code' ? (
      <Code key={i}>{part.text}</Code>
    ) : part.kind === 'ui' ? (
      <GuideUi key={i} name={part.name} />
    ) : (
      <Fragment key={i}>{part.text}</Fragment>
    )
  )
}

export function UserGuide({ onClose }: { onClose: () => void }): ReactNode {
  const [active, setActive] = useState(SECTIONS[0].id)
  const contentRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  // The nav follows the reader: the active entry is the last section whose top has scrolled
  // past the top of the pane (or the last one, once the end is reached).
  const onScroll = (): void => {
    const el = contentRef.current
    if (!el) return
    const top = el.getBoundingClientRect().top + 24
    let current = SECTIONS[0].id
    for (const s of SECTIONS) {
      const node = sectionRefs.current[s.id]
      if (node && node.getBoundingClientRect().top <= top) current = s.id
    }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) current = SECTIONS.at(-1)!.id
    setActive(current)
  }
  const scrollToNode = (node: Element | null | undefined): void => {
    const el = contentRef.current
    if (!el || !node) return
    el.scrollTo({
      top: node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12,
      behavior: 'smooth'
    })
  }
  const jumpTo = (id: string): void => scrollToNode(sectionRefs.current[id])

  // ── search ──
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => searchGuide(SECTIONS, query), [query])
  const searching = searchWords(query).length > 0
  // A hit: scroll its block into view and flash it, so the eye finds it.
  const [flash, setFlash] = useState<string | null>(null)
  const openHit = (h: GuideHit): void => {
    const key = `${h.page.id}:${h.block}`
    scrollToNode(contentRef.current?.querySelector(`[data-guide-block="${key}"]`))
    setFlash(key)
  }
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 1400)
    return () => clearTimeout(t)
  }, [flash])
  // ⌘F / Ctrl+F searches the guide while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Every match marked in the text, with the CSS Custom Highlight API (app.css ::highlight): no
  // change to the rendered tree, so the guide's own elements are left as they are.
  useEffect(() => {
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
    const Hl = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight
    const root = contentRef.current
    if (!registry || !Hl || !root) return
    const words = searchWords(query)
    if (!words.length) {
      registry.delete(GUIDE_HIGHLIGHT)
      return
    }
    const ranges: Range[] = []
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const low = (n.textContent ?? '').toLowerCase()
      for (const w of words)
        for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + w.length)) {
          const r = new Range()
          r.setStart(n, i)
          r.setEnd(n, i + w.length)
          ranges.push(r)
        }
    }
    registry.set(GUIDE_HIGHLIGHT, new Hl(...ranges))
    return () => {
      registry.delete(GUIDE_HIGHLIGHT)
    }
  }, [query])
  return (
    <>
      <div style={styles.scrim} onClick={onClose} />
      <div style={styles.modal} role="dialog" aria-label="User guide">
        <div style={styles.head}>
          <span style={styles.headTitle}>User guide</span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search the guide…"
            aria-label="Search the guide"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) openHit(hits[0])
              else if (e.key === 'Escape' && query) {
                e.stopPropagation()
                setQuery('')
              }
            }}
            style={styles.search}
          />
          <button style={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {/* The tutorial, across the top of the guide: the way in for anyone reading from the start. */}
        <div style={styles.tutorialBar}>
          <PlayTutorial onStart={onClose} />
        </div>
        <div style={styles.body}>
          <nav style={styles.nav}>
            {searching && (
              <>
                <div style={styles.hitCount}>
                  {hits.length === 0
                    ? 'No matches'
                    : `${hits.length}${hits.length >= 80 ? '+' : ''} ${hits.length === 1 ? 'match' : 'matches'}`}
                </div>
                {hits.map((h) => (
                  <button
                    key={`${h.page.id}:${h.block}`}
                    onClick={() => openHit(h)}
                    style={styles.hit}
                  >
                    <span style={styles.hitWhere}>
                      {h.page.title}
                      {h.heading ? ` › ${h.heading}` : ''}
                    </span>
                    <span style={styles.hitText}>
                      {h.snippet.before}
                      <mark style={styles.hitMark}>{h.snippet.match}</mark>
                      {h.snippet.after}
                    </span>
                  </button>
                ))}
              </>
            )}
            {!searching &&
              SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => jumpTo(s.id)}
                  style={{
                    ...styles.navItem,
                    ...(s.sub ? styles.navSub : null),
                    background: s.id === active ? UI.accent : 'transparent',
                    color: s.id === active ? UI.accentText : UI.text
                  }}
                >
                  {s.title}
                </button>
              ))}
          </nav>
          <div ref={contentRef} style={styles.content} onScroll={onScroll}>
            {SECTIONS.map((s, i) => (
              <section
                key={s.id}
                ref={(node) => {
                  sectionRefs.current[s.id] = node
                }}
                style={i === 0 ? undefined : styles.sectionGap}
              >
                <h2 style={styles.contentTitle}>{s.title}</h2>
                {s.blocks.map((b, j) => (
                  <div
                    key={j}
                    data-guide-block={`${s.id}:${j}`}
                    style={flash === `${s.id}:${j}` ? styles.flash : styles.blockWrap}
                  >
                    <Block block={b} />
                  </div>
                ))}
              </section>
            ))}
            {/* room to scroll the last section up to the top, so its nav entry can be reached */}
            <div style={styles.tail} />
          </div>
        </div>
      </div>
    </>
  )
}

// ── content helpers ───────────────────────────────────────────────────────────
function P({ children }: { children: ReactNode }): ReactNode {
  return <p style={styles.p}>{children}</p>
}
function H({ children }: { children: ReactNode }): ReactNode {
  return <h3 style={styles.h}>{children}</h3>
}
function B({ children }: { children: ReactNode }): ReactNode {
  return <strong style={{ color: UI.text }}>{children}</strong>
}
function Code({ children }: { children: ReactNode }): ReactNode {
  return <code style={styles.codeInline}>{children}</code>
}
function UL({ items }: { items: ReactNode[] }): ReactNode {
  return (
    <ul style={styles.ul}>
      {items.map((it, i) => (
        <li key={i} style={styles.li}>
          {it}
        </li>
      ))}
    </ul>
  )
}

/** The name app.css styles the guide's search matches by (`::highlight(oe-guide-search)`). */
const GUIDE_HIGHLIGHT = 'oe-guide-search'

const styles: Record<string, CSSProperties> = {
  search: {
    marginLeft: 'auto',
    width: 260,
    padding: '5px 9px',
    fontSize: 13,
    color: UI.text,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    outline: 'none'
  },
  hitCount: { fontSize: 11, color: UI.textMuted, padding: '4px 10px 6px' },
  hit: {
    textAlign: 'left',
    border: 'none',
    borderRadius: 6,
    padding: '7px 10px',
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  },
  hitWhere: { fontSize: 11, fontWeight: 700, color: UI.text },
  hitText: { fontSize: 11.5, lineHeight: 1.45, color: UI.textMuted },
  hitMark: { background: 'rgba(255, 196, 0, 0.45)', color: UI.text, borderRadius: 2 },
  // each block's wrapper: a hit's flash fades out on it
  blockWrap: { borderRadius: 6, transition: motion('background-color', 'page') },
  flash: {
    borderRadius: 6,
    transition: motion('background-color', 'page'),
    backgroundColor: 'rgba(255, 196, 0, 0.18)'
  },
  scrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60 },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 1080,
    maxWidth: '94vw',
    height: 680,
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 61,
    overflow: 'hidden'
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    flex: '0 0 auto'
  },
  headTitle: { fontWeight: 700, fontSize: 14, color: UI.text },
  close: {
    marginLeft: 10,
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    fontSize: 14,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1
  },
  tutorialBar: {
    padding: '10px 16px',
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto'
  },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  nav: {
    flex: '0 0 200px',
    borderRight: `1px solid ${UI.border}`,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflow: 'auto',
    background: UI.panelAlt
  },
  navItem: {
    textAlign: 'left',
    border: 'none',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  },
  navSub: { marginLeft: 14 },
  sectionGap: { marginTop: 28, paddingTop: 20, borderTop: `1px solid ${UI.border}` },
  tail: { height: 400 },
  content: { flex: 1, minWidth: 0, overflow: 'auto', padding: '18px 22px', color: UI.text },
  contentTitle: { margin: '0 0 12px', fontSize: 17, fontWeight: 700, color: UI.text },
  p: { margin: '0 0 12px', fontSize: 13, lineHeight: 1.6, color: UI.textMuted },
  h: { margin: '18px 0 6px', fontSize: 13, fontWeight: 700, color: UI.text },
  ul: { margin: '0 0 12px', paddingLeft: 18 },
  li: { fontSize: 13, lineHeight: 1.6, color: UI.textMuted, marginBottom: 4 },
  unknown: {
    margin: '0 0 12px',
    padding: 8,
    fontSize: 12,
    whiteSpace: 'pre-wrap',
    color: UI.textMuted,
    border: `1px dashed ${UI.border}`,
    borderRadius: 6
  },
  codeInline: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '1px 5px',
    color: UI.text,
    whiteSpace: 'nowrap'
  }
}
