/** Sectioned User Guide dialog: a left section list + one scrolling document. The content lives in
 *  `user-guide.md` (edit that, not this file); this renders it, pictures included. */
import { Fragment, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import {
  FolderTree,
  GroupDiagram,
  LayoutCards,
  Levels,
  MiniTable,
  RunStates,
  SelectorMock,
  ShapePair,
  StepCards,
  TileMock
} from './guideVisuals'
import { parseGuide, parseInline, type FixedVisual, type GuideBlock } from './guideMarkdown'
import { UI } from './theme'
import guideMd from './user-guide.md?raw'

const SECTIONS = parseGuide(guideMd)

const VISUALS: Record<FixedVisual, () => ReactNode> = {
  layouts: LayoutCards,
  'run-states': RunStates,
  'protein-groups': GroupDiagram,
  'log-shapes': ShapePair,
  'gene-selector': SelectorMock,
  tile: TileMock
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
  const jumpTo = (id: string): void => {
    const el = contentRef.current
    const node = sectionRefs.current[id]
    if (!el || !node) return
    el.scrollTo({
      top: node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop,
      behavior: 'smooth'
    })
  }
  return (
    <>
      <div style={styles.scrim} onClick={onClose} />
      <div style={styles.modal} role="dialog" aria-label="User guide">
        <div style={styles.head}>
          <span style={styles.headTitle}>User guide</span>
          <button style={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={styles.body}>
          <nav style={styles.nav}>
            {SECTIONS.map((s) => (
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
                  <Block key={j} block={b} />
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

const styles: Record<string, CSSProperties> = {
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
    marginLeft: 'auto',
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    fontSize: 14,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1
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
