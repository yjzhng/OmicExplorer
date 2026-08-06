// Desktop compat harness — screenshot every aspect-ratio preset on THIS OS, then
// diff against committed baselines. Derives presets from package.json.
//
//   npm run compat           capture + diff vs compat/baselines/<os>/ (fails on drift)
//   npm run compat -- --update   capture + (re)write baselines
//
// Baselines are environment-specific (fonts/scaling differ per OS) — generate and
// commit them from the SAME environment that runs the check (typically CI). Run
// per-OS in CI; Linux needs `xvfb-run`.
import { execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { compareToBaseline } from './lib/visual-diff.mjs'

const require = createRequire(import.meta.url)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'))
const presets = Object.keys(pkg.appConfig?.platforms?.aspectRatios ?? {})
const update = process.argv.includes('--update')
const DIFF_RATIO_MAX = 0.01 // >1% of pixels differing = regression

if (presets.length === 0) {
  console.log('No aspectRatios in appConfig.platforms — nothing to capture.')
  process.exit(0)
}

const osName =
  { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform] ?? process.platform
const shotDir = resolve(repo, 'compat/screenshots', osName)
const baseDir = resolve(repo, 'compat/baselines', osName)
const diffDir = resolve(repo, 'compat/diffs', osName)
const mainEntry = resolve(repo, 'out/main/index.js')
const electronBin = require('electron')

if (!existsSync(mainEntry)) {
  console.log('Building app first…')
  execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: 'inherit' })
}
mkdirSync(shotDir, { recursive: true })
mkdirSync(baseDir, { recursive: true })

// Ensure Electron runs AS Electron (some shells set ELECTRON_RUN_AS_NODE=1).
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// 1. Capture.
console.log(`Capturing ${presets.length} presets on ${osName}…`)
for (const preset of presets) {
  execFileSync(
    electronBin,
    [mainEntry, `--shoot=${preset}`, `--out=${resolve(shotDir, `${preset}.png`)}`],
    { cwd: repo, stdio: 'inherit', env }
  )
}

// 2. Diff (or promote to baseline with --update / on first run).
let failures = 0
let baselined = 0
for (const preset of presets) {
  const { status, ratio } = compareToBaseline(
    resolve(shotDir, `${preset}.png`),
    resolve(baseDir, `${preset}.png`),
    resolve(diffDir, `${preset}.png`),
    { update, ratioMax: DIFF_RATIO_MAX }
  )
  if (status === 'baselined') {
    baselined++
    console.log(`● ${preset}: baseline ${update ? 'updated' : 'created'}`)
  } else if (status === 'match') {
    console.log(`✓ ${preset}: match`)
  } else if (status === 'size') {
    console.error(`✗ ${preset}: dimensions changed`)
    failures++
  } else {
    console.error(
      `✗ ${preset}: ${(ratio * 100).toFixed(2)}% differ → compat/diffs/${osName}/${preset}.png`
    )
    failures++
  }
}

if (baselined) console.log(`\n${baselined} baseline(s) written for ${osName}.`)
if (failures) {
  console.error(`\n${failures} preset(s) drifted from baseline.`)
  process.exit(1)
}
console.log('\nAll presets match baseline.')
