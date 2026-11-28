/** Contrast's run: FC1 vs FC2 per feature × context, from one split Compare or two inputs. */
import {
  type ContrastConfig,
  isContrastConfigured,
  resolveContrastSource
} from '../../graph/config/contrast'
import { isStep, type NodeResult, numericUnion } from '../../graph/types'
import type { CompareConfig } from '../../graph/config/compare'
import { condUnitsFor, curveDoseUnit } from '../../graph/config/units'
import { hiddenGeneIds, maskSignf } from '../../graph/project/geneMask'
import {
  type CompareFeatureCtx,
  type ContrastFeature,
  pairSides,
  isPairable,
  contrastFeatures,
  surfaceSliceCondOf,
  toContrastSide,
  cutoffDefaults,
  selectSource
} from '../../graph/models/contrastPair'
import { engine } from '../../engine/client'
import {
  type StandardRow,
  combineStandardize,
  withBatchCond,
  type ConditionKey,
  type ThresholdConfig,
  type ContrastResult,
  CURVE_FC_FEATURE,
  type ContrastPairInput,
  valueUnitOf
} from '../../engine'
import { holderTable, lazyCopy, rowsArg } from '../../engine/columns/lazyRows'
import type { StepRunContext } from '../runContext'

export async function run(ctx: StepRunContext): Promise<void> {
  const { id, node, state, get, set, setStatus } = ctx
  const cfg = node.data.config as ContrastConfig
  const ups = state.upstreamIds(id)
  // The Clean data a Compare input ran on (its Standardize inputs pooled, as its run does) —
  // the source of each side's replicates. Undefined for anything but a Compare.
  const compareStd = (cid: string): StandardRow[] | undefined => {
    if (state.results[cid]?.kind !== 'compare') return undefined
    const stds = state
      .upstreamIds(cid)
      .map((u) => state.results[u])
      .filter((r): r is Extract<NodeResult, { kind: 'standardize' }> => r?.kind === 'standardize')
      .map((r) => r.std)
    if (!stds.length) return undefined
    // a per-batch Compare's rows carry the batch: its replicates are matched on rows that do
    const n = state.nodes.find((x) => x.id === cid)
    const split = !!n && isStep(n) && !!(n.data.config as CompareConfig).splitBatch
    const pooled = combineStandardize(stds)
    return (split ? withBatchCond(pooled) : pooled).rows
  }
  // …the same, as the engine pools it (contrastSelect.ts): the Clean data results themselves and
  // whether the Compare ran per batch — sent as their tables, pooled there.
  const compareStdSources = (
    cid: string
  ): { std?: Extract<NodeResult, { kind: 'standardize' }>['std'][]; splitBatch?: boolean } => {
    const stds = state
      .upstreamIds(cid)
      .map((u) => state.results[u])
      .filter((r): r is Extract<NodeResult, { kind: 'standardize' }> => r?.kind === 'standardize')
      .map((r) => r.std)
    if (!stds.length) return {}
    const n = state.nodes.find((x) => x.id === cid)
    return {
      std: stds,
      splitBatch: !!n && isStep(n) && !!(n.data.config as CompareConfig).splitBatch
    }
  }
  // The active conditions of the Clean data a contrast input reads (itself, or above a
  // Compare): what the sides' names may state a slice of (ContrastPairInput.nameConds).
  const activeOf = (nid: string): ConditionKey[] => {
    const r = state.results[nid]
    if (r?.kind === 'standardize') return r.std.activeConditions
    return state.upstreamIds(nid).flatMap((u) => {
      const ru = state.results[u]
      return ru?.kind === 'standardize' ? ru.std.activeConditions : []
    })
  }
  // How a Compare input reads its features: by p or q, as it calls; pEC50 in molar where its
  // dose unit says how (as the potency plot reads it).
  const featureCtx = (cid: string): CompareFeatureCtx => {
    const r = state.results[cid]
    const n = state.nodes.find((x) => x.id === cid)
    const cmpCfg = n && isStep(n) ? (n.data.config as CompareConfig) : undefined
    return {
      statType: r?.kind === 'compare' ? (r.cmp.threshold?.statType ?? 'pQ') : 'pQ',
      doseScale: curveDoseUnit(cmpCfg, condUnitsFor(state, cid)).scale
    }
  }
  // The threshold a Compare input called by — what a linear cutoff starts from.
  const thresholdOf = (r: NodeResult | undefined): ThresholdConfig | undefined =>
    r?.kind === 'compare' ? r.cmp.threshold : undefined
  // A surface's sides carry the level of the axis it's sliced along (one row per slice — see
  // surfaceSideRows): matched on it, never pinned.
  const withSlice = (match: ConditionKey[], c: ConditionKey | undefined): ConditionKey[] =>
    c && !match.includes(c) ? [...match, c] : match
  // Every feature the inputs offer, contrasted alike and stacked — each row tagged with its
  // feature, which the results page's switcher picks (one feature: untagged, nothing to
  // switch).
  // (in the engine — contrastStack.ts — so the tagged rows come back as a table, none of them
  // built here)
  const stack = (
    features: ContrastFeature[],
    input: (f: ContrastFeature) => ContrastPairInput
  ): Promise<ContrastResult> => {
    const one = features.length <= 1
    const list = one ? [features[0] ?? { id: 'value' as const, label: '' }] : features
    return engine.contrastStack(
      list.map((f) => ({
        input: input(f),
        // a curve fit's one feature is still named (its axes read curve log₂FC); no switch
        ...(!one || f.label === CURVE_FC_FEATURE
          ? { tag: { featureId: f.id, feature: f.label } }
          : null)
      }))
    )
  }
  /** The result with `fields` set, its rows left columnar (lazyCopy) — a spread would build them. */
  const withFields = (c: ContrastResult, fields: Partial<ContrastResult>): ContrastResult => {
    const t = holderTable(c)
    return (t && lazyCopy(c, fields, t)) || { ...c, ...fields }
  }
  let ctr: ContrastResult
  let displayMap: Record<string, string>
  if (resolveContrastSource(cfg, ups.length) === 'pair') {
    // Pair mode: two same-kind inputs joined side-by-side by uniqID + matched context —
    // two Compares → FC-vs-FC, two Standardizes → mean-log10-abundance-vs-abundance.
    const sides = pairSides(cfg, ups)
    if (!sides) {
      setStatus(
        'error',
        'Pair mode needs two inputs — connect two Compare or two Clean data tiles.'
      )
      return
    }
    const [idA, idB] = sides
    const ra = state.results[idA]
    const rb = state.results[idB]
    if (!isPairable(ra) || !isPairable(rb) || rb!.kind !== ra!.kind) {
      setStatus(
        'error',
        'Pair mode needs two run inputs of the SAME kind (two Compares, or two Standardizes).'
      )
      return
    }
    const label = (nid: string, fb: string): string => {
      const n = state.nodes.find((x) => x.id === nid)
      return (n && isStep(n) && n.data.name?.trim()) || fb
    }
    setStatus('running')
    // The features both inputs offer (A's names: its significance says p or q).
    const offerB = new Set(contrastFeatures(rb).map((f) => f.id))
    const features = contrastFeatures(ra, condUnitsFor(state, idA)).filter((f) => offerB.has(f.id))
    const ctxA = featureCtx(idA)
    const ctxB = featureCtx(idB)
    // Surfaces are contrasted slice by slice: matched on the slices' condition.
    const surf = [ra, rb]
      .map((r) => (r.kind === 'compare' ? surfaceSliceCondOf(r.cmp) : undefined))
      .find((c) => c != null)
    ctr = await stack(features, (f) => ({
      sideA: toContrastSide(ra, compareStd(idA), f.id, ctxA, true),
      sideB: toContrastSide(rb, compareStd(idB), f.id, ctxB, true),
      match: withSlice(cfg.match ?? [], surf),
      fix: cfg.pairFix,
      relationship: cfg.relationship,
      stat: cfg.stat,
      // each axis's linear cutoffs start at its own Compare's
      feature: f.id,
      cutoffDefaults: cutoffDefaults(thresholdOf(ra), thresholdOf(rb), f.id),
      labelA: label(idA, 'A'),
      labelB: label(idB, 'B'),
      nameConds: [...new Set([...activeOf(idA), ...activeOf(idB)])],
      // No per-side significance for abundance pairs → the band is the only divergence
      // call.
      driverMask: ra.kind === 'compare'
    }))
    displayMap =
      ra.kind === 'compare' ? ra.displayMap : ra.kind === 'standardize' ? ra.std.displayMap : {}
    // Standardize sides carry log10 abundance; Compare sides carry log2 fold-change.
    ctr = withFields(ctr, {
      valueKind: ra.kind === 'standardize' ? 'quantity' : 'fc',
      ...(ra.kind === 'standardize' && valueUnitOf(ra.std) === 'fraction'
        ? { valueUnit: 'fraction' as const }
        : null)
    })
  } else {
    // Select mode: pool the single upstream's rows, then split them into the two EXPLICIT
    // selections (num → FC1, den → FC2). Works on a Compare (each row's value is its log2FC)
    // OR a Standardize (value is log10 abundance) — both become a per-row `log2FC`, so a
    // Standardize contrast compares two abundance selections.
    // Several inputs wired: the groups come from the ONE the config picks (the others are
    // idle for this tile). A single input needs no pick.
    const from = selectSource(cfg, ups)
    const fromIds = from ? [from] : ups
    const upResults = fromIds.map((u) => state.results[u]).filter((r): r is NodeResult => !!r)
    const compares = upResults.filter(
      (r): r is Extract<NodeResult, { kind: 'compare' }> => r.kind === 'compare'
    )
    const stds = upResults.filter(
      (r): r is Extract<NodeResult, { kind: 'standardize' }> => r.kind === 'standardize'
    )
    if (!compares.length && !stds.length) {
      setStatus('error', 'Connect a Compare or Clean data tile and run it first.')
      return
    }
    const isQuantity = !compares.length // all-Standardize input → abundance split
    if (!isContrastConfigured(cfg)) {
      setStatus('error', 'Configure the two contrast sides (FC1/FC2) in the selector.')
      return
    }
    setStatus('running')
    const features = contrastFeatures(
      isQuantity ? stds[0] : compares[0],
      from ? condUnitsFor(state, from) : undefined
    )
    // The pooling, the two selections and every side row are made in the engine
    // (contrastSelect.ts): the inputs go as their tables, none of their rows built here.
    const got = await engine.contrastSelect({
      stds: stds.map((r) => r.std),
      compares: isQuantity
        ? []
        : fromIds.flatMap((cid) => {
            const r = state.results[cid]
            if (r?.kind !== 'compare') return []
            const src = compareStdSources(cid)
            return [{ rows: rowsArg(r.cmp), ...src }]
          }),
      num: cfg.num ?? {},
      den: cfg.den ?? {},
      features,
      tagOne: features.length === 1 && features[0].label === CURVE_FC_FEATURE,
      selCtx: from ? featureCtx(from) : { statType: 'pQ', doseScale: 1 },
      // both axes' linear cutoffs start at the Compare's
      cutoffs: Object.fromEntries(
        features.map((f) => [
          f.id,
          cutoffDefaults(thresholdOf(compares[0]), thresholdOf(compares[0]), f.id)
        ])
      ),
      match: cfg.match ?? [],
      pair: {
        relationship: cfg.relationship,
        stat: cfg.stat,
        nameConds: [...new Set(fromIds.flatMap(activeOf))]
      }
    })
    if ('error' in got) {
      setStatus('error', got.error)
      return
    }
    ctr = got
    displayMap = isQuantity ? stds[0].std.displayMap : compares[0].displayMap
    ctr = withFields(ctr, {
      valueKind: isQuantity ? 'quantity' : 'fc',
      ...(isQuantity && valueUnitOf(stds[0].std) === 'fraction'
        ? { valueUnit: 'fraction' as const }
        : null)
    })
  }
  if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
  // Mask hidden-geneset genes non-significant (covers pair mode with no per-side driver signf).
  // Only when there are any: the result's rows stay columnar (unbuilt) otherwise.
  const hidden = hiddenGeneIds(get())
  if (hidden.size) ctr = { ...ctr, rows: maskSignf(ctr.rows, hidden) }
  // the inputs' declared numeric conditions, carried on as Compare carries Clean data's
  const numericConditions = numericUnion(ups.map((u) => get().results[u]))
  set((s) => ({
    results: {
      ...s.results,
      [id]: {
        kind: 'contrast',
        ctr,
        displayMap,
        ...(numericConditions.length ? { numericConditions } : null)
      }
    }
  }))
  setStatus('done')
  get().invalidateDownstream(id)
}
