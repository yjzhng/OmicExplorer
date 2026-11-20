import { type ReactNode, useContext, useMemo, useState } from 'react'
import {
  type ContrastFeatureId,
  type AxisTail,
  type ContrastStat,
  roundP,
  statTails,
  valueCutoffs,
  upperOnly
} from '../../../engine'
import { ApplyStageContext } from '../../../graph/applyStage'
import { tailStep } from '../../../graph/contrastModel'
import { useGraph } from '../../../graph/store'
import { type ContrastConfig, isStep, resolveContrastSource } from '../../../graph/types'
import { OnOffSwitch, ToggleSwitch } from '../../../ui/ToggleSwitch'
import { Field, NumberInput, Section, Select } from './controls'
import { styles } from './styles'
import { useFacet } from '../../../dashboard/facet'

/** The divergence statistic: correlated (OLS fit of A on B, genes outside its prediction band
 *  diverge) or, off, a linear cutoff — a value on each axis, as a volcano's lines, per feature.
 *  Shown on the Contrast step, and again on a scatter fed by it — the same settings, written to
 *  the Contrast (`subtitle` then says whose they are). */
export function ContrastStatPanel({
  id,
  config: stored,
  subtitle,
  tab
}: {
  id: string
  config: ContrastConfig
  subtitle?: ReactNode
  /** a plot's settings: its results tab (the plot's id), whose feature switcher the linear
   *  cutoff's boxes follow */
  tab?: string
}) {
  const update = useGraph((s) => s.updateConfig)
  // In a plot's settings window (a scatter fed by this Contrast) every edit is held until its
  // Apply, which then saves them and re-runs the Contrast and what follows it — as a Compare's
  // statistic is there; Close drops them. Shown here merged over the stored settings. Outside such
  // a window, an edit lands as it's made.
  const staging = useContext(ApplyStageContext)
  type Held = { relationship?: ContrastConfig['relationship']; stat?: Partial<ContrastStat> }
  const [held, setHeld] = useState<Held | null>(null)
  const config: ContrastConfig = held
    ? {
        ...stored,
        ...(held.relationship ? { relationship: held.relationship } : null),
        stat: { ...stored.stat, ...held.stat } as ContrastStat
      }
    : stored
  const write = (patch: Held): void => {
    if (!staging) {
      update(id, {
        ...(patch.relationship ? { relationship: patch.relationship } : null),
        ...(patch.stat ? { stat: { ...stored.stat, ...patch.stat } } : null)
      })
      return
    }
    const next: Held = {
      ...held,
      ...(patch.relationship ? { relationship: patch.relationship } : null),
      stat: { ...held?.stat, ...patch.stat }
    }
    setHeld(next)
    staging.stage(`contrast-stat:${id}`, () => {
      const g = useGraph.getState()
      const node = g.nodes.find((n) => n.id === id)
      if (!node || !isStep(node)) return
      const cur = node.data.config as ContrastConfig
      g.updateConfig(id, {
        ...(next.relationship ? { relationship: next.relationship } : null),
        stat: { ...cur.stat, ...next.stat }
      })
      void g.rerunFrom(id)
    })
  }
  const correlated = config.relationship !== 'independent'
  const setStat = (patch: Partial<ContrastStat>): void => write({ stat: patch })
  const t = statTails(config.stat)
  // The two sides are "groups" of one dataset (intra) or two "datasets" (inter), per the wiring.
  const inputCount = useGraph((s) => s.edges.filter((e) => e.target === id).length)
  const sideWord = resolveContrastSource(config, inputCount) === 'pair' ? 'dataset' : 'group'
  const asym = config.stat?.asymmetric ?? false
  // Shown as the TAIL — the % called on that side (1 − confidence): "top 1%" reads more
  // directly than "99% confidence". Stored as confidence as before.
  // To 0.001% (confidence 0.99999), the finest tail.
  const pctOf = (c: number): number => Math.round((1 - c) * 1e5) / 1e3
  const clamp = (v: number): number => Math.min(0.99999, Math.max(0.5, 1 - v / 100))
  const confRow = (
    tag: string,
    value: number,
    onChange: (v: number) => void,
    disabled: boolean
  ): ReactNode => (
    <div style={styles.cutoffRow}>
      <span style={styles.inlineTag}>{tag}</span>
      <div style={styles.pctBox}>
        <NumberInput
          value={pctOf(value)}
          step={0.001}
          ladder={tailStep}
          min={0.001}
          max={50}
          disabled={disabled}
          title={disabled ? 'Mirrors the top tail — switch on asymmetric to edit' : undefined}
          onChange={onChange}
        />
      </div>
      <span style={styles.inlineTag}>% outside the band</span>
    </div>
  )
  return (
    <Section title="Statistic" subtitle={subtitle}>
      {/* How the two sides relate: correlated (one response, scattered about a fitted line — the
                      genes outside its prediction band diverge) or independent (each axis judged on its own). */}
      <Field label="relationship">
        <ToggleSwitch
          label="relationship"
          value={correlated ? 'correlated' : 'independent'}
          onChange={(v) => write({ relationship: v })}
          options={[
            { value: 'correlated', label: 'correlated' },
            { value: 'independent', label: 'independent' }
          ]}
        />
      </Field>
      {/* Correlated: what the band is centred on — a line fitted through the two sides, or y = x
                      itself. Independent has one model (a selector anyway, so it reads as a choice). */}
      <Field label="model">
        <Select
          value={correlated ? (config.stat?.model ?? 'linear') : 'cutoff'}
          onChange={(v) =>
            correlated && write({ stat: { model: v as NonNullable<ContrastStat['model']> } })
          }
          options={
            correlated
              ? [
                  { value: 'linear', label: 'linear correlation (fitted line)' },
                  { value: 'identity', label: 'identity (y = x)' }
                ]
              : [{ value: 'cutoff', label: 'linear cutoff' }]
          }
        />
      </Field>
      {correlated ? (
        // The prediction band's level, entered as the tail called (top 1% = 99% confidence).
        // Asymmetric: the band below the line has its own; mirrored, its box is disabled, like
        // Compare's effect-size cutoffs.
        <Field label="cutoff" top>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={styles.cutoffRow}>
              <span style={styles.inlineTag}>asymmetric</span>
              <OnOffSwitch
                on={asym}
                label="asymmetric confidence"
                onChange={(on) => setStat({ asymmetric: on })}
              />
            </div>
            {confRow('top', t.confUp, (v) => setStat({ bandConfidence: clamp(v) }), false)}
            {confRow('bottom', t.confDown, (v) => setStat({ bandConfidenceDown: clamp(v) }), !asym)}
          </div>
        </Field>
      ) : (
        <ValueCutoffFields
          id={id}
          tab={tab}
          stat={config.stat}
          sideWord={sideWord}
          setStat={setStat}
        />
      )}
    </Section>
  )
}

