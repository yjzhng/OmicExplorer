/**
 * The structure's rules, checked: the engine stays pure, each kind's folder is reached only
 * through the registries, kinds don't import each other (but for the variants that share a
 * panel or view), and every kind is complete in every registry.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ALL_OPS, NODE_SPECS, PLOT_SECTIONS } from './graph/registry'
import { PLOT_RUNS, STEP_RUNS } from './nodes/runs'

const ROOT = dirname(fileURLToPath(import.meta.url))

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []
  })
}
/** A file's relative imports, resolved to paths under src/renderer/src. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/(?:from|import\()\s*'(\.[^']+)'/g)].map((m) =>
    relative(ROOT, resolve(dirname(file), m[1]))
  )
}
const ALL = sources(ROOT).map((f) => ({ file: relative(ROOT, f), imports: importsOf(f) }))

/** One kind may use another's panel or view where it is a variant of it. */
const VARIANTS: Record<string, string[]> = {
  curveFit: ['compare'],
  tdr: ['response']
}
/** What the rest of the app may import from nodes/: the registries, the contract, the kit. */
const NODES_PUBLIC = /^nodes\/(contract|specs|settings|views|tiles|runs|runContext|kit\/)/

describe('architecture', () => {
  it('imports are relative (the @renderer alias only resolves in the app build, not in tests)', () => {
    const bad = sources(ROOT).filter((f) => /from '@renderer\//.test(readFileSync(f, 'utf8')))
    expect(bad.map((f) => relative(ROOT, f))).toEqual([])
  })

  it('the engine imports nothing outside engine/', () => {
    const bad = ALL.filter((f) => f.file.startsWith('engine/')).flatMap((f) =>
      f.imports.filter((i) => !i.startsWith('engine/')).map((i) => `${f.file} → ${i}`)
    )
    expect(bad).toEqual([])
  })

  it("a kind's folder is reached only through the registries", () => {
    const bad = ALL.filter((f) => !f.file.startsWith('nodes/')).flatMap((f) =>
      f.imports
        .filter((i) => i.startsWith('nodes/') && !NODES_PUBLIC.test(i))
        .map((i) => `${f.file} → ${i}`)
    )
    expect(bad).toEqual([])
  })

  it("kinds don't import each other (but for variants)", () => {
    const kindOf = (p: string): string | undefined => {
      const m = /^nodes\/([^/]+)\//.exec(p)
      return m && m[1] !== 'kit' ? m[1] : undefined
    }
    const bad = ALL.flatMap((f) => {
      const me = kindOf(f.file)
      if (!me) return []
      return f.imports
        .filter((i) => {
          const other = kindOf(i)
          return other && other !== me && !(VARIANTS[me] ?? []).includes(other)
        })
        .map((i) => `${f.file} → ${i}`)
    })
    expect(bad).toEqual([])
  })

  it('the kit and the shared UI never import a kind', () => {
    const bad = ALL.filter((f) => /^(nodes\/kit|ui|shared)\//.test(f.file)).flatMap((f) =>
      f.imports
        .filter((i) => /^nodes\/[^/]+\//.test(i) && !i.startsWith('nodes/kit/'))
        .map((i) => `${f.file} → ${i}`)
    )
    expect(bad).toEqual([])
  })

  it('every kind is in ALL_OPS, and every plot in one plot-menu section', () => {
    expect([...ALL_OPS].sort()).toEqual(Object.keys(NODE_SPECS).sort())
    const plots = ALL_OPS.filter((k) => NODE_SPECS[k].category === 'plotting' && k !== 'plotGroup')
    for (const k of plots)
      expect(PLOT_SECTIONS.filter((s) => s.kinds.includes(k)).length, k).toBe(1)
  })

  it('every step with a run has one; every computing plot has its run', () => {
    for (const k of ALL_OPS) {
      const spec = NODE_SPECS[k]
      if (spec.category !== 'plotting' && spec.hasRun)
        expect(STEP_RUNS[k], `${k}: STEP_RUNS`).toBeTypeOf('function')
      expect(!!PLOT_RUNS[k], `${k}: PLOT_RUNS`).toBe(!!spec.plot?.computes)
    }
  })

  it("every plot's settings fill PlotSections' slots, so they follow its order", () => {
    const plots = ALL_OPS.filter(
      (k) => NODE_SPECS[k].category === 'plotting' && NODE_SPECS[k].plot?.configurable
    )
    const bad = plots.filter((k) => {
      const file = join(ROOT, 'nodes', k, 'Settings.tsx')
      const text = readFileSync(file, 'utf8')
      // a variant may use the panel of the kind it varies (tdr: the response panel)
      const borrowed = (VARIANTS[k] ?? []).some((v) => text.includes(`from '../${v}/`))
      return !text.includes('<PlotSections') && !borrowed
    })
    expect(bad).toEqual([])
  })

  it('one control per job: the form primitives are built once, in ui/', () => {
    const PRIMITIVES = ['Section', 'Field', 'NumberInput', 'Checkbox', 'Chevron']
    const bad = sources(ROOT).flatMap((p) => {
      const file = relative(ROOT, p)
      const text = readFileSync(p, 'utf8')
      const out: string[] = []
      if (file !== 'ui/NumberInput.tsx' && text.includes('type="number"'))
        out.push(`${file}: a number box of its own (use ui/NumberInput)`)
      if (file !== 'ui/Chevron.tsx' && text.includes('3.5,1.5 7,5 3.5,8.5'))
        out.push(`${file}: a chevron of its own (use ui/Chevron)`)
      for (const name of PRIMITIVES) {
        if (file === `ui/${name}.tsx`) continue
        // a wrapper (the frame a dialog gives it, say) builds on the one in ui/
        const wraps = new RegExp(`from '(\\.\\./)*(\\./)?(ui/)?${name}'`).test(text)
        if (new RegExp(`function ${name}\\b`).test(text) && !wraps)
          out.push(`${file}: a ${name} of its own (use ui/${name})`)
      }
      return out
    })
    expect(bad).toEqual([])
  })

  it("each spec's kind is its key", () => {
    for (const k of ALL_OPS) expect(NODE_SPECS[k].kind).toBe(k)
  })
})
