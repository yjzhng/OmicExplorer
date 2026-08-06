import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { buildCsv, buildXlsx } from './xlsx'

const columns = ['gene', 'value', 'note']
const rows: Array<Array<string | number | null>> = [
  ['argF', 1.5, 'ok'],
  ['comma,gene', 2, 'has "quote"'],
  ['blank', null, 'line\nbreak']
]

/** Minimal ZIP reader: walk local file headers, inflate each entry, verify its CRC. */
function unzip(buf: Buffer): Map<string, string> {
  const crcTable = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })()
  const crc32 = (b: Buffer): number => {
    let c = 0xffffffff
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const out = new Map<string, string>()
  let pos = 0
  while (buf.readUInt32LE(pos) === 0x04034b50) {
    const crc = buf.readUInt32LE(pos + 14)
    const compSize = buf.readUInt32LE(pos + 18)
    const nameLen = buf.readUInt16LE(pos + 26)
    const extraLen = buf.readUInt16LE(pos + 28)
    const name = buf.subarray(pos + 30, pos + 30 + nameLen).toString('utf8')
    const dataStart = pos + 30 + nameLen + extraLen
    const comp = buf.subarray(dataStart, dataStart + compSize)
    const data = inflateRawSync(comp)
    expect(crc32(data)).toBe(crc) // integrity: stored CRC matches inflated bytes
    out.set(name, data.toString('utf8'))
    pos = dataStart + compSize
  }
  return out
}

describe('buildCsv', () => {
  it('emits a header row and RFC-4180 quoting', () => {
    const csv = buildCsv(columns, rows)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('gene,value,note')
    expect(lines[1]).toBe('argF,1.5,ok')
    expect(lines[2]).toBe('"comma,gene",2,"has ""quote"""')
    expect(lines[3]).toBe('blank,,"line\nbreak"')
  })
})

describe('buildXlsx', () => {
  it('produces a valid deflate zip whose sheet carries the data', () => {
    const buf = buildXlsx('Comparison cmp-1', columns, rows)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK') // zip signature
    const parts = unzip(buf)
    // Required OOXML parts are present.
    expect(parts.has('[Content_Types].xml')).toBe(true)
    expect(parts.has('xl/workbook.xml')).toBe(true)
    const sheet = parts.get('xl/worksheets/sheet1.xml') ?? ''
    // Header cells as inline strings, numbers as <v>, escaped special chars.
    expect(sheet).toContain('<t xml:space="preserve">gene</t>')
    expect(sheet).toContain('<v>1.5</v>')
    expect(sheet).toContain('comma,gene')
    expect(sheet).toContain('has &quot;quote&quot;')
    expect(sheet).toContain('line\nbreak')
    // Sheet name (≤31 chars) carried into the workbook.
    expect(parts.get('xl/workbook.xml') ?? '').toContain('name="Comparison cmp-1"')
  })

  it('truncates over-long sheet names to 31 chars', () => {
    const parts = unzip(buildXlsx('x'.repeat(40), ['a'], [[1]]))
    const wb = parts.get('xl/workbook.xml') ?? ''
    const m = wb.match(/name="(x+)"/)
    expect(m?.[1].length).toBe(31)
  })
})
