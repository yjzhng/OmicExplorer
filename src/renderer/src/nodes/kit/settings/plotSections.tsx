import { useStore } from '@xyflow/react'
import { type CSSProperties, Fragment, type ReactNode, useContext, useState } from 'react'
import {
  type ConditionKey,
  type NumericConds,
  condLabel,
  isNumericCond,
  orderConds
} from '../../../engine'
import type {
  AxisStyle,
  EffectColors,
  GroupStyle,
  HighlightStyle,
  LegendConfig,
  LineStyle,
  PlotAxes,
  PlotEffectColors,
  PointStyle
} from '../../../graph/config/plotStyle'
import { type DRConfig, drLook } from '../../../graph/config/dr'
import { AUTO, CLEAR } from '../../../ui/color/ColorPicker'
import {
  type CategoricalId,
  type PaletteRole,
  categoricalIds,
  type PaletteRef,
  toCategoricalId,
  toPaletteRef
} from '../../../ui/color/palettes'
import { CategoricalLabel, PaletteSelect } from '../../../ui/color/PaletteSelect'
import { type AxisDefaults, AXIS_LINE_WIDTH } from '../../../ui/plot/plotAxes'
import {
  type PointPlotKind,
  type ResolvedGroup,
  defaultGroups,
  resolveGroup
} from '../../../ui/plot/pointStyle'
import { guideLook, PALETTES, PLOT_TEXT, UI } from '../../../ui/app/theme'
import { OpacitySlider } from '../../../ui/controls/OpacitySlider'
import { OnOffSwitch } from '../../../ui/controls/ToggleSwitch'
import { useAppSettings, useRolePalette } from '../../../ui/app/useAppSettings'
import { useUiTheme } from '../../../ui/app/useUiTheme'
import { ValueMultiSelect } from '../../../ui/controls/ValueMultiSelect'
import {
  ColorChip,
  EffectLabelInput,
  Field,
  MarkerPreview,
  NumberInput,
  Section,
  Select,
  SizeBox
} from './controls'
import { PlotWindow, ScreenScale } from './hooks'
import {
  autoOf,
  DR_LOOK_FIELDS,
  legendShown,
  useCategoricalInk,
  useEffectColors,
  useEffectNames
} from './plotHooks'
import { styles } from './styles'

/**
 * A plot's settings, in the one order every plot's settings window follows — upstream before
 * downstream, whole plot before its parts (nodes/README.md › A plot's settings):
 *   Statistic (what's computed: the upstream step's, written there, or the plot's own analysis)
 *   → General (the whole plot: what it shows, its legend, its colours) → Ranking (the finite set
 *   it focuses on — genes drawn, genes labelled, terms, features — and the metric ranking them)
 *   → its Points / Lines / Bars (each group's look) → Axes and lines (per axis, then the whole
 *   plot's rows).
 * General and Ranking are this component's sections: the plot hands General rows (`general`, then
 * `colours` — palettes last; the window adds the legend switch between them, PlotWindow, from the
 * spec's `legend` fact) and Ranking its rows (`ranking`). Axes and lines is the window's too; the plot
 * hands its whole-plot axis rows (an axis scale, a reference line) to `axes`. Each plot's Settings
 * fills the slots it has; the order is this component's, not each file's (architecture.test.ts
 * checks every plot goes through it).
 */
export function PlotSections({
  statistic,
  general,
  colours,
  ranking,
  marks,
  axes
}: {
  /** what's computed before it's drawn: the upstream step's statistic (written to that step), or
   *  the plot's own analysis (a PCA's data preparation, a heatmap's clustering) — sections */
  statistic?: ReactNode
  /** General's first rows: what the plot draws (view, metric, ordering) */
  general?: ReactNode
  /** General's colour rows: palettes and colours (ColourRows, CategoricalRows, …) */
  colours?: ReactNode
  /** the Ranking section's rows: the finite set the plot focuses on and what ranks it — the metric
   *  (a bubble's rank), then the cap (a CapRow: Max genes, Label limit, Max terms) */
  ranking?: ReactNode
  /** how points / lines / bars are drawn: a Points / Lines / Bars section */
  marks?: ReactNode
  /** whole-plot rows for the Axes and lines section (an axis scale, a reference line) */
  axes?: ReactNode
}): ReactNode {
  const win = useContext(PlotWindow)
  return (
    <>
      {statistic}
      {(general || colours || win.legend) && (
        <Section title="General">
          {general}
          {win.legend}
          {colours}
        </Section>
      )}
      {ranking && <Section title="Ranking">{ranking}</Section>}
      {marks}
      {win.axes?.(axes)}
    </>
  )
}
/** General's plot-wide legend switch: off hides the legend and the colour scale bars. Every plot
 *  with a legend has it (the point plots' per-group entries stay in their Points table). A point
 *  plot from before this switch kept it in `style.legend`: still read, and cleared when the switch
 *  is used, so one switch decides. */
export function LegendRow({
  config,
  update
}: {
  config: LegendConfig & { style?: PointStyle }
  update: (patch: Record<string, unknown>) => void
}): ReactNode {
  const style = config.style
  return (
    <Field label="show legend">
      <OnOffSwitch
        on={legendShown(config)}
        label="Show legend"
        // unset = shown, so switching back on clears the field
        onChange={(on) =>
          update({
            legend: on ? undefined : false,
            ...(style?.legend !== undefined ? { style: { ...style, legend: undefined } } : null)
          })
        }
      />
    </Field>
  )
}
/** Common props for every plotting panel. `update` is already bound to the right
 *  target (a node's config, or a subcard's config inside a group). `edgeNodeId` is the
 *  id whose incoming edge points at the plot's upstream — the plot node itself, or the
 *  group node for a subcard (a subcard has no edge of its own). */
