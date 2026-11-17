/** Minimal, dependency-free XLSX (OOXML) writer: one sheet, inline strings, DEFLATE-zipped
 *  with Node's zlib. Enough to write a data table Excel opens cleanly — no styles, no shared
 *  strings, no formulas. Cells are string | number | null (null → blank). And a reader of the same
 *  scope: a workbook's first sheet as a table of text (readXlsx). */
import { deflateRawSync, inflateRawSync } from 'node:zlib'

type Cell = string | number | null

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 0 → "A", 25 → "Z", 26 → "AA", … */
function colLetter(n: number): string {
  let s = ''
  let i = n
  do {
    s = String.fromCharCode(65 + (i % 26)) + s
    i = Math.floor(i / 26) - 1
  } while (i >= 0)
  return s
}

/** Excel sheet names: ≤31 chars, none of []:*?/\ */
function sheetName(name: string): string {
  const cleaned = (name || 'Sheet1').replace(/[[\]:*?/\\]/g, '_').slice(0, 31)
  return cleaned || 'Sheet1'
}

function cellXml(ref: string, v: Cell): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(v))}</t></is></c>`
}

function sheetXml(columns: string[], rows: Cell[][]): string {
  const allRows = [columns, ...rows]
  const body = allRows
    .map((cells, ri) => {
      const cellStr = cells.map((v, ci) => cellXml(`${colLetter(ci)}${ri + 1}`, v)).join('')
      return `<row r="${ri + 1}">${cellStr}</row>`
    })
    .join('')
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${body}</sheetData></worksheet>`
  )
}

// ── CRC-32 (for ZIP entries) ────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface Entry {
  name: string
  data: Buffer
  comp: Buffer
  crc: number
  offset: number
}

/** Build a ZIP archive (DEFLATE) from name→content parts. */
function zip(parts: Array<{ name: string; content: string }>): Buffer {
  const entries: Entry[] = []
  const chunks: Buffer[] = []
  let offset = 0
  for (const p of parts) {
    const data = Buffer.from(p.content, 'utf8')
    const comp = deflateRawSync(data)
    const crc = crc32(data)
    const nameBuf = Buffer.from(p.name, 'utf8')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(0, 6) // flags
    header.writeUInt16LE(8, 8) // method: deflate
    header.writeUInt16LE(0, 10) // mod time
    header.writeUInt16LE(0x21, 12) // mod date (1980-01-01)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(comp.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(nameBuf.length, 26)
    header.writeUInt16LE(0, 28)
    entries.push({ name: p.name, data, comp, crc, offset })
    chunks.push(header, nameBuf, comp)
    offset += header.length + nameBuf.length + comp.length
  }
  // Central directory
  const central: Buffer[] = []
  let cdSize = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4) // version made by
    c.writeUInt16LE(20, 6) // version needed
    c.writeUInt16LE(0, 8) // flags
    c.writeUInt16LE(8, 10) // method
    c.writeUInt16LE(0, 12) // time
    c.writeUInt16LE(0x21, 14) // date
    c.writeUInt32LE(e.crc, 16)
    c.writeUInt32LE(e.comp.length, 20)
    c.writeUInt32LE(e.data.length, 24)
    c.writeUInt16LE(nameBuf.length, 28)
    c.writeUInt16LE(0, 30) // extra len
    c.writeUInt16LE(0, 32) // comment len
    c.writeUInt16LE(0, 34) // disk start
    c.writeUInt16LE(0, 36) // internal attrs
    c.writeUInt32LE(0, 38) // external attrs
    c.writeUInt32LE(e.offset, 42)
    central.push(c, nameBuf)
    cdSize += c.length + nameBuf.length
  }
  const cdOffset = offset
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdOffset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, ...central, eocd])
}

/** Build a single-sheet .xlsx workbook as a Buffer. */
export function buildXlsx(name: string, columns: string[], rows: Cell[][]): Buffer {
  const sheet = sheetName(name)
  return zip([
    {
      name: '[Content_Types].xml',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `</Types>`
    },
    {
      name: '_rels/.rels',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${xmlEscape(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `</Relationships>`
    },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml(columns, rows) }
  ])
}

/** Build a CSV string (RFC-4180 quoting) from columns + rows. */
export function buildCsv(columns: string[], rows: Cell[][]): string {
  const esc = (v: Cell): string => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns, ...rows].map((r) => r.map(esc).join(','))
  return lines.join('\r\n')
}

// ── reading ─────────────────────────────────────────────────────────────────────

/** A ZIP archive's entries (name → text), read through its central directory — so an entry whose
 *  local header leaves its sizes to a trailing descriptor (as Excel writes them) reads too. */
function unzip(buf: Buffer): Map<string, string> {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('Not an .xlsx file (no ZIP directory).')
  const count = buf.readUInt16LE(eocd + 10)
  const out = new Map<string, string>()
  let p = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + size)
    if (method === 0 || method === 8)
      out.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'))
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

const unescapeXml = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase()
    if (k[0] === '#')
      return String.fromCodePoint(
        k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
      )
    return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[k] ?? _
  })

/** A string item's text: its runs' <t>s joined, without phonetic (<rPh>) guides. */
const itemText = (xml: string): string =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((m) => unescapeXml(m[1]))
    .join('')

const attr = (attrs: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1]

/** "B12" → column 1 (A = 0). */
const colIndex = (ref: string): number =>
  [...(/^[A-Z]+/.exec(ref)?.[0] ?? '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

/** The first sheet of a workbook, from its unzipped parts: each row's cells as text (shared and
 *  inline strings, numbers as stored, booleans as TRUE / FALSE), placed by their references. */
export function readXlsxParts(parts: Map<string, string>): string[][] {
  const workbook = parts.get('xl/workbook.xml') ?? ''
  const rid = attr(/<sheet\b([^>]*)\/?>/.exec(workbook)?.[1] ?? '', 'r:id')
  const rels = parts.get('xl/_rels/workbook.xml.rels') ?? ''
  const target = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)]
    .map((m) => m[1])
    .find((a) => attr(a, 'Id') === rid)
  const path = target
    ? (attr(target, 'Target') ?? '').replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/')
    : 'xl/worksheets/sheet1.xml'
  const sheet = parts.get(path)
  if (sheet == null) throw new Error('The workbook has no sheet to read.')
  const shared = [
    ...(parts.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)
  ].map((m) => itemText(m[1]))
  const rows: string[][] = []
  let r = 0
  for (const row of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    r = Number(attr(row[1], 'r') ?? r + 1)
    const cells: string[] = []
    let c = -1
    for (const cell of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cell[1], 'r')
      c = ref ? colIndex(ref) : c + 1
      const body = cell[2] ?? ''
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      const type = attr(cell[1], 't')
      const text =
        type === 's'
          ? (shared[Number(v)] ?? '')
          : type === 'inlineStr'
            ? itemText(body)
            : type === 'b'
              ? v === '1'
                ? 'TRUE'
                : 'FALSE'
              : unescapeXml(v ?? '')
      while (cells.length < c) cells.push('')
      cells[c] = text
    }
    while (rows.length < r - 1) rows.push([])
    rows[r - 1] = cells
  }
  while (rows.length && rows[rows.length - 1].every((x) => x === '')) rows.pop()
  return rows
}

/** A workbook's first sheet as a table of text (see readXlsxParts). */
export function readXlsx(buf: Buffer): string[][] {
  return readXlsxParts(unzip(buf))
}
