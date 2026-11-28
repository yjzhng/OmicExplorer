import { describe, expect, it } from 'vitest'

import { dirOf, relativeTo, resolveFrom } from './relPath'

describe('relPath', () => {
  it('finds the folder of a file', () => {
    expect(dirOf('/Users/a/study/p.omicexplorer')).toBe('/Users/a/study')
    expect(dirOf('C:\\data\\p.omicexplorer')).toBe('C:\\data')
    expect(dirOf('/p.omicexplorer')).toBe('/')
  })

  it('relates POSIX paths: inside, beside, above, same', () => {
    expect(relativeTo('/Users/a/study', '/Users/a/study/exp1')).toBe('exp1')
    expect(relativeTo('/Users/a/study', '/Users/a/other/exp1')).toBe('../other/exp1')
    expect(relativeTo('/Users/a/study/proj', '/Users/a')).toBe('../..')
    expect(relativeTo('/Users/a/study', '/Users/a/study')).toBe('.')
  })

  it('relates Windows paths on one drive, and none across drives', () => {
    expect(relativeTo('C:\\data\\proj', 'C:\\data\\exp1')).toBe('../exp1')
    expect(relativeTo('C:\\data', 'c:\\Data\\exp1')).toBe('exp1')
    expect(relativeTo('C:\\data', 'D:\\exp1')).toBeNull()
    expect(relativeTo('\\\\srv\\share\\p', '\\\\srv\\other\\x')).toBeNull()
    expect(relativeTo('C:\\data', '/Users/a')).toBeNull()
  })

  it('resolves back to the same place, and onto a new machine', () => {
    for (const [from, to] of [
      ['/Users/a/study', '/Users/a/other/exp1'],
      ['/Users/a/study', '/Users/a/study/exp1'],
      ['C:\\data\\proj', 'C:\\data\\exp1'],
      ['\\\\srv\\share\\p', '\\\\srv\\share\\x\\y']
    ]) {
      expect(resolveFrom(from, relativeTo(from, to) as string)).toBe(to)
    }
    // the project and its folders copied together under another user's home
    const rel = relativeTo('/Users/a/study', '/Users/a/study/exp1') as string
    expect(resolveFrom('/Volumes/usb/study', rel)).toBe('/Volumes/usb/study/exp1')
    expect(resolveFrom('/Users/b/study', '.')).toBe('/Users/b/study')
  })
})
