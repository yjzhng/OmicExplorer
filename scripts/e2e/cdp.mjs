// A small Chrome DevTools Protocol client for a test instance of the app (scripts/e2e/README.md).
export async function connect(port) {
  const page = (await (await fetch(`http://localhost:${port}/json/list`)).json()).find(
    (p) => p.type === 'page'
  )
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let seq = 0
  const waiting = new Map()
  ws.addEventListener('close', () => {
    console.log('WEBSOCKET CLOSED')
    process.exit(3)
  })
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data)
    if (d.id && waiting.has(d.id)) {
      waiting.get(d.id)(d)
      waiting.delete(d.id)
    }
  })
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++seq
      waiting.set(i, r)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  /** Evaluate in the page (awaiting a promise); throws the page's exception, or after 180 s. */
  const ev = async (expr) => {
    const d = await Promise.race([
      send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('TIMEOUT 180s: ' + expr.slice(0, 160))), 180000)
      )
    ])
    if (d.result?.exceptionDetails)
      throw new Error(
        'EXC ' +
          (
            d.result.exceptionDetails.exception?.description ||
            JSON.stringify(d.result.exceptionDetails)
          ).slice(0, 600)
      )
    return d.result?.result?.value
  }
  return { send, ev }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms))
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

/** The app's own module instances (the URLs its graph imported them by). */
export const MODS = `const urlOf = (p) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(p)) || p;
  const S = (await import(urlOf('/src/graph/store.ts'))).useGraph;
  const V = (await import(urlOf('/src/ui/useAppView.ts'))).useAppView;`
