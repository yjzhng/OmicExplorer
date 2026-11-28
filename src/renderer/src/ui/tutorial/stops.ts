/**
 * The tour's stops, in order. Most come in pairs: one lights a control and waits for it to be
 * clicked (`done` turns true), the next shows what the click did — the menu, panel or mode it
 * opened — and explains it. Next works everywhere: skipping a click, the following stop makes its
 * outcome itself (`enter`), so the tour never depends on the user having clicked.
 *
 * Targets are CSS selectors — the controls carry `data-tour` attributes, tiles React Flow's
 * `data-id`.
 */
import { categoryOf, hasSourceHandle } from '../../graph/registry'
import { useGraph } from '../../graph/store'
import { isStep, type NodeKind, type StepNode } from '../../graph/types'
import type { LoadConfig } from '../../graph/config/load'
import { useAppView } from '../app/useAppView'
import { useSelection } from '../plot/useSelection'
import { DEMO, DEMO_PROJECT_NAME, EXAMPLE_COMPARE, TOUR_LOAD_CONFIG } from './demo'

export interface TourStop {
  id: string
  /** what the stop is about: lit, and the only thing in reach (a function: worked out as the
   *  stop runs — a tile the user made) */
  target: string | (() => string)
  /** light every match of `target` together (one box round them all), not just the first */
  all?: boolean
  /** related controls, ringed (not clickable) */
  also?: string[]
  title: string
  body: string
  /** a click stop: the lit control can be used, and the tour moves on once this holds */
  done?: () => boolean
  /** the hint shown on a click stop */
  clickHint?: string
  /** an outcome stop whose lit part can be used too (typing a name, browsing a menu) */
  interactive?: boolean
  /** what it shows is opened again (`enter`) should it close while the stop is on */
  reopen?: boolean
  /** a drag starts here: the light follows the pointer while it's held, so the drop lands in view */
  followDrag?: boolean
  /** put the app in the state the stop needs, on arriving at it */
  enter?: () => void
}

const tile = (id: string): string => `.react-flow__node[data-id="${id}"]`
const graph = useGraph.getState
const toCanvas = (): void => useAppView.getState().setView('canvas')
/** The canvas with nothing selected: no settings open, no tile picked (a picked tile's action bar
 *  takes ＋ New step's place). */
const clearCanvas = (): void => {
  toCanvas()
  graph().selectNode(null)
  graph().selectTiles([])
}
const toResults = (): void => useAppView.getState().setView('results')
const el = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel)

const FOLDER_CHIP = '#oe-folder-chip'
const NEW_STEP = '[data-tour="new-step"]'
/** The step the hands-on stops work on: the user's Clean data, else the step they placed (else
 *  the example's Clean data). */
const own = (): string => userClean() ?? placedStep()?.id ?? DEMO.clean
const NAME = (): string => `${tile(own())} [title="Click to rename"]`
const NAME_INPUT = (): string => `${tile(own())} input`
const GENES_BTN = '[data-tour="genes"] button'
const PLOT = '[data-tour="plot"]'
const PLOT_SETTINGS_BTN = `${PLOT} [aria-label="Panel settings"]`
const PLOT_SETTINGS = '[role="dialog"][aria-label="Panel settings"]'

/** The tour's own tiles' ids start with this (demo.ts); any other step is one the user added. */
const TOUR_ID = 'tour-'
/** Where a step made for the user (they skipped placing it) goes: below the chain. */
const SPARE_SPOT = { x: 290, y: 300 }
/** The pending picker (its `source` given: one dragged from that step). */
const placeholder = (source?: string): string | undefined =>
  graph().nodes.find(
    (n) =>
      n.type === 'placeholder' &&
      (!source || (n.data as { source?: string | null }).source === source)
  )?.id
/** The step the user placed on their own (no step feeding it). */
const placedStep = (): StepNode | undefined => {
  const g = graph()
  return g.nodes.find(
    (n): n is StepNode =>
      isStep(n) && !n.id.startsWith(TOUR_ID) && !g.edges.some((e) => e.target === n.id)
  )
}
/** Where "Add more steps" grows from: the step the user placed — or, if it can't feed another
 *  (a plot), the tour's Compare. */
