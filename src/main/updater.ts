/**
 * In-app update: find the newest GitHub release, download its installer for this machine and put
 * it in place on a restart — Settings › About › Updates (the renderer's useUpdateCheck asks
 * through update:*).
 *
 * The release is found from github.com itself — /releases/latest redirects to the newest tag —
 * and its installer fetched from its fixed download URL, not through the GitHub API: the API
 * allows 60 unsigned requests an hour per IP address, which a whole institute behind one address
 * (the Crick's) uses up, so the check failed there. The API is asked only for the installer's
 * checksum, and the update goes ahead without it when it's refused.
 *
 * Not electron-updater: the Mac builds are ad-hoc signed (no Developer ID), and Squirrel.Mac
 * refuses an update whose signature doesn't match the running app's, which an ad-hoc one never
 * does. So, by platform:
 *   • macOS — the release's .dmg for this arch is mounted and its app copied next to the installed
 *     one (`.OmicExplorer-update.app`, same folder so the swap is a rename); on the restart, at
 *     will-quit, the installed bundle is moved aside, the new one renamed in, and the app relaunched.
 *     The old bundle is removed on the next launch. Needs the app in a folder it can write
 *     (Applications, for an admin user) — not run from the disk image or translocated.
 *   • Windows — the release's setup .exe, run silently at will-quit (`--updated /S --force-run`,
 *     as electron-updater does), which replaces the install and starts the new version.
 * The download is checked against the release's SHA-256 (when the API gives one), and the Mac app
 * against this app's bundle id and the release's version, before anything is replaced.
 */
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import {
  accessSync,
  constants,
  createWriteStream,
  existsSync,
  readdirSync,
  renameSync,
  rmSync
} from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow, dialog, ipcMain, net } from 'electron'
import pkg from '../../package.json'

const run = promisify(execFile)
const REPO = 'yjzhng/OmicExplorer'
const NAME = pkg.productName

export type UpdatePhase = 'idle' | 'downloading' | 'ready' | 'error'
export interface UpdateState {
  phase: UpdatePhase
  /** the version downloading or ready */
  version?: string
  /** 0–100 while downloading (absent when the size isn't known) */
  percent?: number
  /** what went wrong (phase 'error') */
  message?: string
  /** why this copy can't update itself (then the release page is the way) */
  unsupported?: string
}

let state: UpdateState = { phase: 'idle' }
/** What a restart installs: the staged Mac app or the Windows setup .exe. */
let staged: { version: string; path: string } | null = null
/** A restart to update was asked for (cleared when a save prompt cancels the quit). */
let installing = false

function setState(next: UpdateState): void {
  state = { ...next, unsupported: unsupportedReason() ?? undefined }
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', state)
}

/** The running .app bundle (macOS). */
const macBundle = (): string => resolve(app.getPath('exe'), '../../..')

/** Why this copy can't update itself, or null when it can. */
function unsupportedReason(): string | null {
  if (!app.isPackaged) return 'In-app updates are for the installed app.'
  if (process.platform === 'win32')
    // a copy built by scripts/install-from-source.ps1 has no installer's uninstaller beside it;
    // the setup .exe would install a second copy over it
    return existsSync(join(dirname(app.getPath('exe')), `Uninstall ${NAME}.exe`))
      ? null
      : 'This copy was built from source — run the install script again to update it.'
  if (process.platform !== 'darwin') return 'In-app updates aren’t available on Linux yet.'
  const bundle = macBundle()
  if (!bundle.endsWith('.app')) return 'Couldn’t find the app bundle to update.'
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/'))
    return `Move ${NAME} to the Applications folder, open it from there, then update here.`
  try {
    accessSync(dirname(bundle), constants.W_OK)
    accessSync(bundle, constants.W_OK)
  } catch {
    return `${NAME} is in a folder this account can’t change (${dirname(bundle)}).`
  }
  return null
}

