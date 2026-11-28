import { DEFAULT_AXES } from '../graph/models/axisAvail'
import { ReactFlowProvider } from '@xyflow/react'
import { useState, type ReactNode } from 'react'
import { PlotConfig, PlotEntryMenu } from '../graph/dialogs/NodeConfigPanel'
import { orderedKeys } from '../graph/results/plotOrder'
import { ALL_OPS, NODE_SPECS, canConnect, categoryOf, entryKey } from '../graph/registry'
import { TilePicker } from '../graph/canvas/TilePicker'
import type { NodeConfig, NodeKind } from '../graph/types'
import { Field } from '../ui/controls/Field'
import { InfoTip } from '../ui/controls/InfoTip'
import { AnnotationCache } from '../ui/app/AnnotationCache'
import { ChoiceSwitch } from '../ui/controls/ChoiceSwitch'
import { ColorPicker } from '../ui/color/ColorPicker'
import { CategoryBuilder, SpectrumBuilder } from '../ui/color/PaletteBuilder'
import { PALETTE_ROLES, categoricalIds, type CategoricalId } from '../ui/color/palettes'
import { CategoricalLabel, PaletteSelect } from '../ui/color/PaletteSelect'
import { Select } from '../ui/controls/Select'
import { ACCENT_LABELS, PLOT_FONTS, UI, accentColors, type PlotFontId } from '../ui/app/theme'
import { ToggleSwitch } from '../ui/controls/ToggleSwitch'
import { DPI_CHOICES, useAppSettings } from '../ui/app/useAppSettings'
import { useUiTheme } from '../ui/app/useUiTheme'
import type { UpdateInfo } from '../ui/app/useUpdateCheck'
import { AppCard } from './Home'
import { LayoutPicker, UpdateStatus } from './NavBar'
import { DEFAULT_STEPS, plotEntriesAfter } from './plotDefaults'
import { styles } from './styles'

/**
 * Settings → Customisation → Defaults: the settings a NEW tile of a plot kind starts with. It's the same
 * config panel a tile shows, bound to the stored defaults instead of a node — so anything a tile
 * can be set to can be a default. Kept in app settings (not the project), so it holds across
 * projects and updates; existing tiles are never touched.
 */
export function PaletteSettings(): ReactNode {
  const palettes = useAppSettings((s) => s.palettes)
  const categorical = useAppSettings((s) => s.categorical)
  const customSpectrum = useAppSettings((s) => s.customSpectrum)
  const customCategorical = useAppSettings((s) => s.customCategorical)
  const update = useAppSettings((s) => s.update)
  // One row per role: its name (what it's about behind an (i)), then its selector.
  const row = (key: string, label: string, info: string, control: ReactNode): ReactNode => (
    <div key={key} style={styles.paletteRow}>
      <span style={styles.paletteRowLabel}>
        {label}
        <span style={{ marginLeft: 4, verticalAlign: 'middle' }}>
          <InfoTip label={`About ${label}`}>{info}</InfoTip>
        </span>
      </span>
      <div style={{ flex: '1 1 auto', minWidth: 0, maxWidth: 360 }}>{control}</div>
    </div>
  )
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={styles.settingsSubTitle}>
        Default palettes
        <span style={{ marginLeft: 4, verticalAlign: 'middle' }}>
          <InfoTip label="About default palettes">
            Each plot’s Automatic palette, by what it colours. A plot can still pick its own.
          </InfoTip>
        </span>
      </div>
      {PALETTE_ROLES.map(({ role, label, hint }) =>
        row(
          role,
          label,
          hint,
          <PaletteSelect
            value={palettes[role]}
            onChange={(v) => v && update({ palettes: { ...palettes, [role]: v } })}
          />
        )
      )}
      {row(
        'categorical',
        'Categories',
        'Groups and conditions: QC, bar plots, the heatmap’s category tracks, legends.',
        <Select
          value={categorical}
          onChange={(v) => update({ categorical: v as CategoricalId })}
          options={categoricalIds().map((id) => ({
            value: id,
            label: id,
            render: <CategoricalLabel id={id} />
          }))}
        />
      )}
      <div style={{ ...styles.settingsSubTitle, marginTop: 20 }}>
        Custom palettes
        <span style={{ marginLeft: 4, verticalAlign: 'middle' }}>
          <InfoTip label="About custom palettes">
            Build your own spectrum and category palette. Once made, each is offered as “custom” in
            every palette selector — here and in each plot’s settings.
          </InfoTip>
        </span>
      </div>
      {row(
        'customSpectrum',
        'Spectrum',
        'Up to 5 colours, evenly spaced from the low end to the high end. Drag the marker between two colours to move where they blend half-way; double-click it to reset.',
        // keyed on the applied palette: an Apply or Delete starts the draft afresh
        <SpectrumBuilder
          key={JSON.stringify(customSpectrum ?? null)}
          value={customSpectrum}
          onChange={(v) => update({ customSpectrum: v })}
        />
      )}
      {row(
        'customCategorical',
        'Categories',
        'Up to 20 colours, used in order for groups and conditions.',
        <CategoryBuilder
          key={JSON.stringify(customCategorical ?? null)}
          value={customCategorical}
          onChange={(v) => update({ customCategorical: v })}
        />
      )}
    </div>
  )
}
/** Settings › Plot defaults: the step a plot tile is made from first — one switch for the whole
 *  tab — then what a new plot tile after it comes with (its ticked plots, their order) and each
 *  plot's starting settings. Every option is a row: its name on the left, the control on the
 *  right (as Customisation's palettes). */
