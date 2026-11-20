/**
 * The app's error log: one JSON line per error, in `<userData>/logs/omicexplorer.log`, rotated to
 * `.1` past 2 MB. The renderer reports what it catches (renderer/src/shared/diagnostics.ts →
 * `log:write`); the main process adds its own uncaught errors and a renderer or worker process
 * that died. Help › Show Log File opens it; Help › Copy Diagnostics puts the session's errors and
 * this log's tail on the clipboard, for a bug report.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { app, ipcMain } from 'electron'

const MAX_BYTES = 2 * 1024 * 1024

export const logDir = (): string => join(app.getPath('userData'), 'logs')
export const logFile = (): string => join(logDir(), 'omicexplorer.log')

/** Append one entry (best-effort: logging never throws). */
export function writeLog(entry: Record<string, unknown>): void {
  try {
    mkdirSync(logDir(), { recursive: true })
    const f = logFile()
    if (existsSync(f) && statSync(f).size > MAX_BYTES) renameSync(f, `${f}.1`)
    const line = JSON.stringify({
      time: new Date().toISOString(),
      version: app.getVersion(),
      ...entry
    })
    appendFileSync(f, line + '\n')
  } catch {
    // nowhere left to report it
  }
}

/** The log's last `lines` entries (newest last), or '' when there is none. */
export function logTail(lines = 100): string {
  try {
    const f = logFile()
    if (!existsSync(f)) return ''
    return readFileSync(f, 'utf8').trimEnd().split('\n').slice(-lines).join('\n')
  } catch {
    return ''
  }
}

const stackOf = (e: unknown): { message: string; stack?: string } =>
  e instanceof Error ? { message: e.message, stack: e.stack } : { message: String(e) }

export function registerLogging(): void {
  ipcMain.on('log:write', (_e, entry: Record<string, unknown>) => {
    if (entry && typeof entry === 'object') writeLog({ process: 'renderer', ...entry })
  })
  ipcMain.handle('log:tail', (_e, lines?: number) => logTail(lines))
  ipcMain.handle('log:path', () => logFile())

  // A monitor only observes: Electron's own handling of an uncaught error stays as it was.
  process.on('uncaughtExceptionMonitor', (e) =>
    writeLog({ process: 'main', where: 'uncaught', ...stackOf(e) })
  )
  process.on('unhandledRejection', (e) => {
    console.error('Unhandled rejection in the main process:', e)
    writeLog({ process: 'main', where: 'promise', ...stackOf(e) })
  })
  app.on('render-process-gone', (_e, _wc, details) =>
    writeLog({
      process: 'renderer',
      where: 'process-gone',
      message: details.reason,
      detail: `exit ${details.exitCode}`
    })
  )
  app.on('child-process-gone', (_e, details) =>
    writeLog({
      process: details.type,
      where: 'process-gone',
      message: details.reason,
      detail: `${details.name ?? ''} exit ${details.exitCode}`.trim()
    })
  )
}
