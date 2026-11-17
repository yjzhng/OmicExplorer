import { describe, expect, it } from 'vitest'

import { showTable, shownTableExport, tableOnShow } from './tableOnShow'

describe('the table on show', () => {
  const columns = [
    { key: 'gene', label: 'gene' },
    { key: 'log2FC', label: 'log₂FC', format: (v: unknown) => (v as number).toFixed(1) },
    { key: 'signf', label: 'signf' },
    { key: 'effect', label: 'effect', format: (v: unknown) => (v === 'up' ? 'Up in drug' : '—') }
  ]

  it('writes its columns as headed on screen, numbers at full precision', () => {
    const t = shownTableExport({
      columns,
      rows: [
        { gene: 'A', log2FC: 1.23456, signf: true, effect: 'up' },
        { gene: 'B', log2FC: Number.NaN, signf: false, effect: 'none' }
      ]
    })
    expect(t.columns).toEqual(['gene', 'log₂FC', 'signf', 'effect'])
    expect(t.rows).toEqual([
      ['A', 1.23456, 'true', 'Up in drug'],
      ['B', null, 'false', '—']
    ])
  })

  it('is registered while on show, and gone after', () => {
    const table = { columns, rows: [] }
    const off = showTable('g/s', table)
    expect(tableOnShow('g/s')).toBe(table)
    off()
    expect(tableOnShow('g/s')).toBeUndefined()
  })
})
