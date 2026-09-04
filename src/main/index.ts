import { app, BrowserWindow, dialog } from 'electron'
import { createWindowFromPreset } from './window-manager'
import { assertPreset } from './window-presets'
import { installAppMenu } from './dev-menu'
import { initAutoUpdate } from './updater'
import { getShootRequest, runScreenshot } from './screenshot'
import { registerFileIo } from './file-io'
import { registerPlotExport } from './plot-export'
import { registerAnnotate } from './annotate'
import { registerStringNet } from './string-net'
import pkg from '../../package.json'

// Derive the app name from package.json's productName. Without this, dev (which runs
// the shared node_modules/electron binary) reports app.name = "Electron" — wrong in
// the dock/menu and, worse, points userData at Electron's shared dir. Must run before
// app is ready. Packaged builds already get this from the bundle; this makes dev match.
app.setName(pkg.productName)

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

function openDefaultWindow(): void {
  createWindowFromPreset(DEFAULT_PRESET, { search: `?preset=${DEFAULT_PRESET}` })
}

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
  app.on('second-instance', focusExistingWindow)

  app.whenReady().then(() => {
    assertRenamedFromTemplate()
    registerFileIo() // renderer ↔ main file picking/reading for the Load node
    registerPlotExport() // renderer ↔ main plot-image writing (Export plots)
    registerAnnotate() // renderer ↔ main external-annotation fetch (UniProt)
    registerStringNet() // renderer ↔ main STRING network fetch
    installAppMenu() // dev-only aspect-ratio switcher — lives here, not in the app UI
    openDefaultWindow()
    initAutoUpdate() // no-op unless packaged + appConfig.publish is set

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openDefaultWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
