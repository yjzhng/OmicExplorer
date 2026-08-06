/// <reference types="vite/client" />
/// <reference types="../../preload/index.d.ts" />

/** Injected at build time from package.json "productName" (see electron.vite.config.ts). */
declare const __APP_NAME__: string
/** Injected at build time from package.json "version" (see electron.vite.config.ts). */
declare const __APP_VERSION__: string
