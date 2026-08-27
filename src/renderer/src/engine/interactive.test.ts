import { describe, expect, it } from 'vitest'

import {
  applyFieldRule,
  buildStandardInputs,
  deriveFieldRule,
  guessRoles,
  guessRolesPreset,
  MATRIX_PRESETS,
  parseMatrix,
  type InteractiveSampleCond
} from './interactive'
import { standardize } from './ingest'

const META = [
  'Protein.Group',
  'Protein.Names',
  'Genes',
  'First.Protein.Description',
  'N.Sequences',
  'N.Proteotypic.Sequences',
  'Global.PG.Q.Value' // a plain-named numeric QC column — must NOT be a sample
]
// Run columns as file paths, mixing Windows and POSIX separators + an MS extension,
// to exercise the run-header sample-column guess. Sample IDs keep the raw header verbatim.
// Values are synthetic.
const RUNS = ['D:\\ms\\proj\\run_x1.d', 'D:\\ms\\proj\\run_x2.d', '/data/ms/run_y1.d']
const row = (vals: string[]): string => vals.join('\t')
const MATRIX = [
  row([...META, ...RUNS]),
  row(['PRT001', 'name1', 'G1', 'desc one', '3', '3', '0.01', '100', '200', '300']),
  row(['PRT002', 'name2', 'G2', 'desc two', '5', '4', '0.02', '150', '250', '350'])
].join('\n')

describe('parseMatrix / guessRoles', () => {
  it('parses columns and a first-row sample value', () => {
    const info = parseMatrix(MATRIX)
    expect(info.columns).toHaveLength(10)
    expect(info.sample['Genes']).toBe('G1')
  })

  it('guesses run-like columns as samples, an id, and a gene label', () => {
    const roles = guessRoles(parseMatrix(MATRIX))
    expect(roles['Protein.Group']).toBe('id')
    expect(roles['Genes']).toBe('label')
    expect(roles['D:\\ms\\proj\\run_x1.d']).toBe('sample')
    // Known annotation column → metadata; an unrecognised QC column → ignore (not metadata).
    expect(roles['First.Protein.Description']).toBe('meta')
    expect(roles['Global.PG.Q.Value']).toBe('ignore')
    expect(roles['N.Sequences']).toBe('ignore')
  })
})

describe('guessRolesPreset', () => {
  it('lists None + the three tool presets in menu order', () => {
    expect(MATRIX_PRESETS.map((p) => p.value)).toEqual([
      'none',
      'diann',
      'spectronaut',
      'maxquant'
    ])
  })

  it('none paints nothing (all columns Ignore)', () => {
    const roles = guessRolesPreset(parseMatrix(MATRIX), 'none')
    expect(new Set(Object.values(roles))).toEqual(new Set(['ignore']))
  })

  it('leaves id unset when no known id column is present (no fallback)', () => {
    const NO_ID = [
      ['Accession', 'PG.Genes', '[1] S1.raw.PG.Quantity'].join('\t'),
      ['P1', 'G1', '100'].join('\t')
    ].join('\n')
    const roles = guessRolesPreset(parseMatrix(NO_ID), 'spectronaut')
    expect(Object.values(roles)).not.toContain('id')
    expect(roles['Accession']).toBe('ignore') // not force-assigned as id
    expect(roles['[1] S1.raw.PG.Quantity']).toBe('sample')
  })

  it('classifies a Spectronaut pivot report (.PG.Quantity → sample)', () => {
    const SN = [
      ['PG.ProteinGroups', 'PG.Genes', 'PG.ProteinNames', '[1] S1.raw.PG.Quantity', '[2] S2.raw.PG.Quantity'].join('\t'),
      ['P1', 'G1', 'name one', '100', '200'].join('\t'),
      ['P2', 'G2', 'name two', '150', '250'].join('\t')
    ].join('\n')
    const roles = guessRolesPreset(parseMatrix(SN), 'spectronaut')
    expect(roles['PG.ProteinGroups']).toBe('id')
    expect(roles['PG.Genes']).toBe('label')
    expect(roles['[1] S1.raw.PG.Quantity']).toBe('sample')
    expect(roles['[2] S2.raw.PG.Quantity']).toBe('sample')
    expect(roles['PG.ProteinNames']).toBe('meta')
  })

  it('classifies a MaxQuant proteinGroups table (LFQ intensity → sample, bare Intensity → meta)', () => {
    const MQ = [
      ['Protein IDs', 'Majority protein IDs', 'Gene names', 'Intensity', 'LFQ intensity S1', 'LFQ intensity S2', 'Q-value'].join('\t'),
      ['P1', 'P1', 'G1', '900', '100', '200', '0.01'].join('\t'),
      ['P2', 'P2', 'G2', '800', '150', '250', '0.02'].join('\t')
    ].join('\n')
    const roles = guessRolesPreset(parseMatrix(MQ), 'maxquant')
    expect(roles['Protein IDs']).toBe('id')
    expect(roles['Gene names']).toBe('label')
    expect(roles['LFQ intensity S1']).toBe('sample')
    expect(roles['LFQ intensity S2']).toBe('sample')
    // A known annotation column → metadata; the bare summary "Intensity" and QC column → ignore.
    expect(roles['Majority protein IDs']).toBe('meta')
    expect(roles['Intensity']).toBe('ignore')
    expect(roles['Q-value']).toBe('ignore')
  })
})

