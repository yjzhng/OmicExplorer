/** The User guide's Markdown dialect, and the shipped guide itself parsing cleanly. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseGuide, parseInline } from './guideMarkdown'

describe('parseGuide', () => {
  it('splits pages and sub-pages, headings, paragraphs and bullets', () => {
    const pages = parseGuide(
      [
        '<!-- a note -->',
        '# One',
        'first line',
        'second line',
        '',
        '### Sub heading',
        '- a',
        '  continued',
        '- b',
        '## Two',
        'text'
      ].join('\n')
    )
    expect(pages.map((p) => [p.id, p.title, p.sub])).toEqual([
      ['one', 'One', false],
      ['two', 'Two', true]
    ])
    expect(pages[0].blocks).toEqual([
      { type: 'p', text: 'first line second line' },
      { type: 'h', text: 'Sub heading' },
      { type: 'ul', items: ['a continued', 'b'] }
    ])
  })

  it('reads the picture blocks', () => {
    const [page] = parseGuide(
      [
        '# P',
        '```steps',
        'A | does a | thing',
        '```',
        '```folder',
        'root/',
        '  file.csv | a note',
        '```',
        '```table id sample missing-zero',
        'ID | S1 | S2',
        'x | 1 |',
        '```',
        '```levels COG / KOG',
        'area | Info',
        '```',
        '[[tile]]',
        '[[nope]]'
      ].join('\n')
    )
    expect(page.blocks).toEqual([
      { type: 'steps', steps: [{ title: 'A', text: 'does a | thing' }] },
      {
        type: 'folder',
        entries: [
          { name: 'root/', depth: 0, folder: true },
          { name: 'file.csv', depth: 1, folder: false, note: 'a note' }
        ]
      },
      {
        type: 'table',
        head: ['ID', 'S1', 'S2'],
        kinds: ['id', 'sample', 'plain'],
        rows: [['x', '1', '']],
        missingZero: true
      },
      { type: 'levels', source: 'COG / KOG', levels: [{ label: 'area', example: 'Info' }] },
      { type: 'visual', name: 'tile' },
      { type: 'unknown', text: '[[nope]]' }
    ])
  })

  it('the shipped guide has pages and nothing it cannot place', () => {
    const md = readFileSync(join(__dirname, 'user-guide.md'), 'utf8')
    const pages = parseGuide(md)
    expect(pages.length).toBeGreaterThan(3)
    for (const p of pages) {
      expect(p.blocks.length, p.title).toBeGreaterThan(0)
      expect(
        p.blocks.filter((b) => b.type === 'unknown'),
        p.title
      ).toEqual([])
    }
  })
})

describe('parseInline', () => {
  it('splits bold and code, leaving code literal', () => {
    expect(parseInline('a **b** `c **d**` e')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'c **d**' },
      { kind: 'text', text: ' e' }
    ])
  })
})
