import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GeneSearchMenu } from '../../dashboard/GeneSearchMenu'
import {
  type ConditionKey,
  IMPUTE_DEFAULTS,
  type LogTransform,
  NORMALIZE_REFERENCE_LABEL,
  type NormalizeReference,
  type ScalePreview,
  type StandardizeResult,
  type ValueHistogram,
  condLabel,
  customCond,
  defaultTransform,
  fromLinear,
  histogram,
  histogramShape,
  isCustomCond,
  orderConds,
  outputScale,
  sampleIndex,
  sampleLabel,
  sampleName,
  scaleName,
  toLinear
} from '../../engine'
import type { SampleConds } from '../../engine/types'
import type { CleanupMode } from '../../engine'
import { loadAbove, wiredKindOf } from '../../graph/registry'
import { useGraph } from '../../graph/store'
import {
  type LoadConfig,
  type StandardizeConfig,
  cleanupModeOfConfig,
  cleanupOn,
  imputeOn,
  isStep
} from '../../graph/types'
import { StatusNote } from '../../ui/StatusNote'
import { UI } from '../../ui/theme'
import { OnOffSwitch, ToggleSwitch } from '../../ui/ToggleSwitch'
import { ValueMultiSelect } from '../../ui/ValueMultiSelect'
import { EffectLabelInput, Field, NumberInput, Section, Select } from '../kit/settings/controls'
import { CONDS } from '../kit/settings/hooks'
import { styles } from '../kit/settings/styles'
import { type StepSettingsProps } from '../settings'
import { batchSourceConds, shapeNote } from './model'

/** Clean data's Data scale: the distribution of its input values — read straight from the upstream
 *  Load step's data file, so it shows before any run — the scale detected from them, the
 *  log-transform its values are presented on (none / log10 / log2; log10 by default for linear
 *  input, none for already-logged), and the distribution after that transform. Analyses always
 *  work from exact linear values (logged input is converted on the way in), so the choice sets
 *  what the table and the written data show, never a double log. */
