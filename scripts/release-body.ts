// Prints a release's GitHub body (see config/releaseBody.ts); exits 2 when the version has no
// notes file. Run from the repo root with vite-node (ships with vitest), as
// .github/workflows/release.yml does:
//   npx vite-node scripts/release-body.ts v0.3.5 > body.md
import { resolve } from 'node:path'
import { releaseBody } from '../config/releaseBody'

const tag = process.argv[2]
if (!tag) {
  console.error('usage: release-body.ts <tag, e.g. v0.3.5>')
  process.exit(1)
}
const body = releaseBody(resolve('.'), tag.replace(/^v/, ''), String(new Date().getFullYear()))
if (body === null) {
  console.error(`no releases/${tag}.md`)
  process.exit(2)
}
process.stdout.write(body)
