// Shared visual-diff: compare a screenshot to its baseline, emit a diff image on
// drift. Used by both desktop (compat.mjs) and mobile (compat-mobile.mjs).
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

/**
 * @returns {{status: 'baselined'|'match'|'diff'|'size', ratio: number}}
 *   baselined — no baseline existed (or --update); wrote the current shot as baseline
 *   match     — within threshold
 *   diff      — over threshold; wrote diffOut
 *   size      — dimensions changed (always a failure)
 */
export function compareToBaseline(shot, baseline, diffOut, opts = {}) {
  const { update = false, threshold = 0.1, ratioMax = 0.01 } = opts
  if (update || !existsSync(baseline)) {
    mkdirSync(dirname(baseline), { recursive: true })
    copyFileSync(shot, baseline)
    return { status: 'baselined', ratio: 0 }
  }
  const a = PNG.sync.read(readFileSync(baseline))
  const b = PNG.sync.read(readFileSync(shot))
  if (a.width !== b.width || a.height !== b.height) {
    return { status: 'size', ratio: 1 }
  }
  const diff = new PNG({ width: a.width, height: a.height })
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold })
  const ratio = changed / (a.width * a.height)
  if (ratio > ratioMax) {
    mkdirSync(dirname(diffOut), { recursive: true })
    writeFileSync(diffOut, PNG.sync.write(diff))
    return { status: 'diff', ratio }
  }
  return { status: 'match', ratio }
}