export function DataScaleSection({
  id,
  config,
  std
}: {
  id: string
  config: StandardizeConfig
  std: StandardizeResult | null
}) {
  const setLogTransform = useGraph((s) => s.setStdLogTransform)
  const setLogDisplay = useGraph((s) => s.setStdLogDisplay)
  const previewStdScale = useGraph((s) => s.previewStdScale)
  // The upstream data file's name, so the preview re-reads when the Load step points elsewhere.
  const dataFile = useGraph(
    (s) => (loadAbove(s, id)?.load.data.config as LoadConfig | undefined)?.data ?? ''
  )
  // Fed by Clean data (a Merge, a Subset of one): that result, the preview's source — so it
  // follows a re-run there. Null when fed by Load data.
  const upStd = useGraph((s) => {
    const up = s.upstreamId(id)
    const r = up && wiredKindOf(s, up) === 'standardize' ? s.results[up] : undefined
    return r?.kind === 'standardize' ? r.std : null
  })
  const fedByClean = useGraph((s) => {
    const up = s.upstreamId(id)
    return !!up && wiredKindOf(s, up) === 'standardize'
  })
  const [preview, setPreview] = useState<ScalePreview | null | 'loading'>('loading')
  useEffect(() => {
    let live = true
    // Reset before reading: the state is the preview OF this file, so a change starts it over.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview('loading')
    previewStdScale(id)
      .then((p) => live && setPreview(p))
      .catch(() => live && setPreview(null))
    return () => {
      live = false
    }
  }, [id, dataFile, upStd, previewStdScale])

  // The data file's preview when there is one; else what the last run recorded.
  const ready = preview !== 'loading' && preview !== null ? preview : null
  const detected = ready?.inputScale ?? std?.inputScale
  const value: LogTransform | '' =
    config.logTransform ?? (detected ? defaultTransform(detected) : '')
  const out = detected ? outputScale(value || undefined, detected) : undefined
  const histIn = useMemo(
    () => (ready ? histogram(ready.sample) : (std?.inputHistogram ?? null)),
    [ready, std]
  )
  // The same values as they'll be presented: back to linear from the detected scale, then onto the
  // output one (a non-positive value has no log, so it drops out).
  const histOut = useMemo(() => {
    if (!ready || !detected || !out || out === detected) return null
    const vals: number[] = []
    for (const v of ready.sample) {
      const t = fromLinear(toLinear(v, detected), out)
      if (t != null) vals.push(t)
    }
    return histogram(vals)
  }, [ready, detected, out])
  const fmt = (v: number): string =>
    !Number.isFinite(v)
      ? '—'
      : Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-2)
        ? v.toExponential(1)
        : v.toFixed(Math.abs(v) >= 100 ? 0 : 2)
  return (
    <Section
      title="Log-transform"
      info={
        <>
          The scale the input arrived on is detected from its values (raw intensities, or already
          log₂ / log₁₀) and converted, so logged data is never logged twice. The transform sets the
          scale Clean data&apos;s values are shown, written and plotted on, and the scale a Compare
          tests on. Default: none.
          <br />
          <br />
          The histograms show the values as loaded and after the transform, with whether each shape
          looks normal.
        </>
      }
      // The log-transform sits in the header, right-aligned: the section's one setting.
      action={
        <ToggleSwitch
          label="Log-transform"
          value={value}
          options={[
            { value: 'none' as const, label: 'none' },
            { value: 'log10' as const, label: scaleName('log10') },
            { value: 'log2' as const, label: scaleName('log2') }
          ]}
          // Display-only (analyses read linear rows) — so no re-run, the table just re-presents.
          onChange={(v) => setLogTransform(id, v as LogTransform)}
        />
      }
    >
      {preview === 'loading' && !histIn ? (
        <div style={styles.hint}>Reading the data…</div>
      ) : histIn && histIn.counts.length > 0 ? (
        <ValueHistogramView
          hist={histIn}
          fmt={fmt}
          caption="as loaded"
          // Whether the shape looks normal — to check against the histogram it heads.
          note={shapeNote(histogramShape(histIn))}
        />
      ) : (
        <div style={styles.hint}>
          {fedByClean
            ? 'No data to preview yet — run the step this one reads from.'
            : 'No data to preview yet — set the Load step’s data file (an interactive import: convert it first).'}
        </div>
      )}
      {histOut && (
        <>
          <ValueHistogramView
            hist={histOut}
            fmt={fmt}
            caption={`after ${out ? scaleName(out) : ''}`}
            note={shapeNote(histogramShape(histOut))}
          />
        </>
      )}
      {/* Logged: how the values read — as their logs, or as themselves on a log axis (scale.ts
          LogDisplay). Presentation only: the positions, the shape and the tests stay the same.
          Unset: plain for fractions of a reference protein, logs otherwise. */}
      {out && out !== 'linear' && (
        <Field label="show">
          {/* a dropdown: the second option is too long to sit beside the first in a switch */}
          <Select
            value={
              config.logDisplay ??
              (config.normalizeEnabled && config.normalizeReference === 'protein' ? 'plain' : 'log')
            }
            options={[
              { value: 'log', label: `${scaleName(out)} values` },
              { value: 'plain', label: `original values on ${scaleName(out)} axis` }
            ]}
            onChange={(v) => setLogDisplay(id, v as 'log' | 'plain')}
          />
        </Field>
      )}
    </Section>
  )
}
/** A compact histogram of values (SVG), with the range beneath — enough to see the shape: raw
 *  intensities pile up near zero with a long tail, logged values sit in a hump. */
