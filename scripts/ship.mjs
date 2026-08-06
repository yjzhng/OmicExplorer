// "Commit for production" — derives and runs the full ship pipeline from config:
//   quality gate → desktop package (signed/notarized/published when configured)
//   → mobile (if platforms.mobile set). Tier 3 activates only when creds/config exist.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8'))
const mobile = pkg.appConfig?.platforms?.mobile ?? []
const publish = pkg.appConfig?.publish
const run = (cmd, args) => execFileSync(cmd, args, { cwd: repo, stdio: 'inherit' })

// Tier 3 status — derived from env + config.
const signing =
  process.env.CSC_LINK || process.env.CSC_NAME ? 'on' : 'off (set CSC_LINK / CSC_NAME)'
const notarize =
  process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID
    ? 'on'
    : 'off (set APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID)'
const updates = publish ? `on → ${publish.provider}` : 'off (set appConfig.publish)'
console.log('Tier 3 (production):')
console.log(`  code signing : ${signing}`)
console.log(`  notarization : ${notarize}`)
console.log(`  auto-update  : ${updates}`)

// 0. Quality gate — nothing ships unless these pass.
console.log('\n▸ Quality gate: typecheck · lint · test')
run('npm', ['run', 'typecheck'])
run('npm', ['run', 'lint'])
run('npm', ['test'])

// 1. Desktop — package (electron-builder signs/notarizes/publishes per config above).
console.log('\n▸ Desktop: build + package')
run('npm', ['run', 'build'])
const ebArgs = ['electron-builder', '--config', 'config/electron-builder.cjs']
if (publish) ebArgs.push('--publish', 'always')
run('npx', ebArgs)

// 2. Mobile — only if configured.
if (mobile.length) {
  console.log(`\n▸ Mobile: ${mobile.join(', ')}`)
  if (!existsSync(resolve(repo, 'capacitor.config.ts'))) {
    console.log('  Not set up — run: npm run mobile:setup')
  } else {
    run('npx', ['cap', 'sync'])
    console.log('  Synced. Archive/sign for the stores: npx cap open ios | android')
  }
} else {
  console.log('\n▸ Mobile: none configured — skipped.')
}

console.log('\n✓ Ship complete.')
