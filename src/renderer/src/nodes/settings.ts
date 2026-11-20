/**
 * Every kind's settings panel, by kind (nodes/<kind>/Settings.tsx). The settings window
 * (graph/NodeConfigPanel.tsx) and a Results tile's settings dialog render a kind's entry: a step's
 * panel edits its node by id; a plot's panel edits a config through `update` (a standalone plot, or
 * a subcard inside a group tile). null: nothing of its own to set (a group's settings are its
 * subcards'). A kind added to NodeKind without an entry here fails the type check.
 */
import type { ComponentType } from 'react'

import type { NodeConfig, NodeKind } from '../graph/types'
import { Settings as load } from './load/Settings'
import { Settings as standardize } from './standardize/Settings'
import { Settings as merge } from './merge/Settings'
import { Settings as subset } from './subset/Settings'
import { Settings as compare } from './compare/Settings'
import { Settings as curveFit } from './curveFit/Settings'
import { Settings as contrast } from './contrast/Settings'
import { Settings as volcano } from './volcano/Settings'
import { Settings as heatmap } from './heatmap/Settings'
import { Settings as scatter } from './scatter/Settings'
import { Settings as ma } from './ma/Settings'
import { Settings as dr } from './dr/Settings'
import { Settings as potency } from './potency/Settings'
import { Settings as metrics } from './metrics/Settings'
import { Settings as variance } from './variance/Settings'
import { Settings as interaction } from './interaction/Settings'
import { Settings as curveMad } from './curveMad/Settings'
import { Settings as response } from './response/Settings'
import { Settings as bubble } from './bubble/Settings'
import { Settings as dumbbell } from './dumbbell/Settings'
import { Settings as tdr } from './tdr/Settings'
import { Settings as geneBar } from './geneBar/Settings'
import { Settings as pca } from './pca/Settings'
import { Settings as enrich } from './enrich/Settings'
import { Settings as string } from './string/Settings'
import { Settings as qc } from './qc/Settings'
import { Settings as corr } from './corr/Settings'
import { Settings as table } from './table/Settings'

/** A step's panel: it edits its own node (`id`). */
export interface StepSettingsProps {
  id: string
  config: NodeConfig
}
/** A plot's panel: it edits `config` through `update`; `edgeNodeId` is the node whose incoming edge
 *  is the plot's upstream (the plot itself, or its group tile). */
export interface PlotSettingsProps {
  config: NodeConfig
  update: (patch: Record<string, unknown>) => void
  edgeNodeId: string
}
export type SettingsEntry =
  { step: ComponentType<StepSettingsProps> } | { plot: ComponentType<PlotSettingsProps> } | null

export const SETTINGS: Record<NodeKind, SettingsEntry> = {
  load: { step: load },
  standardize: { step: standardize },
  merge: { step: merge },
  subset: { step: subset },
  compare: { step: compare },
  curveFit: { step: curveFit },
  contrast: { step: contrast },
  volcano: { plot: volcano },
  heatmap: { plot: heatmap },
  scatter: { plot: scatter },
  ma: { plot: ma },
  dr: { plot: dr },
  potency: { plot: potency },
  metrics: { plot: metrics },
  variance: { plot: variance },
  interaction: { plot: interaction },
  curveMad: { plot: curveMad },
  response: { plot: response },
  bubble: { plot: bubble },
  dumbbell: { plot: dumbbell },
  tdr: { plot: tdr },
  geneBar: { plot: geneBar },
  pca: { plot: pca },
  enrich: { plot: enrich },
  string: { plot: string },
  qc: { plot: qc },
  corr: { plot: corr },
  table: { plot: table },
  plotGroup: null
}
