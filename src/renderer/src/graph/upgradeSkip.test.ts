import { describe, expect, it } from 'vitest'
import { upgradeProjectFile, type RawProject } from './upgrades'

const ctx = { nextFolderId: () => 'fd-1' }
/** a project whose one config still names the strain condition (before 0.3.3) */
const file = (appVersion?: string): RawProject =>
  ({
    ...(appVersion ? { appVersion } : null),
    folders: [
      {
        id: 'fd-0',
        workflows: [
          { id: 'wf-0', doc: { version: 1, nodes: [], edges: [] }, legacy: { condition: 'strain' } }
        ]
      }
    ]
  }) as RawProject
const legacyOf = (raw: RawProject): unknown =>
  (raw.folders?.[0]?.workflows?.[0] as { legacy?: unknown } | undefined)?.legacy

describe('upgradeProjectFile', () => {
  it('runs every step on a file that names no release', () => {
    expect(legacyOf(upgradeProjectFile(file(), ctx))).toEqual({ condition: 'cell' })
  })
  it('runs a step on a file saved by its own release or before', () => {
    expect(legacyOf(upgradeProjectFile(file('0.3.3'), ctx))).toEqual({ condition: 'cell' })
    expect(legacyOf(upgradeProjectFile(file('0.3.2'), ctx))).toEqual({ condition: 'cell' })
  })
  it('skips the steps from before the release that saved the file', () => {
    expect(legacyOf(upgradeProjectFile(file('0.3.4'), ctx))).toEqual({ condition: 'strain' })
  })
})
