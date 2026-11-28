/**
 * The ANOVA plots' settings: the Variance plot and the Interaction plot, and what an interaction
 * plot can draw.
 */
import type { ConditionKey } from '../../engine'
import type { PlotAxes, QuickAccess } from './plotStyle'
import type { DRConfig } from './dr'

/** Variance plot (from an ANOVA): how each gene's variation splits among the model's factors
 *  (main effects and interaction) and the residual — its shares of the gene's sum of squares. */
export interface VarianceConfig {
  /** every gene's share per factor as a violin each ('overview', shown as "global"; default), the
   *  selected genes' (else the top genes') share bars ('detail'), or one gene's ('focus') */
  view?: 'overview' | 'detail' | 'focus'
  /** detailed: how many genes when none are selected — the most significant ones */
  topGenes: number
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Interaction plot (from an ANOVA): one gene at a time — its cell means (the model's fit, in
 *  abundance) across one factor's levels, a line per level of the other, its replicates as points
 *  and each mean's standard error as a band or whiskers. Its look is the DR plot's (drLook): the
 *  line, the points and the error, each with its colour ('auto' = one per line), size and opacity. */
export interface InteractionConfig extends Pick<
  DRConfig,
  | 'lineWidth'
  | 'lineColor'
  | 'lineOpacity'
  | 'points'
  | 'pointSize'
  | 'pointColor'
  | 'pointOpacity'
  | 'errors'
  | 'errorStyle'
  | 'errorColor'
  | 'errorOpacity'
> {
  /** the factor along x (a condition key); unset = the model's first factor */
  xFactor?: ConditionKey
  /** factor 2, drawn as lines (the rest are averaged); 'none' — factor 1 alone, every other
   *  factor averaged; unset, or factor 1 = the first factor other than factor 1 */
  lineFactor?: ConditionKey | 'none'
  /** 2-D (the default) or 3-D (needs factor 2) — see interactionDim */
  dim?: '2d' | '3d'
  /** what the view draws (interactionShow): lines (both views); a heatmap (2-D: factor 1 across,
   *  factor 2 down, each tile its cell mean); a surface (3-D, both factors numeric). In 3-D each
   *  cell is log₂ against the control cell. */
  show?: 'line' | 'heatmap' | 'surface'
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}
/** What an interaction plot can draw: whether factor 2 is picked (3-D needs it) and whether both
 *  factors are numeric (a surface needs it — nothing lies between two categories). */
export interface InteractionShape {
  two: boolean
  numeric: boolean
}
export const interactionDim = (c: Partial<InteractionConfig>, s: InteractionShape): '2d' | '3d' =>
  c.dim === '3d' && s.two ? '3d' : '2d'
/** The show the view draws: the picked one where the view can draw it, else lines. */
export function interactionShow(
  c: Partial<InteractionConfig>,
  s: InteractionShape
): 'line' | 'heatmap' | 'surface' {
  const dim = interactionDim(c, s)
  const show = c.show ?? 'line'
  if (dim === '2d') return show === 'heatmap' ? 'heatmap' : 'line'
  return show === 'surface' && s.numeric ? 'surface' : 'line'
}
/** Why a view or a show can't be picked (its tooltip), else undefined. */
export const interactionDimWhy = (dim: string, s: InteractionShape): string | undefined =>
  dim === '3d' && !s.two ? '3D needs a factor 2' : undefined
export const interactionShowWhy = (
  dim: '2d' | '3d',
  show: string,
  s: InteractionShape
): string | undefined =>
  dim === '3d' && show === 'heatmap'
    ? 'A heatmap is 2-D — switch the view to 2D'
    : show === 'surface' && dim === '2d'
      ? 'A surface is 3-D — switch the view to 3D'
      : show === 'surface' && !s.numeric
        ? 'Both factors numeric only — nothing lies between two categories'
        : undefined
