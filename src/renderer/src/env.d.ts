/// <reference types="vite/client" />
/// <reference types="../../preload/index.d.ts" />

/** Injected at build time from package.json "productName" (see electron.vite.config.ts). */
declare const __APP_NAME__: string
/** Injected at build time from package.json "version" (see electron.vite.config.ts). */
declare const __APP_VERSION__: string
/** Injected at build time from the release notes' "Cite this software" section — the newest
 *  version notes up to this version that give one (see config/citation.ts). null when none does. */
declare const __APP_CITATION__: { reference: string; doi: string | null } | null
