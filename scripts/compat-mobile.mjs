// Mobile compat (v3) — boot the iOS Simulator / Android emulator via Capacitor and
// screenshot each configured device, then diff against baselines (shared with the
// desktop harness). Derives targets from package.json (platforms.mobile + .devices).
//
//   npm run compat:mobile            capture + diff
//   npm run compat:mobile -- --update  capture + (re)write baselines
//
// Gated on: mobile configured · native project set up (npm run mobile:setup) ·
// platform tooling present. iOS needs macOS + Xcode; Android needs the SDK + a
// running/creatable emulator. Skips gracefully when a prerequisite is missing — this
// is the least CI-portable stage (iOS only on macOS runners).
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareToBaseline } from './lib/visual-diff.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'))
const platforms = pkg.appConfig?.platforms ?? {}
const mobile = (platforms.mobile ?? []).map((m) => m.toLowerCase())
const devices = platforms.devices ?? {}
const update = process.argv.includes('--update')

if (mobile.length === 0) {
  console.log('No mobile platforms in appConfig.platforms.mobile — nothing to do.')
  process.exit(0)
}
if (!existsSync(resolve(repo, 'capacitor.config.ts'))) {
  console.log('Mobile not set up — run: npm run mobile:setup')
  process.exit(0)
}

const has = (cmd) => {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, {
      stdio: 'ignore'
    })
    return true
  } catch {
    return false
  }
}
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: repo, stdio: 'inherit', ...opts })
const safe = (s) => s.replace(/[^\w.-]+/g, '_')

let failures = 0
let captured = 0

function record(platform, device, png) {
  const { status, ratio } = compareToBaseline(
    png,
    resolve(repo, 'compat/baselines', platform, `${safe(device)}.png`),
    resolve(repo, 'compat/diffs', platform, `${safe(device)}.png`),
    { update }
  )
  captured++
  if (status === 'baselined')
    console.log(`● ${platform}/${device}: baseline ${update ? 'updated' : 'created'}`)
  else if (status === 'match') console.log(`✓ ${platform}/${device}: match`)
  else {
    console.error(
      `✗ ${platform}/${device}: ${status === 'size' ? 'dimensions changed' : `${(ratio * 100).toFixed(2)}% differ`}`
    )
    failures++
  }
}

// Build the web bundle once — Capacitor copies it into the native projects.
sh('npm', ['run', 'build'])

// ---- iOS (macOS + Xcode + simulators) ----
if (mobile.includes('ios')) {
  if (process.platform !== 'darwin' || !has('xcrun')) {
    console.log('• iOS skipped — needs macOS with Xcode (xcrun).')
  } else if (!existsSync(resolve(repo, 'ios'))) {
    console.log('• iOS skipped — no ios/ project (run: npm run mobile:setup).')
  } else {
    for (const device of devices.ios ?? ['iPhone 15']) {
      const dir = resolve(repo, 'compat/screenshots/ios')
      mkdirSync(dir, { recursive: true })
      const out = resolve(dir, `${safe(device)}.png`)
      try {
        sh('xcrun', ['simctl', 'boot', device], { stdio: 'ignore' })
      } catch {
        /* already booted */
      }
      sh('npx', ['cap', 'run', 'ios', '--target', device]) // build → install → launch
      sh('xcrun', ['simctl', 'io', device, 'screenshot', out])
      record('ios', device, out)
    }
  }
}

// ---- Android (SDK + emulator + adb) ----
if (mobile.includes('android')) {
  if (!has('adb') || !has('emulator')) {
    console.log('• Android skipped — needs Android SDK (adb, emulator).')
  } else if (!existsSync(resolve(repo, 'android'))) {
    console.log('• Android skipped — no android/ project (run: npm run mobile:setup).')
  } else if ((devices.android ?? []).length === 0) {
    console.log('• Android skipped — no AVDs in platforms.devices.android.')
  } else {
    for (const avd of devices.android) {
      const dir = resolve(repo, 'compat/screenshots/android')
      mkdirSync(dir, { recursive: true })
      const out = resolve(dir, `${safe(avd)}.png`)
      sh('npx', ['cap', 'run', 'android', '--target', avd]) // build → install → launch
      sh('bash', ['-c', `adb exec-out screencap -p > "${out}"`])
      record('android', avd, out)
    }
  }
}

if (captured === 0) {
  console.log('\nNo devices captured — tooling/projects unavailable. See compat/README.md.')
  process.exit(0)
}
if (failures) {
  console.error(`\n${failures} device(s) drifted from baseline.`)
  process.exit(1)
}
console.log('\nAll mobile devices match baseline.')
