/** The motion standard (ui/app/theme.ts MOTION_MS / EASE / LOOP_MS): app.css carries the same values,
 *  and no component or rule sets a duration of its own. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { EASE, LOOP_MS, MOTION_MS } from './theme'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const CSS = readFileSync(join(ROOT, 'app.css'), 'utf8')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
  })
}

describe('motion', () => {
  it("app.css's --motion / --ease / --loop variables equal the theme's", () => {
    const v = (name: string): string | undefined =>
      new RegExp(`--${name}:\\s*([^;]+);`).exec(CSS)?.[1].trim()
    for (const [job, ms] of Object.entries(MOTION_MS))
      expect(v(`motion-${job}`), job).toBe(`${ms}ms`)
    for (const [kind, curve] of Object.entries(EASE))
      if (kind !== 'linear') expect(v(`ease-${kind}`), kind).toBe(curve)
    for (const [cue, ms] of Object.entries(LOOP_MS)) expect(v(`loop-${cue}`), cue).toBe(`${ms}ms`)
  })

  it('no transition or animation sets its own duration', () => {
    const bad = sources(ROOT).flatMap((p) => {
      const file = relative(ROOT, p)
      const text = readFileSync(p, 'utf8')
      if (file.endsWith('.css')) {
        // a declaration (one or several lines) up to its ';' — the :root definitions aside
        const decls = text.replace(/:root\s*\{[^}]*\}/, '').match(/(transition|animation)[^;{}]*;/g)
        return (decls ?? [])
          .filter((d) => /\b(?!1ms|0ms)\d+(\.\d+)?m?s\b/.test(d.replace(/var\([^)]*\)/g, '')))
          .map((d) => `${file}: ${d.replace(/\s+/g, ' ')}`)
      }
      return [
        ...text.matchAll(/(transition|animation)[A-Za-z]*:\s*['`"][^'`"]*\d+m?s\b[^'`"]*['`"]/g)
      ].map((m) => `${file}: ${m[0]}`)
    })
    expect(bad).toEqual([])
  })
})