export function ValueHistogramView({
  hist,
  fmt,
  caption,
  note
}: {
  hist: ValueHistogram
  fmt: (v: number) => string
  /** what this distribution is (as loaded / after a transform), shown left of it */
  caption?: string
  /** shown under the caption (the detected-scale warning) */
  note?: ReactNode
}): ReactNode {
  const W = 240
  const H = 36
  const peak = Math.max(1, ...hist.counts)
  const bw = W / hist.counts.length
  return (
    <div style={styles.histWrap}>
      {(caption || note) && (
        <div style={styles.histHead}>
          {caption && <span style={styles.histCaption}>{caption}</span>}
          {note}
        </div>
      )}
      <div style={styles.histChart}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={styles.histSvg}
          role="img"
          aria-label={`Distribution of ${hist.n} values from ${fmt(hist.min)} to ${fmt(hist.max)}`}
        >
          {hist.counts.map((c, i) => {
            const h = (c / peak) * (H - 2)
            return (
              <rect
                key={i}
                x={i * bw + 0.5}
                y={H - h}
                width={Math.max(0.5, bw - 1)}
                height={h}
                fill={UI.accent}
                opacity={0.75}
              />
            )
          })}
        </svg>
        <div style={styles.histAxis}>
          <span>{fmt(hist.min)}</span>
          <span>{fmt(hist.max)}</span>
        </div>
      </div>
    </div>
  )
}
/** Pick one protein: a button showing the pick, opening the app's gene search (GeneSearchMenu, as
 *  the one-gene pager's) over the last run's genes. Before any run there are none to list. */
