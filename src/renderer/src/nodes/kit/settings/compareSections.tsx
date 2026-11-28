import { type ReactNode, useContext, useState } from 'react'
import { CC_Q_MIN, type FdrMethod, SAM_PERMUTATIONS, SAM_S0, someNested } from '../../../engine'
import { ApplyStageContext } from '../../../graph/dialogs/applyStage'
import { fitOf } from '../../../graph/models/axisFits'
import { useGraph } from '../../../graph/store'
import { type CompareConfig, curveMethodOf, effectLabelsOf } from '../../../graph/config/compare'
import { isStep } from '../../../graph/types'
import { StatusNote } from '../../../ui/controls/StatusNote'
import { OnOffSwitch, ToggleSwitch } from '../../../ui/controls/ToggleSwitch'
import { EffectLabelInput, Field, NumberInput, PValueInput, Section, Select } from './controls'
import { styles } from './styles'

/** A Compare's significance calls: the method (the p-value route — FDR control, correction,
 *  linear or hyperbolic boundary — or SAM / CurveCurator), its cutoffs, and the effect class
 *  names. Shown on the Compare step, and again on a volcano fed by it — the same settings,
 *  written to the Compare, so tuning the calls is possible from the plot that shows them. */
export function CompareStatisticSection({
  id,
  config,
  subtitle
}: {
  /** the Compare step the settings belong to */
  id: string
  config: CompareConfig
  subtitle?: ReactNode
}) {
  const update = useGraph((s) => s.updateConfig)
  // In a plot's settings window, edits that need a re-run are held (with any made after them)
  // until its Apply, which then re-runs the Compare — rather than discarding its result under the
  // open window. Shown here merged over the stored threshold.
  const staging = useContext(ApplyStageContext)
  const [staged, setStaged] = useState<Partial<CompareConfig['threshold']> | null>(null)
  const t = staged ? { ...config.threshold, ...staged } : config.threshold
  // Whether what's held needs a re-run (the statistics change) or just a re-call of the genes.
  const stagedRerun =
    !!staged &&
    ('fdrMethod' in staged ||
      'samS0' in staged ||
      'permutations' in staged ||
      ('type' in staged && (staged.type === 'sam_fdr') !== (config.threshold.type === 'sam_fdr')))
  // The significance statistic the FDR switch selects — names both the switch and the cutoff row.
  // Shown as the plain P/Q value; the stored threshold (and every plot) stays −log10.
  const statLabel = t.statType === 'pQ' ? 'Q-value' : 'P-value'
  // Cutoff edits re-classify the stored result live (like dragging a volcano guide) — only the
  // correction method changes the q-values themselves, which needs a re-run.
  const setThreshold = useGraph((s) => s.setCompareThreshold)
  // SAM's settings (and switching to or from it) change the statistics themselves — a re-run.
  const changesStats = (partial: Partial<CompareConfig['threshold']>): boolean =>
    'fdrMethod' in partial ||
    'samS0' in partial ||
    'permutations' in partial ||
    ('type' in partial && (partial.type === 'sam_fdr') !== (t.type === 'sam_fdr'))
  const setT = (partial: Partial<CompareConfig['threshold']>): void => {
    // In a plot's settings window every statistic edit waits for Apply — re-calling the genes
    // (and redrawing every plot) on each keystroke is what made the window stutter. Apply then
    // re-calls them in place, or saves and re-runs the Compare when the statistics themselves
    // changed (SAM's settings, the FDR method).
    if (staging) {
      const next = { ...staged, ...partial }
      setStaged(next)
      staging.stage(`compare-threshold:${id}`, () => {
        const g = useGraph.getState()
        const node = g.nodes.find((n) => n.id === id)
        if (!node || !isStep(node)) return
        const cur = (node.data.config as CompareConfig).threshold
        const rerun =
          'fdrMethod' in next ||
          'samS0' in next ||
          'permutations' in next ||
          ('type' in next && (next.type === 'sam_fdr') !== (cur.type === 'sam_fdr'))
        if (rerun) {
          g.updateConfig(id, { threshold: { ...cur, ...next } })
          void g.rerunFrom(id)
        } else g.setCompareThreshold(id, next)
      })
      return
    }
    if (changesStats(partial)) update(id, { threshold: { ...t, ...partial } })
    else setThreshold(id, partial)
  }
  const r2 = (v: number): number => Math.round(v * 100) / 100
  const asym = t.asymmetric ?? false
  const mirrorTitle = asym ? undefined : 'Mirrors the up cutoff — switch on asymmetric to edit'
  // First line of the effect-size block (same level as the cutoff rows): the asymmetric switch.
  const asymRow = (
    // As tall as a cutoff line (a number box), so it lines up with the field's top-aligned label.
    <div style={{ ...styles.cutoffRow, minHeight: 25 }}>
      <span style={styles.inlineTag}>asymmetric</span>
      <OnOffSwitch
        on={asym}
        label="asymmetric effect size"
        onChange={(on) => setT({ asymmetric: on })}
      />
    </div>
  )
  // Effect class names are display-only (legends/tables), so they bypass updateConfig and never
  // stale the result.
  const labels = effectLabelsOf(config)
  const setLabels = useGraph((s) => s.setCompareEffectLabels)
  const curveCurator = t.type === 'curvecurator'
  const ccByFdr = curveCurator && t.ccCallBy === 'fdr'
  // Testing response changes with a 4PL along the picked axis: its F's null is a choice.
  const changesNull = (() => {
    if (config.analysis !== 'curve_fit' || !config.surface || config.surfaceIntent !== 'changes')
      return false
    const pair = config.surfacePair ?? ['dose', 'time']
    const resp = config.responseAxis
    if (!resp || !pair.includes(resp)) return false
    const own = curveMethodOf(config) === 'custom' ? config.axisFits : undefined
    const det = config.detection === 'spline' ? 'spline' : '4pl'
    return fitOf(own, pair, pair.indexOf(resp), det).detect === '4pl'
  })()
  const sam = t.type === 'sam_fdr'
  // The run's target–decoy FDR for CurveCurator's calls (follows its cutoffs live).
  const curveFdr = useGraph((s) => {
    const r = s.results[id]
    return r?.kind === 'compare' ? r.cmp.curveFdr : undefined
  })
  // A curve fit run before the decoy FDR existed has no decoys (so no q-values) until re-run.
  const noDecoys = useGraph((s) => {
    const r = s.results[id]
    // (read off the nested columns — this runs on every store change)
    return (
      r?.kind === 'compare' &&
      !r.cmp.decoys &&
      (someNested(r.cmp, 'curve', 'axis', (on) => on) ||
        someNested(r.cmp, 'rs', 'cc', (_, cc) => !!cc))
    )
  })
  const method = sam ? 'sam' : curveCurator ? 'curvecurator' : 'pvalue'
  // The methods this analysis offers: SAM needs the t-test's per-sample values, CurveCurator a
  // curve fit's per-curve F; a two-way ANOVA has the p-value route only.
  const methods: Array<{ value: typeof method; label: string; title: string }> = [
    {
      value: 'pvalue',
      label: 'P-value',
      title:
        'The per-gene test’s p-value, optionally FDR-corrected, under a linear or hyperbolic boundary'
    },
    ...(config.analysis === 'compare'
      ? [
          {
            value: 'sam' as const,
            label: 'SAM',
            title: 'SAM: moderated t with a permutation-estimated FDR (as in Perseus)'
          }
        ]
      : []),
    // The relevance score needs a 4PL F-test — a 4PL curve's or a 4PL surface's (its decoys are
    // surfaces) — not the response surface method's (model Spline), which calls by its own q.
    ...(config.analysis === 'curve_fit' && config.detection !== 'spline'
      ? [
          {
            value: 'curvecurator' as const,
            label: 'Relevance score',
            title:
              'CurveCurator’s relevance score — the curve’s F-test shrunk by its fold change; called by its α cutoff or by a target FDR from decoy curves'
          }
        ]
      : [])
  ]
  return (
    <Section title="Statistic" subtitle={subtitle}>
      {staged && (
        <StatusNote kind="info">
          {stagedRerun
            ? 'Changes the statistic — re-runs the Compare on Apply.'
            : 'Applies on Apply.'}
        </StatusNote>
      )}
      {/* The significance method first: the per-gene test's p (with or without an FDR correction,
                under a linear or hyperbolic boundary), or a method with its own statistic, FDR and
                boundary — SAM for a t-test, CurveCurator for a curve fit. */}
      {methods.length > 1 && (
        <Field
          label="method"
          info={
            <>
              <b>P-value</b> — each gene’s own test (
              {config.analysis === 'curve_fit'
                ? 'the curve’s F-test against a flat line'
                : 'the t-test or ANOVA'}
              ), optionally FDR-corrected (q), with a fold-change cutoff: a linear cutoff, or a
              hyperbolic boundary that asks smaller effects for stronger significance.
              {methods.some((m) => m.value === 'sam') && (
                <>
                  <br />
                  <b>SAM</b> — a moderated t (a fudge factor s0 added to every gene’s error, so tiny
                  variances can’t make tiny effects significant), with the FDR estimated by
                  shuffling the sample labels (as in Perseus).
                </>
              )}
              {methods.some((m) => m.value === 'curvecurator') && (
                <>
                  <br />
                  <b>Relevance score</b> — CurveCurator’s (Bayer et al., 2023): the curve’s F-test
                  and its fold change (lowest → highest dose) combined into one score, SAM style — a
                  fudge factor s0, set from the fold-change limit and α, so the smaller a curve’s
                  fold change the stronger its F-test must be (a hyperbolic boundary on the
                  volcano). Called by its α cutoff, with the FDR then estimated from decoys —
                  simulated flat curves (or surfaces) plus noise, fitted and scored the same way —
                  or by a target FDR, the cutoff set where the decoys say that FDR is reached.
                </>
              )}
            </>
          }
        >
          <ToggleSwitch
            label="Significance method"
            value={method}
            options={methods}
            onChange={(m) =>
              setT(
                m === 'sam'
                  ? { type: 'sam_fdr', statType: 'pP' }
                  : m === 'curvecurator'
                    ? // CurveCurator works on raw p (its FDR is estimated separately, not by BH).
                      { type: 'curvecurator', statType: 'pP' }
                    : { type: 'non-linear', statType: 'pQ' }
              )
            }
          />
        </Field>
      )}
      {changesNull && (
        // Testing response changes with 4PL curves: the F's null (a non-linear fit has no exact one).
        <Field
          label="null"
          info={
            <>
              Testing response changes with a 4PL along the axis: one 4PL shared by every level of
              the other against a 4PL at each, by F = (ΔRSS / d1) / (RSS / d2). A non-linear fit has
              no exact null for it, so the F is read against one of:
              <br />
              <b>NPARC df</b> — NPARC’s (Childs et al., 2019): the RSS reduction and the residual
              RSS taken as scaled χ², their scale and degrees of freedom estimated across the genes
              of the run; then the F distribution with those df. Fast.
              <br />
              <b>adjusted F</b> — the null simulated: each design’s genes refitted on their shared
              4PL plus noise at their own residual level, many times, scored the same way; the p
              from the simulated F’s tail (as the 4PL surface’s adjusted F). Slower.
            </>
          }
        >
          <ToggleSwitch
            label="Null"
            value={config.changesStat ?? 'adjusted'}
            options={[
              {
                value: 'adjusted' as const,
                label: 'adjusted F',
                title: 'the null simulated on each design (slower)'
              },
              {
                value: 'nparc' as const,
                label: 'NPARC df',
                title:
                  'df estimated across the genes from the RSS distributions (Childs et al. 2019)'
              }
            ]}
            onChange={(v) =>
              v !== (config.changesStat ?? 'adjusted') && update(id, { changesStat: v })
            }
          />
        </Field>
      )}
      {method === 'curvecurator' && (
        // Call by its α cutoff (the FDR is then measured), or by a target FDR (the cutoff follows).
        <Field label="call by">
          <ToggleSwitch
            label="Call by"
            value={ccByFdr ? 'fdr' : 'alpha'}
            options={[
              {
                value: 'alpha' as const,
                label: 'α',
                title: 'CurveCurator’s cutoff on the relevance score; the FDR is then estimated'
              },
              {
                value: 'fdr' as const,
                label: 'target FDR',
                title: 'Call the curves whose target–decoy q is within a target FDR'
              }
            ]}
            onChange={(v) => setT({ ccCallBy: v })}
          />
        </Field>
      )}
      {method === 'curvecurator' && noDecoys && (
        <StatusNote kind="warn">
          This result has no FDR estimate (it was run before one existed) — re-run the Compare
          {ccByFdr ? ' to call by target FDR' : ''}.
        </StatusNote>
      )}
      {method === 'curvecurator' && curveFdr != null && Number.isFinite(curveFdr) && (
        // CurveCurator's FDR: how many simulated null (decoy) curves these cutoffs would also call.
        <StatusNote kind="info">
          Estimated FDR of these calls: {(curveFdr * 100).toPrecision(2)}% (target–decoy)
        </StatusNote>
      )}
      {ccByFdr && !noDecoys && curveFdr != null && !Number.isFinite(curveFdr) && (
        <StatusNote kind="info">No curve reaches the target FDR.</StatusNote>
      )}
      {method === 'pvalue' && (
        <>
          {/* Which statistic drives the calls: raw p (off), or the adjusted q (on). Where the q is
                        fixed by the method — the response surface method's BH × Storey's π₀ over every
                        curve, a 4PL surface's BH over every surface — the info says which. */}
          <Field
            label="FDR control"
            info={
              <>
                Off: calls by each gene’s raw p. On: by its q, the p corrected for testing many
                genes.
                {(config.detection === 'spline' || config.surface) && (
                  <>
                    <br />
                    {config.detection === 'spline'
                      ? 'q: Benjamini–Hochberg × π₀ over every curve (Hybrid model).'
                      : 'q: Benjamini–Hochberg over every surface (4PL surface, adjusted F).'}
                  </>
                )}
              </>
            }
          >
            <OnOffSwitch
              on={t.statType === 'pQ'}
              label="FDR control"
              onChange={(on) => setT({ statType: on ? 'pQ' : 'pP' })}
            />
          </Field>
          {t.statType === 'pQ' && config.detection !== 'spline' && !config.surface && (
            <Field label="correction">
              <Select
                value={t.fdrMethod ?? 'bh'}
                onChange={(v) => setT({ fdrMethod: v as Exclude<FdrMethod, 'none'> })}
                options={[
                  { value: 'bh', label: 'Benjamini–Hochberg (FDR)' },
                  { value: 'bonferroni', label: 'Bonferroni (FWER)' }
                ]}
              />
            </Field>
          )}
          <Field label="boundary">
            <Select
              value={t.type}
              onChange={(v) => setT({ type: v as 'linear' | 'non-linear' })}
              options={[
                { value: 'linear', label: 'linear cutoff' },
                { value: 'non-linear', label: 'hyperbolic boundary' }
              ]}
            />
          </Field>
        </>
      )}
      {/* Effect size: asymmetric switch, then one line per class (up first) — the cutoff and
                the name the class shows under. Symmetric (default): the down cutoff mirrors the up one
                (store keeps them in lock-step), so its box is read-only. */}
      {sam ? (
        <>
          <Field label="FDR">
            <div style={styles.cutoffRow}>
              <span style={styles.inlineTag}>q ≤</span>
              <div style={styles.cutoffBox}>
                <PValueInput statMin={t.statMin} onChange={(v) => setT({ statMin: v })} />
              </div>
            </div>
          </Field>
          {/* s0 sets the boundary's fold-change wall: larger keeps small-variance, small-change
                        genes out. */}
          <Field label="s0">
            <div style={styles.cutoffBox}>
              <NumberInput
                value={t.samS0 ?? SAM_S0}
                step={0.05}
                onChange={(v) => setT({ samS0: Math.max(0, r2(v)) })}
              />
            </div>
          </Field>
          <Field label="permutations">
            <div style={styles.cutoffBox}>
              <NumberInput
                value={t.permutations ?? SAM_PERMUTATIONS}
                step={50}
                onChange={(v) => setT({ permutations: Math.max(10, Math.round(v)) })}
              />
            </div>
          </Field>
          <Field label="labels" top>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>up</span>
                <EffectLabelInput value={labels.up} onCommit={(v) => setLabels(id, { up: v })} />
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>down</span>
                <EffectLabelInput
                  value={labels.down}
                  onCommit={(v) => setLabels(id, { down: v })}
                />
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>none</span>
                <EffectLabelInput
                  value={labels.none}
                  onCommit={(v) => setLabels(id, { none: v })}
                  title="Name shown for the genes called neither up nor down"
                />
              </div>
            </div>
          </Field>
        </>
      ) : t.type !== 'non-linear' ? (
        <>
          <Field label="effect size" top>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {asymRow}
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>log₂FC ≥</span>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={t.fcHigh}
                    step={0.1}
                    onChange={(v) => setT({ fcHigh: r2(v) })}
                  />
                </div>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput value={labels.up} onCommit={(v) => setLabels(id, { up: v })} />
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>log₂FC ≤</span>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={t.fcLow}
                    step={0.1}
                    disabled={!asym}
                    title={mirrorTitle}
                    onChange={(v) => setT({ fcLow: r2(v) })}
                  />
                </div>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput
                  value={labels.down}
                  onCommit={(v) => setLabels(id, { down: v })}
                />
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>otherwise</span>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput
                  value={labels.none}
                  onCommit={(v) => setLabels(id, { none: v })}
                  title="Name shown for the genes called neither up nor down"
                />
              </div>
            </div>
          </Field>
          {/* Named after the statistic the FDR switch selects, so the cutoff reads as one unit. */}
          <Field label="significance">
            <div style={styles.cutoffRow}>
              <span style={styles.inlineTag}>
                {ccByFdr ? 'FDR q ≤' : curveCurator ? 'α =' : `${statLabel} ≤`}
              </span>
              <div style={styles.cutoffBox}>
                {ccByFdr ? (
                  <PValueInput
                    statMin={t.ccQMin ?? CC_Q_MIN}
                    onChange={(v) => setT({ ccQMin: v })}
                  />
                ) : (
                  <PValueInput statMin={t.statMin} onChange={(v) => setT({ statMin: v })} />
                )}
              </div>
            </div>
          </Field>
        </>
      ) : (
        <>
          {/* SAM hyperbola stat = P_lim + b/(|FC| − FC_lim); stored as s0 = −FC_lim, with an
                        optional down-side asymptote s0Down (asymmetric mode; otherwise mirrors s0). */}
          <Field label="effect size" top>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {asymRow}
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>log₂FC ≥</span>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={-t.s0}
                    step={0.1}
                    onChange={(v) => setT({ s0: -Math.max(0, r2(v)) })}
                  />
                </div>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput value={labels.up} onCommit={(v) => setLabels(id, { up: v })} />
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>log₂FC ≤</span>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={t.s0Down ?? t.s0}
                    step={0.1}
                    disabled={!asym}
                    title={mirrorTitle}
                    onChange={(v) => setT({ s0Down: -Math.max(0, r2(Math.abs(v))) })}
                  />
                </div>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput
                  value={labels.down}
                  onCommit={(v) => setLabels(id, { down: v })}
                />
              </div>
              <div style={styles.cutoffRow}>
                <span style={styles.inlineTag}>otherwise</span>
                <span style={{ ...styles.inlineTag, marginLeft: 6 }}>label</span>
                <EffectLabelInput
                  value={labels.none}
                  onCommit={(v) => setLabels(id, { none: v })}
                  title="Name shown for the genes called neither up nor down"
                />
              </div>
            </div>
          </Field>
          <Field label="significance">
            <div style={styles.cutoffRow}>
              <span style={styles.inlineTag}>{statLabel} ≤</span>
              <div style={styles.cutoffBox}>
                <PValueInput statMin={t.statMin} onChange={(v) => setT({ statMin: v })} />
              </div>
            </div>
          </Field>
          {/* b: how far the curve bows away from its asymptotes — larger = stricter. */}
          <Field label="stringency">
            <div style={styles.cutoffRow}>
              <span style={styles.inlineTag}>b =</span>
              <div style={styles.cutoffBox}>
                <NumberInput
                  value={t.b}
                  step={0.1}
                  onChange={(v) => setT({ b: Math.max(0.01, r2(v)) })}
                />
              </div>
            </div>
          </Field>
        </>
      )}
    </Section>
  )
}
