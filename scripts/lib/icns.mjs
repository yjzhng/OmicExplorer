// Shared: generate build-resources/icon.icns from icon.png (macOS only).
// Cached — regenerates only when the .icns is missing or older than the .png.
// Returns the .icns path, or null if unavailable (non-mac / no png / tooling error).
import { existsSync, statSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

export function ensureIcns(repo) {
  if (process.platform !== 'darwin') return null
  const png = resolve(repo, 'build-resources/icon.png')
  if (!existsSync(png)) return null
  const icns = resolve(repo, 'build-resources/icon.icns')
  try {
    const fresh = existsSync(icns) && statSync(icns).mtimeMs >= statSync(png).mtimeMs
    if (!fresh) {
      const iconset = resolve(repo, 'build-resources/icon.iconset')
      rmSync(iconset, { recursive: true, force: true })
      mkdirSync(iconset, { recursive: true })
      for (const s of [16, 32, 128, 256, 512]) {
        const px = (n, f) =>
          execFileSync('sips', ['-z', String(n), String(n), png, '--out', resolve(iconset, f)], {
            stdio: 'ignore'
          })
        px(s, `icon_${s}x${s}.png`)
        px(s * 2, `icon_${s}x${s}@2x.png`)
      }
      execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns], { stdio: 'ignore' })
      rmSync(iconset, { recursive: true, force: true })
    }
    return icns
  } catch (e) {
    console.warn('[icns] generation skipped:', e.message)
    return null
  }
}
