import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dropCiteSection, fillInstruction, releaseBody } from './releaseBody'

const INSTRUCTION = [
  'Intro.',
  '',
  '## Install',
  '',
  'Get **App-{{VERSION}}-arm64.dmg**.',
  '',
  '## Cite this software',
  '',
  '```text',
  '{{CITATION}}',
  '```',
  '',
  'DOI: {{DOI}}',
  ''
].join('\n')

const CITE = (ref: string): string =>
  ['## Cite this software', '', '```text', ref, '```', '', 'DOI: 10.1234/abc.5', ''].join('\n')

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'relbody-'))
  mkdirSync(join(root, 'releases'))
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(root, 'releases', name), text)
  return root
}

describe('release body', () => {
  it('drops the cite section while no version gives a citation', () => {
    const body = releaseBody(
      repo({ 'instruction.md': INSTRUCTION, 'v1.0.0.md': '## Features\n\n- A' }),
      '1.0.0',
      '2026'
    )!
    expect(body).toContain('App-1.0.0-arm64.dmg')
    expect(body).not.toMatch(/Cite this software|\{\{/)
    expect(body).toContain(
      "<summary><b>What's new in 1.0.0</b></summary>\n\n## Features\n\n- A\n\n</details>"
    )
  })

  it('fills the cite section from the newest earlier notes, and keeps it out of the changelog', () => {
    const body = releaseBody(
      repo({
        'instruction.md': INSTRUCTION,
        'v1.0.0.md': `## Features\n\n- A\n\n${CITE('Doe J. App v{{VERSION}} ({{YEAR}}).')}`,
        'v1.1.0.md': '## Fixes\n\n- B'
      }),
      '1.1.0',
      '2026'
    )!
    expect(body).toContain('Doe J. App v1.1.0 (2026).')
    expect(body).toContain('DOI: [10.1234/abc.5](https://doi.org/10.1234/abc.5)')
    expect(body.match(/Cite this software/g)).toHaveLength(1)
  })

  it('is null without the version notes', () => {
    expect(releaseBody(repo({ 'instruction.md': INSTRUCTION }), '1.0.0', '2026')).toBeNull()
  })

  it('drops the DOI line when the citation has no DOI', () => {
    const out = fillInstruction(INSTRUCTION, '1.0.0', { reference: 'Ref $1', doi: null })
    expect(out).toContain('Ref $1')
    expect(out).not.toContain('DOI')
  })

  it('removes a cite section up to the next heading', () => {
    expect(dropCiteSection(`## A\n\nx\n\n${CITE('R')}## B\n\ny\n`)).toBe('## A\n\nx\n\n## B\n\ny\n')
  })
})
