import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseCitation, readCitation } from './citation'

const notes = (body: string): string =>
  `Intro.\n\n## Highlights\n\n- x\n\n${body}\n\n## Install\n\nSteps.`

describe('parseCitation', () => {
  it('reads the fenced reference and fills in the version and year', () => {
    const c = parseCitation(
      notes(
        '## Cite this software\n\nPlease cite:\n\n```text\nA. Author ({{YEAR}}). App v{{VERSION}}.\n```'
      ),
      { VERSION: '1.2.0', YEAR: '2026' }
    )
    expect(c).toEqual({ reference: 'A. Author (2026). App v1.2.0.', doi: null })
  })

  it('takes a DOI from the section, in any form, but not from inside the reference', () => {
    const c = parseCitation(
      notes(
        '## Cite this software\n\n```text\nRef citing 10.1000/other.\n```\n\nDOI: [10.5281/zenodo.123](https://doi.org/10.5281/zenodo.123).'
      )
    )
    expect(c?.doi).toBe('10.5281/zenodo.123')
  })

  it('ignores a DOI in an HTML comment (a placeholder note)', () => {
    const c = parseCitation(
      notes('## Cite this software\n\n```text\nRef.\n```\n\n<!-- DOI: 10.1234/placeholder -->')
    )
    expect(c?.doi).toBeNull()
  })

  it('is null without the section or without a reference block', () => {
    expect(parseCitation(notes(''))).toBeNull()
    expect(parseCitation(notes('## Cite this software\n\nNo block.'))).toBeNull()
  })

  it('treats the template (unfilled placeholders) as no citation', () => {
    expect(
      parseCitation(notes('## Cite this software\n\n```text\n{{CITATION}}\n```\n\nDOI: {{DOI}}'))
    ).toBeNull()
  })
})

describe('readCitation', () => {
  it('carries forward the newest earlier version notes that give one', () => {
    const root = mkdtempSync(join(tmpdir(), 'cite-'))
    mkdirSync(join(root, 'releases'))
    const section = (ref: string): string => `## Cite this software\n\n\`\`\`text\n${ref}\n\`\`\`\n`
    writeFileSync(join(root, 'releases', 'v0.9.0.md'), section('Old (v{{VERSION}})'))
    writeFileSync(join(root, 'releases', 'v0.10.0.md'), section('Paper (v{{VERSION}})'))
    writeFileSync(join(root, 'releases', 'v0.10.1.md'), '## Fixes\n\n- x')
    writeFileSync(join(root, 'releases', 'v0.11.0.md'), section('Future'))
    writeFileSync(join(root, 'releases', 'instruction.md'), section('{{CITATION}}'))
    expect(readCitation(root, '0.10.1', '2026')?.reference).toBe('Paper (v0.10.1)')
    expect(readCitation(root, '0.9.5', '2026')?.reference).toBe('Old (v0.9.5)')
    expect(readCitation(root, '0.8.0', '2026')).toBeNull()
  })
})
