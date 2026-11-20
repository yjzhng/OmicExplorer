import { useStore } from '@xyflow/react'
import { type CSSProperties, Fragment, type ReactNode, useContext, useState } from 'react'
import { type ConditionKey, type NumericConds, condLabel, isNumericCond } from '../../../engine'
import {
  type AxisStyle,
  type DRConfig,
  type EffectColors,
  type GroupStyle,
  type HighlightStyle,
  type LineStyle,
  type PlotAxes,
  type PlotEffectColors,
  type PointStyle,
  drLook,
  type LegendConfig
} from '../../../graph/types'
import { AUTO, CLEAR } from '../../../ui/ColorPicker'
import {
  type CategoricalId,
  type PaletteRole,
  categoricalIds,
  type PaletteRef,
  toCategoricalId,
  toPaletteRef
} from '../../../ui/palettes'
import { CategoricalLabel, PaletteSelect } from '../../../ui/PaletteSelect'
import { type AxisDefaults, AXIS_LINE_WIDTH } from '../../../ui/plotAxes'
import {
  type PointPlotKind,
  type ResolvedGroup,
  defaultGroups,
  resolveGroup
} from '../../../ui/pointStyle'
import { GUIDE_WIDTH, PALETTES, UI } from '../../../ui/theme'
import { OnOffSwitch } from '../../../ui/ToggleSwitch'
import { useAppSettings, useRolePalette } from '../../../ui/useAppSettings'
import { useUiTheme } from '../../../ui/useUiTheme'
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
import { ScreenScale } from './hooks'
import { autoOf, DR_LOOK_FIELDS, legendShown, useEffectColors, useEffectNames } from './plotHooks'
import { styles } from './styles'

/**
 * A plot's settings, in the one order every plot's settings window follows: what the plot shows →
 * the statistic it draws (from the upstream step) → its labels → its points / lines → its colours.
 * The window then adds the Legend and Axes sections (graph/NodeConfigPanel, from the spec's
 * `legend` / `axes` facts), so they always come last. Each plot's Settings fills the slots it has;
 * the order is this component's, not each file's.
 */
export function PlotSections({
  show,
  statistic,
  labels,
  marks,
  colours
}: {
  /** what the plot draws: its view, metric, genes / cap, ordering */
  show?: ReactNode
  /** the upstream step's statistic, offered here (written to that step) */
  statistic?: ReactNode
  /** which genes are labelled (the label cap) */
  labels?: ReactNode
  /** how points / lines / bars are drawn */
  marks?: ReactNode
  /** palettes and colours */
  colours?: ReactNode
}): ReactNode {
  return (
    <>
      {show}
      {statistic}
      {labels}
      {marks}
      {colours}
    </>
  )
}
/** The plot-wide legend switch: off hides the legend and the colour scale bars. Every plot with a
 *  legend has it here (the point plots' per-group entries stay in their Points table). A point
 *  plot from before this section kept its switch in `style.legend`: still read, and cleared when
 *  the switch is used, so one switch decides. */
