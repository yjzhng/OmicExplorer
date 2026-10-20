import { existsSync } from 'node:fs'

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { createWindowFromPreset } from './window-manager'
import { assertPreset } from './window-presets'
import { installAppMenu } from './dev-menu'
import { initAutoUpdate } from './updater'
import { getShootRequest, runScreenshot } from './screenshot'
import { registerFileIo } from './file-io'
import { registerCloseGuard } from './close-guard'
import { registerPlotExport } from './plot-export'
import { registerAnnotate } from './annotate'
import { registerStringNet } from './string-net'
import { registerPark } from './park'
import { registerRefCache } from './ref-cache'
import pkg from '../../package.json'

// Derive the app name from package.json's productName. Without this, dev (which runs
// the shared node_modules/electron binary) reports app.name = "Electron" — wrong in
// the dock/menu and, worse, points userData at Electron's shared dir. Must run before
// app is ready. A from-source run (not packaged) is "<productName> Dev": its own userData
// (settings, recent projects, the reference cache) and its own single-instance lock, so it
// never shares a session with — or, launched second, just focuses — an installed copy
// running alongside.
app.setName(app.isPackaged ? pkg.productName : `${pkg.productName} Dev`)

// Single source of truth: the first window's shape comes from package.json.
// Validated against the defined presets so a typo fails loudly, not silently.
const DEFAULT_PRESET = assertPreset(pkg.appConfig.defaultPreset)

/**
 * Guard #3: Electron derives userData from the app name. If this template was
 * copied without renaming, two different apps would share one state dir and
 * cross-contaminate. Fail fast so it can't happen silently.
 */
function assertRenamedFromTemplate(): void {
  if (app.getName() === 'oneproduction' && !process.env.ONEPROD_ALLOW_DEFAULT_NAME) {
    dialog.showErrorBox(
      'Rename before shipping',
      'This app still uses the template name "oneproduction", so it shares its ' +
        'userData dir with every other unrenamed copy. Set "name"/"productName" in ' +
        'package.json (or ONEPROD_ALLOW_DEFAULT_NAME=1 to bypass during scaffolding).'
    )
  }
}

function focusExistingWindow(): void {
  const [win] = BrowserWindow.getAllWindows()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
}

/** The project each window was opened for, by webContents id, until its renderer takes it. */
const launchProjects = new Map<number, string>()

/** A window; given a project file, one that opens it — set off from the window in front, so it
 *  isn't stacked exactly over it. */
function openDefaultWindow(project?: string): void {
  const front = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const win = createWindowFromPreset(DEFAULT_PRESET, { search: `?preset=${DEFAULT_PRESET}` })
  if (!project) return
  launchProjects.set(win.webContents.id, project)
  if (front && !front.isDestroyed()) {
    const [x, y] = front.getPosition()
    win.setPosition(x + 28, y + 28)
  }
}

/** The project and template files among launch arguments (Windows / Linux pass a double-clicked
 *  file so). */
const projectArgs = (argv: string[]): string[] =>
  argv.slice(1).filter((a) => /\.omicexplorer(-template)?$/i.test(a) && existsSync(a))

/** Projects macOS asked to open before the app was ready (the double-click that launched it). */
const queuedProjects: string[] = []

// Compat harness: headless screenshot mode bypasses the normal app (no menu,
// no single-instance lock) — just render the requested preset and capture it.
const shoot = getShootRequest()

if (shoot) {
  app.whenReady().then(() => {
    registerFileIo()
    return runScreenshot(shoot)
  })
} else if (!app.requestSingleInstanceLock()) {
  // Guard #2: only one instance of this app may run. A second launch focuses the
  // existing window instead of spawning a parallel session.
  app.quit()
} else {
  // A second launch: a project file it was given opens in a new window; otherwise it just brings
  // the app forward.
  app.on('second-instance', (_e, argv) => {
    const files = projectArgs(argv)
    if (files.length) for (const f of files) openDefaultWindow(f)
    else focusExistingWindow()
  })
  // macOS: Finder's double-click / Open With on a project or template (openProject starts a new
  // project from a template). Registered before ready — the
  // double-click that launches the app arrives before it is.
  app.on('open-file', (e, path) => {
    e.preventDefault()
    if (app.isReady()) openDefaultWindow(path)
    else queuedProjects.push(path)
  })
  ipcMain.handle('proj:takeLaunch', (evt): string | null => {
    const path = launchProjects.get(evt.sender.id) ?? null
    launchProjects.delete(evt.sender.id)
    return path
  })

  app.whenReady().then(() => {
    assertRenamedFromTemplate()
    registerFileIo() // renderer ↔ main file picking/reading for the Load node
    registerCloseGuard() // unsaved-changes prompt on close / open / new
    registerPlotExport() // renderer ↔ main plot-image writing (Export plots)
    registerAnnotate() // renderer ↔ main external-annotation fetch (UniProt)
    registerStringNet() // renderer ↔ main STRING network fetch
    registerPark() // inactive workflows' results parked on disk (renderer memory)
    registerRefCache() // Settings › Database: the UniProt / STRING cache's contents
    installAppMenu() // dev-only aspect-ratio switcher — lives here, not in the app UI
    // Launched to open projects: a window for each; else the one home window.
    const launch = [...queuedProjects, ...projectArgs(process.argv)]
    queuedProjects.length = 0
    if (launch.length) for (const f of launch) openDefaultWindow(f)
    else openDefaultWindow()
    initAutoUpdate() // no-op unless packaged + appConfig.publish is set

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openDefaultWindow()
    })
  })

  // Quit with the last window — on macOS too. Staying in the Dock with no window, the macOS default,
  // only left a process running that looked closed. The unsaved-changes prompt runs first (it
  // guards each window's close).
  app.on('window-all-closed', () => app.quit())
}
