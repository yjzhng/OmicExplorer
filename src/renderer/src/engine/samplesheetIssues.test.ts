/** The samplesheet rule both imports enforce: every condition in use filled, dose and time numbers. */
import { describe, expect, it } from 'vitest'

import {
  manualSheetIssues,
  samplesheetIssues,
  sheetIssueLines,
  sheetIssueText,
  standardize
} from './ingest'

const row = (
  sample: string,
  cmpd: string,
  dose: string,
  time = ''
): Record<string, string> & {
  sample: string
} => ({ sample, cell: '', cmpd, dose, time })

describe('samplesheetIssues', () => {
  it('passes a complete sheet; an unused condition is fine', () => {
    expect(samplesheetIssues([row('s1', 'A', '10'), row('s2', 'DMSO', '0')])).toEqual([])
  })
  it('flags a condition in use left empty, and a dose that is not a number', () => {
    const i = samplesheetIssues([
      row('s1', 'A', '10'),
      row('s2', 'DMSO', ''),
      row('s3', 'DMSO', 'DMSO')
    ])
    expect(i.map((x) => `${x.field}:${x.kind}`)).toEqual(['dose:empty', 'dose:notNumber'])
    expect(i[0].samples).toEqual(['s2'])
    expect(sheetIssueText(i[1])).toContain('“DMSO” (1 sample: s3)')
  })
  it('a custom condition in use must be filled too; rep may stay empty', () => {
    const i = samplesheetIssues(
      [
        { ...row('s1', 'A', '1'), batch: 'b1', rep: '' },
        { ...row('s2', 'A', '2'), batch: '', rep: '' }
      ],
      ['batch']
    )
    expect(i.map((x) => `${x.field}:${x.kind}`)).toEqual(['batch:empty'])
  })
})

describe('standardize refuses an incomplete samplesheet', () => {
  it('names what to fix', () => {
    expect(() =>
      standardize({
        dataText: 'id,s1,s2\ng1,10,20\n',
        dataFilename: 'data_wide.csv',
        samplesheetText: 'sample,cmpd,dose\ns1,A,10\ns2,DMSO,DMSO\n'
      } as never)
    ).toThrow(/dose must be a number/)
  })
})

describe('standardize needs a sample column', () => {
  it('in the samplesheet — well / position are not read as one', () => {
    expect(() =>
      standardize({
        dataText: 'id,A1,A2\ng1,10,20\n',
        dataFilename: 'data_datamatrix.csv',
        samplesheetText: 'well,cmpd\nA1,A\nA2,B\n'
      } as never)
    ).toThrow(/needs a 'sample' column/)
  })

  it('in a long data file', () => {
    expect(() =>
      standardize({
        dataText: 'id,well,value\ng1,s1,10\ng1,s2,20\n',
        dataFilename: 'data_long.csv',
        samplesheetText: 'sample,cmpd\ns1,A\ns2,B\n'
      } as never)
    ).toThrow(/long file needs a 'sample' column/)
  })
})

describe('manualSheetIssues — the manual Load page’s check', () => {
  const data = 'id,s1,s2\ng1,10,20\n'

  it('passes a complete sheet', () => {
    expect(manualSheetIssues('sample,cmpd,dose\ns1,A,10\ns2,B,5\n', data, 'd.csv')).toEqual({
      noSample: false,
      issues: []
    })
  })

  it('flags an empty condition and a non-numeric dose, custom conditions included', () => {
    const r = manualSheetIssues(
      'sample,cmpd,dose,medium\ns1,A,10,LB\ns2,,DMSO,\ns3,C,1,LB\n',
      data,
      'd.csv'
    )
    expect(r.issues.map((i) => `${i.field}:${i.kind}`).sort()).toEqual([
      'cmpd:empty',
      'dose:notNumber',
      'medium:empty'
    ])
  })

  it('checks only the samples the data carries', () => {
    // s3 is broken but not in the data, so the run ignores it — and so does the check
    expect(manualSheetIssues('sample,cmpd\ns1,A\ns2,B\ns3,\n', data, 'd.csv').issues).toEqual([])
  })

  it('reports a missing sample column', () => {
    expect(manualSheetIssues('well,cmpd\nA1,A\n', data, 'd.csv').noSample).toBe(true)
  })
})

describe('issue messages stay short on a large sheet', () => {
  it('names at most three bad values, counting the rest', () => {
    const text = sheetIssueText({
      field: 'dose',
      kind: 'notNumber',
      samples: [],
      values: ['a', 'b', 'c', 'd', 'e'].map((v) => ({ value: v, samples: [`s_${v}`] }))
    })
    expect(text).toBe(
      'dose must be a number — “a” (1 sample: s_a); “b” (1 sample: s_b); “c” (1 sample: s_c); +2 more values'
    )
  })

  it('shows at most five issues, counting the rest', () => {
    const issues = Array.from({ length: 8 }, (_, k) => ({
      field: `c${k}`,
      kind: 'empty' as const,
      values: [],
      samples: ['s1']
    }))
    const lines = sheetIssueLines(issues)
    expect(lines).toHaveLength(6)
    expect(lines[5]).toBe('+3 more issues')
  })
})
