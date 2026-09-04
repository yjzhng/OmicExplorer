/**
 * App-level cache under Electron's userData dir, shared across all projects. Holds external
 * reference data so the app is local-first: UniProt annotations (per accession) and STRING
 * per-organism interaction files. Version-stamped so a stale entry can be refreshed against the
 * live source, but otherwise served offline.
 *
 *   <userData>/reference-cache/uniprot/store.json           accession → { fields, release }
 *   <userData>/reference-cache/string/<taxon>/manifest.json { version }
 *   <userData>/reference-cache/string/<taxon>/links.v<ver>.tsv
 *   <userData>/reference-cache/string/<taxon>/info.v<ver>.tsv
 *
 * NOTE: this MUST NOT live under `<userData>/cache` — that is Chromium's own HTTP disk-cache
 * directory (it stores `Cache_Data` there), which Chromium evicts/clears on its own schedule. Any
 * sibling folders we put there get wiped between sessions, which looked like "annotations didn't
 * persist." A dedicated, Chromium-free directory keeps our reference data durable.
 */
import { app } from 'electron'
import { createWriteStream } from 'fs'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'

export function cacheRoot(): string {
  // Deliberately NOT 'cache' — that collides with Chromium's HTTP disk cache (see file header).
  return join(app.getPath('userData'), 'reference-cache')
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDir(dirOf(path))
  await writeFile(path, JSON.stringify(value))
}

function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : path
}

/**
 * Stream a gzipped URL to `destPath`, decompressing on the fly, reporting progress on the
 * COMPRESSED byte stream (so it aligns with Content-Length). Writes to a temp file first and
 * renames on success so a partial download never looks complete.
 */
export async function downloadGunzip(
  url: string,
  destPath: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`download HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let loaded = 0
  await ensureDir(dirOf(destPath))
  const tmp = `${destPath}.part`
  const src = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  src.on('data', (chunk: Buffer) => {
    loaded += chunk.length
    onProgress?.(loaded, total)
  })
  await pipeline(src, createGunzip(), createWriteStream(tmp))
  const { rename } = await import('fs/promises')
  await rename(tmp, destPath)
}
