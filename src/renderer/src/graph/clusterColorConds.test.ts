import { describe, expect, it } from 'vitest'
import { numericConds } from '../engine'

import {
  clusterColorConds,
  clusterColoring,
  clusterColorPicks,
  clusterColorWrite,
  clusterFadeCond,
  clusterFadeScheme,
  clusterGroupConds,
  clusterTwoConds,
  type ClusterConfig
} from './types'

/** dose and time numeric, no custom condition declared (the schema of these tests' data) */
const numeric = numericConds()

const cfg = (o: Partial<ClusterConfig>): ClusterConfig =>
  ({ method: 'pca', colorBy: 'cmpd', display: 'replicate', ...o }) as ClusterConfig

describe('cluster colour by up to two conditions', () => {
  it('reads colorBy alone until two are picked', () => {
    expect(clusterColorConds(cfg({}), numeric)).toEqual(['cmpd'])
    expect(clusterTwoConds(cfg({}), numeric)).toBeNull()
  })
  it('draws a colour and a dose/time shade, no arrows', () => {
    const c = cfg({ colorConds: ['cmpd', 'dose'] })
    expect(clusterColorConds(c, numeric)).toEqual(['cmpd', 'dose'])
    expect(clusterTwoConds(c, numeric)).toEqual({ color: ['cmpd'], shade: 'dose', arrow: 'none' })
  })
  it('drops the pair when colorBy is later switched to another condition, or to clusters', () => {
    expect(
      clusterColorConds(cfg({ colorBy: 'cell', colorConds: ['cmpd', 'dose'] }), numeric)
    ).toEqual(['cell'])
    expect(
      clusterColorConds(cfg({ colorBy: 'cluster', colorConds: ['cmpd', 'dose'] }), numeric)
    ).toEqual([])
  })
})

describe('cluster colour by a numeric condition', () => {
  it('takes no shade on top of dose or time', () => {
    expect(
      clusterColorConds(cfg({ colorBy: 'dose', colorConds: ['cmpd', 'dose'] }), numeric)
    ).toEqual(['dose'])
  })
})

describe('cluster colour by condition groups', () => {
  it('combines every condition unless some are picked, in the data’s order', () => {
    const active = ['cell', 'cmpd', 'dose', 'time'] as const
    expect(clusterGroupConds(cfg({ colorBy: 'groups' }), [...active])).toEqual([...active])
    expect(
      clusterGroupConds(cfg({ colorBy: 'groups', groupConds: ['time', 'cmpd'] }), [...active])
    ).toEqual(['cmpd', 'time'])
    // a pick the data no longer carries falls back to all
    expect(clusterGroupConds(cfg({ groupConds: ['temp' as never] }), ['cmpd'])).toEqual(['cmpd'])
  })
  it('takes no colour / shade pair', () => {
    const c = cfg({ colorBy: 'groups', colorConds: ['cmpd', 'dose'] })
    expect(clusterColorConds(c, numeric)).toEqual([])
    expect(clusterTwoConds(c, numeric)).toBeNull()
  })
})

describe('cluster colour by conditions: colour picks and a fade, as the user picks them', () => {
  const active = ['cell', 'cmpd', 'dose', 'time'] as const
  const all = [...active]
  const picks = (o: Partial<ClusterConfig>): string[] => clusterColorPicks(cfg(o), all, numeric)
  const fade = (o: Partial<ClusterConfig>): string | null => clusterFadeCond(cfg(o), all, numeric)
  it('writes one colour condition as itself, several as the condition groups — any types', () => {
    expect(clusterColorWrite(['dose'], null)).toMatchObject({
      colorBy: 'dose',
      colorPicks: ['dose']
    })
    for (const p of [
      ['cell', 'cmpd'],
      ['cmpd', 'dose'],
      ['dose', 'time']
    ] as const) {
      const w = clusterColorWrite([...p], null)
      expect(w).toMatchObject({ colorBy: 'groups', groupConds: [...p] })
      expect(clusterFadeScheme(cfg(w), all, numeric)).toBeNull()
    }
  })
  it('fades by the one numeric condition picked, drawn by the complex legend', () => {
    const w = clusterColorWrite(['cell', 'cmpd'], 'dose')
    expect(fade(w)).toBe('dose')
    expect(clusterFadeScheme(cfg(w), all, numeric)).toEqual({
      color: ['cell', 'cmpd'],
      shade: 'dose',
      arrow: 'none'
    })
  })
  it('never fades by a colour condition or a categorical one', () => {
    expect(clusterColorWrite(['cmpd', 'dose'], 'dose').fadeCond).toBeUndefined()
    expect(fade({ colorPicks: ['dose'], fadeCond: 'dose' })).toBeNull()
    expect(fade({ colorPicks: ['dose'], fadeCond: 'cell' })).toBeNull()
  })
  it('keeps the picks and the fade across colouring by cluster', () => {
    const w = { ...clusterColorWrite(['cmpd', 'time'], 'dose'), colorBy: 'cluster' as const }
    expect(picks(w)).toEqual(['cmpd', 'time'])
    expect(fade(w)).toBe('dose')
    expect(clusterFadeScheme(cfg(w), all, numeric)).toBeNull()
  })
  it('reads an older config back as its colour and fade', () => {
    expect(picks({ colorBy: 'cmpd' })).toEqual(['cmpd'])
    expect(fade({ colorBy: 'cmpd' })).toBeNull()
    expect(picks({ colorBy: 'cmpd', colorConds: ['cmpd', 'dose'] })).toEqual(['cmpd'])
    expect(fade({ colorBy: 'cmpd', colorConds: ['cmpd', 'dose'] })).toBe('dose')
    expect(picks({ colorBy: 'groups', groupConds: ['cell', 'time'] })).toEqual(['cell', 'time'])
    // by cluster, nothing picked yet: the default
    expect(picks({ colorBy: 'cluster' })).toEqual(['cell', 'cmpd'])
  })
  it('a new plot colours by every categorical condition and fades by the first numeric one', () => {
    expect(picks({ colorPicks: [] })).toEqual(['cell', 'cmpd'])
    expect(fade({ colorPicks: [] })).toBe('dose')
    // in the default condition order, whatever order the data lists them in
    expect(
      clusterColoring(cfg({ colorPicks: [] }), ['time', 'dose', 'cmpd', 'cell'], numeric)
    ).toEqual({ picks: ['cell', 'cmpd'], fade: 'dose' })
    // only numeric conditions: the first colours, the next fades
    expect(clusterColoring(cfg({ colorPicks: [] }), ['dose', 'time'], numeric)).toEqual({
      picks: ['dose'],
      fade: 'time'
    })
    // no numeric condition: no fade
    expect(clusterColoring(cfg({ colorPicks: [] }), ['cell', 'cmpd'], numeric)).toEqual({
      picks: ['cell', 'cmpd'],
      fade: null
    })
  })
  it('an explicit "none" fade stays none', () => {
    expect(fade(clusterColorWrite(['cell', 'cmpd'], null))).toBeNull()
  })
})
