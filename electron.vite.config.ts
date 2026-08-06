import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      {
        // Inject %APP_NAME% (from productName) and a Content-Security-Policy that is
        // relaxed in dev (Vite HMR + React refresh need inline/eval + ws) and strict
        // in the production build.
        name: 'inject-app-name-and-csp',
        transformIndexHtml(html: string, ctx: { server?: unknown }) {
          const dev = !!ctx.server
          // api.github.com is allowed in connect-src for the update check (About section).
          const csp = dev
            ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: http: https://api.github.com"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.github.com"
          return {
            html: html.replace(/%APP_NAME%/g, pkg.productName),
            tags: [
              {
                tag: 'meta',
                attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
                injectTo: 'head-prepend'
              }
            ]
          }
        }
      }
    ],
    // Expose productName to renderer code as a compile-time constant.
    define: {
      __APP_NAME__: JSON.stringify(pkg.productName),
      __APP_VERSION__: JSON.stringify(pkg.version),
      // react-draggable (via react-grid-layout) reads `process.env.DRAGGABLE_DEBUG`
      // in its log(); with contextIsolation the renderer has no `process`, so the
      // bare reference throws on drag-start. Fold it to a literal.
      'process.env.DRAGGABLE_DEBUG': 'false'
    },
    server: {
      // Base port comes from package.json "appConfig.devPort" (single source of
      // truth). Each app in the fleet gets a unique one so sibling dev sessions
      // never cross-wire. Override at runtime with ONEPROD_DEV_PORT.
      port: Number(process.env.ONEPROD_DEV_PORT ?? pkg.appConfig.devPort),
      strictPort: true
    }
  }
})