describe('deriveFieldRule / applyFieldRule', () => {
  // Two names of DIFFERENT token counts (the second compound has an internal '_').
  const n1 = 'B_M_SA_90_drugA_1_w1_9' // 8 tokens
  const n2 = 'B_M_SA_90_KRAS_PROTAC_1_w2_9' // 9 tokens

  it('a leading field (strain) stays start-anchored across both names', () => {
    const at = n1.indexOf('SA')
    const rule = deriveFieldRule(n1, at, at + 2)!
    expect(applyFieldRule(n1, rule)).toBe('SA')
    expect(applyFieldRule(n2, rule)).toBe('SA')
  })

  it('a trailing field (rep) stays end-anchored on a longer name', () => {
    const at = n1.indexOf('_1_') + 1 // the rep token '1'
    const rule = deriveFieldRule(n1, at, at + 1)!
    expect(applyFieldRule(n1, rule)).toBe('1')
    expect(applyFieldRule(n2, rule)).toBe('1')
  })

  it('a middle field captures an internal delimiter via both-sided anchoring', () => {
    // Taught on n1's single-token compound; the same anchors capture n2's two-token compound
    // because each edge is anchored from its closer end (extra tokens fall in the middle).
    const at = n1.indexOf('drugA')
    const rule = deriveFieldRule(n1, at, at + 'drugA'.length)!
    expect(applyFieldRule(n1, rule)).toBe('drugA')
    expect(applyFieldRule(n2, rule)).toBe('KRAS_PROTAC')
  })

  it('returns null for an empty selection', () => {
    expect(deriveFieldRule(n1, 3, 3)).toBeNull()
  })
})

describe('buildStandardInputs', () => {
  const roles = guessRoles(parseMatrix(MATRIX))
  const RX1 = 'D:\\ms\\proj\\run_x1.d'
  const RX2 = 'D:\\ms\\proj\\run_x2.d'
  const RY1 = '/data/ms/run_y1.d'

  it('emits wide data (raw sample headers) and a uniqID→gene db', () => {
    const a = buildStandardInputs(MATRIX, { roles, conditions: {} })
    expect(a.dataFilename).toMatch(/_wide\.csv$/)
    const header = a.dataText.split(/\r?\n/)[0]
    expect(header.startsWith('uniqID,')).toBe(true)
    expect(header).toContain('run_x1.d') // raw header kept verbatim
    expect(a.dbText.split(/\r?\n/)[0].startsWith('uniqID,gene')).toBe(true)
    expect(a.dbText).toContain('PRT001,G1,') // gene from the label (Genes) column
  })

  it('drops a sample marked include:false', () => {
    const conditions: Record<string, InteractiveSampleCond> = {
      [RX2]: { sample: RX2, include: false, strain: '', cmpd: '', dose: '', time: '', rep: '' }
    }
    const a = buildStandardInputs(MATRIX, { roles, conditions })
    expect(a.dataText).not.toContain('run_x2.d')
    expect(a.samplesheetText).not.toContain('run_x2.d')
  })

  it('output feeds the unchanged standardize() end-to-end', () => {
    const cond = (h: string, cmpd: string): InteractiveSampleCond => ({
      sample: h,
      strain: '',
      cmpd,
      dose: '',
      time: '',
      rep: '1'
    })
    const conditions = {
      [RX1]: cond(RX1, 'drugA'),
      [RX2]: cond(RX2, 'drugA'),
      [RY1]: cond(RY1, 'vehicle')
    }
    const a = buildStandardInputs(MATRIX, { roles, conditions })
    const std = standardize({
      dataText: a.dataText,
      dataFilename: a.dataFilename,
      samplesheetText: a.samplesheetText,
      dbText: a.dbText
    })
    expect(std.rows).toHaveLength(6) // 2 proteins × 3 samples
    expect(new Set(std.rows.map((r) => r.cmpd))).toEqual(new Set(['drugA', 'vehicle']))
    expect(std.displayMap['PRT001']).toBe('G1')
  })
})