export function PlotDefaultsTab(): ReactNode {
  const [step, setStep] = useState<NodeKind>(DEFAULT_STEPS[0])
  return (
    <>
      <ChoiceSwitch
        label="Step the plot tile is made from"
        value={step}
        options={DEFAULT_STEPS.map((k) => ({ value: k, label: NODE_SPECS[k].label }))}
        onChange={(v) => setStep(v as NodeKind)}
      />
      <div style={styles.settingsHint}>
        For plot tiles added after a {NODE_SPECS[step].label} step
        {step === 'standardize' ? ' (or a Merge or Subset of one)' : ''}.
      </div>
      <div style={styles.defaultsSection}>
        <div style={styles.settingsSubTitle}>New plot tiles</div>
        <DefaultPlots step={step} />
        <PlotOrder step={step} />
      </div>
      <div style={styles.defaultsSection}>
        <div style={styles.settingsSubTitle}>Plot settings</div>
        <PlotDefaults step={step} />
      </div>
    </>
  )
}
/** One Plot defaults option: its name (and (i)) on the left, its control on the right. */
export function SettingRow({
  label,
  tip,
  children
}: {
  label: string
  tip?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <Field label={label} info={tip} labelWidth={150} top>
      <div style={styles.settingRowControl}>{children}</div>
    </Field>
  )
}
/** The plots a new plot tile after `step` comes with ticked — None, or Custom, ticked on a
 *  stand-in for the canvas picker (the same list, gated as for data with dose and time). A default
 *  a tile's data can't support is simply not offered, so never added. */
export function DefaultPlots({ step }: { step: NodeKind }): ReactNode {
  const defaultPlots = useAppSettings((s) => s.defaultPlots)
  const update = useAppSettings((s) => s.update)
  const own = defaultPlots[step]
  const put = (next: { on: boolean; keys: string[] }): void =>
    update({ defaultPlots: { ...defaultPlots, [step]: next } })
  const plotOps = ALL_OPS.filter((k) => categoryOf(k) === 'plotting' && canConnect(step, k))
  return (
    <>
      <SettingRow
        label="Default plots"
        tip={
          <>
            The plots already ticked when you add a plot tile, so you don’t pick them every time. A
            plot the data can’t show (a Dose response with no dose levels, say) isn’t offered there,
            so it’s simply left out.
          </>
        }
      >
        <ToggleSwitch
          label="Default plots"
          value={own?.on ? 'custom' : 'none'}
          options={[
            { value: 'none', label: 'None' },
            { value: 'custom', label: 'Custom' }
          ]}
          onChange={(v) => put({ on: v === 'custom', keys: own?.keys ?? [] })}
        />
      </SettingRow>
      {own?.on && (
        <SettingRow label="Ticked plots">
          {/* The canvas picker itself, its plots ticked as a new tile's will be (keyed by step, so
                        switching steps starts it afresh). */}
          <TilePicker
            key={step}
            ops={plotOps}
            onPick={() => undefined}
            upstream={{ kind: step, axes: DEFAULT_AXES, curve: step === 'curveFit' }}
            ticked={own.keys}
            onTickedChange={(keys) => put({ on: true, keys })}
            preview
          />
        </SettingRow>
      )}
    </>
  )
}
/** The order the plots a new plot tile after `step` is made with are added in — so laid out in on
 *  the results page — whichever are picked (defaults or not): every plot the step offers, dragged
 *  into place. Unset, the plot menu's order. */