/** The linear cutoff's values for one feature — in a plot's settings the one its results tab
 *  shows, on the Contrast itself picked here: each axis's top and bottom line, as a volcano's — significance one line per axis,
 *  entered as the p (or q) it stands for. Each starts at the axis's own Compare's (shown until
 *  set); a box left empty cuts nothing on that tail. */
export function ValueCutoffFields({
  id,
  tab,
  stat,
  sideWord,
  setStat
}: {
  id: string
  tab?: string
  stat: ContrastStat | undefined
  sideWord: string
  setStat: (patch: Partial<ContrastStat>) => void
}): ReactNode {
  const result = useGraph((s) => s.results[id])
  const ctr = result?.kind === 'contrast' ? result.ctr : undefined
  // The run's features in switcher order, named as the switcher names them (before a run: the
  // sides' own value).
  const features = useMemo(() => {
    const seen = new Map<ContrastFeatureId, string>()
    for (const r of ctr?.rows ?? [])
      if (r.featureId && !seen.has(r.featureId)) seen.set(r.featureId, r.feature ?? r.featureId)
    if (!seen.size) seen.set('value', ctr?.valueKind === 'abundance' ? 'abundance' : 'log₂FC')
    return [...seen].map(([fid, label]) => ({ id: fid, label }))
  }, [ctr])
  // A plot's settings: the feature on show in its results tab (the switcher's pick, keyed by the
  // tab — the feature's name), so the boxes and the plotted lines are always the same feature's.
  // The Contrast's own settings: picked here.
  const shown = useFacet((s) => (tab ? s.sel[tab]?.feature : undefined))
  const [picked, setPicked] = useState<ContrastFeatureId | null>(null)
  const feature =
    (tab ? features.find((f) => f.label === shown) : features.find((f) => f.id === picked)) ??
    features[0]
  const defaults = ctr?.classify?.cutoffDefaults?.[feature.id]
  const cuts = valueCutoffs(stat, feature.id, defaults)
  const own = stat?.values?.[feature.id]
  const sig = upperOnly(feature.id)
  // what a significance box holds: p or q, as the feature is named
  const sigWord = feature.label.endsWith('q') ? 'q' : 'p'
  const unit = sig
    ? null
    : feature.id === 'value' && ctr?.valueKind === 'abundance'
      ? 'log₁₀ abundance'
      : feature.label
  const set = (tail: AxisTail, v: number | null): void =>
    setStat({ values: { ...stat?.values, [feature.id]: { ...own, [tail]: v } } })
  const box = (tail: AxisTail): ReactNode => {
    const v = cuts[tail]
    return (
      <div style={styles.pctBox}>
        <NumberInput
          optional
          // significance: stored as −log₁₀, shown as the p it stands for
          value={v == null ? null : sig ? roundP(10 ** -v) : v}
          step={sig ? 0.001 : 0.1}
          placeholder="none"
          title="Leave empty for no cutoff on this tail"
          onChange={(x) => set(tail, x == null ? null : sig ? (x > 0 ? -Math.log10(x) : null) : x)}
        />
      </div>
    )
  }
  const axisRows = (side: 'a' | 'b', name: string): ReactNode => (
    <>
      <span style={styles.sideTag}>
        {sideWord} {name}
      </span>
      <div style={styles.cutoffRow}>
        {sig ? (
          <>
            <span style={styles.inlineTag}>{sigWord} ≤</span>
            {box(`${side}Up`)}
          </>
        ) : (
          <>
            <span style={styles.inlineTag}>top</span>
            {box(`${side}Up`)}
            <span style={{ ...styles.inlineTag, marginLeft: 6 }}>bottom</span>
            {box(`${side}Down`)}
          </>
        )}
      </div>
    </>
  )
  return (
    <Field label="cutoff" top>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* which feature's they are — a plot's: the one its tab shows (switched there) */}
        {features.length > 1 &&
          (tab ? (
            <span style={styles.inlineTag}>for {feature.label}</span>
          ) : (
            <Select
              value={feature.id}
              onChange={(v) => setPicked(v as ContrastFeatureId)}
              options={features.map((f) => ({ value: f.id, label: f.label }))}
            />
          ))}
        {axisRows('a', 'A (y-axis)')}
        {axisRows('b', 'B (x-axis)')}
        <div style={styles.cutoffRow}>
          {/* the unit, unless the feature's name above already says it */}
          {unit && (features.length <= 1 || unit !== feature.label) && (
            <span style={styles.inlineTag}>in {unit}</span>
          )}
          {/* back to the Compares' own (only while any is set here, and a Compare has one) */}
          {own && defaults && (
            <button
              style={{ ...styles.resetBtn, marginLeft: 'auto' }}
              onClick={() => {
                const { [feature.id]: _drop, ...rest } = stat?.values ?? {}
                void _drop
                setStat({ values: rest })
              }}
            >
              use the Compare’s
            </button>
          )}
        </div>
      </div>
    </Field>
  )
}
