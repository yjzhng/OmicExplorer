// Config-gated mobile setup. Does nothing unless package.json declares mobile
// platforms in appConfig.platforms.mobile. When it does, it installs Capacitor,
// writes a derived capacitor.config.ts, and generates the native project(s).
//
// This is the "auto-derive the stack" step: a web/desktop-only project never pulls
// Capacitor; adding "iOS"/"Android" to the config and running `npm run mobile:setup`
// materialises exactly what those platforms need.
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'))
const mobile = pkg.appConfig?.platforms?.mobile ?? []

if (mobile.length === 0) {
  console.log('No mobile platforms configured (appConfig.platforms.mobile is empty).')
  console.log('Add e.g. "mobile": ["iOS", "Android"] to package.json, then re-run.')
  process.exit(0)
}

const wants = [...new Set(mobile.map((m) => (m.toLowerCase() === 'ios' ? 'ios' : 'android')))]
const run = (cmd, args) => execFileSync(cmd, args, { cwd: repo, stdio: 'inherit' })

// 1. Install Capacitor — core + cli always, platform packages only as configured.
const deps = ['@capacitor/core', '@capacitor/cli']
if (wants.includes('ios')) deps.push('@capacitor/ios')
if (wants.includes('android')) deps.push('@capacitor/android')
console.log(`Installing Capacitor: ${deps.join(' ')}`)
run('npm', ['install', '-D', ...deps])

// 2. Write a DERIVED capacitor.config.ts (mobile identity = desktop identity).
const configPath = resolve(repo, 'capacitor.config.ts')
if (!existsSync(configPath)) {
  writeFileSync(
    configPath,
    `import type { CapacitorConfig } from '@capacitor/cli'
import pkg from './package.json'

// Mobile wraps the SAME web build as the Electron renderer; identity is derived
// from package.json so the mobile bundle id matches the desktop appId.
const config: CapacitorConfig = {
  appId: \`\${pkg.appConfig.appIdNamespace}.\${pkg.name}\`,
  appName: pkg.productName,
  webDir: 'out/renderer'
}

export default config
`
  )
  console.log('Wrote capacitor.config.ts (derived from package.json)')
}

// 3. Ensure a web build exists (Capacitor's webDir), then add native project(s).
if (!existsSync(resolve(repo, 'out/renderer'))) run('npm', ['run', 'build'])
for (const p of wants) {
  if (existsSync(resolve(repo, p))) {
    console.log(`${p} project already exists — skipping`)
    continue
  }
  console.log(
    `Adding ${p} project (needs ${p === 'ios' ? 'Xcode + CocoaPods' : 'Android Studio + SDK'})…`
  )
  run('npx', ['cap', 'add', p])
}

console.log('\nMobile setup complete. Launch from the Platform menu, or:')
for (const p of wants) console.log(`  npm run cap:${p}`)
