/** Contrast's run: FC1 vs FC2 per feature × context, from one split Compare or two inputs. */
import {
  type ContrastConfig,
  type NodeResult,
  isStep,
  type CompareConfig,
  curveDoseUnit,
  condUnitsFor,
  resolveContrastSource,
  isContrastConfigured,
  numericUnion
} from '../../graph/types'
import { hiddenGeneIds, maskSignf } from '../../graph/geneMask'
import {
  type CompareFeatureCtx,
  type ContrastFeature,
  pairSides,
  isPairable,
  contrastFeatures,
  surfaceSliceCondOf,
  toContrastSide,
  cutoffDefaults,
  selectSource,
  stdGroupsOf,
  surfaceSliceCond,
  isSurfaceRow,
  surfaceSideRows,
  stdFeatureValue,
  compareFeatureValue
} from '../../graph/contrastPair'
import { engine } from '../../engine/client'
import {
  type StandardRow,
  combineStandardize,
  withBatchCond,
  type ConditionKey,
  type ThresholdConfig,
  type ContrastResult,
  CURVE_FC_FEATURE,
  type CompareResultRow,
  termless,
  stdByGene,
  replicateLog2FCs,
  condsIn,
  type CondSelector,
  ctxValue,
  type ContrastSideRow,
  valueUnitOf
} from '../../engine'
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
  const stack = async (
    features: ContrastFeature[],
    run: (f: ContrastFeature) => Promise<ContrastResult>
  ): Promise<ContrastResult> => {
    if (features.length <= 1) {
      const f = features[0] ?? { id: 'value', label: '' }
      const one = await run(f)
      // a curve fit's one feature is still named (its axes read curve log₂FC); no switch
      return f.label === CURVE_FC_FEATURE
        ? { ...one, rows: one.rows.map((r) => ({ ...r, featureId: f.id, feature: f.label })) }
        : one
    }
    const parts: Array<{ f: ContrastFeature; ctr: ContrastResult }> = []
    for (const f of features) parts.push({ f, ctr: await run(f) })
    const classify = parts[0].ctr.classify
    return {
      ...parts[0].ctr,
      // every feature's linear cutoffs from its inputs, for re-calling in place
      ...(classify
        ? {
            classify: {
              ...classify,
              cutoffDefaults: Object.assign({}, ...parts.map((p) => p.ctr.classify?.cutoffDefaults))
            }
          }
        : null),
      rows: parts.flatMap(({ f, ctr: c }) =>
        c.rows.map((r) => ({ ...r, featureId: f.id, feature: f.label }))
      )
    }
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
    ctr = await stack(features, (f) =>
      engine.contrastPair({
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
      })
    )
    displayMap =
      ra.kind === 'compare' ? ra.displayMap : ra.kind === 'standardize' ? ra.std.displayMap : {}
    // Standardize sides carry log10 abundance; Compare sides carry log2 fold-change.
    ctr = {
      ...ctr,
      valueKind: ra.kind === 'standardize' ? 'quantity' : 'fc',
      ...(ra.kind === 'standardize' && valueUnitOf(ra.std) === 'fraction'
        ? { valueUnit: 'fraction' as const }
        : null)
    }
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
    // Each pooled row's replicates (on its value's scale), for the DR's points.
    const repsOf = new WeakMap<CompareResultRow, number[]>()
    // One abundance group as a pseudo primary row: its mean log10 abundance, with the
    // replicate SE carried as fcSE (the DR error band).
    const poolRow = (row: StandardRow, logs: number[]): CompareResultRow => {
      const mean = logs.reduce((s, v) => s + v, 0) / logs.length
      // SE of the mean abundance = SD / √n (matches the fold-change SE convention).
      const sd =
        logs.length >= 2
          ? Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / (logs.length - 1)) /
            Math.sqrt(logs.length)
          : null
      return {
        uniqID: row.uniqID,
        cmpd: row.cmpd,
        dose: row.dose,
        time: row.time,
        cell: row.cell,
        ...(row.extra ? { extra: row.extra } : null),
        cmp_cond: '',
        comparison: '',
        mean1: null,
        mean2: null,
        sd1: null,
        sd2: null,
        log2FC: mean,
        fcSE: sd,
        pP: null,
        pQ: null,
        thrsh: '',
        signf: false,
        effect: 'none'
      }
    }
    // Standardize → pseudo primary rows. Replicates are aggregated per (gene × conditions) to
    // mean log10 abundance, with the replicate SD carried as fcSE (the DR error band). This
    // both collapses replicates cleanly and gives an honest per-condition abundance spread.
    const pooled: CompareResultRow[] = isQuantity
      ? (() => {
          // One per gene × condition context (custom conditions included in the key) — read
          // off the tables' columns (no row built).
          // (each batch its own group: withBatchCond — a side may pin one)
          return stdGroupsOf(stds.map((r) => withBatchCond(r.std))).map(
            ({ row, logs }): CompareResultRow => {
              const out = poolRow(row, logs)
              repsOf.set(out, logs)
              return out
            }
          )
        })()
      : compares.flatMap((r) => termless(r.cmp.rows))
    // A Compare's rows: each replicate's log2 ratio to the control mean.
    if (!isQuantity)
      for (const cid of fromIds) {
        const r = state.results[cid]
        const cstd = compareStd(cid)
        if (r?.kind !== 'compare' || !cstd) continue
        const byGene = stdByGene(cstd)
        for (const row of termless(r.cmp.rows)) {
          const reps = replicateLog2FCs(row, byGene.get(row.uniqID) ?? [])
          if (reps.length) repsOf.set(row, reps)
        }
      }
    if (!pooled.length) {
      setStatus('error', 'The upstream tile has no results.')
      return
    }
    if (!isContrastConfigured(cfg)) {
      setStatus('error', 'Configure the two contrast sides (FC1/FC2) in the selector.')
      return
    }
    // Each side is an EXPLICIT cond-value selection. A pooled row belongs to a side when it
    // matches every pinned condition of that side's selector (others are free). FC1 = num side,
    // FC2 = den side; the two are then joined on the chosen match context (runContrastPair
    // aggregates replicates + unmatched dims), so nothing about the context is inferred.
    // Every condition a selector could pin, including the custom ones the rows carry.
    const selConds = condsIn(pooled)
    const matchesSel = (row: CompareResultRow, sel: CondSelector): boolean =>
      selConds.every((c) => {
        const want = sel[c]
        if (!want || want.length === 0) return true
        const v = ctxValue(row, c)
        return v != null && v !== '' && want.map(String).includes(String(v))
      })
    // A pooled row as a side, for one feature: its own value with its SE and replicates, or
    // another feature's value alone (an abundance group's spread from its replicates).
    const selCtx = from ? featureCtx(from) : { statType: 'pQ' as const, doseScale: 1 }
    // A surface is contrasted slice by slice (surfaceSideRows), matched on the slices'
    // condition.
    const surf = isQuantity ? undefined : surfaceSliceCond(pooled)
    const toSideRows = (row: CompareResultRow, f: ContrastFeature): ContrastSideRow[] =>
      isSurfaceRow(row) ? surfaceSideRows(row, f.id, selCtx) : [toSideRow(row, f)]
    const toSideRow = (row: CompareResultRow, f: ContrastFeature): ContrastSideRow => ({
      uniqID: row.uniqID,
      cell: row.cell ?? null,
      cmpd: row.cmpd,
      dose: row.dose,
      time: row.time,
      ...(row.extra ? { extra: row.extra } : null),
      value:
        f.id === 'value'
          ? row.log2FC
          : isQuantity
            ? stdFeatureValue(repsOf.get(row) ?? [], f.id)
            : compareFeatureValue(row, f.id, selCtx),
      signf: row.signf,
      effect: row.effect,
      pP: row.pP,
      pQ: row.pQ,
      ...(f.id === 'value'
        ? { se: row.fcSE ?? null, ...(repsOf.has(row) ? { reps: repsOf.get(row) } : null) }
        : null)
    })
    const selLabel = (sel: CondSelector): string => {
      const parts = selConds
        .filter((c) => (sel[c]?.length ?? 0) > 0)
        .map((c) => (sel[c] as string[]).join('/'))
      return parts.length ? parts.join(' · ') : 'all'
    }
    const num = cfg.num ?? {}
    const den = cfg.den ?? {}
    const rowsA = pooled.filter((r) => matchesSel(r, num))
    const rowsB = pooled.filter((r) => matchesSel(r, den))
    if (!rowsA.length || !rowsB.length) {
      setStatus('error', 'One contrast side matched no rows — adjust the FC1/FC2 selections.')
      return
    }
    setStatus('running')
    const features = contrastFeatures(
      isQuantity ? stds[0] : compares[0],
      from ? condUnitsFor(state, from) : undefined
    )
    ctr = await stack(features, (f) =>
      engine.contrastPair({
        sideA: rowsA.flatMap((r) => toSideRows(r, f)),
        sideB: rowsB.flatMap((r) => toSideRows(r, f)),
        match: withSlice(cfg.match ?? [], surf),
        relationship: cfg.relationship,
        stat: cfg.stat,
        // both axes' linear cutoffs start at the Compare's
        feature: f.id,
        cutoffDefaults: cutoffDefaults(thresholdOf(compares[0]), thresholdOf(compares[0]), f.id),
        labelA: selLabel(num),
        labelB: selLabel(den),
        nameConds: [...new Set(fromIds.flatMap(activeOf))],
        // Abundance slices carry no per-side significance, so the band is the only
        // divergence call.
        driverMask: !isQuantity
      })
    )
    displayMap = isQuantity ? stds[0].std.displayMap : compares[0].displayMap
    ctr = {
      ...ctr,
      valueKind: isQuantity ? 'quantity' : 'fc',
      ...(isQuantity && valueUnitOf(stds[0].std) === 'fraction'
        ? { valueUnit: 'fraction' as const }
        : null)
    }
  }
  if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
  // Mask hidden-geneset genes non-significant (covers pair mode with no per-side driver signf).
  ctr = { ...ctr, rows: maskSignf(ctr.rows, hiddenGeneIds(get())) }
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