const growFrom = (): string => {
  const p = placedStep()
  return p && hasSourceHandle(p.data.kind) ? p.id : DEMO.compare
}
/** Steps the user added that are wired to another. */
const linkedSteps = (): string[] => {
  const added = new Set(extraSteps())
  return graph()
    .edges.filter((e) => added.has(e.target) && !e.target.startsWith(TOUR_ID))
    .map((e) => e.target)
}
/** The example's data is small, so a run is over in a blink — the step would look done before
 *  it was seen running. Once its run has finished, the step is shown running for a moment more,
 *  then done: what a run looks like on real data. Its status is put back as it was. */
let showing: ReturnType<typeof setTimeout> | undefined
const statusOf = (id: string): string | undefined => {
  const n = graph().nodes.find((x) => x.id === id)
  return n && isStep(n) ? n.data.status : undefined
}
const setStatus = (id: string, status: 'running' | 'done'): void =>
  useGraph.setState((s) => ({
    nodes: s.nodes.map((n) =>
      n.id === id && isStep(n) ? { ...n, data: { ...n.data, status } } : n
    )
  }))
function showRun(id: string, waited = 0): void {
  clearTimeout(showing)
  // only ever on the tour's project (the tour may have ended meanwhile)
  if (graph().projectName !== DEMO_PROJECT_NAME) return
  // the real run first (or give up after a while: a step that can't run has nothing to show)
  if (graph().runningAll || statusOf(id) === 'running') {
    if (waited < RUN_WAIT_MS) showing = setTimeout(() => showRun(id, waited + 100), 100)
    return
  }
  if (statusOf(id) !== 'done') return
  setStatus(id, 'running')
  showing = setTimeout(() => {
    const g = graph()
    if (g.projectName === DEMO_PROJECT_NAME && statusOf(id) === 'running' && !g.runningAll)
      setStatus(id, 'done')
  }, RUN_SHOW_MS)
}
/** How long a finished step is shown running. */
const RUN_SHOW_MS = 1600
/** How long to wait for the real run to end before showing it. */
const RUN_WAIT_MS = 10000

/** The steps the tour lets the user add — ones that run on the example data as they come: a Load
 *  (given the example files), then a Clean data after it. */
const FIRST: NodeKind[] = ['load']
const NEXT: NodeKind[] = ['standardize']
/** Narrow a pending picker to `ops`. */
const offerOnly = (id: string, ops: NodeKind[]): void =>
  useGraph.setState((s) => ({
    nodes: s.nodes.map((n) =>
      n.id === id && n.type === 'placeholder' ? { ...n, data: { ...n.data, ops } } : n
    )
  }))
/** Give the user's Load the example files (as the tour's own Load has), so it runs. */
const withExampleData = (id: string | undefined): void => {
  const n = id && graph().nodes.find((x) => x.id === id)
  if (!n || !isStep(n) || n.data.kind !== 'load') return
  const c = n.data.config as LoadConfig
  if (c.data === TOUR_LOAD_CONFIG.data) return
  graph().updateConfig(n.id, { ...TOUR_LOAD_CONFIG })
  void graph().checkLoad(n.id)
}
/** Where a step the tour links for the user goes: to the right of the one grown from. */
const nextSpot = (): { x: number; y: number } => {
  const n = graph().nodes.find((x) => x.id === growFrom())
  return n ? { x: n.position.x + 300, y: n.position.y + 40 } : SPARE_SPOT
}
/** Take away what grew from the placed step: a pending picker, linked steps. */
const removeLinked = (): void => {
  const ph = placeholder()
  if (ph) graph().cancelPlaceholder(ph)
  for (const id of linkedSteps()) graph().deleteNode(id)
}
const extraSteps = (): string[] =>
  graph()
    .nodes.filter((n) => isStep(n) && !n.id.startsWith(TOUR_ID))
    .map((n) => n.id)
/** Take away what the user added during the tour: a pending picker, new steps. */
const removeAdded = (): void => {
  const ph = placeholder()
  if (ph) graph().cancelPlaceholder(ph)
  for (const id of extraSteps()) graph().deleteNode(id)
}
/** The user's own steps by kind: their Clean data, their plot. */
const userStep = (test: (kind: NodeKind) => boolean): string | undefined => {
  const added = new Set(extraSteps())
  return graph().nodes.find((n) => added.has(n.id) && isStep(n) && test(n.data.kind))?.id
}
const userClean = (): string | undefined => userStep((k) => k === 'standardize')
const userCompare = (): string | undefined => userStep((k) => k === 'compare')
const userPlot = (): string | undefined => userStep((k) => categoryOf(k) === 'plotting')
/** The plot the user makes: a volcano, whose points show off highlighting later in the tour. */
const PLOTS: NodeKind[] = ['volcano']
/** A volcano plots a comparison: the tour adds the user's Clean data a Compare (the example's
 *  comparison) to draw it from. */
