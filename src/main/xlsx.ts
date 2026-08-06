/** Minimal, dependency-free XLSX (OOXML) writer: one sheet, inline strings, DEFLATE-zipped
 *  with Node's zlib. Enough to write a data table Excel opens cleanly — no styles, no shared
 *  strings, no formulas. Cells are string | number | null (null → blank). */
import { deflateRawSync } from 'node:zlib'

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
