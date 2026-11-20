import { app, clipboard, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createWindowFromPreset } from './window-manager'
import { WINDOW_PRESETS } from './window-presets'
import { logFile, logTail } from './logging'
import pkg from '../../package.json'

// Platform targets — derived from package.json (appConfig.platforms), the single
// source of truth. Desktop → VM compat (step 2), mobile → Capacitor emulator run.
const { desktop, mobile } = pkg.appConfig.platforms
const repoRoot = resolve(__dirname, '../..') // dev: out/main -> repo root

/** Placeholder for the (planned) desktop VM compat run — see README "Planned". */
function runCompat(label: string): void {
  dialog.showMessageBox({
    type: 'info',
    title: 'Desktop compat (planned)',
    message: `${label} compatibility testing`,
    detail:
      `Will build the app, boot it in a ${label} VM, and screenshot each aspect-ratio ` +
      `preset for visual diffing.\n\nNot yet implemented — this is the hook for the VM ` +
      `compat harness (step 2).`
  })
}

/** Mobile via Capacitor: build web → sync → boot the simulator/emulator. */
function runMobile(label: string): void {
  const platform = label.toLowerCase() === 'ios' ? 'ios' : 'android'
  const tooling = platform === 'ios' ? 'Xcode + CocoaPods' : 'Android Studio + SDK'

  if (!existsSync(resolve(repoRoot, platform))) {
    dialog.showMessageBox({
      type: 'info',
      title: `${label} not set up`,
      message: `Set up mobile first`,
      detail:
        `Run:  npm run mobile:setup\n\n(reads platforms.mobile, installs Capacitor, and ` +
        `generates the ${label} project — needs ${tooling}). Then choose ${label} again to ` +
        `build, sync, and launch the ${platform === 'ios' ? 'iOS Simulator' : 'Android emulator'}.`
    })
    return
  }

  dialog.showMessageBox({
    type: 'info',
    title: `Launching ${label}`,
    message: `Building web → sync → run ${label}`,
    detail: 'Opens the simulator/emulator; this can take a minute.'
  })
  const child = spawn('npm', ['run', `cap:${platform}`], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
}

/** Help › Copy Diagnostics: the app, the platform and the error log's latest entries, on the
 *  clipboard for a bug report. */
function copyDiagnostics(): void {
  const tail = logTail(100)
  clipboard.writeText(
    [
      `${app.getName()} ${app.getVersion()}`,
      `platform: ${process.platform} ${process.arch} · electron ${process.versions.electron}`,
      `log: ${logFile()}`,
      '',
      tail || '(no errors logged)'
    ].join('\n')
  )
}

/**
 * Install the application menu.
 *
 * In dev it includes a "Platform" menu — a framework-level testing tool that lives in
 * the MAIN process, not in the (replaceable) app UI. Hidden in packaged builds. Three
 * sections, divider-separated: aspect ratios · desktop OS · mobile OS. All derived from
 * package.json, so a new app configures its platforms in one place.
 */
export function installAppMenu({ newWindow }: { newWindow: () => void }): void {
  const isMac = process.platform === 'darwin'
  const separator: MenuItemConstructorOptions = { type: 'separator' }
  // A new window is a session of its own (its own project, results and engine).
  const newWindowItem: MenuItemConstructorOptions = {
    label: 'New Window',
    accelerator: 'CmdOrCtrl+N',
    click: newWindow
  }

  // Aspect ratios — always present.
  const submenu: MenuItemConstructorOptions[] = Object.entries(WINDOW_PRESETS).map(
    ([name, preset], i) => ({
      label: preset.label,
      accelerator: `CmdOrCtrl+${i + 1}`,
      click: () => createWindowFromPreset(name, { search: `?preset=${name}` })
    })
  )

  // Desktop OS compat — only if configured.
  if (desktop.length) {
    submenu.push(separator, ...desktop.map((label) => ({ label, click: () => runCompat(label) })))
  }

  // Mobile OS (Capacitor) — only if configured.
  if (mobile.length) {
    submenu.push(separator, ...mobile.map((label) => ({ label, click: () => runMobile(label) })))
  }

  const platformMenu: MenuItemConstructorOptions = { label: 'Platform', submenu }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    // The default File menu (Close on macOS, Quit elsewhere) with New Window above it.
    {
      label: 'File',
      submenu: [newWindowItem, separator, isMac ? { role: 'close' } : { role: 'quit' }]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    ...(app.isPackaged ? [] : [platformMenu]),
    { role: 'windowMenu' },
    // Error tracing (main/logging.ts): the log of every error the app caught, for a bug report.
    {
      role: 'help',
      submenu: [
        { label: 'Copy Diagnostics', click: copyDiagnostics },
        { label: 'Show Log File', click: () => shell.showItemInFolder(logFile()) }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  // macOS: the Dock icon's right-click menu (its open windows are listed above it by the system).
  app.dock?.setMenu(Menu.buildFromTemplate([{ label: 'New Window', click: newWindow }]))
}