export function PlotOrder({ step }: { step: NodeKind }): ReactNode {
  const plotOrder = useAppSettings((s) => s.plotOrder)
  const update = useAppSettings((s) => s.update)
  const entries = plotEntriesAfter(step)
  const labelOf = new Map(entries.map((e) => [entryKey(e), e.label]))
  const order = orderedKeys(entries.map(entryKey), plotOrder[step])
  const own = !!plotOrder[step]
  const [dragged, setDragged] = useState<number | null>(null)
  const move = (from: number, to: number): void => {
    const next = [...order]
    const [k] = next.splice(from, 1)
    next.splice(to, 0, k)
    update({ plotOrder: { ...plotOrder, [step]: next } })
  }
  const reset = (): void => {
    const next = { ...plotOrder }
    delete next[step]
    update({ plotOrder: next })
  }
  return (
    <SettingRow
      label="Results page order"
      tip={
        <>
          The order a new plot tile’s plots are added in — so the order they’re laid out in on the
          results page — whichever you pick. Drag a plot to move it.
        </>
      }
    >
      <div style={styles.defaultOrder}>
        {order.map((k, i) => (
          <div
            key={k}
            draggable
            onDragStart={(e) => {
              setDragged(i)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (dragged == null) return
              e.preventDefault()
              if (dragged !== i) {
                move(dragged, i)
                setDragged(i)
              }
            }}
            onDragEnd={() => setDragged(null)}
            style={{ ...styles.defaultOrderRow, opacity: dragged === i ? 0.5 : 1 }}
            title="Drag to reorder"
          >
            <span style={styles.defaultOrderGrip}>⠿</span>
            <span style={styles.defaultOrderNum}>{i + 1}</span>
            {labelOf.get(k)}
          </div>
        ))}
      </div>
      {own && (
        <button style={styles.defaultsReset} onClick={reset} title="Back to the plot menu’s order">
          Reset to the menu’s order
        </button>
      )}
    </SettingRow>
  )
}
/** Each plot's settings a new tile of it starts with — one of the plots `step` feeds, picked from
 *  the plot tile's own menu, so Dose response and Time response are their own entries, as in the
 *  editor. */
