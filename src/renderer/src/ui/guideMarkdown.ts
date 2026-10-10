/** Parser for the User guide's Markdown (`user-guide.md`). A deliberately small dialect — pages,
 *  sub-pages, headings, paragraphs, bullets, bold and code, plus the guide's pictures — so the
 *  guide can be edited as plain text. The syntax is documented at the top of that file. */

export type ColKind = 'id' | 'sample' | 'cond' | 'label' | 'plain'

/** A picture with nothing to fill in, written `[[name]]`. */
export const FIXED_VISUALS = [
  'layouts',
  'run-states',
  'protein-groups',
  'log-shapes',
  'gene-selector',
  'tile'
] as const
export type FixedVisual = (typeof FIXED_VISUALS)[number]

export type GuideBlock =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'visual'; name: FixedVisual }
  | { type: 'steps'; steps: { title: string; text: string }[] }
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

export type InlinePart = { kind: 'text' | 'bold' | 'code'; text: string }

/** `**bold**` and `` `code` `` within a line of text. Code is literal (no bold inside it). */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  const re = /`([^`]+)`|\*\*(.+?)\*\*/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ kind: 'text', text: text.slice(last, m.index) })
    parts.push(m[1] !== undefined ? { kind: 'code', text: m[1] } : { kind: 'bold', text: m[2] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}