export interface PlotPanelProps<C> {
  config: C
  update: (patch: Record<string, unknown>) => void
  edgeNodeId: string
}
/** The look sections shared by the point plots (volcano / MA / scatter): the legend — one row per
 *  point group (colour, size, opacity, label switch) plus its show/hide switch — and the highlight
 *  look (selected / hovered emphasis and the dim of everything else). Only what the user changes is written to
 *  `config.style`; each section's Reset drops its overrides so the plot's defaults show through. */
export function PointStyleSections({
  kind,
  names,
  colors,
  style,
  update,
  legend = true,
  selection = true
}: {
  kind: PointPlotKind
  names: { up: string; down: string; none?: string }
  /** the upstream's effect colours — what a group's automatic colour follows */
  colors?: EffectColors
  style: PointStyle | undefined
  update: (patch: Record<string, unknown>) => void
  /** the plot's legend is shown (legendShown) — each group's entry switch only works while it is */
  legend?: boolean
  /** the points are genes, so the gene selection applies: the label switch and the selected /
   *  not-selected looks (off for a plot of samples) */
  selection?: boolean
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const ink = PALETTES[mode].text
  const defaults = defaultGroups(kind, names, colors)
  const groups = defaults.map((d) => resolveGroup(style, d))
  // the states the preview shows: plain, and — where the points are genes — selected / not
  const states = selection ? (['plain', 'selected', 'faded'] as const) : (['plain'] as const)
  /** A group's colour as its chip shows it: what the user picked (or cleared), else Automatic. */
  // Where a group's automatic colour comes from: an effect group follows the plot's FC palette
  // (General).
  const autoSource = (key: string): string =>
    key === 'up' || key === 'down' || key === 'none' ? 'from the FC palette' : "the plot's default"
  const chipColor = (key: string): string => {
    const c = style?.groups?.[key]?.color
    return c && c !== AUTO ? c : AUTO
  }
  const labelChip = (key: string): string => {
    const c = style?.groups?.[key]?.labelColor
    return c && c !== AUTO ? c : AUTO
  }
  /** A group's emphasised marker size: the explicit one, else its own size plus the bump. */
  const hlSize = (g: ResolvedGroup): number => g.highlight.size ?? g.size + g.highlight.bump
  // One template for every block below, so their columns line up under the group they belong to.
  const gridCols: CSSProperties = {
    ...styles.groupGrid,
    gridTemplateColumns: `64px repeat(${groups.length}, minmax(72px, 1fr))`
  }
  const setStyle = (patch: Partial<PointStyle>): void => update({ style: { ...style, ...patch } })
  const setGroup = (key: string, patch: GroupStyle): void =>
    setStyle({ groups: { ...style?.groups, [key]: { ...style?.groups?.[key], ...patch } } })
  const setGroupHl = (key: string, patch: HighlightStyle): void =>
    setGroup(key, { highlight: { ...style?.groups?.[key]?.highlight, ...patch } })
  // A section's Reset drops only ITS fields from every group (Points: the look; Legend: the
  // per-group entry switch), leaving the other section's overrides alone.
  const hasGroupField = (fields: (keyof GroupStyle)[]): boolean =>
    Object.values(style?.groups ?? {}).some((g) => fields.some((f) => g?.[f] !== undefined)) ||
    (fields.includes('highlight') && !!style?.highlight)
  const withoutGroupFields = (fields: (keyof GroupStyle)[]): PointStyle['groups'] => {
    const next: Record<string, GroupStyle> = {}
    for (const [key, g] of Object.entries(style?.groups ?? {})) {
      const kept = { ...g }
      for (const f of fields) delete kept[f]
      if (Object.keys(kept).length) next[key] = kept
    }
    return Object.keys(next).length ? next : undefined
  }
  const LOOK_FIELDS: (keyof GroupStyle)[] = [
    'name',
    'size',
    'opacity',
    'color',
    'label',
    'labelColor',
    'labelSize',
    'highlight'
  ]
  const reset = (label: string, onClick: () => void): ReactNode => (
    <button style={styles.resetBtn} onClick={onClick} title={`Restore the default ${label}`}>
      Reset
    </button>
  )
  // Opacity as the app's slider (fading to the group's own colour); pixel sizes as value boxes
  // over a plot-sensible range.
  const opacity = (
    label: string,
    color: string,
    value: number,
    onChange: (v: number) => void
  ): ReactNode => (
    <OpacitySlider compact label={label} color={color} value={value} onChange={onChange} />
  )
  const px = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    min: number,
    max: number,
    /** sharing its cell with a swatch or a switch — take only the room they leave */
    tight = false,
    /** the snap step — whole pixels, or 0.5 for a line width (outlines run thin) */
    step = 1
  ): ReactNode => (
    <SizeBox
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
      title={`${label} (px)`}
      tight={tight}
    />
  )
  return (
    <>
      <Section
        title="Points"
        // Reset sits right of the title (the subtitle slot). The plot-wide legend switch is
        // General's; the per-group entries are a column of the table below.
        subtitle={
          hasGroupField(LOOK_FIELDS)
            ? reset('point look', () =>
                setStyle({ groups: withoutGroupFields(LOOK_FIELDS), highlight: undefined })
              )
            : null
        }
      >
        {/* One column per group (they share every setting), one row per setting — so a value is
                compared across groups by reading along its row. Scrolls sideways when a plot has many
                groups (a linear cutoff contrast's eight quadrants). */}
        <div style={styles.groupScroll}>
          {/* Every state up front: the settings below all show up here, so a change is judged
                without hunting for the row that drew it. Indented like a sub-block (without its
                rule) so its group columns line up with theirs. */}
          <div style={styles.previewIndent}>
            <div style={gridCols}>
              {/* The name field heads its own column: editing it here names the group everywhere,
              and the preview underneath says which marker it belongs to. */}
              <span style={{ ...styles.rowLabel, gridRow: 1, gridColumn: 1 }}>name</span>
              {groups.map((g, i) => (
                <EffectLabelInput
                  key={g.key}
                  value={g.name}
                  onCommit={(v) => setGroup(g.key, { name: v || undefined })}
                  style={{ ...styles.styleName, gridRow: 1, gridColumn: i + 2 }}
                  title="Legend name for this group on this plot (blank = the upstream tile's name)"
                />
              ))}
              <span style={{ ...styles.rowLabel, gridRow: 2, gridColumn: 1 }}>colour</span>
              {groups.map((g, i) => (
                <ColorChip
                  key={g.key}
                  color={chipColor(g.key)}
                  on={g.color !== CLEAR}
                  label={`${g.name} colour`}
                  title={
                    chipColor(g.key) === AUTO
                      ? `${g.name} colour: automatic (${autoSource(g.key)})`
                      : `${g.name} colour`
                  }
                  clearLabel="No fill (a hollow marker)"
                  onPick={(c) => setGroup(g.key, { color: c })}
                  onClear={() => setGroup(g.key, { color: CLEAR })}
                  onAuto={() => setGroup(g.key, { color: undefined })}
                  autoLabel={`Automatic (${autoSource(g.key)})`}
                  autoColor={g.color}
                  style={{ gridRow: 2, gridColumn: i + 2, width: '100%', flex: '1 1 auto' }}
                />
              ))}
              {/* The group's legend entry — a setting of the group, in every state (it needs the
                  plot's legend on, in General). */}
              <span style={{ ...styles.rowLabel, gridRow: 3, gridColumn: 1 }}>in legend</span>
              {groups.map((g, i) => (
                <div key={g.key} style={{ ...styles.switchCell, gridRow: 3, gridColumn: i + 2 }}>
                  <OnOffSwitch
                    on={g.legend}
                    disabled={!legend}
                    label={`${g.name} legend entry`}
                    onChange={(on) => setGroup(g.key, { legend: on })}
                  />
                </div>
              ))}
              {/* ONE ground behind every marker: a grid item spanning the three state rows and all
              the group columns. Everything in these rows is placed EXPLICITLY — auto-placement
              treats the ground's cells as taken and would flow the markers below it. */}
              <div style={{ ...styles.previewBox, gridRow: `4 / span ${states.length}` }} />
              {states.map((state, r) => (
                <Fragment key={state}>
                  <span style={{ ...styles.rowLabel, gridRow: r + 4, gridColumn: 1 }}>
                    {state === 'faded' ? 'not selected' : state}
                  </span>
                  {groups.map((g, i) => (
                    <MarkerPreview
                      key={g.key}
                      g={g}
                      state={state}
                      ink={ink}
                      style={{ gridRow: r + 4, gridColumn: i + 2 }}
                    />
                  ))}
                </Fragment>
              ))}
            </div>
          </div>

          <div style={{ ...styles.sideTag, marginTop: 12 }}>Plain</div>
          <div style={styles.subGroup}>
            <div style={gridCols}>
              <span style={styles.rowLabel}>size</span>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {px(`${g.name} size`, g.size, (v) => setGroup(g.key, { size: v }), 1, 20)}
                </Fragment>
              ))}

              <span style={styles.rowLabel}>opacity</span>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {opacity(`${g.name}`, g.color, g.opacity, (v) => setGroup(g.key, { opacity: v }))}
                </Fragment>
              ))}

              {/* Marker outline — a thin 0.5px by default (DEFAULT_OUTLINE). */}
              <span style={styles.rowLabel}>outline</span>
              {groups.map((g) => (
                <div key={g.key} style={styles.ringCell}>
                  <ColorChip
                    color={g.outlineColor ?? ink}
                    on={g.outlineColor !== CLEAR}
                    clearLabel="No colour (keeps the width)"
                    label={`${g.name} outline colour`}
                    title={`${g.name} outline colour (default: the theme's text colour)`}
                    onPick={(c) => setGroup(g.key, { outlineColor: c })}
                    onClear={() => setGroup(g.key, { outlineColor: CLEAR })}
                  />
                  {px(
                    `${g.name} outline width`,
                    g.outline,
                    (v) => setGroup(g.key, { outline: v }),
                    0,
                    4,
                    true,
                    0.5
                  )}
                </div>
              ))}

              {selection && (
                <>
                  <span
                    style={styles.rowLabel}
                    title="Offer this group's genes to the auto-label layer"
                  >
                    label
                  </span>
                  {/* Whether its genes are labelled, then the labels' colour (automatic = the
                      group's marker colour) and size — the order the Selected row repeats. */}
                  {groups.map((g) => (
                    <div key={g.key} style={styles.ringCell}>
                      <OnOffSwitch
                        on={g.label}
                        label={`${g.name} labels`}
                        onChange={(on) => setGroup(g.key, { label: on })}
                      />
                      <ColorChip
                        color={labelChip(g.key)}
                        on
                        label={`${g.name} label colour`}
                        title={
                          labelChip(g.key) === AUTO
                            ? `${g.name} label colour: automatic (the group's colour)`
                            : `${g.name} label colour`
                        }
                        onPick={(c) => setGroup(g.key, { labelColor: c })}
                        onAuto={() => setGroup(g.key, { labelColor: undefined })}
                        autoLabel="Automatic (the group's colour)"
                        autoColor={g.color}
                      />
                      {px(
                        `${g.name} label size`,
                        g.labelSize ?? PLOT_TEXT.label,
                        (v) => setGroup(g.key, { labelSize: v }),
                        7,
                        16,
                        true
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* How each group's points look while they ARE the selection. */}
          {selection && <div style={{ ...styles.sideTag, marginTop: 12 }}>Selected</div>}
          {selection && (
            <div style={styles.subGroup}>
              <div style={gridCols}>
                <span style={styles.rowLabel}>size</span>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    {px(
                      `${g.name} selected size`,
                      hlSize(g),
                      (v) => setGroupHl(g.key, { size: v }),
                      1,
                      25
                    )}
                  </Fragment>
                ))}

                <span style={styles.rowLabel}>outline</span>
                {groups.map((g) => (
                  <div key={g.key} style={styles.ringCell}>
                    <ColorChip
                      color={g.highlight.ringColor ?? ink}
                      on={g.highlight.ringColor !== CLEAR}
                      clearLabel="No colour (keeps the width)"
                      label={`${g.name} selected-outline colour`}
                      title={`${g.name} selected-outline colour (default: the theme's text colour)`}
                      onPick={(c) => setGroupHl(g.key, { ringColor: c })}
                      onClear={() => setGroupHl(g.key, { ringColor: CLEAR })}
                    />
                    {px(
                      `${g.name} selected-outline width`,
                      g.highlight.ring,
                      (v) => setGroupHl(g.key, { ring: v }),
                      0,
                      3,
                      true,
                      0.5
                    )}
                  </div>
                ))}

                {/* The selected gene's name: on, its colour (automatic = its point's colour),
                    its size — as the Plain row. */}
                <span style={styles.rowLabel}>label</span>
                {groups.map((g) => {
                  const own = style?.groups?.[g.key]?.highlight?.labelColor
                  const c = own && own !== AUTO ? own : AUTO
                  return (
                    <div key={g.key} style={styles.ringCell}>
                      <OnOffSwitch
                        on={g.highlight.label}
                        label={`Label selected ${g.name} points`}
                        onChange={(on) => setGroupHl(g.key, { label: on })}
                      />
                      <ColorChip
                        color={c}
                        on
                        label={`${g.name} selected label colour`}
                        title={
                          c === AUTO
                            ? `${g.name} selected label colour: automatic (the point's colour)`
                            : `${g.name} selected label colour`
                        }
                        onPick={(v) => setGroupHl(g.key, { labelColor: v })}
                        onAuto={() => setGroupHl(g.key, { labelColor: undefined })}
                        autoLabel="Automatic (the point's colour)"
                        autoColor={g.color}
                      />
                      {px(
                        `${g.name} selected label size`,
                        g.highlight.labelSize,
                        (v) => setGroupHl(g.key, { labelSize: v }),
                        7,
                        16,
                        true
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* How each group fades while something ELSE is selected. */}
          {selection && <div style={{ ...styles.sideTag, marginTop: 12 }}>Not selected</div>}
          {selection && (
            <div style={styles.subGroup}>
              <div style={gridCols}>
                <span style={styles.rowLabel}>opacity</span>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    {opacity(`${g.name} not selected`, g.color, g.highlight.dim, (v) =>
                      setGroupHl(g.key, { dim: v })
                    )}
                  </Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>
    </>
  )
}
/** A DR's pEC50 reference line (a curve fit's): a line across the plot at each curve's EC50 — one
 *  of the plot's whole-plot rows, in Axes and lines. */
export function Ec50LineField({
  config,
  update
}: {
  config: DRConfig
  update: (patch: Record<string, unknown>) => void
}): ReactNode {
  return (
    <Field label="pEC50 line">
      <OnOffSwitch
        on={drLook(config, true).ec50Line}
        label="pEC50 line"
        title="A dotted line at each curve's EC50 (the 4PL's midpoint), within the tested range"
        onChange={(v) => update({ ec50Line: v })}
      />
    </Field>
  )
}
/** A DR's line / points / error look, one row each: an on/off where the element can be hidden,
 *  then — while shown — its colour, size and opacity (the slider), as the gene bar's replicates.
 *  Points and error are drawn only in the gene-by-gene views (focused, detailed, or from a
 *  Contrast), so they're offered only there. An automatic colour is the gene's effect group
 *  (focused, one comparison), one per comparison (focused, several), per gene (global, detailed),
 *  or per side (from a Contrast). */
export function DRStyleSection({
  config,
  update,
  focused,
  detailed,
  fromContrast,
  curveFit,
  texts
}: {
  config: Partial<DRConfig>
  update: (patch: Record<string, unknown>) => void
  focused: boolean
  /** the detailed view: points and error as focused, colours per gene as global */
  detailed: boolean
  fromContrast: boolean
  curveFit: boolean
  /** another plot with the DR's look (the interaction plot): what its automatic line colour is,
   *  and what its points and error are */
  texts?: { autoLine: string; points: string; error: string }
}): ReactNode {
  const look = drLook(config, curveFit)
  const autoLine =
    texts?.autoLine ??
    (fromContrast
      ? 'one per side'
      : focused
        ? 'by effect group; one per comparison when several'
        : 'one per gene')
  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }
  const custom = DR_LOOK_FIELDS.some((f) => config[f] !== undefined)
  // Automatic is a colour per gene / group / comparison here, so its chip shows the colours it
  // picks from, not one of them: the line palette (General) where the lines take a colour each —
  // a gene, a comparison, a side — or, focused on one gene, its effect group's (the FC palette's
  // down → none → up). Another plot with this look (`texts`) keeps the effect colours.
  const effect = useEffectColors(config.fcPalette)
  const categorical = useCategoricalInk(config)
  const byPalette = !texts && (!focused || detailed || fromContrast)
  const autoInk = byPalette
    ? categorical
    : `linear-gradient(135deg, ${effect.down}, ${effect.none}, ${effect.up})`
  // An opacity slider fades to the colour set; Automatic is a palette here, so neutral (unset).
  const inkOf = (value: string): string | undefined => (value !== AUTO ? value : undefined)
  const color = (field: string, value: string, what: string, auto: string): ReactNode => (
    <ColorChip
      color={value}
      on
      label={`${what} colour`}
      title={value === AUTO ? `${what} colour: automatic (${auto})` : `${what} colour`}
      onPick={(c) => update({ [field]: c })}
      onAuto={() => update({ [field]: AUTO })}
      autoLabel={`Automatic (${auto})`}
      autoColor={autoInk}
    />
  )
  const px = (field: string, value: number, title: string, min: number, max: number): ReactNode => (
    <div style={{ width: 52, flex: '0 0 auto' }}>
      <NumberInput
        value={value}
        step={field === 'lineWidth' ? 0.5 : 1}
        min={min}
        max={max}
        title={title}
        onChange={(v) => update({ [field]: Math.min(max, Math.max(min, Math.round(v * 2) / 2)) })}
      />
    </div>
  )
  const pct = (field: string, value: number, what: string, ink: string): ReactNode => (
    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
      <OpacitySlider
        label={what}
        color={inkOf(ink)}
        value={value}
        onChange={(v) => update({ [field]: v })}
      />
    </div>
  )
  return (
    <Section
      title="Lines"
      subtitle={
        custom ? (
          <button
            style={styles.resetBtn}
            onClick={() => update(Object.fromEntries(DR_LOOK_FIELDS.map((f) => [f, undefined])))}
            title="Restore the default line, point and error look"
          >
            Reset
          </button>
        ) : null
      }
    >
      <Field label="line">
        <div style={row}>
          {color('lineColor', look.lineColor, 'Line', autoLine)}
          {px('lineWidth', look.lineWidth, 'Line width (px)', 0.5, 8)}
          {pct('lineOpacity', look.lineOpacity, 'Line', look.lineColor)}
        </div>
      </Field>
      {(focused || detailed) && (
        <>
          <Field label="points">
            <div style={row}>
              <OnOffSwitch
                on={look.points}
                label="Points"
                title={
                  texts?.points ??
                  (fromContrast
                    ? "Each side's replicates behind its line"
                    : curveFit
                      ? 'The measured points the curve was fitted to'
                      : 'The replicates behind each fold change')
                }
                onChange={(v) => update({ points: v })}
              />
              {look.points && (
                <>
                  {color('pointColor', look.pointColor, 'Point', 'the line colour')}
                  {px('pointSize', look.pointSize, 'Point size (px)', 2, 16)}
                  {pct('pointOpacity', look.pointOpacity, 'Point', look.pointColor)}
                </>
              )}
            </div>
          </Field>
          <Field label="error">
            <div style={row}>
              <OnOffSwitch
                on={look.errors}
                label="Error"
                title={
                  texts?.error ??
                  (fromContrast
                    ? "Each side's standard error (its fold change's, or its abundance's)"
                    : curveFit
                      ? 'The fit’s 95% confidence band: where the true curve plausibly lies'
                      : "The fold change's standard error")
                }
                onChange={(v) => update({ errors: v })}
              />
              {look.errors && (
                <>
                  <div style={{ width: 92, flex: '0 0 auto' }}>
                    <Select
                      value={look.errorStyle}
                      onChange={(v) => update({ errorStyle: v as DRConfig['errorStyle'] })}
                      options={[
                        { value: 'whisker', label: 'whisker' },
                        { value: 'band', label: 'band' }
                      ]}
                    />
                  </div>
                  {color('errorColor', look.errorColor, 'Error', 'the line colour')}
                  {pct('errorOpacity', look.errorOpacity, 'Error', look.errorColor)}
                </>
              )}
            </div>
          </Field>
        </>
      )}
      {!focused && !detailed && (
        <div style={styles.hint}>
          Styles the coloured curves; points and error show in the detailed and focused views.
        </div>
      )}
    </Section>
  )
}
/** A fold-change plot's colour rows (in General): its palette (Automatic = the global one, Settings → Customisation) —
 *  the continuous scale, and what the up / down / none colours are sampled from — and, where the
 *  plot draws those groups without point styles to carry them (enrichment's bars), the groups'
 *  own colours: Automatic by default (from the palette), or the plot's own. */
export function ColourRows({
  config,
  update,
  edgeNodeId,
  groups = false,
  hint,
  role = 'fcObject',
  paletteLabel = 'FC palette',
  groupsLabel = 'groups',
  noneDrawn = true,
  children
}: PlotPanelProps<{ effectColors?: PlotEffectColors; fcPalette?: PaletteRef }> & {
  /** the plot's other colour settings, under the palette and any group colours (a heatmap's
   *  module palettes, enrichment's categories) */
  children?: ReactNode
  /** offer the up / down / none colours too */
  groups?: boolean
  /** the palette row's name, where it isn't a fold-change scale (enrichment: an effect palette —
   *  its up / down can be an NES's sign) */
  paletteLabel?: string
  /** the up / down / none row's name */
  groupsLabel?: string
  /** false: the plot as set draws no "none" colour — its chip is greyed */
  noneDrawn?: boolean
  /** the palette role Automatic follows (default: fold change on objects) */
  role?: PaletteRole
  /** a line under the palette, when it needs saying what it colours */
  hint?: string
}): ReactNode {
  const names = useEffectNames(edgeNodeId)
  const rolePalette = useRolePalette(role)
  const inherited = useEffectColors(config.fcPalette)
  const own = config.effectColors
  const chip = (k: 'up' | 'down' | 'none'): ReactNode => {
    const c = own?.[k]
    const set = c && c !== AUTO ? c : AUTO
    return (
      <ColorChip
        color={set}
        on
        label={`${names[k]} colour`}
        title={
          set === AUTO
            ? `${names[k]} colour: automatic (${inherited[k]}, from the palette)`
            : `${names[k]} colour`
        }
        onPick={(v) => update({ effectColors: { ...own, [k]: v } })}
        onAuto={() => update({ effectColors: { ...own, [k]: undefined } })}
        autoLabel="Automatic (from the palette)"
        autoColor={inherited[k]}
      />
    )
  }
  return (
    <>
      <Field label={paletteLabel}>
        <PanelPaletteSelect
          value={toPaletteRef(config.fcPalette)}
          onChange={(v) => update({ fcPalette: v })}
          auto={autoOf(rolePalette)}
        />
      </Field>
      {hint && <div style={styles.hint}>{hint}</div>}
      {groups && (
        <Field label={groupsLabel}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={styles.inlineTag}>{names.up}</span>
            {chip('up')}
            <span style={{ ...styles.inlineTag, marginLeft: 6 }}>{names.down}</span>
            {chip('down')}
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                ...(noneDrawn ? null : { opacity: 0.4, pointerEvents: 'none' })
              }}
            >
              <span style={{ ...styles.inlineTag, marginLeft: 6 }}>{names.none}</span>
              {chip('none')}
            </span>
          </div>
        </Field>
      )}
      {children}
    </>
  )
}
/** A plot's colour rows (in General) with a categorical palette (QC, cluster, bar): what it colours by (the
 *  plot's own fields, as children), then the palette — Automatic = the global one (Settings →
 *  Customisation), or its own. */
export function CategoricalRows({
  config,
  update,
  children
}: Pick<PlotPanelProps<{ categorical?: CategoricalId }>, 'config' | 'update'> & {
  /** the plot's other colour settings (what it colours by, …), above the palette */
  children?: ReactNode
}): ReactNode {
  return (
    <>
      {children}
      <Field label="palette">
        <CategoricalSelect config={config} update={update} />
      </Field>
    </>
  )
}
/** The categorical palette picker itself (the plot's `categorical`, or another `field`):
 *  Automatic = the global one. */
export function CategoricalSelect({
  config,
  update,
  field = 'categorical'
}: Pick<PlotPanelProps<Record<string, unknown>>, 'config' | 'update'> & {
  field?: string
}): ReactNode {
  const global = useAppSettings((s) => s.categorical)
  const own = toCategoricalId(config[field])
  return (
    <Select
      value={own ?? AUTO}
      onChange={(v) => update({ [field]: v === AUTO ? undefined : v })}
      options={[
        {
          value: AUTO,
          label: `auto · ${global}`,
          render: <CategoricalLabel id={global} name={`auto · ${global}`} />
        },
        ...categoricalIds().map((id) => ({
          value: id,
          label: id,
          render: <CategoricalLabel id={id} />
        }))
      ]}
    />
  )
}
/** One axis decoration (gridlines, zero line): show it, how it's stroked, how thick. The style
 *  and width only appear while it's shown — they'd configure nothing otherwise. */
export function LineRow({
  label,
  on,
  onShow,
  style,
  onStyle,
  width,
  onWidth,
  locked,
  disabled
}: {
  label: string
  /** the line can't be switched or restyled, only its width set (a cluster's minimal axes) */
  locked?: boolean
  /** the whole row greyed: the plot doesn't draw this line at all */
  disabled?: boolean
  on: boolean
  onShow: (on: boolean) => void
  /** omitted where Plotly offers no dash for that line (the axis line itself) */
  style?: LineStyle
  onStyle?: (v: LineStyle) => void
  width: number
  onWidth: (v: number) => void
}): ReactNode {
  // The style and width controls stay in place when the line is off — greyed rather than gone, so
  // the row keeps its shape and the settings don't appear to come and go with the switch.
  return (
    <Field label={label} top>
      <div style={styles.lineRow}>
        <OnOffSwitch on={on} label={label} onChange={onShow} disabled={locked || disabled} />
        {style && onStyle && (
          <LineStyleChoice value={style} onChange={onStyle} disabled={locked || disabled || !on} />
        )}
        <div style={styles.lineWidth}>
          <SizeBox
            value={width}
            min={0.5}
            max={4}
            step={0.5}
            disabled={disabled || (!locked && !on)}
            title={`${label} width (px)`}
            onChange={onWidth}
          />
        </div>
      </div>
    </Field>
  )
}
/** A sample of the stroke itself — what a line-style option looks like when drawn. */
export function LineSwatch({ dash }: { dash?: string }): ReactNode {
  return (
    <svg width="34" height="10" aria-hidden style={{ display: 'block' }}>
      <line
        x1="1"
        y1="5"
        x2="33"
        y2="5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        {...(dash ? { strokeDasharray: dash } : null)}
      />
    </svg>
  )
}
/** Line-style picker: the app's dropdown, with each option drawn as the line it produces rather
 *  than named — a sample of the stroke reads faster than the word for it. */
export function LineStyleChoice({
  value,
  onChange,
  disabled
}: {
  value: LineStyle
  onChange: (v: LineStyle) => void
  disabled?: boolean
}): ReactNode {
  return (
    <div style={styles.lineChoice}>
      <Select
        value={value}
        disabled={disabled}
        onChange={(v) => onChange(v as LineStyle)}
        options={[
          { value: 'solid', label: 'Solid', render: <LineSwatch /> },
          { value: 'dash', label: 'Dashed', render: <LineSwatch dash="5 3" /> },
          { value: 'dot', label: 'Dotted', render: <LineSwatch dash="1.5 3" /> }
        ]}
      />
    </div>
  )
}
/** Axis settings shared by every Plotly plot: one axis at a time (X | Y tabs) — title, title and
 *  tick font sizes, a fixed range, tick placement and count, gridlines, the axis line's thickness,
 *  a mirrored frame and the zero line. Everything unset falls through to the view's own layout;
 *  Reset drops the shown axis's overrides. Applied in PlotlyChart via PlotAxesContext. */
export function AxesSection({
  config,
  update,
  defaults,
  minimal = false,
  guides,
  plotRows
}: {
  config: { axes?: PlotAxes }
  update: (patch: Record<string, unknown>) => void
  /** the plot's own whole-plot rows (an axis scale, a reference line), in the Whole plot group */
  plotRows?: ReactNode
  /** the plot draws threshold / reference guide lines (spec `guides`): their look (`style`'s
   *  guideShow / guideStyle / guideWidth) and how to change it — a row like every other line's,
   *  but in a group of its own below the X | Y ones, since the lines (cutoffs, curves) belong to
   *  the plot, not to one axis */
  guides?: { style: PointStyle | undefined; set: (patch: Partial<PointStyle>) => void }
  /** a cluster's minimal axes: only the title size and the axis line's width apply, so every other
   *  field is greyed (its value kept for when the axes go back to standard) */
  minimal?: boolean
  /** the live plot's own title/range per axis — shown as each field's placeholder, so "unset"
   *  reads as the value actually in use rather than a blank or the word "auto". */
  defaults?: AxisDefaults
}): ReactNode {
  const [which, setWhich] = useState<'x' | 'y'>('x')
  const st: AxisStyle = config.axes?.[which] ?? {}
  const def = defaults?.[which] ?? {}
  // Ranges read long by default (−3.0179…) — a placeholder is a hint, so round it.
  const round = (v: number | undefined): string | undefined =>
    v == null ? undefined : String(Math.round(v * 100) / 100)
  const set = (patch: Partial<AxisStyle>): void => {
    const next: AxisStyle = { ...st, ...patch }
    for (const k of Object.keys(next) as (keyof AxisStyle)[])
      if (next[k] === undefined) delete next[k]
    update({ axes: { ...config.axes, [which]: Object.keys(next).length ? next : undefined } })
  }
  const hasAny = Object.keys(st).length > 0
  return (
    <Section
      title="Axes and lines"
      subtitle={
        hasAny ? (
          <button
            style={styles.resetBtn}
            onClick={() => update({ axes: { ...config.axes, [which]: undefined } })}
            title={`Restore the ${which} axis defaults`}
          >
            Reset
          </button>
        ) : null
      }
      // Which axis the settings below belong to — in line with the heading, since it switches the
      // whole section rather than setting anything itself. A dot marks a customised axis.
      action={
        <div style={styles.axisPill} role="radiogroup" aria-label="Axis">
          {(['x', 'y'] as const).map((k) => {
            const on = which === k
            const dirty = Object.keys(config.axes?.[k] ?? {}).length > 0
            return (
              <button
                key={k}
                role="radio"
                aria-checked={on}
                onClick={() => setWhich(k)}
                title={dirty ? `${k} axis (customised)` : `${k} axis`}
                style={{
                  ...styles.axisPillBtn,
                  background: on ? UI.accent : 'transparent',
                  color: on ? UI.accentText : dirty ? UI.text : UI.textMuted
                }}
              >
                {k.toUpperCase()}
                {dirty ? ' •' : ''}
              </button>
            )
          })}
        </div>
      }
    >
      <div style={styles.sideTag}>Title</div>
      <div style={styles.subGroup}>
        <Field label="Text">
          <EffectLabelInput
            value={st.title ?? ''}
            onCommit={(v) => set({ title: v || undefined })}
            style={{ minWidth: 0, width: '100%' }}
            placeholder={def.title ?? "the plot's own"}
            title="Axis title (blank = the plot's own)"
            disabled={minimal}
          />
        </Field>
        <Field label="Size">
          <div style={styles.cutoffRow}>
            <SizeBox
              value={st.titleSize ?? 12}
              min={8}
              max={18}
              title="Title font size (px)"
              onChange={(v) => set({ titleSize: v })}
            />
          </div>
        </Field>
      </div>

      <div style={{ ...styles.sideTag, marginTop: 10 }}>Scale</div>
      <div style={styles.subGroup}>
        <Field label="Range">
          <div style={styles.cutoffRow}>
            <div style={styles.cutoffBox}>
              <NumberInput
                optional
                value={st.min}
                placeholder={round(def.min) ?? 'auto'}
                title="Lower bound (blank = the plot's own)"
                disabled={minimal}
                onChange={(v) => set({ min: v })}
              />
            </div>
            <span style={styles.inlineTag}>to</span>
            <div style={styles.cutoffBox}>
              <NumberInput
                optional
                value={st.max}
                placeholder={round(def.max) ?? 'auto'}
                title="Upper bound (blank = the plot's own)"
                disabled={minimal}
                onChange={(v) => set({ max: v })}
              />
            </div>
          </div>
        </Field>
        <Field label="Ticks">
          <div style={styles.cutoffRow}>
            <Select
              value={st.ticks ?? 'auto'}
              disabled={minimal}
              onChange={(v) => set({ ticks: v === 'auto' ? undefined : (v as AxisStyle['ticks']) })}
              options={[
                { value: 'auto', label: 'default' },
                { value: 'outside', label: 'outside' },
                { value: 'inside', label: 'inside' },
                { value: 'none', label: 'none' }
              ]}
            />
            <span style={{ ...styles.inlineTag, marginLeft: 6 }}>every</span>
            <div style={styles.pctBox}>
              <NumberInput
                optional
                value={st.interval}
                placeholder="auto"
                title="Tick spacing in the axis's own units (blank = automatic spacing)"
                disabled={minimal}
                onChange={(v) => set({ interval: v && v > 0 ? v : undefined })}
              />
            </div>
          </div>
        </Field>
        <Field label="Labels">
          {/* The size sits with its switch, as in the point plots' label row. */}
          <div style={styles.cutoffRow}>
            <OnOffSwitch
              on={st.tickLabels ?? true}
              label="Tick labels"
              onChange={(on) => set({ tickLabels: on })}
              disabled={minimal}
            />
            {(st.tickLabels ?? true) && (
              <SizeBox
                value={st.tickSize ?? 12}
                min={8}
                max={18}
                title="Tick label font size (px)"
                disabled={minimal}
                onChange={(v) => set({ tickSize: v })}
              />
            )}
          </div>
        </Field>
      </div>

      <div style={{ ...styles.sideTag, marginTop: 10 }}>Lines</div>
      <div style={styles.subGroup}>
        <LineRow
          label="Axis line"
          locked={minimal}
          on={minimal || (st.lineWidth != null ? st.lineWidth > 0 : (def.line ?? true))}
          onShow={(on) => set({ lineWidth: on ? st.lineWidth || AXIS_LINE_WIDTH : 0 })}
          style={st.lineStyle ?? 'solid'}
          onStyle={(v) => set({ lineStyle: v === 'solid' ? undefined : v })}
          // "off" is stored as width 0, so fall back to the default — the greyed box shows the
          // width the line would come back at, not a 0 that sits below the box's own minimum.
          width={st.lineWidth || AXIS_LINE_WIDTH}
          onWidth={(v) => set({ lineWidth: v })}
        />
        <LineRow
          label="Frame"
          disabled={minimal}
          on={st.mirror ?? def.frame ?? true}
          onShow={(on) => set({ mirror: on })}
          style={st.frameStyle ?? 'solid'}
          onStyle={(v) => set({ frameStyle: v === 'solid' ? undefined : v })}
          width={st.frameWidth ?? (st.lineWidth || AXIS_LINE_WIDTH)}
          onWidth={(v) => set({ frameWidth: v })}
        />
        <LineRow
          label="Gridlines"
          disabled={minimal}
          on={st.grid ?? def.grid ?? false}
          onShow={(on) => set({ grid: on })}
          style={st.gridStyle ?? 'solid'}
          onStyle={(v) => set({ gridStyle: v === 'solid' ? undefined : v })}
          width={st.gridWidth ?? AXIS_LINE_WIDTH}
          onWidth={(v) => set({ gridWidth: v })}
        />
        <LineRow
          label="Zero line"
          disabled={minimal}
          on={st.zeroline ?? def.zeroline ?? true}
          onShow={(on) => set({ zeroline: on })}
          style={st.zerolineStyle ?? 'solid'}
          onStyle={(v) => set({ zerolineStyle: v === 'solid' ? undefined : v })}
          width={st.zerolineWidth ?? 1}
          onWidth={(v) => set({ zerolineWidth: v })}
        />
      </div>
      {/* The whole plot's rows — not switched with X | Y: its own (an axis scale, a reference line)
          and the threshold lines (cutoffs and curves across both axes). */}
      {(guides || plotRows) && (
        <>
          <div style={{ ...styles.sideTag, marginTop: 10 }}>Whole plot</div>
          <div style={styles.subGroup}>
            {plotRows}
            {guides && <ThresholdLineRow guides={guides} />}
          </div>
        </>
      )}
    </Section>
  )
}
/** The threshold lines' row: shown / style / width, as every other line (guideLook). */
function ThresholdLineRow({
  guides
}: {
  guides: { style: PointStyle | undefined; set: (patch: Partial<PointStyle>) => void }
}): ReactNode {
  const look = guideLook(guides.style)
  return (
    <LineRow
      label="Threshold lines"
      on={look.show}
      onShow={(on) => guides.set({ guideShow: on ? undefined : false })}
      style={look.dash}
      onStyle={(v) => guides.set({ guideStyle: v === 'dash' ? undefined : v })}
      width={look.width}
      onWidth={(v) => guides.set({ guideWidth: v })}
    />
  )
}
/** Axes and lines for a plot with no axes of its own to set (a 3-D view): only its whole-plot
 *  rows. */
export function PlotRowsSection({ children }: { children: ReactNode }): ReactNode {
  return (
    <Section title="Axes and lines">
      <div style={styles.subGroup}>{children}</div>
    </Section>
  )
}
/** Colour by condition's picks (gene bar, QC, cluster), indented under the colour-by — the
 *  user's choice as made, nothing inferred from the conditions' types: `colour`, the conditions the
 *  colours stand for (several: every combination its own colour; at least one), and `fade`, one
 *  numeric condition at most shading them light = low → dark = high (an ordered channel, so
 *  numeric only); a condition already on colour is greyed there. In the default condition order. */
export function ColorFadeFields({
  active,
  numeric,
  picks,
  fade,
  onChange
}: {
  /** the conditions the upstream data carries */
  active: readonly ConditionKey[]
  /** of those, the numeric ones (the data's schema): what the fade can take */
  numeric: NumericConds
  picks: ConditionKey[]
  fade: ConditionKey | null
  /** the new picks and fade (a fade now picked for colour comes back as null) */
  onChange: (picks: ConditionKey[], fade: ConditionKey | null) => void
}): ReactNode {
  const conds = orderConds(active)
  const nums = conds.filter((c) => isNumericCond(c, numeric))
  return (
    <div style={styles.subGroup}>
      <Field
        label="colour"
        info="The conditions the colours stand for. Several: every combination of their values is its own colour."
      >
        <ValueMultiSelect
          members
          values={conds}
          selected={picks}
          labelOf={(c) => condLabel(c as ConditionKey)}
          noun="condition"
          onChange={(next) => {
            // at least one: unticking the last keeps it
            if (!next.length) return
            const p = conds.filter((k) => next.includes(k))
            onChange(p, fade && !p.includes(fade) ? fade : null)
          }}
        />
      </Field>
      {nums.length > 0 && (
        <Field
          label="fade"
          info="Shades each colour light → dark along one numeric condition (low → high). A condition already picked for colour can't fade too."
        >
          <Select
            value={fade ?? ''}
            onChange={(v) => onChange(picks, v ? (v as ConditionKey) : null)}
            options={[
              { value: '', label: 'none' },
              ...nums.map((c) => ({ value: c, label: condLabel(c), disabled: picks.includes(c) }))
            ]}
          />
        </Field>
      )}
    </div>
  )
}

/** PaletteSelect on a config panel: its menu at the canvas zoom, closing when the canvas moves
 *  (as Select) — unless `unscaled` (a fixed window such as Settings). */
export function PanelPaletteSelect({
  unscaled,
  ...props
}: Omit<Parameters<typeof PaletteSelect>[0], 'zoom' | 'closeKey'> & {
  unscaled?: boolean
}): ReactNode {
  const tf = useStore((s) => `${s.transform[0]},${s.transform[1]},${s.transform[2]}`)
  const flat = useContext(ScreenScale) || unscaled
  return (
    <PaletteSelect
      {...props}
      zoom={flat ? 1 : Number(tf.split(',')[2]) || 1}
      closeKey={unscaled ? undefined : tf}
    />
  )
}