export function LegendSection({
  config,
  update,
  groups
}: {
  config: LegendConfig & { style?: PointStyle }
  update: (patch: Record<string, unknown>) => void
  /** a point plot: its groups' own entries are switched in Points */
  groups?: boolean
}): ReactNode {
  const style = config.style
  return (
    <Section title="Legend">
      <Field label="legend">
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
      <div style={styles.hint}>
        Off hides the legend and any colour scale bar.
        {groups ? ' Each group’s own entry is switched in Points.' : ''}
      </div>
    </Section>
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
  /** A group's colour as its chip shows it: what the user picked (or cleared), else Automatic. */
  // Where a group's automatic colour comes from: an effect group follows the upstream tile.
  const autoSource = (key: string): string =>
    key === 'up' || key === 'down' || key === 'none' ? "the upstream tile's" : "the plot's default"
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
    'highlight'
  ]
  const reset = (label: string, onClick: () => void): ReactNode => (
    <button style={styles.resetBtn} onClick={onClick} title={`Restore the default ${label}`}>
      Reset
    </button>
  )
  // Value boxes throughout: opacity over 0–1 in 0.05 steps, pixel sizes over a plot-sensible range.
  const opacity = (label: string, value: number, onChange: (v: number) => void): ReactNode => (
    <SizeBox value={value} onChange={onChange} min={0} max={1} step={0.05} title={label} />
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
        // Reset sits right of the title (the subtitle slot). The plot-wide legend switch is the
        // Legend section's; the per-group entries are a column of the table below.
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
                  style={{ gridRow: 2, gridColumn: i + 2, width: '100%', flex: '1 1 auto' }}
                />
              ))}
              {/* ONE ground behind every marker: a grid item spanning the three state rows and all
              the group columns. Everything in these rows is placed EXPLICITLY — auto-placement
              treats the ground's cells as taken and would flow the markers below it. */}
              <div style={styles.previewBox} />
              {(['plain', 'selected', 'faded'] as const).map((state, r) => (
                <Fragment key={state}>
                  <span style={{ ...styles.rowLabel, gridRow: r + 3, gridColumn: 1 }}>
                    {state === 'faded' ? 'not selected' : state}
                  </span>
                  {groups.map((g, i) => (
                    <MarkerPreview
                      key={g.key}
                      g={g}
                      state={state}
                      ink={ink}
                      style={{ gridRow: r + 3, gridColumn: i + 2 }}
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
                  {opacity(`${g.name} opacity`, g.opacity, (v) => setGroup(g.key, { opacity: v }))}
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
                  {/* Whether its genes are labelled, and in what colour: automatic = the group's
                        marker colour. */}
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
                        style={{ flex: '1 1 auto', width: '100%' }}
                      />
                    </div>
                  ))}
                </>
              )}

              <span style={styles.rowLabel}>legend</span>
              {groups.map((g) => (
                <div key={g.key} style={styles.switchCell}>
                  <OnOffSwitch
                    on={g.legend}
                    disabled={!legend}
                    label={`${g.name} legend entry`}
                    onChange={(on) => setGroup(g.key, { legend: on })}
                  />
                </div>
              ))}
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

                <span style={styles.rowLabel}>label</span>
                {groups.map((g) => (
                  <div key={g.key} style={styles.hlLabelCell}>
                    <OnOffSwitch
                      on={g.highlight.label}
                      label={`Label selected ${g.name} points`}
                      onChange={(on) => setGroupHl(g.key, { label: on })}
                    />
                    {g.highlight.label &&
                      px(
                        `${g.name} label size`,
                        g.highlight.labelSize,
                        (v) => setGroupHl(g.key, { labelSize: v }),
                        9,
                        13,
                        true
                      )}
                  </div>
                ))}

                {/* The selected gene's name colour: automatic = its point's colour. */}
                <span style={styles.rowLabel}>label colour</span>
                {groups.map((g) => {
                  const own = style?.groups?.[g.key]?.highlight?.labelColor
                  const c = own && own !== AUTO ? own : AUTO
                  return (
                    <ColorChip
                      key={g.key}
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
                      style={{ width: '100%', flex: '1 1 auto' }}
                    />
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
                    {opacity(`${g.name} faded opacity`, g.highlight.dim, (v) =>
                      setGroupHl(g.key, { dim: v })
                    )}
                  </Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* The threshold / reference guide lines — the plot's dashed cutoffs. */}
        <Field label="threshold line">
          <div style={{ width: 64 }}>
            <SizeBox
              value={style?.guideWidth ?? GUIDE_WIDTH}
              onChange={(v) => setStyle({ guideWidth: v })}
              min={0.5}
              max={4}
              step={0.5}
              title="Threshold line width (px)"
            />
          </div>
        </Field>
      </Section>
    </>
  )
}
/** A DR's line / points / error look, one row each: an on/off where the element can be hidden,
 *  then — while shown — its colour, size and opacity (%), as the gene bar's replicate row does.
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
        step={field === 'lineWidth' ? 0.5 : 1}
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
    <Section
      title="Style"
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
          {pct('lineOpacity', look.lineOpacity, 'Line opacity (%)')}
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
                  {pct('pointOpacity', look.pointOpacity, 'Point opacity (%)')}
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
                  {pct('errorOpacity', look.errorOpacity, 'Error opacity (%)')}
                </>
              )}
            </div>
          </Field>
          {curveFit && (
            <Field label="pEC50 line">
              <OnOffSwitch
                on={look.ec50Line}
                label="pEC50 line"
                title="A dotted line at each curve's EC50 (the 4PL's midpoint), within the tested range"
                onChange={(v) => update({ ec50Line: v })}
              />
            </Field>
          )}
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
/** A fold-change plot's colours: its palette (Automatic = the global one, Settings → Customisation) —
 *  the continuous scale, and what the up / down / none colours are sampled from — and, where the
 *  plot draws those groups without point styles to carry them (enrichment's bars), the groups'
 *  own colours: Automatic by default (from the palette), or the plot's own. */
export function ColourSection({
  config,
  update,
  edgeNodeId,
  groups = false,
  hint,
  role = 'fcObject'
}: PlotPanelProps<{ effectColors?: PlotEffectColors; fcPalette?: PaletteRef }> & {
  /** offer the up / down / none colours too */
  groups?: boolean
  /** the palette role Automatic follows (default: fold change on objects) */
  role?: PaletteRole
  /** a line under the palette, when it needs saying what it colours */
  hint?: string
}): ReactNode {
  const names = useEffectNames(edgeNodeId)
  const rolePalette = useRolePalette(role)
  const inherited = useEffectColors(edgeNodeId, config.fcPalette)
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
      />
    )
  }
  return (
    <Section title="Colour">
      <Field label="FC palette">
        <PanelPaletteSelect
          value={toPaletteRef(config.fcPalette)}
          onChange={(v) => update({ fcPalette: v })}
          auto={autoOf(rolePalette)}
        />
      </Field>
      {hint && <div style={styles.hint}>{hint}</div>}
      {groups && (
        <Field label="groups">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={styles.inlineTag}>{names.up}</span>
            {chip('up')}
            <span style={{ ...styles.inlineTag, marginLeft: 6 }}>{names.down}</span>
            {chip('down')}
            <span style={{ ...styles.inlineTag, marginLeft: 6 }}>{names.none}</span>
            {chip('none')}
          </div>
        </Field>
      )}
    </Section>
  )
}
/** A plot's Colour section with a categorical palette (QC, cluster, bar): what it colours by (the
 *  plot's own fields, as children), then the palette — Automatic = the global one (Settings →
 *  Customisation), or its own. */
export function CategoricalSection({
  config,
  update,
  children
}: Pick<PlotPanelProps<{ categorical?: CategoricalId }>, 'config' | 'update'> & {
  /** the plot's other colour settings (what it colours by, …), above the palette */
  children?: ReactNode
}): ReactNode {
  return (
    <Section title="Colour">
      {children}
      <Field label="palette">
        <CategoricalSelect config={config} update={update} />
      </Field>
    </Section>
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
  minimal = false
}: {
  config: { axes?: PlotAxes }
  update: (patch: Record<string, unknown>) => void
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
      title="Axes"
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
    </Section>
  )
}
/** Colour by condition's picks (gene bar, QC, cluster), indented under the colour-by: a single
 *  `colour` condition (categorical) and a single `fade` (dose or time: light = low, dark = high).
 *  Stored together as `colorConds`. `colour: false` leaves the colour to the colour-by itself (the
 *  cluster's, which picks the condition directly) and offers the fade alone. */
export function ConditionColorFields({
  active,
  numeric,
  selected,
  onChange,
  colour = true
}: {
  /** the conditions the upstream data carries */
  active: ConditionKey[]
  /** of those, the numeric ones (the data's schema): what the fade can take */
  numeric: NumericConds
  selected: ConditionKey[]
  onChange: (next: ConditionKey[]) => void
  colour?: boolean
}): ReactNode {
  const NONE = ''
  const cats = active.filter((c) => !isNumericCond(c, numeric))
  const nums = active.filter((c) => isNumericCond(c, numeric))
  const cat = selected.find((c) => !isNumericCond(c, numeric)) ?? NONE
  const num = selected.find((c) => isNumericCond(c, numeric)) ?? NONE
  const pick = (c: string, n: string): void =>
    onChange([c, n].filter((k) => k !== NONE) as ConditionKey[])
  const opts = (keys: ConditionKey[], none: boolean): Array<{ value: string; label: string }> => [
    ...(none ? [{ value: NONE, label: 'none' }] : []),
    ...keys.map((k) => ({ value: k, label: condLabel(k) }))
  ]
  return (
    <div style={styles.subGroup}>
      {colour && (
        <Field label="colour">
          <Select
            value={cat}
            onChange={(v) => pick(v, num)}
            // none only while a fade carries the colouring (dose / time alone: shades of one hue)
            options={opts(cats, num !== NONE || cat === NONE)}
          />
        </Field>
      )}
      {nums.length > 0 && (
        <Field label="fade">
          <Select
            value={num}
            onChange={(v) => pick(cat, v)}
            // the fade can't go too when it alone carries the colouring
            options={opts(nums, cat !== NONE || !colour)}
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
