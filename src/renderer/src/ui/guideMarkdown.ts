/** Parser for the User guide's Markdown (`user-guide.md`). A deliberately small dialect — pages,
 *  sub-pages, headings, paragraphs, bullets, bold and code, plus the guide's pictures — so the
 *  guide can be edited as plain text. The syntax is documented at the top of that file. */

export type ColKind = 'id' | 'sample' | 'cond' | 'label' | 'plain'

/** A picture with nothing to fill in, written `[[name]]` on a line of its own. */
export const FIXED_VISUALS = ['layouts', 'run-states', 'protein-groups', 'log-shapes'] as const
export type FixedVisual = (typeof FIXED_VISUALS)[number]

/** One of the app's own buttons, written `[[name]]` within a line: drawn inline in the guide as the
 *  real element (guideUi.tsx), so the guide shows exactly what the app shows. */
export const UI_ELEMENTS = [
  'home',
  'save',
  'save-as',
  'undo',
  'redo',
  'editor-layout',
  'run',
  'rerun',
  'retry',
  'stop',
  'project-folder',
  'guide',
  'settings',
  'new-step',
  'results',
  'copy',
  'download',
  'export-data',
  'tile-settings'
] as const
export type UiElement = (typeof UI_ELEMENTS)[number]

export type GuideBlock =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'visual'; name: FixedVisual }
  | { type: 'steps'; steps: { title: string; text: string }[] }
  /** workflow steps drawn as the canvas's own tiles: a node kind (e.g. `standardize`) and a line */
  | { type: 'tiles'; tiles: { kind: string; text: string }[] }
  | {
      type: 'folder'
      entries: { name: string; depth: number; folder: boolean; note?: string }[]
    }
  | { type: 'table'; head: string[]; kinds: ColKind[]; rows: string[][]; missingZero: boolean }
  | { type: 'levels'; source: string; levels: { label: string; example: string }[] }
  /** something the parser can't place (an unknown picture or block): shown as-is, so a typo is
   *  visible in the guide rather than silently dropped */
  | { type: 'unknown'; text: string }

export interface GuidePage {
  id: string
  title: string
  /** a `##` sub-page: indented in the nav under the page before it */
  sub: boolean
  blocks: GuideBlock[]
}

const COL_KINDS: ColKind[] = ['id', 'sample', 'cond', 'label', 'plain']

/** `a | b | c` → trimmed cells; a missing trailing cell reads as empty. */
function cells(line: string): string[] {
  return line.split('|').map((c) => c.trim())
}

/** Split at the first `|` only: the text after it may contain more. */
function pair(line: string): [string, string] {
  const i = line.indexOf('|')
  return i < 0 ? [line.trim(), ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()]
}

function fenced(info: string, body: string[]): GuideBlock {
  const [kind, ...args] = info.trim().split(/\s+/)
  const lines = body.filter((l) => l.trim() !== '')
  switch (kind) {
    case 'steps':
      return {
        type: 'steps',
        steps: lines.map((l) => {
          const [title, text] = pair(l)
          return { title, text }
        })
      }
    case 'tiles':
      return {
        type: 'tiles',
        tiles: lines.map((l) => {
          const [kind, text] = pair(l)
          return { kind, text }
        })
      }
    case 'folder':
      return {
        type: 'folder',
        entries: lines.map((l) => {
          const depth = Math.floor((l.length - l.trimStart().length) / 2)
          const [name, note] = pair(l)
          return { name, depth, folder: name.endsWith('/'), ...(note ? { note } : {}) }
        })
      }
    case 'table': {
      const missingZero = args.includes('missing-zero')
      const given = args.filter((a): a is ColKind => COL_KINDS.includes(a as ColKind))
      const [headLine, ...rowLines] = lines
      const head = headLine ? cells(headLine) : []
      const width = head.length
      const rows = rowLines.map((l) => {
        const r = cells(l)
        return Array.from({ length: width }, (_, i) => r[i] ?? '')
      })
      const kinds = head.map((_, i) => given[i] ?? 'plain')
      return { type: 'table', head, kinds, rows, missingZero }
    }
    case 'levels':
      return {
        type: 'levels',
        source: args.join(' '),
        levels: lines.map((l) => {
          const [label, example] = pair(l)
          return { label, example }
        })
      }
    default:
      return { type: 'unknown', text: ['```' + info, ...body, '```'].join('\n') }
  }
}

function slug(title: string, taken: Set<string>): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'page'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  taken.add(id)
  return id
}