/** Compare dotted versions numerically (as the renderer's useUpdateCheck does). */
function isNewer(a: string, b: string): boolean {
  const pa = a
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  const pb = b
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0
  }
  return false
}

/** The newest release (github.com's /releases/latest redirects to its tag page): its tag and
 *  version, and that page. */
export async function latestRelease(): Promise<{ tag: string; version: string; url: string }> {
  const url = await redirectOf(`https://github.com/${REPO}/releases/latest`)
  const m = /\/releases\/tag\/([^/?#]+)$/.exec(url)
  if (!m) throw new Error('No release is published yet.')
  const tag = decodeURIComponent(m[1])
  return { tag, version: tag.replace(/^v/, ''), url }
}

/** Where `url` redirects to (net.fetch follows a redirect without saying where it went, so a
 *  request that stops at it). */
function redirectOf(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'HEAD', redirect: 'manual' })
    req.on('redirect', (_status, _method, to) => {
      resolve(to)
      req.abort()
    })
    req.on('response', (res) => reject(new Error(`GitHub answered ${res.statusCode}.`)))
    req.on('error', reject)
    req.end()
  })
}

/** This machine's installer in a release (as config/electron-builder.cjs names them:
 *  `<productName>-<version>-<arch>.<ext>`; Windows ships x64 only, which arm64 Windows runs). */
const assetName = (version: string): string =>
  process.platform === 'darwin'
    ? `${NAME}-${version}-${process.arch}.dmg`
    : `${NAME}-${version}-x64.exe`

/** The installer's SHA-256 (hex) from the GitHub API, or null when it's refused (rate limit,
 *  offline) or gives none. */
async function assetDigest(tag: string, name: string): Promise<string | null> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) return null
    const rel = (await res.json()) as { assets?: { name: string; digest?: string | null }[] }
    const d = rel.assets?.find((a) => a.name === name)?.digest
    return d?.startsWith('sha256:') ? d.slice(7).toLowerCase() : null
  } catch {
    return null
  }
}

/** The update folder in temp (the download, the Mac disk image's mount point). */
const workDir = (): string => join(app.getPath('temp'), `${NAME}-update`)
/** Where the new Mac app waits for the restart — beside the installed one, so the swap is a
 *  rename on the same volume. */
const macStaging = (): string => join(dirname(macBundle()), `.${NAME}-update.app`)

async function download(): Promise<void> {
  if (state.phase === 'downloading') return
  const why = unsupportedReason()
  if (why) throw new Error(why)
  setState({ phase: 'downloading' })
  const { tag, version } = await latestRelease()
  if (!isNewer(version, app.getVersion()))
    throw new Error(`v${app.getVersion()} is already the latest.`)
  if (staged?.version === version) return setState({ phase: 'ready', version })
  const name = assetName(version)

  const dir = workDir()
  rmSync(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const file = join(dir, name)
  setState({ phase: 'downloading', version, percent: 0 })
  const [sha, want] = await Promise.all([
    fetchTo(
      `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${name}`,
      file,
      (percent) => setState({ phase: 'downloading', version, percent })
    ),
    assetDigest(tag, name)
  ])
  if (want && want !== sha)
    throw new Error('The download is corrupt (checksum mismatch) — try again.')

  if (process.platform === 'darwin') {
    await stageMac(file, dir, version)
    staged = { version, path: macStaging() }
  } else {
    staged = { version, path: file }
  }
  setState({ phase: 'ready', version })
}

/** Download `url` to `file`, reporting progress; returns the bytes' SHA-256 (hex). */
async function fetchTo(
  url: string,
  file: string,
  progress: (percent: number) => void
): Promise<string> {
  const res = await net.fetch(url)
  if (res.status === 404) throw new Error('This release has no installer for this computer yet.')
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = createHash('sha256')
  const out = createWriteStream(file)
  const reader = res.body.getReader()
  let got = 0
  let shown = -1
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      got += value.length
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      const pct = total ? Math.floor((got / total) * 100) : 0
      if (pct !== shown) progress((shown = pct))
    }
  } finally {
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())))
  }
  return hash.digest('hex')
}

