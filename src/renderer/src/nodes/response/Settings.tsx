import type { CSSProperties, ReactNode } from 'react'
import { type ConditionKey, condLabel } from '../../engine'
import { useGraph } from '../../graph/store'
import {
  type ResponseConfig,
  type TdrConfig,
  CURVE_OF_SLICE,
  responseDim,
  responseLook,
  responseShow,
  responseShowWhy,
  responseSlice,
  responseSliceable,
  responseSurfaceRows,
  SLICE_OF_CURVE,
  tdrPair
} from '../../graph/types'
import { useUpstreamFacts } from '../../graph/useUpstreamFacts'
import { AUTO } from '../../ui/ColorPicker'
import { UI } from '../../ui/theme'
import { OnOffSwitch, ToggleSwitch } from '../../ui/ToggleSwitch'
import { useRolePalette } from '../../ui/useAppSettings'
import {
  ColorChip,
  Field,
  NumberInput,
  QuickToggle,
  Section,
  Select
} from '../kit/settings/controls'
import { autoOf, paletteLabel } from '../kit/settings/plotHooks'
import { PanelPaletteSelect, type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { responseLabel } from '../kit/variants'
import { type PlotSettingsProps } from '../settings'
import { RESPONSE_LOOK_FIELDS } from './model'

/** Response plot: 2-D or 3-D, what to show (a heatmap is 2-D only, a surface 3-D only), and the
 *  look of what the view draws — its lines, points, surface and value colour scale. `measured`:
 *  the Time & Dose-response plot, the same views of a Compare's measured log₂FC (no model). */
export function ResponsePanel({
  config,
  update,
  edgeNodeId,
  measured = false
}: PlotPanelProps<TdrConfig> & { measured?: boolean }): ReactNode {
  const globalFc = useRolePalette('fc')
  const dim = responseDim(config)
  const show = responseShow(config)
  // The view by time or by dose slices: every line view, and a slices description's surface too
  // (its dose and time curves are separate fits); never the heatmap — see responseSliceable.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { result } = useUpstreamFacts(upId)
  const rows = !measured && result?.kind === 'compare' ? responseSurfaceRows(result.cmp) : undefined
  const joint = !!rows?.some((r) => r.rs?.surface?.method === 'joint')
  const sliceable = responseSliceable(dim, show, rows)
  const slice = responseSlice(config, rows)
  // A measured plot is over its own pair (the first in the dose slot, the second in the time slot);
  // a fitted surface over dose × time.
  const [px0, py0]: [ConditionKey, ConditionKey] = measured ? tdrPair(config) : ['dose', 'time']
  // What the lines are per — their Automatic palette is that levels' role (time's for time, dose's
  // for dose and any other numeric condition, as the heatmap's level tracks).
  const linesPer = slice === 'dose' ? px0 : py0
  const lineRole = useRolePalette(linesPer === 'time' ? 'time' : 'dose')
  const look = responseLook(config)
  const lines = show === 'line'
  const valueScale = show !== 'line'
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }
  const custom = RESPONSE_LOOK_FIELDS.some((f) => config[f] !== undefined)
  const color = (field: string, value: string, what: string, auto: string): ReactNode => (
    <ColorChip
      color={value}
      on
      label={`${what} colour`}
      title={value === AUTO ? `${what} colour: automatic (${auto})` : `${what} colour`}
      onPick={(c) => update({ [field]: c })}
      onAuto={() => update({ [field]: AUTO })}
      autoLabel={`Automatic (${auto})`}
    />
  )
  const px = (field: string, value: number, title: string, min: number, max: number): ReactNode => (
    <div style={{ width: 52, flex: '0 0 auto' }}>
      <NumberInput
        value={value}
        step={field === 'lineWidth' || field === 'curveWidth' ? 0.5 : 1}
        min={min}
        max={max}
        title={title}
        onChange={(v) => update({ [field]: Math.min(max, Math.max(min, Math.round(v * 2) / 2)) })}
      />
    </div>
  )
  const pct = (field: string, value: number, title: string): ReactNode => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: 64, flex: '0 0 auto' }}>
      <NumberInput
        value={Math.round(value * 100)}
        step={10}
        min={5}
        max={100}
        title={title}
        onChange={(v) => update({ [field]: Math.min(100, Math.max(5, Math.round(v))) / 100 })}
      />
      <span style={{ color: UI.textMuted, fontSize: 12 }}>%</span>
    </div>
  )
  return (
    <PlotSections
      show={
        <Section title={responseLabel([px0, py0])}>
          <Field label="view" aside={<QuickToggle config={config} field="dim" update={update} />}>
            <ToggleSwitch
              label="View"
              value={dim}
              options={[
                { value: '2d', label: '2D' },
                { value: '3d', label: '3D' }
              ]}
              onChange={(v) => update({ dim: v })}
            />
          </Field>
          <Field label="show" aside={<QuickToggle config={config} field="show" update={update} />}>
            {/* A dropdown, not a switch: three options don't fit the field. The one the view can't
                draw is greyed, its label saying which view it needs. */}
            <Select
              value={show}
              options={(['line', 'surface', 'heatmap'] as const).map((v) => {
                const off = !!responseShowWhy(dim, v)
                return {
                  value: v,
                  label: off ? `${v} (${v === 'surface' ? '3D' : '2D'} only)` : v,
                  disabled: off
                }
              })}
              onChange={(v) => update({ show: v as ResponseConfig['show'] })}
            />
          </Field>
          {sliceable && (
            <Field
              label="curve"
              aside={<QuickToggle config={config} field="slice" update={update} />}
            >
              {/* named by the curves drawn: dose curves (a slice at each time) or time curves */}
              <ToggleSwitch
                label="Curve"
                value={CURVE_OF_SLICE[slice]}
                options={[
                  { value: 'dose', label: condLabel(px0) },
                  { value: 'time', label: condLabel(py0) }
                ]}
                onChange={(v) => update({ slice: SLICE_OF_CURVE[v] })}
              />
            </Field>
          )}
          {/* Perspective draws the far side smaller; orthographic keeps parallels parallel, so a
                level lines up with its tick across the box. */}
          {dim === '3d' && (
            <Field
              label="projection"
              aside={
                <QuickToggle
                  config={config}
                  field="projection"
                  update={update}
                  kind={measured ? 'tdr' : 'response'}
                />
              }
            >
              <Select
                value={config.projection ?? 'orthographic'}
                options={[
                  { value: 'orthographic', label: 'orthographic' },
                  { value: 'perspective', label: 'perspective' }
                ]}
                onChange={(v) => update({ projection: v as ResponseConfig['projection'] })}
              />
            </Field>
          )}
          {/* The value axis per gene, or across every gene in the facet. */}
          <Field
            label="axis scale"
            aside={<QuickToggle config={config} field="yScale" update={update} />}
          >
            <Select
              value={config.yScale ?? 'gene'}
              onChange={(v) => update({ yScale: v as TdrConfig['yScale'] })}
              options={[
                { value: 'gene', label: 'adjusted (each gene’s own range)' },
                { value: 'global', label: 'global (all genes in the facet)' }
              ]}
            />
          </Field>
          <div style={styles.hint}>
            {measured
              ? show === 'line'
                ? dim === '3d'
                  ? slice === 'dose'
                    ? 'Each dose’s time curve through its measured log₂FC, drawn at its dose in dose × time × effect.'
                    : 'Each time point’s dose curve through its measured log₂FC, drawn at its time in dose × time × effect.'
                  : 'Each time point’s dose curve through its measured log₂FC, coloured early → late.'
                : show === 'surface'
                  ? 'The measured log₂FC, joined by straight lines across dose and time.'
                  : 'The measured log₂FC over dose × time.'
              : show === 'line'
                ? dim === '3d'
                  ? joint
                    ? slice === 'dose'
                      ? 'Slices of the joint model at each dose: its time curves.'
                      : 'Slices of the joint model at each time: its dose curves.'
                    : slice === 'dose'
                      ? 'Each dose’s 4PL time curve, drawn at its dose in dose × time × effect.'
                      : 'Each time’s 4PL dose curve, drawn at its time in dose × time × effect.'
                  : 'Each time point’s dose curve, coloured early → late.'
                : show === 'surface'
                  ? joint
                    ? 'The joint model over dose × time, with the measured means.'
                    : slice === 'dose'
                      ? 'Each dose’s 4PL time curve, joined across doses, with the measured means.'
                      : 'Each time’s 4PL dose curve, joined across times, with the measured means.'
                  : 'The measured effect over dose × time.'}
          </div>
        </Section>
      }
      marks={
        <Section
          title="Style"
          subtitle={
            custom ? (
              <button
                style={styles.resetBtn}
                onClick={() =>
                  update(Object.fromEntries(RESPONSE_LOOK_FIELDS.map((f) => [f, undefined])))
                }
                title="Restore the default look"
              >
                Reset
              </button>
            ) : null
          }
        >
          {lines && (
            <Field label="line">
              <div style={row}>
                {color(
                  'lineColor',
                  look.lineColor,
                  'Line',
                  `one per ${condLabel(linesPer)}, along the line palette`
                )}
                {px('lineWidth', look.lineWidth, 'Line width (px)', 0.5, 8)}
                {pct('lineOpacity', look.lineOpacity, 'Line opacity (%)')}
              </div>
            </Field>
          )}
          {/* The palette the automatic line colours run along, low → high (early → late). */}
          {lines && look.lineColor === AUTO && (
            <Field label="line palette">
              <PanelPaletteSelect
                value={look.linePalette}
                onChange={(v) => update({ linePalette: v, linePaletteReverse: undefined })}
                auto={{
                  palette: lineRole,
                  label: `${paletteLabel(lineRole)} (${condLabel(linesPer)})`
                }}
              />
            </Field>
          )}
          {show !== 'heatmap' && (
            <Field label="points">
              <div style={row}>
                <OnOffSwitch
                  on={look.points}
                  label="Points"
                  title={
                    measured ? 'The replicates behind each fold change' : 'The measured level means'
                  }
                  onChange={(v) => update({ points: v })}
                />
                {look.points && (
                  <>
                    {color(
                      'pointColor',
                      look.pointColor,
                      'Point',
                      show === 'surface' ? 'by log₂, on the FC palette' : 'the line colour'
                    )}
                    {/* its own size in each view: the 3-D scene's points read smaller */}
                    {px(
                      dim === '3d' ? 'pointSize3d' : 'pointSize',
                      (dim === '3d' ? look.pointSize3d : look.pointSize) ?? (dim === '3d' ? 3 : 7),
                      `Point size in ${dim === '3d' ? '3D' : '2D'} (px)`,
                      1,
                      16
                    )}
                    {pct('pointOpacity', look.pointOpacity, 'Point opacity (%)')}
                  </>
                )}
              </div>
            </Field>
          )}
          {/* The measured values' error, as the Dose/time-response plot's focused view draws it. */}
          {measured && lines && (
            <Field label="error">
              <div style={row}>
                <OnOffSwitch
                  on={look.errors}
                  label="Error"
                  title="The fold change's standard error"
                  onChange={(v) => update({ errors: v })}
                />
                {look.errors && (
                  <>
                    <div style={{ width: 92, flex: '0 0 auto' }}>
                      <Select
                        value={look.errorStyle}
                        onChange={(v) => update({ errorStyle: v as TdrConfig['errorStyle'] })}
                        options={[
                          { value: 'whisker', label: 'whisker' },
                          { value: 'band', label: 'band' }
                        ]}
                      />
                    </div>
                    {color('errorColor', look.errorColor, 'Error', 'the line colour')}
                    {pct('errorOpacity', look.errorOpacity, 'Error opacity (%)')}
                  </>
                )}
              </div>
            </Field>
          )}
          {show === 'surface' && (
            <Field label="surface">
              <div style={row}>
                {pct('surfaceOpacity', look.surfaceOpacity, 'Surface opacity (%)')}
              </div>
            </Field>
          )}
          {show === 'surface' && (
            <Field label="curves">
              <div style={row}>
                <OnOffSwitch
                  on={look.curves}
                  label="Curves"
                  title="The surface's curves traced on it: a dose curve at each time, a time curve at each dose"
                  onChange={(v) => update({ curves: v })}
                />
                {look.curves && (
                  <>
                    {color('curveColor', look.curveColor, 'Curve', 'the text colour')}
                    {px('curveWidth', look.curveWidth, 'Curve width (px)', 0.5, 8)}
                    {pct('curveOpacity', look.curveOpacity, 'Curve opacity (%)')}
                  </>
                )}
              </div>
            </Field>
          )}
          {valueScale && (
            <Field label="FC palette">
              <PanelPaletteSelect
                value={look.valuePalette}
                onChange={(v) => update({ fcPalette: v, colorScale: undefined })}
                auto={autoOf(globalFc)}
              />
            </Field>
          )}
        </Section>
      }
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <ResponsePanel config={config as ResponseConfig} {...props} />
}
