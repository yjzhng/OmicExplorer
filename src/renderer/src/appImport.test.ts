/**
 * Module evaluation order: no module reads, while it loads, a binding imported from a module in an
 * import cycle with it. Whichever module of a cycle is entered first, the others see its bindings
 * still unset — "Cannot access X before initialization" — and the window stays blank. (Reading an
 * imported binding inside a function is fine: by the time it runs, every module has loaded.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(import.meta.url))
const files = (function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.tsx?$/.test(f) && !/\.(test|d)\.tsx?$/.test(f) ? [p] : []
  })
})(ROOT)
const known = new Set(files)
const resolveSpec = (from: string, spec: string): string | undefined => {
  const base = resolve(dirname(from), spec)
  return ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((e) => base + e).find((p) => known.has(p))
}

interface Mod {
  sf: ts.SourceFile
  /** value imports: local name → module */
  imports: Map<string, string>
  deps: Set<string>
}
const mods = new Map<string, Mod>()
for (const f of files) {
  const sf = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true)
  const imports = new Map<string, string>()
  const deps = new Set<string>()
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const target = st.moduleSpecifier.text.startsWith('.')
      ? resolveSpec(f, st.moduleSpecifier.text)
      : undefined
    if (!target || st.importClause?.isTypeOnly) continue
    const c = st.importClause
    // an import whose every binding is `type` is elided at build: no dependency at run time
    const nb0 = c?.namedBindings
    const values =
      !c ||
      !!c.name ||
      (nb0 && ts.isNamespaceImport(nb0)) ||
      (nb0 && ts.isNamedImports(nb0) && nb0.elements.some((el) => !el.isTypeOnly))
    if (!values) continue
    deps.add(target)
    if (c?.name) imports.set(c.name.text, target)
    const nb = c?.namedBindings
    if (nb && ts.isNamedImports(nb))
      for (const el of nb.elements) if (!el.isTypeOnly) imports.set(el.name.text, target)
    if (nb && ts.isNamespaceImport(nb)) imports.set(nb.name.text, target)
  }
  mods.set(f, { sf, imports, deps })
}

// strongly connected components (Tarjan)
const sccOf = new Map<string, number>()
{
  let index = 0
  let comp = 0
  const idx = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const on = new Set<string>()
  const strong = (v: string): void => {
    idx.set(v, index)
    low.set(v, index++)
    stack.push(v)
    on.add(v)
    for (const w of mods.get(v)!.deps) {
      if (!idx.has(w)) {
        strong(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!))
    }
    if (low.get(v) === idx.get(v)) {
      let w: string
      do {
        w = stack.pop()!
        on.delete(w)
        sccOf.set(w, comp)
      } while (w !== v)
      comp++
    }
  }
  for (const f of mods.keys()) if (!idx.has(f)) strong(f)
}

/** Identifiers read while the module evaluates: everything outside function bodies. */
function topLevelReads(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isGetAccessor(n) ||
      ts.isSetAccessor(n) ||
      ts.isConstructorDeclaration(n) ||
      ts.isImportDeclaration(n) ||
      ts.isTypeNode(n) ||
      ts.isInterfaceDeclaration(n) ||
      ts.isTypeAliasDeclaration(n)
    )
      return
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
      // a class's heritage and static initialisers run as it's defined
      n.heritageClauses?.forEach(visit)
      for (const m of n.members)
        if (
          ts.isPropertyDeclaration(m) &&
          m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)
        )
          visit(m)
      return
    }
    if (ts.isIdentifier(n)) {
      const p = n.parent
      const isName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n) ||
        (ts.isVariableDeclaration(p) && p.name === n) ||
        ts.isJsxAttribute(p)
      if (!isName) out.add(n.text)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

describe('module evaluation order', () => {
  it('no module reads a binding from its own import cycle while loading', () => {
    const bad: string[] = []
    for (const [f, m] of mods) {
      const reads = topLevelReads(m.sf)
      for (const [name, from] of m.imports)
        if (from !== f && sccOf.get(from) === sccOf.get(f) && reads.has(name))
          bad.push(`${relative(ROOT, f)} reads ${name} from ${relative(ROOT, from)}`)
    }
    expect(bad).toEqual([])
  })
})
