/**
 * Error tracing: one place every failure the app catches is reported to.
 *
 * `reportError` records the error with where it happened (a run of a node, a render of a panel, an
 * engine op…), keeps the last entries in memory for Help › Copy Diagnostics, prints it to the
 * console and hands it to the main process, which appends it to the log file in the app's data
 * folder (main/logging.ts) — so an installed copy's failure can be traced after the fact.
 *
 * The engine's errors arrive as `EngineError`, carrying the worker's own stack and the op that
 * failed (engine/client.ts), which a plain message lost.
 */
import { EngineError } from '../engine/engineError'

/** Where an error happened — what the log line and the diagnostics name it by. */
export interface ErrorContext {
  /** the area: 'run', 'plot-run', 'render', 'engine', 'window', 'promise', … */
  where: string
  nodeId?: string
  kind?: string
  /** an engine op (standardize, compare, curveFit …) */
  op?: string
  /** anything else worth keeping (a panel's label, a file name) */
  detail?: string
}

export interface DiagnosticEntry extends ErrorContext {
  /** ISO time */
  time: string
  message: string
  stack?: string
  /** the worker's stack, for an engine error */
  workerStack?: string
  /** a React render error's component stack */
  componentStack?: string
}

export { EngineError }

/** The message an error shows the user — what a status line or an error note displays. */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

const MAX_ENTRIES = 200
const entries: DiagnosticEntry[] = []

/** A plot or step that can't run YET — its upstream hasn't run, the data lacks what it needs, a
 *  species or annotations are missing: the message tells the user what to do, and it is not a
 *  failure of the app, so it isn't logged. */
export class NotReady extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotReady'
  }
}

/** Errors that are part of normal control flow (a run the user stopped, a plot not ready), not
 *  failures. */
const isCancel = (err: unknown): boolean =>
  errorMessage(err) === 'cancelled' || (err instanceof Error && err.name === 'NotReady')

/** Record a caught error with its context. Returns the message, so a caller can also show it:
 *  `setStatus('error', reportError(err, { where: 'run', nodeId }))`. */
export function reportError(
  err: unknown,
  context: ErrorContext,
  extra?: { componentStack?: string }
): string {
  const message = errorMessage(err)
  if (isCancel(err)) return message
  const entry: DiagnosticEntry = {
    time: new Date().toISOString(),
    ...context,
    ...(err instanceof EngineError ? { op: context.op ?? err.op } : null),
    message,
    stack: err instanceof Error ? err.stack : undefined,
    workerStack: err instanceof EngineError ? err.workerStack : undefined,
    componentStack: extra?.componentStack
  }
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  const tag = [context.where, context.kind, context.nodeId, entry.op].filter(Boolean).join(' ')
  console.error(`[${tag}] ${message}`, err)
  try {
    const api = (globalThis as { window?: { api?: { logError?: (e: DiagnosticEntry) => void } } })
      .window?.api
    api?.logError?.(entry)
  } catch {
    // the log is best-effort: a failure to write it must never become an error of its own
  }
  return message
}

/** The errors recorded this session, oldest first. */
export const recentErrors = (): readonly DiagnosticEntry[] => entries

/** A plain-text report for a bug report: the app, the platform and the recent errors. */
export function diagnosticsText(app: { name: string; version: string }): string {
  const nav = (globalThis as { navigator?: { userAgent?: string; platform?: string } }).navigator
  const head = [
    `${app.name} ${app.version}`,
    `platform: ${nav?.platform ?? '?'}`,
    `user agent: ${nav?.userAgent ?? '?'}`,
    `time: ${new Date().toISOString()}`,
    `errors this session: ${entries.length}`
  ]
  const body = entries
    .slice(-50)
    .map((e) =>
      [
        `── ${e.time} [${[e.where, e.kind, e.nodeId, e.op].filter(Boolean).join(' ')}]${e.detail ? ` ${e.detail}` : ''}`,
        e.message,
        e.workerStack && `worker stack:\n${e.workerStack}`,
        e.stack && `stack:\n${e.stack}`,
        e.componentStack && `component stack:${e.componentStack}`
      ]
        .filter(Boolean)
        .join('\n')
    )
  return [...head, '', ...body].join('\n')
}

let installed = false
/** Catch what nothing else does: an uncaught error, or a promise rejected with no handler. */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    reportError(e.error ?? e.message, {
      where: 'window',
      detail: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined
    })
  })
  window.addEventListener('unhandledrejection', (e) => {
    reportError(e.reason, { where: 'promise' })
  })
}
