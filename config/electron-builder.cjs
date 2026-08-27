// Production packaging config — DERIVED from package.json. Never edit per project;
// change identity in package.json ("name", "productName", "appConfig") instead.
//
// Tier 3 is config/credential-driven, so a plain build stays unsigned & local:
//   • Code signing  — automatic when CSC_LINK / CSC_KEY_PASSWORD (or a keychain
//     Developer ID) are present; skipped otherwise.
//   • Notarization  — enabled only when APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD +
//     APPLE_TEAM_ID are in the env.
//   • Auto-update   — a `publish` target is emitted only when appConfig.publish is set.
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const pkg = require('../package.json')

const publish = pkg.appConfig.publish // optional: { provider, owner, repo }
const notarize = !!(
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
)
// A real Developer-ID sign will run (electron-builder auto-signs when CSC_* is set, or when
// notarizing) — in that case the ad-hoc fallback below must NOT run.
const realMacSign = !!(process.env.CSC_LINK || process.env.CSC_KEY_PASSWORD || notarize)

/**
 * Ad-hoc-seal the packaged .app on credential-free macOS builds.
 *
 * Without a signing identity electron-builder skips bundle signing, leaving only the Electron
 * binary's linker-signed ad-hoc signature — the bundle itself is never sealed (Info.plist not
 * bound, resources unsealed), so `codesign --verify` fails. Gatekeeper reports a quarantined
 * download of such an app as "…is damaged — Move to Trash", which has NO GUI bypass. A valid
 * ad-hoc signature (`codesign --sign -`) seals the bundle, downgrading that to the ordinary
 * "unidentified developer" dialog, which offers a working Open Anyway. Non-hardened on purpose:
 * ad-hoc + hardened runtime without the Electron JIT entitlements would crash on launch.
 * afterPack runs before electron-builder's own (skipped) signing, so this seal is what ships.
 */
function adhocSealMac(context) {
  if (context.electronPlatformName !== 'darwin' || realMacSign) return
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  console.log(`ad-hoc sealed ${appPath}`)
}

module.exports = {
  appId: `${pkg.appConfig.appIdNamespace}.${pkg.name}`, // e.g. tech.yjzhng.oneproduction
  productName: pkg.productName,
  directories: {
    output: 'dist',
    buildResources: 'build-resources'
  },
  files: ['out/**/*', 'package.json'],
  // Guarantee a valid ad-hoc signature on unsigned macOS builds (see adhocSealMac).
  afterPack: adhocSealMac,
  mac: {
    // dmg = first-install download; zip = what Squirrel.Mac pulls for auto-update
    // (electron-updater emits latest-mac.yml only when a zip target exists).
    target: ['dmg', 'zip'],
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    notarize // true only when APPLE_* creds are set
  },
  win: { target: 'nsis' }, // signs automatically when CSC_LINK / CSC_KEY_PASSWORD are set
  // Consistent, arch-tagged filenames across artifacts:
  //   OmicExplorer-<version>-<arch>.{dmg,exe}
  // Defaults otherwise drop the arch on x64 dmgs and use "OmicExplorer Setup
  // <version>.exe" (spaces, no arch) for the installer.
  dmg: { artifactName: '${productName}-${version}-${arch}.${ext}' },
  nsis: { artifactName: '${productName}-${version}-${arch}.${ext}' },
  linux: { target: 'AppImage' },
  ...(publish ? { publish } : {})
}
