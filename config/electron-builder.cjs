// Production packaging config — DERIVED from package.json. Never edit per project;
// change identity in package.json ("name", "productName", "appConfig") instead.
//
// Tier 3 is config/credential-driven, so a plain build stays unsigned & local:
//   • Code signing  — automatic when CSC_LINK / CSC_KEY_PASSWORD (or a keychain
//     Developer ID) are present; skipped otherwise.
//   • Notarization  — enabled only when APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD +
//     APPLE_TEAM_ID are in the env.
//   • Auto-update   — a `publish` target is emitted only when appConfig.publish is set.
const pkg = require('../package.json')

const publish = pkg.appConfig.publish // optional: { provider, owner, repo }
const notarize = !!(
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
)

module.exports = {
  appId: `${pkg.appConfig.appIdNamespace}.${pkg.name}`, // e.g. tech.yjzhng.oneproduction
  productName: pkg.productName,
  directories: {
    output: 'dist',
    buildResources: 'build-resources'
  },
  files: ['out/**/*', 'package.json'],
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
  // Match the dmg naming (OmicExplorer-<version>-<arch>.exe) instead of the
  // default "OmicExplorer Setup <version>.exe" (spaces, no arch).
  nsis: { artifactName: '${productName}-${version}-${arch}.${ext}' },
  linux: { target: 'AppImage' },
  ...(publish ? { publish } : {})
}
