/** Every `new Worker(new URL('<path>', import.meta.url))` points at a file that exists. A wrong path
 *  only fails the production build (Vite resolves it then) — in dev the worker just never starts —
 *  so a moved file broke the v0.5.0 release build with nothing failing before it. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : sources(p)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}

describe('worker URLs', () => {
  it('resolve to files that exist', () => {
    const missing: string[] = []
    for (const file of sources(__dirname)) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(
        /new Worker\(\s*new URL\(\s*'([^']+)'\s*,\s*import\.meta\.url/g
      ))
        if (!existsSync(resolve(dirname(file), m[1]))) missing.push(`${file}: ${m[1]}`)
    }
    expect(missing).toEqual([])
  })
})
