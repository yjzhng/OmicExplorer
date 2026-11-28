/**
 * The tutorial's project: a throw-away, never-saved project on the tour's own synthetic data
 * (data/ — made by scripts/build_tour_data.py: DrugA against DMSO, made-up proteins; nothing real
 * in it), with a ready-made Load → Clean data → Compare
 * chain, so every stop of the tour points at something real. The plot is the user's to make (a
 * volcano, the tour's own steps); Run runs it all, and its points can be clicked.
 *
 * The example files are written to this app run's scratch folder (`tutorial-example/input/`);
 * the project's own outputs go where any unsaved project's do. Nothing is written elsewhere.
 *
 * The user's own project is set aside in memory while the tour runs (as Home keeps it) and put
 * back as it was — unsaved work included — so starting the tour never asks to save.
 */
import type { Edge } from '@xyflow/react'

import type { LoadConfig } from '../../graph/config/load'
import tourDatamatrix from './data/tour_datamatrix.csv?raw'
import tourMetadata from './data/tour_metadata.csv?raw'
import tourSamplesheet from './data/tour_samplesheet.csv?raw'
import { lastViewports, viewportKey } from '../../app/canvasModel'
import { newFolder } from '../../graph/project/project'
import { loadSlot, makeNode, syncActiveSlot } from '../../graph/state/shared'
import { type GraphState, useGraph } from '../../graph/store'
import type { CompareConfig } from '../../graph/config/compare'
import type { GraphNode } from '../../graph/types'
import { buildWorkflowDoc } from '../../graph/project/workflowDoc'
import { useAppView } from '../app/useAppView'
import { canvasNav } from './canvasNav'

/** The tour's tiles, by id (the stops find them on the canvas by these) — its own ids, never a
 *  user's tile's, so nothing cached for one can answer for the other. */
export const DEMO = {
  load: 'tour-load',
  clean: 'tour-clean',
  compare: 'tour-compare'
} as const

/** The tour's input files (written to its folder's input/), and a Load step's settings for them. */
const TOUR_INPUT: { name: string; content: string }[] = [
  { name: 'tour_datamatrix.csv', content: tourDatamatrix },
  { name: 'tour_samplesheet.csv', content: tourSamplesheet },
  { name: 'tour_metadata.csv', content: tourMetadata }
]
export const TOUR_LOAD_CONFIG: LoadConfig = {
  mode: 'manual',
  data: 'tour_datamatrix.csv',
  samplesheet: 'tour_samplesheet.csv',
  db: 'tour_metadata.csv'
}

/** The comparison the tour's Compare steps make: DrugA at 1000 nM against the vehicle, matched by
 *  time — two comparisons (60 min, 24 h; the later one with the clearer response). */
export const EXAMPLE_COMPARE: Pick<CompareConfig, 'num' | 'den' | 'match'> = {
  num: { cmpd: ['DrugA'], dose: ['1000'] },
  den: { cmpd: ['DMSO'] },
  match: ['time']
}

/** The ready-made chain's width on the canvas (three 230 px tiles, 290 apart), and its gap from
 *  the canvas's top edge when the tour opens. */
const CHAIN_W = 810
const CHAIN_TOP = 40

export const DEMO_PROJECT_NAME = 'Tutorial (example data)'

function demoGraph(): { nodes: GraphNode[]; edges: Edge[] } {
  const load = makeNode(DEMO.load, 'load', { x: 0, y: 0 })
  load.data.config = { ...TOUR_LOAD_CONFIG }
  const clean = makeNode(DEMO.clean, 'standardize', { x: 290, y: 0 })
  const compare = makeNode(DEMO.compare, 'compare', { x: 580, y: 0 })
  compare.data.config = { ...(compare.data.config as CompareConfig), ...EXAMPLE_COMPARE }
  return {
    nodes: [load, clean, compare],
    edges: [
      { id: 'tour-e1', source: DEMO.load, target: DEMO.clean },
      { id: 'tour-e2', source: DEMO.clean, target: DEMO.compare }
    ]
  }
}

