import { describe, expect, it } from 'vitest'

import type { CompareResultRow } from '../engine'
import { contrastCurveSides } from './contrastPair'
import { axisAvailFor, type AxisGraph } from './registry'
import type { ContrastConfig, GraphNode, NodeResult } from './types'

/** A dose curve fit's row: a whole curve (no dose of its own), at a time. */
const curveRow = (uniqID: string, cmpd: string, time: number): CompareResultRow =>
  ({
    uniqID,
    cmpd,
    cell: 'c',
    dose: null,
    time,
    comparison: `${cmpd} | DMSO`,
    log2FC: 1,
    curve: { axis: 'dose', pec50: -1, slope: 1, front: 1, back: 2, x: [0, 1], y: [1, 2] }
  }) as unknown as CompareResultRow
const fit = (rows: CompareResultRow[]): NodeResult =>
  ({ kind: 'compare', cmp: { rows, comparisons: [] }, displayMap: {} }) as NodeResult

describe('a Contrast of Curve fits draws their curves', () => {
  const both = fit([curveRow('g1', 'A', 8), curveRow('g1', 'B', 8), curveRow('g2', 'A', 8)])
  it('one input split in two (compound A vs B): each side its own curves, named for it', () => {
    const cfg: ContrastConfig = {
      source: 'select',
      num: { cmpd: ['A'] },
      den: { cmpd: ['B'] }
    } as ContrastConfig
    const sides = contrastCurveSides(cfg, ['f'], { f: both }, 'dose', ['A side', 'B side'])!
    expect(sides[0].map((r) => r.cmpd)).toEqual(['A', 'A'])
    expect(sides[1].map((r) => r.cmpd)).toEqual(['B'])
    expect(sides[0][0].comparison).toBe('A side')
    expect(sides[1][0].comparison).toBe('B side')
  })
  it('two inputs: the two fits; none when a side isn’t curves over the axis', () => {
    const cfg = { source: 'pair', pairA: 'f1', pairB: 'f2' } as ContrastConfig
    const f1 = fit([curveRow('g1', 'A', 8)])
    const f2 = fit([curveRow('g1', 'A', 8)])
    const sides = contrastCurveSides(cfg, ['f1', 'f2'], { f1, f2 }, 'dose', ['WT', 'KO'])!
    expect(sides.map((s) => s[0].comparison)).toEqual(['WT', 'KO'])
    expect(contrastCurveSides(cfg, ['f1', 'f2'], { f1, f2 }, 'time', ['WT', 'KO'])).toBeNull()
    const ttest = fit([
      { ...curveRow('g1', 'A', 8), curve: undefined, dose: 10 } as CompareResultRow
    ])
    expect(
      contrastCurveSides(cfg, ['f1', 'f2'], { f1, f2: ttest }, 'dose', ['WT', 'KO'])
    ).toBeNull()
  })
  it('offers the Response plot of the axis its Curve fits fit over', () => {
    const node = (id: string, kind: string): GraphNode =>
      ({
        id,
        type: 'step',
        position: { x: 0, y: 0 },
        data: { kind, config: {}, status: 'done' }
      }) as GraphNode
    const g: AxisGraph = {
      nodes: [node('f', 'curveFit'), node('c', 'contrast')],
      edges: [{ source: 'f', target: 'c' }],
      results: {
        f: both,
        c: {
          kind: 'contrast',
          ctr: { rows: [{ uniqID: 'g1', dose: null, time: 8 }] },
          displayMap: {}
        } as unknown as NodeResult
      }
    }
    expect(axisAvailFor(g, 'c')).toEqual(['dose', 'time'])
  })
})
