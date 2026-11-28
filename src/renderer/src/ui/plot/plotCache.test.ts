import { describe, expect, it } from 'vitest'
import { plotCached } from './plotCache'

describe('plotCached', () => {
  it('builds once per name and inputs (objects by identity, the rest by value)', () => {
    const rows = [{ a: 1 }]
    let built = 0
    const get = (k: number, o: object = rows): unknown =>
      plotCached('t', [o, k], () => ({ n: ++built }))
    const first = get(1)
    expect(get(1)).toBe(first)
    expect(built).toBe(1)
    expect(get(2)).not.toBe(first)
    expect(get(1, [{ a: 1 }])).not.toBe(first)
    expect(plotCached('other', [rows, 1], () => 'x')).toBe('x')
  })
  it('keeps the latest few per object', () => {
    const rows = {}
    const first = plotCached('t', [rows, 0], () => ({}))
    for (let i = 1; i < 20; i++) plotCached('t', [rows, i], () => ({}))
    expect(plotCached('t', [rows, 0], () => ({}))).not.toBe(first)
  })
  it('tells a string from a number of the same text', () => {
    const rows = {}
    expect(plotCached('t', [rows, 1], () => 'num')).toBe('num')
    expect(plotCached('t', [rows, '1'], () => 'str')).toBe('str')
  })
})
