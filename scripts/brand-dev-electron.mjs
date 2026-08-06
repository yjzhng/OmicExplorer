// predev hook — make `npm run dev` show THIS app's name + icon in the dock/menu,
// not the generic shared "Electron".
//
// Why a CLONE at a fresh path (not in-place plist editing): macOS caches a bundle's
// dock name+icon BY PATH. `node_modules/electron/dist/Electron.app` was cached as
// "Electron" the first time any sibling ran it, and editing that bundle's Info.plist
// in place does NOT evict the cache — the dock keeps saying "Electron". The fleet's
// fix (see sibling ProDesigner/ChemSketcher) is to launch a clone at a path macOS
// never cached. Here we clone to `dist/<ProductName>.app` and repoint
// `node_modules/electron/path.txt` at it, so electron-vite launches the branded
// clone. The clone is an APFS copy-on-write copy (`cp -Rc`): near-instant, no real
// disk.
//
// macOS-only; a no-op elsewhere. Never fails the build — on any error it warns and
// lets dev continue with stock Electron.
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { ensureIcns } from './lib/icns.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/' +
  'LaunchServices.framework/Versions/A/Support/lsregister'

try {
  ensureIcns(repo) // keep build-resources/icon.icns fresh even on non-mac / early exit
  if (process.platform !== 'darwin') process.exit(0)

  const distDir = resolve(repo, 'node_modules/electron/dist')
  const stockApp = resolve(distDir, 'Electron.app')
  if (!existsSync(stockApp)) process.exit(0) // deps not installed yet

  const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'))
  const name = pkg.productName || pkg.name || 'App'
  const ns = pkg.appConfig?.appIdNamespace || 'tech.yjzhng'
  // `.dev` so this from-source clone never claims the packaged app's bundle id —
  // Launch Services would otherwise resolve the two to whichever it saw last.
  const brandId = `${ns}.${(pkg.name || 'app').toLowerCase()}.dev`
  const electronVer = (() => {
    try {
      return JSON.parse(readFileSync(resolve(repo, 'node_modules/electron/package.json'), 'utf8')).version
    } catch {
      return '?'
    }
  })()

  const brandedApp = resolve(distDir, `${name}.app`)
  const relExe = `${name}.app/Contents/MacOS/Electron` // path.txt is relative to dist/
  const pathTxt = resolve(repo, 'node_modules/electron/path.txt')
  const marker = resolve(distDir, '.branded') // in dist/ → wiped on reinstall, re-clones
  const REV = '2' // bump to force a re-clone
  const want = `${name}:${brandId}:${electronVer}:${REV}`

  const upToDate =
    existsSync(marker) &&
    readFileSync(marker, 'utf8').trim() === want &&
    existsSync(brandedApp) &&
    existsSync(pathTxt) &&
    readFileSync(pathTxt, 'utf8').trim() === relExe
  if (upToDate) process.exit(0)

  // (Re)build the branded clone at a fresh path.
  execFileSync('rm', ['-rf', brandedApp])
  execFileSync('cp', ['-Rc', stockApp, brandedApp]) // APFS copy-on-write clone
  execFileSync(
    '/usr/libexec/PlistBuddy',
    [
      '-c', `Set :CFBundleName ${name}`,
      '-c', `Set :CFBundleDisplayName ${name}`,
      '-c', `Set :CFBundleIdentifier ${brandId}`,
      resolve(brandedApp, 'Contents/Info.plist')
    ],
    { stdio: 'ignore' }
  )
  const icns = ensureIcns(repo)
  if (icns) copyFileSync(icns, resolve(brandedApp, 'Contents/Resources/electron.icns'))
  // Editing the bundle invalidates its signature; arm64 macOS then refuses to
  // launch it, so ad-hoc re-sign.
  execFileSync('codesign', ['--force', '--sign', '-', brandedApp], { stdio: 'ignore' })
  // Point the electron binary resolver at the clone so electron-vite launches it.
  writeFileSync(pathTxt, relExe)
  // Register the fresh-path bundle with Launch Services so the dock uses its name.
  try {
    execFileSync(LSREGISTER, ['-f', brandedApp], { stdio: 'ignore' })
  } catch {
    // best-effort
  }
  writeFileSync(marker, want)
  console.log(`[brand] dev Electron → ${name} (clone at dist/${name}.app, ${brandId})`)
} catch (e) {
  console.warn('[brand] skipped, using stock Electron:', e.message)
  process.exit(0) // never block dev
}
