import { describe, expect, it } from 'vitest'

import { pngDpiFor, pngWithDpi } from './png-dpi'
import { crc32 } from './xlsx'

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}

function png(width: number, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(10, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', Buffer.from([1, 2, 3])),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** Chunk types in order, with pHYs's pixels-per-metre and unit. */
function walk(buf: Buffer): { types: string[]; phys: [number, number, number][] } {
  const types: string[] = []
  const phys: [number, number, number][] = []
  let at = 8
  while (at < buf.length) {
    const len = buf.readUInt32BE(at)
    const type = buf.toString('latin1', at + 4, at + 8)
    const body = buf.subarray(at + 4, at + 8 + len)
    expect(buf.readUInt32BE(at + 8 + len)).toBe(crc32(body))
    types.push(type)
    if (type === 'pHYs') phys.push([body.readUInt32BE(4), body.readUInt32BE(8), body[12]])
    at += 12 + len
  }
  return { types, phys }
}

describe('pngWithDpi', () => {
  it('inserts pHYs after IHDR with a valid CRC', () => {
    const out = walk(pngWithDpi(png(100), 300))
    expect(out.types).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND'])
    expect(out.phys).toEqual([[11811, 11811, 1]]) // 300 dpi = 11811 px/m
  })

  it('replaces an existing pHYs rather than adding a second', () => {
    const old = Buffer.alloc(9)
    old.writeUInt32BE(3780, 0)
    old.writeUInt32BE(3780, 4)
    old[8] = 1
    const out = walk(pngWithDpi(png(100, [chunk('pHYs', old)]), 600))
    expect(out.types).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND'])
    expect(out.phys).toEqual([[23622, 23622, 1]])
  })

  it('leaves non-PNG bytes alone', () => {
    const junk = Buffer.from('not a png at all, just text')
    expect(pngWithDpi(junk, 300)).toBe(junk)
  })
})

describe('pngDpiFor', () => {
  it('reads the render DPI from pixel width over physical width', () => {
    // A 517 px-wide plot at 300 dpi: round(517 × 300/96) = 1616 px over 517/96 in.
    expect(pngDpiFor(png(1616), 517 / 96)).toBe(300)
    expect(pngDpiFor(png(517), 517 / 96)).toBe(96)
  })
})
