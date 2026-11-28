/** Compare's (and Curve fit's) run: the comparison table — t-tests / limma / SAM, an ANOVA,
 *  or curve fits — over its (up to two, pooled) Clean data inputs. */
import type { NodeResult } from '../../graph/types'
import {
  anovaFactorsOf,
  type CompareConfig,
  describesAll,
  normalizeCompareConfig
} from '../../graph/config/compare'
import { hiddenGeneIds, maskSignf } from '../../graph/project/geneMask'
import { engine } from '../../engine/client'
import { rowsArg } from '../../engine/columns/lazyRows'
import {
  combineStandardize,
  analysisScaleOf,
  type CompareTableResult,
  batchesOf,
  BATCH_COND,
  numericConds
} from '../../engine'
import type { StepRunContext } from '../runContext'

export async function run(ctx: StepRunContext): Promise<void> {
  const { id, kind, node, state, get, set, setStatus, onProgress } = ctx
  // Compare (and Curve fit, the same num/den model) accepts up to two Standardize inputs; pool them into one dataset (rows matched
  // across datasets by uniqID) so numerator/denominator/context conditions can be drawn from
  // either. One input is the common case and passes through unchanged.
  const stds = state
    .upstreamIds(id)
    .map((u) => state.results[u])
    .filter((r): r is Extract<NodeResult, { kind: 'standardize' }> => r?.kind === 'standardize')
    .map((r) => r.std)
  if (stds.length === 0) {
    setStatus('error', 'Connect a Clean data tile upstream.')
    return
  }
  const std = combineStandardize(stds)
  // on the scale the pooled data carries (the first input's, as combineStandardize presents it)
  // (the analysis scale: fractions of a reference protein are shown unlogged but tested logged)
  const testsLogged = analysisScaleOf(std) !== 'linear'
  // Migrate any legacy veh_norm/direct config to the explicit num/den/match model, and
  // persist it so the stored workflow is updated on first run.
  const cfg = normalizeCompareConfig(node.data.config as CompareConfig)
  if (cfg !== node.data.config) get().updateConfig(id, cfg as unknown as Record<string, unknown>)

  let cmp: CompareTableResult
  if (kind === 'curveFit' || cfg.analysis === 'curve_fit') {
    const numPinned = Object.values(cfg.num).some((v) => v && v.length > 0)
    const denPinned = Object.values(cfg.den).some((v) => v && v.length > 0)
    if (!numPinned || !denPinned) {
      setStatus('error', 'Open “Configure curve fit” to pick the treatments and the control.')
      return
    }
    // The baseline is whatever the user picked — the vehicle, or a treated level (the top
    // dose, a late time) to fit the inverse effect from there.
    const curveAxis = cfg.curveAxis ?? 'dose'
    setStatus('running')
    // The response surface method: spline detection on log₂ level means vs the control,
    // over one axis or the dose × time surface.
    // A surface (under either model) needs both its axes in the data — a saved choice may
    // outlive them.
    const pair = cfg.surfacePair ?? ['dose', 'time']
    const surface = !!cfg.surface && pair.every((c) => std.activeConditions.includes(c))
    // testing changes: the axis the curves run along is the user's pick
    if (
      surface &&
      cfg.surfaceIntent === 'changes' &&
      !(cfg.responseAxis && pair.includes(cfg.responseAxis))
    ) {
      setStatus('error', 'Open “Configure curve fit” and pick the axis the curves run along.')
      return
    }
    if (cfg.detection === 'spline' || surface)
      cmp = await engine.responseSurface(
        {
          rows: rowsArg(std),
          num: cfg.num,
          den: cfg.den,
          match: cfg.match,
          activeConditions: std.activeConditions,
          numericConditions: std.numericConditions ?? [],
          curveAxis: surface ? 'surface' : curveAxis,
          ...(surface && cfg.surfacePair ? { surfacePair: cfg.surfacePair } : null),
          // under the 4PL model, the 4PL surface detector (adjusted F)
          detector: cfg.detection === 'spline' ? 'spline' : '4pl',
          // what a surface is for: its shape (the joint description) or its changes
          intent: cfg.surfaceIntent ?? 'shape',
          ...(cfg.surfaceIntent === 'changes'
            ? { responseAxis: cfg.responseAxis, changesStat: cfg.changesStat }
            : null),
          axisScale: cfg.axisScale?.[curveAxis],
          axisBaseline: surface ? undefined : cfg.axisBaseline?.[curveAxis],
          // every axis's scale, baseline and models (a surface's two)
          axisScales: cfg.axisScale,
          axisBaselines: cfg.axisBaseline,
          axisFits: cfg.axisFits,
          describeAll: describesAll(cfg, surface),
          threshold: cfg.threshold,
          interpolation: !!cfg.interpolation
        },
        onProgress
      )
    // The CurveCurator method: fitted on ratios to the control of the linear values (its
    // definition), so Clean data's log-transform setting doesn't enter.
    else
      cmp = await engine.curveFit(
        {
          rows: rowsArg(std),
          num: cfg.num,
          den: cfg.den,
          match: cfg.match,
          activeConditions: std.activeConditions,
          numericConditions: std.numericConditions ?? [],
          curveAxis,
          axisScale: cfg.axisScale?.[curveAxis],
          axisBaseline: cfg.axisBaseline?.[curveAxis],
          threshold: cfg.threshold,
          interpolation: !!cfg.interpolation,
          // responders only marks the rest undescribed (their 4PL is still their test)
          describeAll: describesAll(cfg, false)
        },
        onProgress
      )
  } else if (cfg.analysis === 'compare') {
    const numPinned = Object.values(cfg.num).some((v) => v && v.length > 0)
    const denPinned = Object.values(cfg.den).some((v) => v && v.length > 0)
    if (!numPinned || !denPinned) {
      setStatus('error', 'Open “Configure comparison” to define numerator and denominator.')
      return
    }
    setStatus('running')
    // Per batch: the batch a condition matched like-for-like, so each batch is its own
    // comparison (and its own fold change, for a Contrast to pair) — nothing to block on then.
    const split = !!cfg.splitBatch && !!batchesOf(std)
    cmp = await engine.compare({
      // the table as it is; per batch, the worker tags each row with its sample's batch (tagBatch)
      rows: rowsArg(std),
      ...(split ? { batchOf: batchesOf(std) } : null),
      num: cfg.num,
      den: cfg.den,
      match: split ? [...cfg.match, BATCH_COND] : cfg.match,
      // as the dialog states them (absent on configs saved before: inferred, nothing pooled)
      compared: cfg.compared,
      pool: cfg.pool,
      activeConditions: split ? [...std.activeConditions, BATCH_COND] : std.activeConditions,
      numericConditions: std.numericConditions ?? [],
      // each t-test blocks on the batches the data was measured in (Clean data's)
      ...(std.batches && !split ? { batches: std.batches } : null),
      method: cfg.method,
      // Tested on Clean data's scale: in log space when it presents its values logged (a
      // log₂ or log₁₀ choice, or an already-logged input left as it arrived), on the values
      // as they are when not. The first Clean data input decides.
      transform: testsLogged,
      threshold: cfg.threshold
    })
  } else {
    // "Does it matter": the compared conditions as the factors, each at its test levels and
    // its control (so "drugA, drugB vs DMSO" models all three).
    const factors = anovaFactorsOf(cfg, numericConds(std.numericConditions ?? []))
    if (!factors.length) {
      setStatus(
        'error',
        'Open “Configure comparison” to pick test values and a control for each compared condition.'
      )
      return
    }
    setStatus('running')
    cmp = await engine.factorAnova({
      rows: rowsArg(std),
      factors,
      activeConditions: std.activeConditions,
      threshold: cfg.threshold,
      // Context inclusion filters (non-factor conditions narrowed in the dialog).
      num: cfg.num,
      den: cfg.den,
      // On Clean data's scale, as the t-test: log₂ when it presents its values logged.
      transform: testsLogged
    })
  }
  if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
  // Apply the project-wide geneset mask so hidden genes are non-significant from the start — only
  // when there are any: the result's rows stay columnar (unbuilt) otherwise.
  const hidden = hiddenGeneIds(get())
  if (hidden.size) cmp = { ...cmp, rows: maskSignf(cmp.rows, hidden) }
  set((s) => ({
    results: {
      ...s.results,
      [id]: {
        kind: 'compare',
        cmp,
        displayMap: std.displayMap,
        annotationMap: std.annotationMap ?? {},
        keggCategories: std.keggCategories ?? {},
        ...(std.numericConditions?.length ? { numericConditions: std.numericConditions } : null)
      }
    }
  }))
  setStatus('done')
  get().invalidateDownstream(id)
}
