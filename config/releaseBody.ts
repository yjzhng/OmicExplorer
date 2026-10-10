/** Release time: a GitHub release's body, assembled from the version-controlled notes (the repo,
 *  not the web UI, owns it — see .github/workflows/release.yml):
 *
 *    releases/instruction.md  — the shared general section (intro, install, cite), at the TOP of
 *                               every release; `{{VERSION}}` is the release's version.
 *    releases/v<version>.md   — that version's notes only, appended UNDER it inside a collapsed
 *                               <details> block, so the install section stays in view.
 *
 *  The "Cite this software" section is filled from the newest notes up to this version that give
 *  a citation (as the app's home page does — see citation.ts), and dropped while none does. A
 *  version's own notes keep theirs only as the source: it's left out of the changelog block. */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readCitation, type Citation } from './citation'

/** `markdown` without its `## Cite this software` section (up to the next `##` heading). */
export function dropCiteSection(markdown: string): string {
  return markdown.replace(/^##\s+Cite this software\s*$[\s\S]*?(?=^##\s|(?![\s\S]))/im, '')
}

/** The shared section with its placeholders filled; the cite section dropped without a citation. */
export function fillInstruction(
  instruction: string,
  version: string,
  citation: Citation | null
): string {
  const text = instruction.replace(/\{\{VERSION\}\}/g, version)
  if (!citation) return dropCiteSection(text)
  return (
    text
      // A function replacement, so `$` in a reference is taken literally.
      .replace(/\{\{CITATION\}\}/g, () => citation.reference)
      .replace(/^.*\{\{DOI\}\}.*$/gm, (line) =>
        citation.doi
          ? line.replace(/\{\{DOI\}\}/g, `[${citation.doi}](https://doi.org/${citation.doi})`)
          : ''
      )
  )
}

/** The release body for `version` (no leading v), from the repo at `root`. null when the version
 *  has no notes file (the workflow then falls back to GitHub's generated notes). */
export function releaseBody(root: string, version: string, year: string): string | null {
  const notesPath = join(root, 'releases', `v${version}.md`)
  if (!existsSync(notesPath)) return null
  const instrPath = join(root, 'releases', 'instruction.md')
  const head = existsSync(instrPath)
    ? fillInstruction(
        readFileSync(instrPath, 'utf8'),
        version,
        readCitation(root, version, year)
      ).trimEnd() + '\n\n'
    : ''
  const notes = dropCiteSection(readFileSync(notesPath, 'utf8')).trim()
  // Blank lines around the notes so GitHub renders the Markdown inside the disclosure.
  return `${head}<details>\n<summary><b>What's new in ${version}</b></summary>\n\n${notes}\n\n</details>\n`
}