export function ProteinPicker({
  value,
  names,
  onChange
}: {
  value: string | undefined
  /** uniqID → display name, from the Clean data step's last run */
  names: Record<string, string> | undefined
  onChange: (uid: string) => void
}): ReactNode {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setRect(null), [])
  // every gene, by name
  const genes = useMemo(
    () =>
      names
        ? Object.keys(names).sort((a, b) =>
            (names[a] ?? a).localeCompare(names[b] ?? b, undefined, { numeric: true })
          )
        : [],
    [names]
  )
  const shown = value ? (names?.[value] ?? value) : null
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={!names}
        title={!names ? 'Run Clean data once to list its proteins' : 'Pick the reference protein'}
        onClick={() =>
          setRect((r) => (r ? null : (btnRef.current?.getBoundingClientRect() ?? null)))
        }
        style={{
          ...styles.input,
          textAlign: 'left',
          cursor: names ? 'pointer' : 'not-allowed',
          color: shown ? UI.text : UI.textMuted
        }}
      >
        {shown ?? (names ? 'Pick a protein…' : 'Run Clean data first')}
      </button>
      {rect && names && (
        <GeneSearchMenu
          genes={genes}
          current={value}
          displayMap={names}
          anchor={rect}
          triggerRef={btnRef}
          onPick={onChange}
          onClose={close}
        />
      )}
    </>
  )
}
export function StandardizePanel({ id, config }: { id: string; config: StandardizeConfig }) {
  const update = useGraph((s) => s.updateConfig)
  const std = useGraph((s) => {
    const r = s.results[id]
    return r?.kind === 'standardize' ? r.std : null
  })
  // The conditions the imported data actually carries, for "Coverage per": read off the upstream
  // interactive import's sample conditions (any included sample with a value), so they're right
  // before this tile has ever run. Joined into a string so the selector returns a stable value.
  // null = nothing to read there (a manual import) — then this tile's last run says, else every
  // preset is offered.
  const importConds = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === id)?.source
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    const ia = up && isStep(up) ? (up.data.config as LoadConfig).interactive : undefined
    if (!ia) return null
    const samples = Object.values(ia.conditions ?? {}).filter((c) => c.include !== false)
    const has = (v: string | undefined): boolean => !!v && v.trim() !== ''
    // A condition switched off in the import isn't written, whatever values it keeps.
    const hidden = new Set(ia.hiddenConditions ?? [])
    const keys: string[] = (['cell', 'cmpd', 'dose', 'time'] as const).filter(
      (f) => !hidden.has(f) && samples.some((c) => has(c[f]))
    )
    for (const name of ia.customConditions ?? [])
      if (!hidden.has(name) && samples.some((c) => has(c.extra?.[name])))
        keys.push(customCond(name))
    return keys.join('\u0001')
  })
  // Fed by Clean data (a second clean-up): the conditions of the table it's given, before this
  // step has run itself.
  const inputConds = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === id)?.source
    const r = upId ? s.results[upId] : undefined
    return r?.kind === 'standardize' ? r.std.activeConditions.join('\u0001') : null
  })
  const conds = useMemo(() => {
    if (importConds != null)
      return orderConds(importConds ? (importConds.split('\u0001') as ConditionKey[]) : [])
    if (std) return orderConds(std.activeConditions)
    if (inputConds != null)
      return orderConds(inputConds ? (inputConds.split('\u0001') as ConditionKey[]) : [])
    return orderConds([...CONDS])
  }, [std, importConds, inputConds])
  const geneTotal = useMemo(() => (std ? new Set(std.rows.map((r) => r.uniqID)).size : 0), [std])
  const r2 = (v: number): number => Math.round(v * 100) / 100
  // The clean-up rule as chosen, shown under its controls. Only the conditions on offer: one the
  // data doesn't carry groups nothing.
  const cleanupBy = (config.minSamplePctBy ?? []).filter((c) => conds.includes(c))
  const cleanupMode = cleanupModeOfConfig(config)
  const grouped = cleanupMode !== 'overall'
  const byCount = config.minSampleUnit === 'count'
  const cleanupRule = (() => {
    const n = config.minSampleCount ?? 2
    const min = byCount
      ? `${n} sample${n === 1 ? '' : 's'}`
      : `${config.minSamplePct ?? 0}% of samples`
    if (!grouped) return `Removing proteins detected in fewer than ${min} overall.`
    if (cleanupBy.length === 0) return 'Pick the conditions that make the groups.'
    const group = `${cleanupBy.map(condLabel).join(' × ')} group`
    if (cleanupMode === 'withinGroup')
      return `Removing a protein's values in each ${group} where it's detected in fewer than ${min}.`
    if (cleanupMode === 'everyGroup')
      return `Keeping proteins detected in at least ${min} in every ${group}.`
    return `Keeping proteins detected in at least ${min} in at least one ${group}.`
  })()
  return (
    <>
      <DataScaleSection id={id} config={config} std={std} />
      <Section
        title="Clean-up"
        info="Drop low coverage genes."
        action={
          <OnOffSwitch
            on={cleanupOn(config)}
            label="Clean-up"
            onChange={(on) =>
              // First switch-on with no threshold yet → a sensible starting point.
              update(id, {
                cleanupEnabled: on,
                ...(on && !(config.minSamplePct > 0) ? { minSamplePct: 50 } : null)
              })
            }
          />
        }
      >
        {cleanupOn(config) && (
          <>
            {/* the removal mode first, then the groups it's judged in, then the bar */}
            <Field label="mode">
              <Select
                value={cleanupMode}
                onChange={(v) => update(id, { cleanupMode: v as CleanupMode })}
                options={[
                  { value: 'overall', label: 'remove proteins below threshold overall' },
                  {
                    value: 'withinGroup',
                    label: 'remove proteins below threshold within each condition group'
                  },
                  {
                    value: 'anyGroup',
                    label: 'keep proteins above threshold in at least one group'
                  },
                  { value: 'everyGroup', label: 'keep proteins above threshold in every group' }
                ]}
              />
            </Field>
            {grouped && (
              <>
                <Field label="groups by">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 12px' }}>
                    {conds.map((c) => {
                      const by = config.minSamplePctBy ?? []
                      const on = by.includes(c)
                      return (
                        <label key={c} style={{ ...styles.checkRow, marginBottom: 0 }}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) =>
                              update(id, {
                                minSamplePctBy: e.target.checked
                                  ? conds.filter((k) => k === c || by.includes(k))
                                  : by.filter((k) => k !== c)
                              })
                            }
                          />
                          {condLabel(c)}
                        </label>
                      )
                    })}
                  </div>
                </Field>
              </>
            )}
            <Field label="threshold">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <div style={{ width: 60, flex: '0 0 auto' }}>
                  {byCount ? (
                    <NumberInput
                      value={config.minSampleCount ?? 2}
                      step={1}
                      min={1}
                      onChange={(v) => update(id, { minSampleCount: Math.max(1, Math.round(v)) })}
                    />
                  ) : (
                    <NumberInput
                      value={config.minSamplePct ?? 0}
                      step={5}
                      min={0}
                      max={100}
                      onChange={(v) =>
                        update(id, { minSamplePct: Math.min(100, Math.max(0, Math.round(v))) })
                      }
                    />
                  )}
                </div>
                {/* the unit, then what it counts: "50 · % · of samples", "2 · # · samples" — within
                    group in the grouped modes. The switch never shrinks (its pills would stack);
                    the words wrap instead. */}
                <div style={{ flex: '0 0 auto' }}>
                  <ToggleSwitch
                    label="Threshold unit"
                    value={byCount ? 'count' : 'pct'}
                    options={[
                      { value: 'pct', label: '%' },
                      { value: 'count', label: '#' }
                    ]}
                    onChange={(v) => update(id, { minSampleUnit: v })}
                  />
                </div>
                <span style={{ color: UI.textMuted, fontSize: 12, minWidth: 0, lineHeight: 1.3 }}>
                  {byCount ? 'samples' : 'of samples'}
                  {grouped ? ' within group' : ''}
                </span>
              </div>
            </Field>
            <StatusNote kind="warn">{cleanupRule}</StatusNote>
          </>
        )}
        {cleanupOn(config) &&
          std &&
          ((std.cleanup?.droppedGenes ?? 0) > 0 || (std.cleanup?.removedValues ?? 0) > 0) && (
            <StatusNote kind="ok" style={styles.doneNote}>
              Dropped {std.cleanup.droppedGenes.toLocaleString()} of{' '}
              {(std.cleanup.droppedGenes + geneTotal).toLocaleString()} genes
              {(std.cleanup.removedValues ?? 0) > 0 &&
                `; removed ${std.cleanup.removedValues!.toLocaleString()} values`}
            </StatusNote>
          )}
      </Section>
      {/* Normalisation runs after clean-up and before imputation, whose draws follow each
                sample's own distribution — so they're drawn from the normalised one. */}
      <Section
        title="Normalisation"
        info={
          <>
            Align samples to remove loading and batch differences. Skip for data already normalised.
            <br />
            <b>Common genes</b>: measured in every sample.
            <br />
            <b>All genes</b>: every value each sample measured.
            <br />
            <b>Reference protein</b>: every value divided by one protein (e.g. a housekeeping
            protein or a spike-in) in its own sample, so that protein reads 1 everywhere and each
            value is its fraction, shown unlogged. It must be measured in every sample.
            <br />
            <b>Median</b>: shift each sample to the same median.
            <br />
            <b>Distribution</b>: median plus spread (Perseus width adjustment); also changes fold
            changes.
          </>
        }
        action={
          <OnOffSwitch
            on={!!config.normalizeEnabled}
            label="Normalisation"
            onChange={(on) => update(id, { normalizeEnabled: on })}
          />
        }
      >
        {config.normalizeEnabled && (
          <>
            <Field label="Applied to">
              <Select
                value={config.normalizeReference ?? 'shared'}
                onChange={(v) => update(id, { normalizeReference: v as NormalizeReference })}
                options={(['shared', 'all', 'protein'] as const).map((v) => ({
                  value: v,
                  label: NORMALIZE_REFERENCE_LABEL[v]
                }))}
              />
            </Field>
            {config.normalizeReference === 'protein' ? (
              <Field label="Protein">
                <ProteinPicker
                  value={config.normalizeProtein}
                  names={std?.displayMap}
                  onChange={(uid) => update(id, { normalizeProtein: uid })}
                />
              </Field>
            ) : (
              // (one protein has no spread to equalise: median only)
              <Field label="Method">
                <Select
                  value={config.normalizeSpread ? 'distribution' : 'median'}
                  onChange={(v) => update(id, { normalizeSpread: v === 'distribution' })}
                  options={[
                    { value: 'median', label: 'Median' },
                    { value: 'distribution', label: 'Distribution' }
                  ]}
                />
              </Field>
            )}
          </>
        )}
        {config.normalizeEnabled &&
          std?.normalization &&
          (() => {
            const nz = std.normalization
            if (nz.used === 'protein') {
              const name = nz.protein ? (std.displayMap[nz.protein] ?? nz.protein) : ''
              return !nz.protein ? (
                <StatusNote kind="warn">Pick the reference protein.</StatusNote>
              ) : nz.samples === 0 ? (
                <StatusNote kind="warn">
                  {name} wasn't measured in any sample (or was dropped in clean-up): nothing was
                  normalised.
                </StatusNote>
              ) : (
                <StatusNote kind="ok" style={styles.doneNote}>
                  {`Divided ${nz.samples.toLocaleString()} sample${nz.samples === 1 ? '' : 's'} by ${name}: values are fractions of it`}
                </StatusNote>
              )
            }
            const asked = nz.used === nz.reference
            const n = nz.samples
            // The genes the medians were taken on, of every gene kept: common ones, or all.
            const on = nz.used === 'shared' ? nz.sharedGenes : geneTotal
            const what = `sample ${nz.spread ? 'distribution' : 'median'}${n === 1 ? '' : 's'}`
            return (
              <StatusNote kind={asked ? 'ok' : 'warn'} style={asked ? styles.doneNote : undefined}>
                {asked
                  ? `Normalised ${n.toLocaleString()} ${what} on ${on.toLocaleString()}/${geneTotal.toLocaleString()} genes`
                  : `Too few common genes ${nz.sharedGenes.toLocaleString()}/${geneTotal.toLocaleString()}. Normalised ${n.toLocaleString()} ${what} on all ${geneTotal.toLocaleString()} genes`}
              </StatusNote>
            )
          })()}
      </Section>
      {/* Batch correction runs after normalisation and before imputation (see engine batch.ts). */}
      <BatchSection id={id} config={config} std={std} />
      {/* Imputation runs after clean-up, so it fills only the gaps in genes that were kept. */}
      <Section
        title="Imputation"
        info={
          <>
            Fill missing values assuming limits of detection for each sample (Perseus): each gap is
            drawn from a normal distribution with SD of{' '}
            {config.imputeWidth ?? IMPUTE_DEFAULTS.width} × sample SD, centred at{' '}
            {config.imputeShift ?? IMPUTE_DEFAULTS.shift} × sample SD below the sample mean. Needs
            clean-up, so a gene seen once isn&apos;t mostly imputed.
          </>
        }
        subtitle={
          cleanupOn(config) ? undefined : (
            <StatusNote kind="info" inline>
              enabled upon clean-up
            </StatusNote>
          )
        }
        action={
          <OnOffSwitch
            on={imputeOn(config)}
            label="Imputation"
            disabled={!cleanupOn(config)}
            onChange={(on) => update(id, { imputeEnabled: on })}
          />
        }
      >
        {imputeOn(config) && (
          <>
            {/* Perseus draws each gap from a normal distribution shifted below (and narrower than)
                        the sample's own log-intensity distribution — the "below detection" model. */}
            <Field label="downshift">
              <div style={styles.cutoffRow}>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={config.imputeShift ?? IMPUTE_DEFAULTS.shift}
                    step={0.1}
                    min={0}
                    onChange={(v) => update(id, { imputeShift: Math.max(0, r2(v)) })}
                  />
                </div>
                <span style={styles.inlineTag}>× sample SD</span>
              </div>
            </Field>
            <Field label="width">
              <div style={styles.cutoffRow}>
                <div style={styles.cutoffBox}>
                  <NumberInput
                    value={config.imputeWidth ?? IMPUTE_DEFAULTS.width}
                    step={0.05}
                    min={0.01}
                    onChange={(v) => update(id, { imputeWidth: Math.max(0.01, r2(v)) })}
                  />
                </div>
                <span style={styles.inlineTag}>× sample SD</span>
              </div>
            </Field>
          </>
        )}
        {imputeOn(config) && std?.imputation && (
          <StatusNote kind="ok" style={styles.doneNote}>
            Imputed {std.imputation.imputed.toLocaleString()} of{' '}
            {std.imputation.total.toLocaleString()} values
          </StatusNote>
        )}
      </Section>
    </>
  )
}
/** Clean data's batch correction: the batches its samples were measured in, filled in one go from
 *  a condition (a TMT plex column) or from the Merge inputs above — then any sample moved by hand.
 *  Each batch's shift is removed with every condition protected, and a Compare below blocks on
 *  the batches (engine batch.ts). Defined here, explicitly: nested batches (plexes within merged
 *  datasets) are corrected step by step — each dataset's plexes first, then the merged datasets. */