/** The user's project as it was when the tour started — what `restoreProject` puts back. */
export interface SetAside {
  open: boolean
  project: Pick<
    GraphState,
    | 'projectPath'
    | 'projectName'
    | 'projectCreatedWith'
    | 'folders'
    | 'activeFolderId'
    | 'geneSets'
    | 'dirty'
    | 'past'
    | 'future'
  >
  view: 'canvas' | 'results'
  resultsTab: string | null
}

/** Set the open project (if any) aside: its live graph written back into its folder first, as
 *  going Home does, so the snapshot holds everything. */
export function setProjectAside(): SetAside {
  if (useGraph.getState().projectOpen) syncActiveSlot(useGraph.getState, useGraph.setState)
  const g = useGraph.getState()
  const v = useAppView.getState()
  return {
    open: g.projectOpen,
    project: {
      projectPath: g.projectPath,
      projectName: g.projectName,
      projectCreatedWith: g.projectCreatedWith,
      folders: g.folders,
      activeFolderId: g.activeFolderId,
      geneSets: g.geneSets,
      dirty: g.dirty,
      past: g.past,
      future: g.future
    },
    view: v.view,
    resultsTab: v.resultsTab
  }
}

/** Put the set-aside project back as it was: its graph, unsaved changes, undo history and page. */
export async function restoreProject(a: SetAside): Promise<void> {
  const { past, future, ...project } = a.project
  const has = project.folders.length > 0 && !!project.activeFolderId
  useGraph.setState({
    ...project,
    projectOpen: a.open && has,
    inputFiles: [],
    inputFileFolders: {},
    // none: nothing of the tour's is left on the live graph
    ...(has ? null : { nodes: [], edges: [], results: {}, dataDir: null, selectedId: null })
  })
  if (has) {
    loadSlot(useGraph.getState, useGraph.setState, project.activeFolderId!)
    useGraph.setState({ past, future })
    // its canvas view too (the tour set its own on the same canvas)
    const back = lastViewports.get(viewportKey())
    if (back) canvasNav()?.setView(back)
    await useGraph.getState().refreshDataFiles()
  }
  const v = useAppView.getState()
  if (a.resultsTab) v.setResultsTab(a.resultsTab)
  v.setView(a.view)
}

/** Open the tutorial project in place of the open one (set aside first: see setProjectAside). */
export async function openDemoProject(): Promise<void> {
  const root = useGraph.getState().scratchRoot ?? (await window.api.scratchDir())
  const dir = `${root}/tutorial-example`
  // Lists (and makes) <dir>/input, then the example files go in it.
  await window.api.listInputFiles(dir)
  for (const f of TOUR_INPUT) await window.api.writeWorkflow(`${dir}/input/${f.name}`, f.content)

  const { nodes, edges } = demoGraph()
  const folder = newFolder(dir, 'Example data')
  folder.workflows[0] = {
    ...folder.workflows[0],
    doc: buildWorkflowDoc({ nodes, edges, nextId: 100, groupLayouts: {}, groupMeta: {} })
  }
  useGraph.setState({
    projectPath: null,
    projectName: DEMO_PROJECT_NAME,
    projectCreatedWith: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null,
    projectOpen: true,
    folders: [folder],
    activeFolderId: folder.id,
    geneSets: [],
    dirty: false,
    inputFiles: [],
    inputFileFolders: {}
  })
  loadSlot(useGraph.getState, useGraph.setState, folder.id)
  // Opened at full size with the chain along the top (not fitted to the middle), so the canvas
  // below is free for the steps the user places.
  // Set for the canvas to open on, and on the canvas now if it's already up (it isn't remounted
  // for another project).
  const view = { x: Math.max(CHAIN_TOP, (window.innerWidth - CHAIN_W) / 2), y: CHAIN_TOP, zoom: 1 }
  lastViewports.set(viewportKey(), view)
  canvasNav()?.setView(view)
  useAppView.getState().setView('canvas')
  await useGraph.getState().refreshDataFiles()
}
