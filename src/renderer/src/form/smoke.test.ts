/**
 * Render smoke test for the `form` workflow view (Settings → Appearance → Layout).
 *
 * It is a thin projection over the graph store, so the failure it can realistically have is a
 * render-time crash — a bad hook order, a missing provider, a null deref on an empty project —
 * which typecheck cannot see and the unit tests never exercise. Server-rendering it catches
 * exactly that. The renderer's modules run side effects against the preload bridge at import time,
 * so `window` is stubbed with no-ops rather than pulled in via a DOM environment.
 *
 * The paged results view can't be rendered this way — it reaches Plotly, which needs a real DOM at
 * import — so its page derivation is covered as pure logic in pages.test.ts instead. Note a server
 * render can only ever see the INITIAL store: zustand v5 hands `getInitialState` to
 * useSyncExternalStore as the server snapshot, so anything driven by a store mutation (a rename,
 * say) has to be tested as pure logic, not asserted on this markup.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

const noop = (): void => {}
vi.stubGlobal('window', {
  // Every preload call is a no-op returning a no-op (several are unsubscribe functions).
  api: new Proxy({}, { get: () => () => noop }),
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop })
})
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: noop,
  removeItem: noop
})

const render = async (mod: string, name: string): Promise<string> => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const m = (await import(mod)) as Record<string, () => unknown>
  return renderToStaticMarkup(createElement(m[name] as never))
}

describe('form layout views render', () => {
  it('renders the seeded pipeline as one tile per step', async () => {
    const html = await render('./FormWorkflow', 'FormWorkflow')
    const { useGraph } = await import('../graph/store')
    const steps = useGraph.getState().nodes.filter((n) => n.type === 'step')
    // Every step is in the workflow column, and each can be dragged — this also pins the
    // ReactFlowProvider wrapper: the shared config panels' `Select` reads the React Flow
    // transform, and `useStore` throws outright without a provider.
    expect(html).toContain('Load data')
    expect(html).toContain('Clean data')
    expect(html).toContain('Add step')
    expect((html.match(/aria-label="Drag to reorder"/g) ?? []).length).toBe(steps.length)
  })

  it("shows one step's settings, with its wiring stated at the top", async () => {
    const html = await render('./FormWorkflow', 'FormWorkflow')
    const { useGraph } = await import('../graph/store')
    const selected = useGraph.getState().selectedId
    // Exactly one config panel — for the selected step, not one per tile.
    expect((html.match(/data-config-panel/g) ?? []).length).toBe(1)
    expect(html).toContain(`data-config-panel="${selected}"`)
    // The wiring moved here from the old middle column; a source step says so rather than
    // offering an input it can't take.
    expect(html).toMatch(/Input|Source step/)
  })

  it('is one view: no Workflow/Results split to switch between', async () => {
    const html = await render('./FormWorkflow', 'FormWorkflow')
    // The workflow column and the selected step's panel, and a single divider between them.
    expect(html).toContain('Analysis workflow')
    expect((html.match(/role="separator"/g) ?? []).length).toBe(1)
    expect(html).toContain('aria-label="Resize the workflow column"')
  })

  it("uses the app's own pickers, never a native one", async () => {
    const html = await render('./FormWorkflow', 'FormWorkflow')
    // A native <select> ignores the theme and draws the platform's chrome, which is jarring in a
    // themed list. Nothing in this view should be one.
    expect(html).not.toContain('<select')
  })

  it('shows "add step" as a tile, and lists the kinds only once opened', async () => {
    const html = await render('./FormWorkflow', 'FormWorkflow')
    const { NODE_SPECS } = await import('../graph/registry')
    expect(html).toContain('+ Add step')
    // Closed by default, so the kinds aren't sitting in the document. A SUBTITLE is the giveaway:
    // step labels also appear as section titles, so they can't tell open from closed.
    expect(NODE_SPECS.compare.subtitle).toBeTruthy()
    expect(html).not.toContain(NODE_SPECS.compare.subtitle as string)
  })

  it('leaves no pending placeholder behind in the graph', async () => {
    // The picker commits through the canvas's placeholder flow, and a placeholder is a real node
    // while it's open. Merely rendering the view must not create one.
    await render('./FormWorkflow', 'FormWorkflow')
    const { useGraph } = await import('../graph/store')
    expect(useGraph.getState().nodes.some((n) => n.type === 'placeholder')).toBe(false)
  })

  it('never calls a plot "not run" — a plot has no run of its own', async () => {
    const html = await render('./FormWorkflow', 'FormWorkflow')
    const { useGraph } = await import('../graph/store')
    const { NODE_SPECS } = await import('../graph/registry')
    const steps = useGraph.getState().nodes.filter((n) => n.type === 'step')
    const plots = steps.filter((n) => !NODE_SPECS[n.data.kind].hasRun)
    const runnable = steps.filter((n) => NODE_SPECS[n.data.kind].hasRun)
    expect(plots.length).toBeGreaterThan(0)

    // A plot's status stays `idle` for the life of the project, so reading it as a run state made
    // the form say "not run" for a step the canvas shows as ready. Only runnable steps get one.
    // The status is a dot; what it means is its aria-label.
    expect((html.match(/aria-label="Not run"/g) ?? []).length).toBeLessThanOrEqual(runnable.length)
    expect((html.match(/role="img" aria-label="/g) ?? []).length).toBe(steps.length)
  })

  it("reads a Load tile's readiness from its own files, not from an upstream", async () => {
    const html = await render('./FormWorkflow', 'FormWorkflow')
    const { useGraph } = await import('../graph/store')
    const { unconfiguredLoad } = await import('../graph/types')
    const load = useGraph.getState().nodes.find((n) => n.data?.kind === 'load')
    expect(load).toBeDefined()
    // A Load has nothing upstream, so the "waiting for data" path never applies to it. The seed
    // has its files set, so it must read ready — it said waiting forever before.
    expect(unconfiguredLoad(load!.data.config as never)).toBeNull()
    expect(html).toContain('aria-label="Ready"')
  })

  it('uses no colour built by pasting an alpha onto a CSS variable', () => {
    // `UI.*` are `var(--…)` references, so `${UI.textMuted}7a` yields `var(--text-muted)7a` —
    // invalid CSS. The property is dropped, and an SVG stroke then defaults to none, so the whole
    // graph silently disappears. Typecheck can't see it; it renders as an empty column.
    const src = readFileSync(new URL('./SideNav.tsx', import.meta.url), 'utf8')
    expect(src).not.toMatch(/\$\{UI\.[A-Za-z]+\}[0-9a-fA-F]{2}/)
  })
})
