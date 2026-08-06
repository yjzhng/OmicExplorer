import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'

// Matches the fleet's ESLint stack (autumnLab), extended for OneProduction's
// main (Node) + preload (Node) + renderer (browser/React) split.
export default defineConfig([
  globalIgnores(['dist', 'out', 'node_modules', '**/*.app', 'build-resources']),

  // All TypeScript.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended]
  },

  // Renderer — browser globals + React rules.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: { ...globals.browser, __APP_NAME__: 'readonly' }
    }
  },

  // Main / preload — Node globals (CommonJS output at runtime).
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'electron.vite.config.ts'],
    languageOptions: { globals: { ...globals.node } }
  },

  // Build scripts — Node ESM.
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node }, sourceType: 'module' }
  },

  prettier // last: disable ESLint rules that would fight Prettier
])
