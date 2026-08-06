// Generate a double-clickable <productName>.app that launches Path B (live dev).
// Reads name/version from package.json so a renamed derived app regenerates its
// own launcher. Run: `npm run make:launcher`.
//
// The .app is a stub: its executable backgrounds launch.sh and exits, leaving
// only the Electron window (matches the sibling ChemViewer/uniOme/autumnLab
// pattern — git pull to update, nothing to reinstall).
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
  readFileSync,
  copyFileSync
} from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureIcns } from './lib/icns.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'))
const name = pkg.productName || pkg.name || 'OneProduction'
const ns = pkg.appConfig?.appIdNamespace || 'tech.yjzhng'
const id = `${ns}.${(pkg.name || 'oneproduction').toLowerCase()}.launcher`

const app = resolve(repo, `${name}.app`)
const macos = resolve(app, 'Contents/MacOS')
if (existsSync(app)) rmSync(app, { recursive: true, force: true })
mkdirSync(macos, { recursive: true })

const exe = resolve(macos, name)
writeFileSync(
  exe,
  `#!/bin/bash
# Double-clickable launcher: resolves the repo it lives in, hands off to
# launch.sh in the background, and exits so only the Electron window remains.
DIR="$(cd "$(dirname "$0")/../../.." && pwd)" # repo root: <name>.app/Contents/MacOS -> ../../..
nohup "$DIR/scripts/launch.sh" >"\${TMPDIR:-/tmp}/${(pkg.name || 'oneproduction').toLowerCase()}-launch.log" 2>&1 &
exit 0
`
)
chmodSync(exe, 0o755)

// Give the launcher the app icon, derived from the single-source-of-truth master.
let iconLine = ''
const icns = ensureIcns(repo)
if (icns) {
  const resources = resolve(app, 'Contents/Resources')
  mkdirSync(resources, { recursive: true })
  copyFileSync(icns, resolve(resources, 'icon.icns'))
  iconLine = '\n  <key>CFBundleIconFile</key><string>icon</string>'
}

writeFileSync(
  resolve(app, 'Contents/Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>${name}</string>${iconLine}
  <key>CFBundleIdentifier</key><string>${id}</string>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundleDisplayName</key><string>${name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>${pkg.version || '0.0.1'}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`
)

console.log(`Generated ${name}.app → double-click to run Path B (live dev).`)
