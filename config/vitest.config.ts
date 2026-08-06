import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Anchored to the repo root (this file lives in config/), so `include` globs and
// the package.json import in tests resolve regardless of cwd.
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
