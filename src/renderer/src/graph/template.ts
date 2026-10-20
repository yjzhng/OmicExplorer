/** Project templates (`.omicexplorer-template`): a project's structure — its folders' workflows —
 *  without its data, to start new projects from (see the store's newFromTemplate). What else it
 *  keeps is chosen per section when it's saved (TEMPLATE_SECTIONS). A template never holds
 *  results, folder paths, input file names or fetched annotations: those belong to the data. */
import { deserializeProject, PROJECT_VERSION, type ProjectFile } from './project'
import { categoryOf, NODE_SPECS } from './registry'
import type { InteractiveImport, LoadConfig, NodeConfig, NodeKind, PlotGroupConfig } from './types'
import type { WorkflowDoc } from './workflowDoc'

export type TemplateSection =
  'analysis' | 'importMapping' | 'plotLayout' | 'plotSettings' | 'geneSets'

export type TemplateSections = Record<TemplateSection, boolean>

/** The sections offered when saving a template, in menu order. The workflows themselves
 *  (tiles, wiring, frames) are always kept — every other section hangs off them. */
export const TEMPLATE_SECTIONS: Array<{ key: TemplateSection; label: string }> = [
  { key: 'analysis', label: 'Analysis settings' },
  { key: 'importMapping', label: 'Import mapping' },
  { key: 'plotLayout', label: 'Plot layout' },
  { key: 'plotSettings', label: 'Plot settings' },
  { key: 'geneSets', label: 'Genesets' }
]

export const DEFAULT_TEMPLATE_SECTIONS: TemplateSections = {
  analysis: true,
  importMapping: true,
  plotLayout: true,
  plotSettings: true,
  geneSets: false
}

export const TEMPLATE_EXT = 'omicexplorer-template'

export interface TemplateFile extends Omit<ProjectFile, 'format'> {
  format: 'omicexplorer-template'
  /** what was kept when it was saved */
  sections: TemplateSections
}

/** Whether a file's text is a template (read from its start, without parsing it all). */
export function isTemplateText(text: string): boolean {
  return /"format"\s*:\s*"omicexplorer-template"/.test(text.slice(0, 200))
}

/** The import spec as a template keeps it: no columns (so the wizard reads the new matrix's own
 *  on first open, then fits the rest onto them — see fitTemplateSpec), no fetched annotations,
 *  back at the first stage. */
function templateSpec(spec: InteractiveImport): InteractiveImport {
  const out: InteractiveImport = { ...spec, columns: [], step: 1 }
  delete out.annotations
  return out
}

function loadConfig(cfg: LoadConfig, keepMapping: boolean): LoadConfig {
  const out: LoadConfig = { ...cfg, data: null, samplesheet: null, db: null, matrix: null }
  if (keepMapping && cfg.interactive) out.interactive = templateSpec(cfg.interactive)
  else delete out.interactive
  if (!keepMapping) {
    delete out.units
    delete out.numericConditions
  }
  return out
}

function plotGroupConfig(cfg: PlotGroupConfig, keepSettings: boolean): PlotGroupConfig {
  return {
    ...cfg,
    // a child's run state is the data's, not the template's
    children: cfg.children.map((c) => ({
      id: c.id,
      kind: c.kind,
      config: keepSettings ? c.config : NODE_SPECS[c.kind].defaultConfig()
    }))
  }
}

function nodeConfig(kind: NodeKind, cfg: NodeConfig, s: TemplateSections): NodeConfig {
  if (kind === 'load') return loadConfig(cfg as LoadConfig, s.importMapping)
  if (kind === 'plotGroup') return plotGroupConfig(cfg as PlotGroupConfig, s.plotSettings)
  const keep = categoryOf(kind) === 'plotting' ? s.plotSettings : s.analysis
  return keep ? cfg : NODE_SPECS[kind].defaultConfig()
}

function templateDoc(doc: WorkflowDoc, s: TemplateSections): WorkflowDoc {
  const out: WorkflowDoc = {
    ...doc,
    nodes: doc.nodes.map((n) => ({
      ...n,
      data: { ...n.data, config: nodeConfig(n.data.kind, n.data.config, s) }
    }))
  }
  if (!s.plotLayout) {
    delete out.groupLayouts
    delete out.groupMeta
  }
  return out
}

/** A template of `p` keeping `sections`, named `name`. `p`'s workflows must hold their docs (the
 *  open one synced into its folder); their results are never read. */
export function buildTemplate(
  p: ProjectFile,
  sections: TemplateSections,
  name: string
): TemplateFile {
  return {
    format: 'omicexplorer-template',
    version: PROJECT_VERSION,
    ...(p.appVersion ? { appVersion: p.appVersion } : null),
    name,
    sections: { ...sections },
    folders: p.folders.map((f) => ({
      id: f.id,
      name: f.name,
      path: '',
      activeWorkflowId: f.activeWorkflowId,
      workflows: f.workflows.map((w) => ({
        id: w.id,
        name: w.name,
        doc: templateDoc(w.doc, sections),
        results: {}
      }))
    })),
    activeFolderId: p.activeFolderId,
    geneSets: sections.geneSets ? (p.geneSets ?? []) : []
  }
}

export function serializeTemplate(t: TemplateFile): string {
  return JSON.stringify(t)
}

/** A new (unsaved) project from a template's text: its folders and workflows, each folder waiting
 *  for a data folder to be picked. Throws when the text isn't a template. */
export function projectFromTemplate(text: string): ProjectFile {
  if (!isTemplateText(text)) throw new Error('Not an OmicExplorer template.')
  const p = deserializeProject(text)
  return { ...p, folders: p.folders.map((f) => ({ ...f, path: '' })), view: 'canvas' }
}

/** A template's import spec (columns left empty — see templateSpec) fitted onto a matrix's freshly
 *  read one (`read`: its columns, and roles guessed by the template's preset): what still applies
 *  carries over — a column's role, a sample's conditions and name spans, a filter — wherever the
 *  same header is in the new matrix; the separator, custom conditions (and which are numeric) and
 *  preset always do. */
export function fitTemplateSpec(
  tpl: InteractiveImport,
  read: InteractiveImport
): InteractiveImport {
  const has = new Set(read.columns)
  const pick = <V>(m: Record<string, V> | undefined): Record<string, V> =>
    Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => has.has(k)))
  const out: InteractiveImport = {
    ...read,
    roles: { ...read.roles, ...pick(tpl.roles) },
    conditions: { ...read.conditions, ...pick(tpl.conditions) }
  }
  if (tpl.customConditions) out.customConditions = [...tpl.customConditions]
  if (tpl.hiddenConditions) out.hiddenConditions = [...tpl.hiddenConditions]
  if (tpl.numericConditions) out.numericConditions = [...tpl.numericConditions]
  if (tpl.separator) out.separator = tpl.separator
  if (tpl.preset) out.preset = tpl.preset
  const spans = pick(tpl.spans)
  if (Object.keys(spans).length) out.spans = spans
  const filters = pick(tpl.filters)
  if (Object.keys(filters).length) out.filters = filters
  return out
}

/** Whether a Load tile's import spec came from a template and hasn't met a matrix yet. */
export const isTemplateSpec = (spec: InteractiveImport | undefined): spec is InteractiveImport =>
  !!spec && (spec.columns?.length ?? 0) === 0
