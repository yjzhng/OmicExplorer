import { app } from 'electron'
import { writeFileSync } from 'node:fs'
import { createWindowFromPreset } from './window-manager'
import { assertPreset } from './window-presets'

// Headless screenshot mode for the compat harness. Invoked as:
//   electron out/main/index.js --shoot=<preset> --out=<file.png>
// Opens the preset window, captures it with webContents.capturePage(), and quits.

export interface ShootRequest {
  preset: string
  out: string
}

export function getShootRequest(): ShootRequest | null {
  const arg = (p: string) => process.argv.find((a) => a.startsWith(p))?.slice(p.length)
  const preset = arg('--shoot=')
  const out = arg('--out=')
  return preset && out ? { preset, out } : null
}

export async function runScreenshot({ preset, out }: ShootRequest): Promise<void> {
  try {
    const name = assertPreset(preset)
    const win = createWindowFromPreset(name, { search: `?preset=${name}` })
    if (win.webContents.isLoading()) {
      await new Promise<void>((res) => win.webContents.once('did-finish-load', () => res()))
    }
    // Give React a beat to mount/paint before capturing.
    await new Promise((r) => setTimeout(r, 500))
    const image = await win.webContents.capturePage()
    writeFileSync(out, image.toPNG())
    console.log(`shot ${name} -> ${out}`)
  } catch (err) {
    console.error('screenshot failed:', err)
    process.exitCode = 1
  } finally {
    app.quit()
  }
}
