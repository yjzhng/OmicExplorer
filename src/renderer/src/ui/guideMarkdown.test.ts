/** The User guide's Markdown dialect, and the shipped guide itself parsing cleanly. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseGuide, parseInline, searchGuide } from './guideMarkdown'
import { NODE_SPECS } from '../graph/registry'

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
        '[[layouts]]',
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
      { type: 'visual', name: 'layouts' },
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
      // …nor a tile of a kind the app doesn't have
      for (const b of p.blocks)
        if (b.type === 'tiles')
          expect(
            b.tiles.map((t) => t.kind).filter((k) => !(k in NODE_SPECS)),
            p.title
          ).toEqual([])
      // …nor a [[name]] within a line that names no app element
      const texts = p.blocks.flatMap((b) =>
        b.type === 'p' || b.type === 'h' ? [b.text] : b.type === 'ul' ? b.items : []
      )
      expect(
        texts.flatMap((t) => parseInline(t).filter((x) => x.kind === 'unknown')),
        p.title
      ).toEqual([])
    }
  })
})

describe('parseInline', () => {
  it('reads [[element]] within a line as the app element, an unknown one as written', () => {
    expect(parseInline('press [[run]] or [[nope]]')).toEqual([
      { kind: 'text', text: 'press ' },
      { kind: 'ui', name: 'run' },
      { kind: 'text', text: ' or ' },
      { kind: 'unknown', text: '[[nope]]' }
    ])
  })
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

describe('searchGuide', () => {
  const pages = parseGuide(
    [
      '# Clean data',
      '### Batch correction',
      'Removes each batch’s **offset** while protecting your conditions.',
      '- Imputation fills gaps with low values.',
      '# Compare',
      'A t-test per [[run]] group.'
    ].join('\n')
  )
  it('finds a block by its words, with the heading it sits under and a snippet', () => {
    const [hit, ...rest] = searchGuide(pages, 'offset')
    expect(rest).toEqual([])
    expect(hit.page.title).toBe('Clean data')
    expect(hit.heading).toBe('Batch correction')
    expect(hit.snippet.match).toBe('offset')
    expect(hit.snippet.before).toBe('Removes each batch’s ')
  })
  it('needs every word, counting the page title and heading', () => {
    expect(searchGuide(pages, 'batch protecting').length).toBe(1)
    expect(searchGuide(pages, 'clean imputation').map((h) => h.block)).toEqual([2])
    expect(searchGuide(pages, 'compare imputation')).toEqual([])
  })
  it('ignores case, markup and app elements', () => {
    expect(searchGuide(pages, 'T-TEST').length).toBe(1)
    expect(searchGuide(pages, 'run')).toEqual([])
    expect(searchGuide(pages, '   ')).toEqual([])
  })
})
