/** Build-time: the "Cite this software" section of the release notes, for the app's home page.
 *
 *  The release-note template (releases/instruction.md) has the section with placeholders
 *  (`{{CITATION}}`, `{{DOI}}`), filled in when a release's notes are put together. The actual
 *  reference is written in a version's own notes (releases/v<version>.md) — once, when it first
 *  applies (the software's first citation, an updated paper): a version without one carries
 *  forward the newest earlier version's. So each build cites what its release notes say.
 *
 *  Expected shape (Markdown, as GitHub renders it — the fenced block gets GitHub's copy button):
 *
 *    ## Cite this software
 *
 *    Any intro text.
 *
 *    ```text
 *    The full reference, on one or more lines.
 *    ```
 *
 *    DOI: [10.xxxx/yyyy](https://doi.org/10.xxxx/yyyy)     ← optional; any form holding a DOI
 *
 *  `{{VERSION}}` and `{{YEAR}}` are filled in; a section still holding any other placeholder is
 *  the template's, and counts as none. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Citation {
  /** the full reference, as written in the fenced block */
  reference: string
  /** a bare DOI (10.xxxx/yyyy), when the section names one */
  doi: string | null
}

/** The "Cite this software" section of a Markdown document, parsed; null when it has none (or the
 *  section has no fenced reference). */
export function parseCitation(
  markdown: string,
  vars: Record<string, string> = {}
): Citation | null {
  const text = markdown.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m)
  const head = /^##\s+Cite this software\s*$/im.exec(text)
  if (!head) return null
  const rest = text.slice(head.index + head[0].length)
  const next = /^##\s/m.exec(rest)
  const section = next ? rest.slice(0, next.index) : rest
  const fence = /^```[^\n]*\n([\s\S]*?)\n```/m.exec(section)
  if (!fence) return null
  const reference = fence[1].trim()
  if (/\{\{\w+\}\}/.test(reference)) return null // an unfilled template
  // The DOI is looked for outside the reference, so a DOI quoted inside it isn't mistaken for the
  // section's own DOI line (it still shows, within the reference).
  const outside = section.replace(fence[0], '').replace(/<!--[\s\S]*?-->/g, '')
  const doi = /\b(10\.\d{4,9}\/[^\s)\]>"]+)/.exec(outside)?.[1].replace(/[.,;]+$/, '') ?? null
  return reference ? { reference, doi } : null
}

/** `1.2.10` → [1, 2, 10], for ordering versions. */
const parts = (v: string): number[] => v.split('.').map((n) => parseInt(n, 10) || 0)
const compare = (a: string, b: string): number => {
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** The citation for `version`: from the newest release notes, up to that version, that give one
 *  (releases/v<x.y.z>.md). null when none does yet. */
export function readCitation(root: string, version: string, year: string): Citation | null {
  const dir = join(root, 'releases')
  if (!existsSync(dir)) return null
  const versions = readdirSync(dir)
    .map((f) => /^v(\d+(?:\.\d+)*)\.md$/.exec(f)?.[1])
    .filter((v): v is string => !!v && compare(v, version) <= 0)
    .sort((a, b) => compare(b, a))
  for (const v of versions) {
    const c = parseCitation(readFileSync(join(dir, `v${v}.md`), 'utf8'), {
      VERSION: version,
      YEAR: year
    })
    if (c) return c
  }
  return null
}