export function parseGuide(md: string): GuidePage[] {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  const pages: GuidePage[] = []
  const taken = new Set<string>()
  let page: GuidePage | null = null
  let para: string[] = []
  let list: string[] | null = null

  const flush = (): void => {
    if (!page) return
    if (para.length) page.blocks.push({ type: 'p', text: para.join(' ') })
    if (list) page.blocks.push({ type: 'ul', items: list })
    para = []
    list = null
  }
  const push = (b: GuideBlock): void => {
    flush()
    if (page) page.blocks.push(b)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      const [, hashes, text] = heading
      if (hashes.length === 3) {
        push({ type: 'h', text: text.trim() })
      } else {
        flush()
        page = { id: slug(text, taken), title: text.trim(), sub: hashes.length === 2, blocks: [] }
        pages.push(page)
      }
      continue
    }
    if (!page) continue // text before the first page heading is ignored
    const fence = /^```(.*)$/.exec(line)
    if (fence) {
      const body: string[] = []
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i])
      push(fenced(fence[1], body))
      continue
    }
    const visual = /^\[\[\s*([\w-]+)\s*\]\]\s*$/.exec(line)
    if (visual) {
      const name = visual[1]
      push(
        (FIXED_VISUALS as readonly string[]).includes(name)
          ? { type: 'visual', name: name as FixedVisual }
          : { type: 'unknown', text: line.trim() }
      )
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      if (para.length) {
        page.blocks.push({ type: 'p', text: para.join(' ') })
        para = []
      }
      list = [...(list ?? []), bullet[1].trim()]
      continue
    }
    if (list && /^\s+\S/.test(line)) {
      list[list.length - 1] += ' ' + line.trim()
      continue
    }
    if (list) {
      page.blocks.push({ type: 'ul', items: list })
      list = null
    }
    para.push(line.trim())
  }
  flush()
  return pages
}

export type InlinePart =
  | { kind: 'text' | 'bold' | 'code'; text: string }
  | { kind: 'ui'; name: UiElement }
  /** a `[[name]]` that names no element: shown as written, so a typo is visible */
  | { kind: 'unknown'; text: string }

/** `**bold**`, `` `code` `` and `[[element]]` within a line of text. Code is literal (nothing
 *  parsed inside it). */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  const re = /`([^`]+)`|\*\*(.+?)\*\*|\[\[\s*([\w-]+)\s*\]\]/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) })
    if (m[1] !== undefined) parts.push({ kind: 'code', text: m[1] })
    else if (m[2] !== undefined) parts.push({ kind: 'bold', text: m[2] })
    else
      parts.push(
        (UI_ELEMENTS as readonly string[]).includes(m[3])
          ? { kind: 'ui', name: m[3] as UiElement }
          : { kind: 'unknown', text: m[0] }
      )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

/** A line's words as plain text: markup dropped, an app element dropped (it has no words). */
function plain(text: string): string {
  return parseInline(text)
    .map((p) => (p.kind === 'ui' ? '' : p.text))
    .join('')
}

/** A block's words as plain text, for search. Pictures have none. */
export function blockText(b: GuideBlock): string {
  switch (b.type) {
    case 'p':
    case 'h':
      return plain(b.text)
    case 'ul':
      return b.items.map(plain).join(' ')
    case 'steps':
      return b.steps.map((s) => `${s.title} ${plain(s.text)}`).join(' ')
    case 'tiles':
      return b.tiles.map((t) => plain(t.text)).join(' ')
    case 'folder':
      return b.entries.map((e) => `${e.name} ${e.note ?? ''}`).join(' ')
    case 'table':
      return [b.head, ...b.rows].map((r) => r.map(plain).join(' ')).join(' ')
    case 'levels':
      return `${b.source} ${b.levels.map((l) => `${l.label} ${l.example}`).join(' ')}`
    default:
      return ''
  }
}

/** The words of a search: lowercased, split on spaces. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

export interface GuideHit {
  page: GuidePage
  /** the block's index in its page */
  block: number
  /** the `###` heading the block sits under, if any */
  heading: string | null
  /** the block's text around the first match */
  snippet: { before: string; match: string; after: string }
}

/** The blocks that match a search, in reading order: every word must appear in the block, or in
 *  its page title or heading, and at least one in the block itself (so a page title alone doesn't
 *  list every paragraph under it). */
export function searchGuide(pages: GuidePage[], query: string, limit = 80): GuideHit[] {
  const words = searchWords(query)
  if (!words.length) return []
  const hits: GuideHit[] = []
  for (const page of pages) {
    let heading: string | null = null
    page.blocks.forEach((b, block) => {
      if (b.type === 'h') heading = plain(b.text)
      if (hits.length >= limit) return
      const text = blockText(b).replace(/\s+/g, ' ').trim()
      const low = text.toLowerCase()
      const around = `${page.title} ${heading ?? ''}`.toLowerCase()
      if (!words.every((w) => low.includes(w) || around.includes(w))) return
      const at = words
        .map((w) => [low.indexOf(w), w.length] as const)
        .filter(([i]) => i >= 0)
        .sort((a, b) => a[0] - b[0])[0]
      if (!at) return
      const [i, n] = at
      // a little context either side, cut at a space
      const from = i <= 40 ? 0 : text.lastIndexOf(' ', i - 40) + 1
      const toAt = text.indexOf(' ', i + n + 70)
      const to = toAt < 0 ? text.length : toAt
      hits.push({
        page,
        block,
        heading,
        snippet: {
          before: (from > 0 ? '…' : '') + text.slice(from, i),
          match: text.slice(i, i + n),
          after: text.slice(i + n, to) + (to < text.length ? '…' : '')
        }
      })
    })
  }
  return hits
}
