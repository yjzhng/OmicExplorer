/** An engine (Web Worker) failure: the op that failed and the worker's stack, which `postMessage`
 *  would otherwise drop. Its message is the worker's own, unchanged. */
export class EngineError extends Error {
  readonly op: string
  readonly workerStack?: string
  constructor(op: string, message: string, workerStack?: string) {
    super(message)
    this.name = 'EngineError'
    this.op = op
    this.workerStack = workerStack
  }
}

/** What a worker posts back for a failed request: the message, plus its stack. */
export const failure = (err: unknown): { error: string; stack?: string } => ({
  error: err instanceof Error ? err.message : String(err),
  stack: err instanceof Error ? err.stack : undefined
})
