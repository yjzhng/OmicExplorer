import { crc32 } from './xlsx'

/** Inches per metre: PNG stores resolution as pixels per metre. */
const IN_PER_M = 1 / 0.0254

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Pixel width from a PNG's IHDR, or null when the bytes aren't a PNG. */
export function pngWidth(png: Buffer): number | null {
  if (png.length < 24 || !png.subarray(0, 8).equals(SIGNATURE)) return null
  if (png.toString('latin1', 12, 16) !== 'IHDR') return null
  return png.readUInt32BE(16)
}

/**
 * Stamp a resolution into a PNG (its pHYs chunk), so file properties and layout apps read the
 * export's DPI rather than assuming 96. A canvas-encoded PNG has no pHYs; any existing one is
 * replaced. Pixels are untouched. Bytes that aren't a well-formed PNG come back unchanged.
 */
export function pngWithDpi(png: Buffer, dpi: number): Buffer {
  if (pngWidth(png) == null || !(dpi > 0)) return png
  const ppm = Math.round(dpi * IN_PER_M)
  const body = Buffer.alloc(13) // type + x ppm + y ppm + unit
  body.write('pHYs', 0, 'latin1')
  body.writeUInt32BE(ppm, 4)
  body.writeUInt32BE(ppm, 8)
  body[12] = 1 // unit: metre
  const chunk = Buffer.alloc(4 + 13 + 4)
  chunk.writeUInt32BE(9, 0)
  body.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(body), 17)

  const parts: Buffer[] = [png.subarray(0, 8)]
  let at = 8
  let placed = false
  while (at + 12 <= png.length) {
    const len = png.readUInt32BE(at)
    const end = at + 12 + len
    if (end > png.length) return png
    const type = png.toString('latin1', at + 4, at + 8)
    if (type !== 'pHYs') parts.push(png.subarray(at, end))
    if (type === 'IHDR' && !placed) {
      parts.push(chunk)
      placed = true
    }
    at = end
  }
  if (!placed) return png
  parts.push(png.subarray(at))
  return Buffer.concat(parts)
}

/** The DPI a raster drawn `widthIn` inches wide was rendered at (pixels ÷ inches, to a whole
 *  number), or null when that can't be read. */
export function pngDpiFor(png: Buffer, widthIn: number): number | null {
  const px = pngWidth(png)
  if (px == null || !(widthIn > 0)) return null
  return Math.round(px / widthIn)
}