function ensureCompare(): void {
  const clean = userClean()
  if (!clean || userCompare()) return
  const n = graph().nodes.find((x) => x.id === clean)
  const at = n ? { x: n.position.x + 300, y: n.position.y } : SPARE_SPOT
  const ph = graph().addPlaceholder(clean, ['compare'], at)
  graph().resolvePlaceholder(ph, [{ kind: 'compare', override: { ...EXAMPLE_COMPARE } }])
}
/** Where the user's plot grows from (their Compare, else the example's), and goes. */
const plotFrom = (): string => userCompare() ?? DEMO.compare
const plotSpot = (): { x: number; y: number } => {
  const n = graph().nodes.find((x) => x.id === plotFrom())
  return n ? { x: n.position.x + 300, y: n.position.y } : SPARE_SPOT
}
/** Take the user's plot away (and a picker for one). */
const removePlot = (): void => {
  const ph = placeholder(plotFrom())
  if (ph) graph().cancelPlaceholder(ph)
  const p = userPlot()
  if (p) graph().deleteNode(p)
}
const folderOpen = (): boolean => !!el(`${FOLDER_CHIP}[data-open="true"]`)
const placing = (): boolean => el(NEW_STEP)?.textContent?.trim() === 'Cancel'

export const STOPS: TourStop[] = [
  {
    id: 'folder',
    target: FOLDER_CHIP,
    title: 'Your data folder',
    body: 'Each project keeps its data in a folder; your input files go in its input/ folder. Open the folder menu.',
    clickHint: 'Click the folder chip',
    done: folderOpen,
    enter: clearCanvas
  },
  {
    id: 'folder-menu',
    reopen: true,
    target: '[data-tour="folder-menu"]',
    title: 'Folders',
    body: 'Switch between data folders, add another, or move one elsewhere. The tour’s folder holds example data.',
    enter: () => {
      clearCanvas()
      if (!folderOpen()) el(FOLDER_CHIP)?.click()
    }
  },
  {
    id: 'new-step',
    target: NEW_STEP,
    title: 'Build a workflow',
    body: 'A workflow is a chain of steps: load, clean, compare, plot. Steps are added from here.',
    clickHint: 'Click ＋ New step',
    done: placing,
    enter: clearCanvas
  },
  {
    id: 'placing',
    target: '.react-flow__pane',
    title: 'Place it',
    body: 'The new step goes wherever you click on the canvas.',
    clickHint: 'Click an empty spot on the canvas',
    done: () => !!placeholder(),
    enter: () => {
      removeAdded()
      clearCanvas()
      if (!placing()) el(NEW_STEP)?.click()
    }
  },
  {
    id: 'pick-type',
    target: '.react-flow__node-placeholder',
    title: 'Choose what it is',
    body: 'First the type of step — Data, Processing or Visualisation — then the step itself. Every workflow starts from Data: for the tour, a Load data step that comes with the example data.',
    clickHint: 'Choose Data, then Load data',
    done: () => extraSteps().length > 0,
    enter: () => {
      toCanvas()
      if (placing()) el(NEW_STEP)?.click()
      // Back from the new tile: it goes, and its picker comes back.
      for (const id of extraSteps()) graph().deleteNode(id)
      const ph = placeholder() ?? graph().addPlaceholder(null, FIRST, SPARE_SPOT)
      // The tour's steps are ones that run on the example data: this one, a Load.
      offerOnly(ph, FIRST)
    }
  },
  {
    id: 'drag-next',
    target: () => `${tile(growFrom())} .react-flow__handle.source`,
    title: 'Add more steps',
    body: 'Drag from a step’s right-hand dot onto empty canvas: the next step comes already linked to it.',
    clickHint: 'Drag from the ringed dot to an empty spot',
    followDrag: true,
    done: () => !!placeholder(growFrom()) || linkedSteps().length > 0,
    enter: () => {
      removeLinked()
      // Skipped the pick: the tour makes the step, so there's one to grow from.
      if (!placedStep()) {
        const ph = placeholder() ?? graph().addPlaceholder(null, FIRST, SPARE_SPOT)
        graph().resolvePlaceholder(ph, [{ kind: FIRST[0] }])
      }
      withExampleData(placedStep()?.id)
      clearCanvas()
    }
  },
  {
    id: 'pick-next',
    target: '.react-flow__node-placeholder',
    title: 'Only what fits',
    body: 'The picker offers only steps that can follow the one you dragged from. After loading, the data is cleaned: pick Clean data.',
    clickHint: 'Choose Clean data',
    done: () => linkedSteps().length > 0,
    enter: () => {
      toCanvas()
      // Back from the linked tile: it goes, and its picker comes back.
      for (const id of linkedSteps()) graph().deleteNode(id)
      let ph = placeholder(growFrom())
      if (!ph) {
        const other = placeholder()
        if (other) graph().cancelPlaceholder(other)
        ph = graph().addPlaceholder(growFrom(), NEXT, nextSpot())
      }
      offerOnly(ph, NEXT)
    }
  },
  {
    id: 'configure',
    target: () => tile(own()),
    title: 'Set up a step',
    body: 'Each step has its settings. Click your step to open them.',
    clickHint: 'Click the step',
    done: () => graph().selectedId === own(),
    enter: () => {
      // a picker left open (the pick skipped) goes
      const ph = placeholder()
      if (ph) graph().cancelPlaceholder(ph)
      clearCanvas()
    }
  },
  {
    id: 'settings',
    reopen: true,
    target: '[data-tour="step-settings"]',
    title: 'Its settings',
    body: 'Everything the step does is set here. Change a setting and the step — and the ones after it — run again next time.',
    enter: () => {
      toCanvas()
      if (graph().selectedId !== own()) graph().selectNode(own())
    }
  },
  {
    id: 'rename',
    target: NAME,
    title: 'Name it your way',
    body: 'Click a step’s name to rename it.',
    clickHint: 'Click the name',
    done: () => !!el(NAME_INPUT()),
    enter: toCanvas
  },
  {
    id: 'rename-edit',
    reopen: true,
    target: NAME_INPUT,
    interactive: true,
    title: 'Type a name',
    body: 'Type a new name and press Enter (Esc keeps the old one). The step’s output folder follows its name when you save.',
    clickHint: 'Type, then Enter',
    done: () => {
      const n = graph().nodes.find((x) => x.id === own())
      return !!n && isStep(n) && !!n.data.name && !el(NAME_INPUT())
    },
    enter: () => {
      toCanvas()
      if (!el(NAME_INPUT())) el(NAME())?.click()
    }
  },
  {
    id: 'run',
    target: '[data-tour="run"]',
    also: [`${tile(DEMO.clean)} [data-tour="step-run"]`],
    title: 'Run it',
    body: 'Run runs every step of the workflow; each step also has its own Run, to run just that one.',
    clickHint: 'Click Run',
    done: () => {
      const g = graph()
      return (
        g.runningAll ||
        g.nodes.some((n) => isStep(n) && n.id === DEMO.compare && n.data.status === 'running')
      )
    },
    enter: clearCanvas
  },
  {
    id: 'running',
    target: () => tile(own()),
    title: 'How it went',
    body: 'Each step’s dot shows its progress and turns green when it’s done.',
    enter: () => {
      toCanvas()
      const g = graph()
      if (!g.runningAll && !g.nodes.some((n) => isStep(n) && n.data.status === 'done'))
        void g.runAll()
      showRun(own())
    }
  },
  {
    id: 'drag-plot',
    target: () => `${tile(plotFrom())} .react-flow__handle.source`,
    title: 'Plot it',
    body: 'Plots are steps too. A volcano plots a comparison, so the tour has added a Compare after your Clean data (DrugA against the vehicle). Drag from its right-hand dot onto empty canvas.',
    clickHint: 'Drag from the ringed dot to an empty spot',
    followDrag: true,
    done: () => !!placeholder(plotFrom()) || !!userPlot(),
    enter: () => {
      removePlot()
      ensureCompare()
      clearCanvas()
      // the comparison runs meanwhile, so the picker knows what it can plot
      const c = userCompare()
      if (c && statusOf(c) !== 'done' && !graph().runningAll) void graph().runAll()
    }
  },
  {
    id: 'pick-plot',
    target: '.react-flow__node-placeholder',
    title: 'Choose a plot',
    body: 'Under Visualisation, tick Volcano and add it. (Tick several plots and they share one tile.)',
    clickHint: 'Visualisation, tick Volcano, add it',
    done: () => !!userPlot(),
    enter: () => {
      toCanvas()
      // Back from the plot: it goes, and its picker comes back.
      const p = userPlot()
      if (p) graph().deleteNode(p)
      let ph = placeholder(plotFrom())
      if (!ph) {
        const other = placeholder()
        if (other) graph().cancelPlaceholder(other)
        ph = graph().addPlaceholder(plotFrom(), PLOTS, plotSpot())
      }
      offerOnly(ph, PLOTS)
    }
  },
  {
    id: 'plot-tile',
    target: () => tile(userPlot() ?? plotFrom()),
    title: 'Your volcano',
    body: 'It runs from the comparison before it and draws on its tile — and on the Results page.',
    enter: () => {
      toCanvas()
      // Skipped the pick: the tour adds the volcano, so there's a plot to show.
      if (!userPlot()) {
        const ph = placeholder(plotFrom()) ?? graph().addPlaceholder(plotFrom(), PLOTS, plotSpot())
        graph().resolvePlaceholder(ph, [{ kind: PLOTS[0] }])
      }
      const p = userPlot()
      if (p && statusOf(p) !== 'done' && !graph().runningAll) void graph().runAll()
    }
  },
  {
    id: 'save',
    target: '[data-tour="save"]',
    also: ['[data-tour="project"]'],
    title: 'Save your work',
    body: 'Save here, or with ⌘S. The dot by the project name is amber while there are unsaved changes and green once saved. (The tour’s project isn’t saved.)',
    enter: clearCanvas
  },
  {
    id: 'results',
    target: '[data-tour="results"]',
    also: ['.react-flow__node-step [aria-label="Open in Results"]'],
    title: 'See the results',
    body: 'Results → opens every plot on one page. On a plot step, ↗ jumps straight to its tab.',
    clickHint: 'Click Results →',
    done: () => useAppView.getState().view === 'results',
    enter: clearCanvas
  },
  {
    id: 'points',
    target: PLOT,
    title: 'Every point is live',
    body: 'Hover a point to find that gene in every plot; click it to pin it. Table rows and legend entries work the same way.',
    clickHint: 'Click a point',
    done: () => useSelection.getState().pinnedIds.size > 0,
    enter: () => {
      toResults()
      useSelection.getState().clearPins()
    }
  },
  {
    id: 'genes',
    target: '[data-tour="genes"]',
    title: 'Highlight genes',
    body: 'Pinned genes are gathered here. Open it.',
    clickHint: 'Click Highlight genes',
    done: () => !!el('[data-tour="gene-menu"]'),
    enter: toResults
  },
  {
    id: 'gene-menu',
    target: '[data-tour="gene-menu"]',
    interactive: true,
    title: 'Genes and groups',
    body: 'Search genes or pathways, or browse them by function. Save a selection as a gene group, and click groups to colour them in every plot.',
    // The menu closing (by any click that closes it) moves on — it isn't opened again (`reopen`),
    // which brought it straight back each time it closed.
    done: () => !el('[data-tour="gene-menu"]'),
    enter: () => {
      toResults()
      if (!el('[data-tour="gene-menu"]')) el(GENES_BTN)?.click()
    }
  },
  {
    id: 'plot-tools',
    target: PLOT_SETTINGS_BTN,
    also: [`${PLOT} [aria-label="Copy plot"]`, `${PLOT} [aria-label="Download"]`],
    title: 'Make it yours',
    body: 'Each plot can be copied (PNG or SVG) or downloaded from its header, and has settings of its own. Open them.',
    clickHint: 'Click ⚙',
    done: () => !!el(PLOT_SETTINGS),
    enter: toResults
  },
  {
    id: 'plot-settings',
    target: PLOT_SETTINGS,
    interactive: true,
    title: 'Plot settings',
    body: 'Colours, labels, axes, text sizes: changes show on the plot at once. That’s the tour.',
    clickHint: 'Apply or Close to finish',
    // Closing the settings (Apply, Close) ends the tour — they aren't opened again (`reopen`),
    // which would bring them straight back after Apply.
    done: () => !el(PLOT_SETTINGS),
    enter: () => {
      toResults()
      if (!el(PLOT_SETTINGS)) el(PLOT_SETTINGS_BTN)?.click()
    }
  }
]