export function BatchSection({
  id,
  config,
  std
}: {
  id: string
  config: StandardizeConfig
  std: StandardizeResult | null
}) {
  const update = useGraph((s) => s.updateConfig)
  // The samples to sort into batches: the table this step is given when it reads Clean data (a
  // Merge, a Subset of one) — else, off Load data, its own last run's.
  const upStd = useGraph((s) => {
    const up = s.upstreamId(id)
    const r = up && wiredKindOf(s, up) === 'standardize' ? s.results[up] : undefined
    return r?.kind === 'standardize' ? r.std : null
  })
  const fedByClean = useGraph((s) => {
    const up = s.upstreamId(id)
    return !!up && wiredKindOf(s, up) === 'standardize'
  })
  const input = fedByClean ? upStd : std
  const samples = useMemo(
    () => (input ? (input.samples ?? sampleIndex(input).reps) : []),
    [input]
  ) as SampleConds[]
  const labels = useMemo(() => [...new Set(samples.map((m) => sampleLabel(m)))], [samples])
  // A batch's samples are saved by their key (sampleLabel); shown by their name (" · ").
  const nameOfLabel = useMemo(() => {
    const names = new Map(samples.map((m) => [sampleLabel(m), sampleName(m)]))
    return (l: string): string => names.get(l) ?? l
  }, [samples])
  const sources = input?.sources
  // Fed straight by a Merge whose result doesn't say where its samples came from: it ran before
  // Merge recorded that — a re-run of it does.
  const fedByMerge = useGraph((s) => {
    const up = s.upstreamId(id)
    const n = up ? s.nodes.find((x) => x.id === up) : undefined
    return !!n && isStep(n) && n.data.kind === 'merge'
  })
  const mergeUnrecorded = fedByMerge && !sources
  const fromConds = useMemo(() => batchSourceConds(samples), [samples])
  // The batches a condition's values, or the Merge inputs, make: one per value, every sample placed.
  const groupsFrom = useCallback(
    (from: string): Array<{ name: string; samples: string[]; value: string }> => {
      const groups = new Map<string, string[]>()
      for (const m of samples) {
        const l = sampleLabel(m)
        const v =
          from === 'source'
            ? (sources?.[l] ?? '')
            : String(
                (isCustomCond(from as ConditionKey)
                  ? m.extra?.[from.slice(1)]
                  : m[from as 'cell']) ?? ''
              )
        if (!v) continue
        const g = groups.get(v) ?? []
        if (!g.includes(l)) g.push(l)
        groups.set(v, g)
      }
      return [...groups].map(([value, ls]) => ({ name: value, samples: ls, value }))
    },
    [samples, sources]
  )
  // Filled and not moved by hand since: the batches follow the data as it is now (and are worked
  // out the same way on each run — batchSpecOf's live), each value keeping the name given here.
  const liveFrom = config.batchEdited ? undefined : config.batchFrom
  const batches = useMemo(() => {
    if (!liveFrom) return config.batches ?? []
    const names = new Map((config.batches ?? []).map((b) => [b.value, b.name]))
    return groupsFrom(liveFrom).map((g) => ({ ...g, name: names.get(g.value) ?? g.name }))
  }, [liveFrom, config.batches, groupsFrom])
  const batchOf = useMemo(() => {
    const m = new Map<string, number>()
    batches.forEach((b, i) => b.samples.forEach((l) => m.set(l, i)))
    return m
  }, [batches])
  // `edited`: a sample moved, or a batch added or removed, by hand — the batches are these lists
  // from then on (a rename keeps them following the data).
  const set = (
    next: Array<{ name: string; samples: string[]; value?: string }>,
    edited = !!config.batchEdited
  ): void => update(id, { batches: next, batchFrom: config.batchFrom, batchEdited: edited })
  // Fill from a condition's values, or the Merge inputs: one batch per value, every sample placed.
  const fill = (from: string): void => {
    if (!from) return
    update(id, {
      batches: groupsFrom(from),
      batchFrom: from as StandardizeConfig['batchFrom'],
      batchEdited: false
    })
  }
  // Batch `to`'s samples set to `next` — a sample ticked here leaves any other batch (one each).
  const assign = (to: number, next: string[]): void => {
    const now = new Set(next)
    set(
      batches.map((b, i) =>
        i === to ? { ...b, samples: next } : { ...b, samples: b.samples.filter((l) => !now.has(l)) }
      ),
      true
    )
  }
  const used = batches.filter((b) => b.samples.length > 0).length
  const summary = std?.batchCorrection
  return (
    <Section
      title="Batch correction"
      info={
        <>
          Remove differences between the batches samples were measured in (merged datasets, TMT
          plexes) while keeping every condition&apos;s effect. Fill the batches from a condition or
          the Merge inputs, then move any sample by hand. A Compare below also tests within batches.
          <br />
          <br />
          Batches have to share a condition (a common control) to be told apart from it. For plexes
          within merged datasets, correct each dataset&apos;s plexes first, then the merged datasets
          in a Clean data after the Merge.
        </>
      }
      action={
        <OnOffSwitch
          on={!!config.batchEnabled}
          label="Batch correction"
          onChange={(on) => update(id, { batchEnabled: on })}
        />
      }
    >
      {config.batchEnabled &&
        (!input ? (
          <div style={styles.hint}>
            {fedByClean
              ? 'Run the step this one reads from to list its samples.'
              : 'Run this step once to list its samples.'}
          </div>
        ) : (
          <>
            <Field label="Fill from">
              <Select
                value=""
                placeholder={
                  config.batchFrom === 'source'
                    ? 'Merge inputs'
                    : config.batchFrom
                      ? condLabel(config.batchFrom)
                      : 'Choose…'
                }
                onChange={fill}
                options={[
                  ...(sources ? [{ value: 'source', label: 'Merge inputs' }] : []),
                  ...fromConds.map((c) => ({ value: c, label: condLabel(c) }))
                ]}
              />
            </Field>
            {mergeUnrecorded && (
              <div style={styles.hint}>
                Re-run the Merge above to fill the batches from its inputs.
              </div>
            )}
            {config.batchFrom && config.batchFrom !== 'source' && (
              <div style={styles.hint}>
                {condLabel(config.batchFrom)} is the batch now, not a condition downstream.
              </div>
            )}
            {/* Each batch: its name, then its samples (one batch each — ticking a sample here
                            moves it from the batch it's in, which the list notes). */}
            <Field label="Batches">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
                {batches.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <EffectLabelInput
                      value={b.name}
                      title="This batch's name"
                      style={{ flex: '0 0 96px', width: 96 }}
                      onCommit={(v) =>
                        v && set(batches.map((x, k) => (k === i ? { ...x, name: v } : x)))
                      }
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ValueMultiSelect
                        members
                        values={labels}
                        selected={b.samples}
                        labelOf={nameOfLabel}
                        noun="sample"
                        noteOf={(l) => {
                          const k = batchOf.get(l)
                          return k != null && k !== i ? `in ${batches[k].name}` : undefined
                        }}
                        onChange={(next) => assign(i, next)}
                      />
                    </div>
                    <button
                      type="button"
                      style={styles.iconBtnSm}
                      title="Remove this batch (its samples go uncorrected)"
                      onClick={() =>
                        set(
                          batches.filter((_, k) => k !== i),
                          true
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  style={{ ...styles.resetBtn, alignSelf: 'flex-start', padding: 0 }}
                  onClick={() =>
                    set([...batches, { name: `Batch ${batches.length + 1}`, samples: [] }], true)
                  }
                >
                  + batch
                </button>
              </div>
            </Field>
            {used < 2 ? (
              <StatusNote kind="info">Put samples in at least two batches to correct.</StatusNote>
            ) : (
              summary && (
                <StatusNote
                  kind={summary.skipped ? 'warn' : 'ok'}
                  style={summary.skipped ? undefined : styles.doneNote}
                >
                  {`Corrected ${summary.genes.toLocaleString()} genes across ${summary.batches} batches`}
                  {summary.skipped
                    ? ` · ${summary.skipped.toLocaleString()} left as they were (their measured samples don't share a condition across batches)`
                    : ''}
                </StatusNote>
              )
            )}
          </>
        ))}
    </Section>
  )
}

/** Its settings panel (nodes/settings.ts). */
export function Settings({ id, config }: StepSettingsProps): ReactNode {
  return <StandardizePanel id={id} config={config as StandardizeConfig} />
}