export function PlotDefaults({ step }: { step: NodeKind }): ReactNode {
  const entries = plotEntriesAfter(step)
  const [pickedKey, setPickedKey] = useState('')
  const entry = entries.find((e) => entryKey(e) === pickedKey) ?? entries[0]
  const kind = entry.kind
  const plotDefaults = useAppSettings((s) => s.plotDefaults)
  const setPlotDefault = useAppSettings((s) => s.setPlotDefault)
  const clearPlotDefault = useAppSettings((s) => s.clearPlotDefault)
  const own = plotDefaults[kind]
  // The panel edits a full config: what a new tile from this entry starts with — the kind's
  // built-in defaults, the stored overrides on top, then the entry's own (dr's axis).
  const config = {
    ...NODE_SPECS[kind].defaultConfig(),
    ...(own ?? {}),
    ...(entry.override ?? {})
  } as NodeConfig
  // The Response plots over each condition (or pair) are one plot kind: one set of defaults serves
  // them all.
  const shared = kind === 'dr' || kind === 'tdr'
  return (
    <>
      <SettingRow label="Plot">
        {/* The workflow tile's plot menu, single-choice: same sections, same rows. Its themed
                dropdown reads the canvas zoom, so it needs a provider of its own out here. */}
        <div style={styles.defaultsPick}>
          <ReactFlowProvider>
            <PlotEntryMenu
              value={entryKey(entry)}
              upstreamKind={step}
              onChange={(e) => setPickedKey(entryKey(e))}
            />
          </ReactFlowProvider>
        </div>
        <div style={{ ...styles.settingsHint, marginTop: 0 }}>
          {own
            ? `New ${entry.label} tiles start with the settings below.`
            : `New ${entry.label} tiles start with the built-in settings — change anything below to save a default.`}
          {shared &&
            ` Every ${entry.kind === 'tdr' ? 'two-condition' : 'one-condition'} Response plot shares one set of defaults.`}
        </div>
        {own && (
          <button
            style={styles.defaultsReset}
            onClick={() => clearPlotDefault(kind)}
            title={`Forget the saved defaults for ${entry.label}`}
          >
            Reset to the built-in settings
          </button>
        )}
      </SettingRow>
      {/* The panel's Selects read React Flow's zoom for their dropdown metrics; a provider of its
                own pins that to 1 here, outside the canvas. `edgeNodeId` matches no node, so the panels
                that look upstream simply offer everything. */}
      <ReactFlowProvider>
        <div style={styles.defaultsPanel}>
          <PlotConfig
            key={entryKey(entry)}
            kind={kind}
            config={config}
            update={(patch) => setPlotDefault(kind, patch)}
            edgeNodeId=""
          />
        </div>
      </ReactFlowProvider>
    </>
  )
}
export function SettingsPopover({
  onClose,
  update,
  silenced,
  onToggleSilence
}: {
  onClose: () => void
  update: UpdateInfo
  silenced: boolean
  onToggleSilence: () => void
}) {
  const preference = useUiTheme((s) => s.preference)
  const setPreference = useUiTheme((s) => s.setPreference)
  const accent = useUiTheme((s) => s.accent)
  const setAccent = useUiTheme((s) => s.setAccent)
  const customAccent = useUiTheme((s) => s.customAccent)
  const setCustomAccent = useUiTheme((s) => s.setCustomAccent)
  const mode = useUiTheme((s) => s.mode)
  const copyFormat = useAppSettings((s) => s.copyFormat)
  const copyDpi = useAppSettings((s) => s.copyDpi)
  const downloadFormat = useAppSettings((s) => s.downloadFormat)
  const downloadDpi = useAppSettings((s) => s.downloadDpi)
  const tableFormat = useAppSettings((s) => s.tableFormat)
  const exportBackground = useAppSettings((s) => s.exportBackground)
  const plotFont = useAppSettings((s) => s.plotFont)
  const plotsPerRow = useAppSettings((s) => s.plotsPerRow)
  const updateSettings = useAppSettings((s) => s.update)
  const DPI_OPTS = DPI_CHOICES.map((d) => ({ v: String(d), label: `${d} dpi` }))
  const [active, setActive] = useState<
    'appearance' | 'plots' | 'plotDefaults' | 'export' | 'database' | 'about'
  >('appearance')
  const showDot = update.updateAvailable && !silenced
  const APPEARANCE = [
    { v: 'light', label: '☀ Light' },
    { v: 'dark', label: '☾ Dark' },
    { v: 'auto', label: '◐ Auto' }
  ] as const
  const SECTIONS = [
    { id: 'appearance', title: 'Appearance', dot: false },
    { id: 'plots', title: 'Customisation', dot: false },
    { id: 'plotDefaults', title: 'Plot defaults', dot: false },
    { id: 'export', title: 'Export', dot: false },
    { id: 'database', title: 'Database', dot: false },
    { id: 'about', title: 'About', dot: showDot }
  ] as const
  /** A settings choice: the app's ToggleSwitch. */
  const seg = <V extends string>(
    value: V,
    options: readonly { v: V; label: string }[],
    onChange: (v: V) => void
  ): ReactNode => (
    <ToggleSwitch
      label="Setting"
      value={value}
      options={options.map((o) => ({ value: o.v, label: o.label }))}
      onChange={onChange}
    />
  )
  return (
    <>
      <div style={styles.dialogScrim} onClick={onClose} />
      <div style={styles.settingsModal} role="dialog" aria-label="Settings">
        <div style={styles.settingsModalHead}>
          <span style={styles.settingsModalTitle}>Settings</span>
          <button style={styles.settingsClose} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={styles.settingsBody}>
          <nav style={styles.settingsNav}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                style={{
                  ...styles.settingsNavItem,
                  background: active === s.id ? UI.accent : 'transparent',
                  color: active === s.id ? UI.accentText : UI.text
                }}
              >
                <span>{s.title}</span>
                {s.dot && <span style={styles.settingsNavDot} />}
              </button>
            ))}
          </nav>
          <div style={styles.settingsContent}>
            {active === 'appearance' ? (
              <>
                <h2 style={styles.settingsContentTitle}>Appearance</h2>
                <div style={styles.settingsSubTitle}>Colour scheme</div>
                {seg(preference, APPEARANCE, (v) => setPreference(v))}
                {preference === 'auto' && (
                  <div style={styles.settingsHint}>Following your system colour scheme.</div>
                )}
                <div style={{ ...styles.settingsSubTitle, marginTop: 24 }}>Accent colour</div>
                <div style={styles.accentRow} role="radiogroup" aria-label="Accent colour">
                  {(['graphite', 'blue', 'orange'] as const).map((id) => {
                    const on = accent === id
                    const [color] = accentColors(id, mode, customAccent)
                    return (
                      <button
                        key={id}
                        role="radio"
                        aria-checked={on}
                        onClick={() => setAccent(id)}
                        style={{
                          ...styles.accentSwatch,
                          outline: on ? `2px solid ${color}` : 'none'
                        }}
                      >
                        <span style={{ ...styles.accentDot, background: color }} />
                        <span style={styles.accentLabel}>{ACCENT_LABELS[id]}</span>
                      </button>
                    )
                  })}
                  {/* Custom: the whole chip opens the app's colour picker and selects it (with its
                        saved colour) — a pick also switches to it. */}
                  <span
                    role="radio"
                    aria-checked={accent === 'custom'}
                    onClick={() => setAccent('custom')}
                  >
                    <ColorPicker
                      value={customAccent}
                      onPick={setCustomAccent}
                      label="Custom accent colour"
                      title="Pick the custom colour"
                      triggerStyle={{
                        ...styles.accentSwatch,
                        outline: accent === 'custom' ? `2px solid ${customAccent}` : 'none'
                      }}
                    >
                      <span
                        style={{
                          ...styles.accentDot,
                          background: customAccent,
                          boxShadow: `0 0 0 1px ${UI.border}`
                        }}
                      />
                      <span style={styles.accentLabel}>{ACCENT_LABELS.custom}</span>
                    </ColorPicker>
                  </span>
                </div>
                <div style={{ ...styles.settingsSubTitle, marginTop: 24 }}>
                  Workflow editor mode
                </div>
                <LayoutPicker />
                <div style={{ ...styles.settingsSubTitle, marginTop: 24 }}>
                  Results dashboard: default plots per row
                  <span style={{ marginLeft: 4, verticalAlign: 'middle' }}>
                    <InfoTip label="About default plots per row">
                      How many plots sit side by side on a results tab you haven’t arranged
                      yourself, and how plots added later join one you have. A tab you’ve moved or
                      resized plots on keeps its arrangement.
                    </InfoTip>
                  </span>
                </div>
                {seg(
                  String(plotsPerRow),
                  [
                    { v: '2', label: '2' },
                    { v: '3', label: '3' },
                    { v: '4', label: '4' }
                  ] as const,
                  (v) => updateSettings({ plotsPerRow: Number(v) as 2 | 3 | 4 })
                )}
              </>
            ) : active === 'plots' ? (
              <>
                <h2 style={styles.settingsContentTitle}>Customisation</h2>
                <div style={styles.settingsSubTitle}>
                  Plot font
                  <span style={{ marginLeft: 4, verticalAlign: 'middle' }}>
                    <InfoTip label="About the plot font">
                      All plot text, on screen and in every copy and export. Arial and Helvetica are
                      what most journals ask for in figures.
                    </InfoTip>
                  </span>
                </div>
                <div style={{ marginBottom: 24 }}>
                  {seg(
                    plotFont,
                    (Object.keys(PLOT_FONTS) as PlotFontId[]).map((id) => ({
                      v: id,
                      label: PLOT_FONTS[id].label
                    })),
                    (v) => updateSettings({ plotFont: v })
                  )}
                </div>
                <PaletteSettings />
              </>
            ) : active === 'plotDefaults' ? (
              <>
                <h2 style={styles.settingsContentTitle}>Plot defaults</h2>
                <PlotDefaultsTab />
              </>
            ) : active === 'export' ? (
              <>
                <h2 style={styles.settingsContentTitle}>Export</h2>
                {/* A tile's Copy and Download buttons act straight away (no window of their own):
                        Copy in this format/DPI; Download opens the OS save window for this format. */}
                <div style={styles.settingsSubTitle}>
                  Background
                  <span style={{ marginLeft: 4, verticalAlign: 'middle' }}>
                    <InfoTip label="About the export background">
                      What every copied or exported plot sits on. Transparent leaves no backdrop,
                      for placing a plot on a coloured slide or into a figure.
                    </InfoTip>
                  </span>
                </div>
                {seg(
                  exportBackground,
                  [
                    { v: 'white', label: 'White' },
                    { v: 'transparent', label: 'Transparent' }
                  ] as const,
                  (v) => updateSettings({ exportBackground: v })
                )}

                <div style={{ ...styles.settingsSubTitle, marginTop: 24 }}>Copy to clipboard</div>
                {/* format, then resolution in line to its right */}
                <div style={styles.settingsInline}>
                  <div>
                    <div style={styles.settingsFieldLabel}>Format</div>
                    {seg(
                      copyFormat,
                      [
                        { v: 'png', label: 'PNG' },
                        { v: 'svg', label: 'SVG' }
                      ] as const,
                      (v) => updateSettings({ copyFormat: v })
                    )}
                  </div>
                  <div>
                    <div style={styles.settingsFieldLabel}>Resolution</div>
                    {seg(String(copyDpi), DPI_OPTS, (v) => updateSettings({ copyDpi: Number(v) }))}
                  </div>
                </div>

                <div style={{ ...styles.settingsSubTitle, marginTop: 24 }}>Download</div>
                <div style={styles.settingsInline}>
                  <div>
                    <div style={styles.settingsFieldLabel}>Plot format</div>
                    {seg(
                      downloadFormat,
                      [
                        { v: 'svg', label: 'SVG' },
                        { v: 'png', label: 'PNG' },
                        { v: 'pdf', label: 'PDF' }
                      ] as const,
                      (v) => updateSettings({ downloadFormat: v })
                    )}
                  </div>
                  <div>
                    <div style={styles.settingsFieldLabel}>Resolution</div>
                    {seg(String(downloadDpi), DPI_OPTS, (v) =>
                      updateSettings({ downloadDpi: Number(v) })
                    )}
                  </div>
                </div>
                <div style={{ ...styles.settingsFieldLabel, marginTop: 16 }}>Table format</div>
                {seg(
                  tableFormat,
                  [
                    { v: 'csv', label: 'CSV' },
                    { v: 'xlsx', label: 'XLSX' }
                  ] as const,
                  (v) => updateSettings({ tableFormat: v })
                )}
              </>
            ) : active === 'database' ? (
              <>
                <h2 style={styles.settingsContentTitle}>Database</h2>
                <AnnotationCache />
              </>
            ) : (
              <>
                <h2 style={styles.settingsContentTitle}>About</h2>
                {/* The namecard; the update status follows in full, so no tag on it here. */}
                <AppCard update={update} showUpdate={false} />
                {/* Updates: check again, and what the check found. */}
                <div style={{ ...styles.settingsSubTitle, marginTop: 24 }}>Updates</div>
                <div style={styles.updateActions}>
                  <button
                    style={styles.updateButton}
                    onClick={update.check}
                    disabled={update.checking}
                  >
                    Check now
                  </button>
                  <UpdateStatus update={update} />
                </div>
                {update.updateAvailable && update.install.unsupported && (
                  <div style={{ ...styles.aboutMuted, marginTop: 8 }}>
                    {update.install.unsupported}
                  </div>
                )}
                {update.updateAvailable && !update.install.unsupported && update.install.admin && (
                  <div style={{ ...styles.aboutMuted, marginTop: 8 }}>
                    {`${update.install.admin} needs an administrator’s password to change: macOS asks for one when the update is put in place.`}
                  </div>
                )}
                <label style={{ ...styles.silenceRow, marginTop: 14 }}>
                  <span>Silence update dot</span>
                  <input type="checkbox" checked={silenced} onChange={onToggleSilence} />
                </label>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