/** A bundle's Info.plist value. */
async function plistValue(bundle: string, key: string): Promise<string> {
  const { stdout } = await run('plutil', [
    '-extract',
    key,
    'raw',
    join(bundle, 'Contents/Info.plist')
  ])
  return stdout.trim()
}

/** The disk image's app, copied beside the installed one — checked to be this app, at `version`. */
async function stageMac(dmg: string, dir: string, version: string): Promise<void> {
  const mnt = join(dir, 'mnt')
  await mkdir(mnt, { recursive: true })
  await run('hdiutil', ['attach', dmg, '-nobrowse', '-noautoopen', '-readonly', '-mountpoint', mnt])
  try {
    const app_ = readdirSync(mnt).find((n) => n.endsWith('.app'))
    if (!app_) throw new Error('The disk image has no app in it.')
    const from = join(mnt, app_)
    const [id, v, mine] = await Promise.all([
      plistValue(from, 'CFBundleIdentifier'),
      plistValue(from, 'CFBundleShortVersionString'),
      plistValue(macBundle(), 'CFBundleIdentifier')
    ])
    if (id !== mine) throw new Error(`The disk image holds another app (${id}).`)
    if (v !== version) throw new Error(`The disk image holds v${v}, not v${version}.`)
    const to = macStaging()
    rmSync(to, { recursive: true, force: true })
    await run('ditto', [from, to])
  } finally {
    await run('hdiutil', ['detach', mnt, '-force']).catch(() => undefined)
  }
}

/** At will-quit: put the staged update in place (and, on a Mac, relaunch it). */
function applyUpdate(): void {
  if (!staged || !installing) return
  const { path } = staged
  staged = null
  installing = false
  try {
    if (process.platform === 'darwin') {
      const bundle = macBundle()
      const old = join(dirname(bundle), `.${NAME}-old-${Date.now()}.app`)
      renameSync(bundle, old)
      try {
        renameSync(path, bundle)
      } catch (e) {
        rmSync(bundle, { recursive: true, force: true })
        renameSync(old, bundle) // put the installed app back
        throw e
      }
      app.relaunch()
    } else {
      spawn(path, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch (e) {
    dialog.showErrorBox(
      'Update not installed',
      `${NAME} couldn’t put the update in place (${(e as Error).message}). It stays on v${app.getVersion()}.`
    )
  }
}

/** A Mac update's leftovers from before (the old bundle moved aside, an unfinished staging, the
 *  download) — removed at launch. */
function cleanUp(): void {
  try {
    rmSync(workDir(), { recursive: true, force: true })
  } catch {
    /* still in use (the Windows setup finishing as the new version opens) — next time */
  }
  if (process.platform !== 'darwin' || !app.isPackaged) return
  const dir = dirname(macBundle())
  try {
    for (const n of readdirSync(dir))
      if (n.startsWith(`.${NAME}-old-`) || n === basename(macStaging()))
        rmSync(join(dir, n), { recursive: true, force: true })
  } catch {
    /* the folder can't be read — nothing to tidy */
  }
}

/** A quit was stopped (Cancel on a save prompt): no restart into the update; it stays ready. */
export function quitCancelled(): void {
  installing = false
}

export function initAutoUpdate(): void {
  cleanUp()
  ipcMain.handle('update:latest', async () => {
    try {
      return await latestRelease()
    } catch (e) {
      return { error: (e as Error).message }
    }
  })
  ipcMain.handle('update:state', (): UpdateState => ({
    ...state,
    unsupported: unsupportedReason() ?? undefined
  }))
  ipcMain.handle('update:download', async (): Promise<void> => {
    try {
      await download()
    } catch (e) {
      setState({ phase: 'error', message: (e as Error).message })
    }
  })
  ipcMain.handle('update:install', (): void => {
    if (state.phase !== 'ready' || !staged) return
    installing = true
    app.quit()
  })
  app.on('will-quit', applyUpdate)
}
