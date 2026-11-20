import { type ReactNode, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { manualSheetConditions, manualSheetIssues, sheetIssueLines } from '../../engine'
import { useConfigWindowOpen } from '../../graph/dialogDock'
import { loadCheckInfo } from '../../graph/loadCheck'
import { locationOf } from '../../graph/state/shared'
import { useGraph } from '../../graph/store'
import {
  type LoadConfig,
  declaredNumeric,
  DOSE_UNIT_SUGGESTIONS,
  resolveLoadMode,
  TIME_UNIT_SUGGESTIONS
} from '../../graph/types'
import { UnitInput } from '../../graph/UnitInput'
import { IconJump } from '../../ui/icons'
import { HoverTip } from '../../ui/InfoTip'
import { ProjectFolderViewer } from '../../ui/ProjectFolderViewer'
import { StatusIcon, StatusNote } from '../../ui/StatusNote'
import { cssVars, NOTICE_MS, PALETTES } from '../../ui/theme'
import { ToggleSwitch } from '../../ui/ToggleSwitch'
import { useUiTheme } from '../../ui/useUiTheme'
import { ConfigureButton, Field, Section, Select } from '../kit/settings/controls'
import { useInputText } from '../kit/settings/hooks'
import { styles } from '../kit/settings/styles'
import { type StepSettingsProps } from '../settings'
import { type DataFormatTab, DataFormatDialog } from './DataFormatDialog'
import { InteractiveImportDialog } from './InteractiveImportDialog'

export function LoadPanel({ id, config }: { id: string; config: LoadConfig }) {
  const update = useGraph((s) => s.updateConfig)
  const loadCheck = useGraph((s) => s.loadChecks[id])
  const loadInfo =
    loadCheck && loadCheck.state !== 'ok' ? loadCheckInfo(loadCheck, resolveLoadMode(config)) : null
  const setUnits = useGraph((s) => s.setLoadUnits)
  const setNumeric = useGraph((s) => s.setLoadNumeric)
  const inputFiles = useGraph((s) => s.inputFiles)
  const refreshDataFiles = useGraph((s) => s.refreshDataFiles)
  const [dialogOpen, setDialogOpen] = useConfigWindowOpen(id)
  const [refreshState, setRefreshState] = useState<'idle' | 'busy' | 'done'>('idle')
  const opts = [{ value: '', label: '—' }, ...inputFiles.map((f) => ({ value: f, label: f }))]
  // The matrix may be an external file (absolute path) picked from outside the data folder — surface
  // it as a selectable option so the dropdown shows it instead of falling back to blank.
  const matrixExternal = !!config.matrix && !inputFiles.includes(config.matrix)
  const matrixOpts = matrixExternal
    ? [
        ...opts,
        { value: config.matrix!, label: `${config.matrix!.replace(/^.*[\\/]/, '')} (external)` }
      ]
    : opts
  // Browse the whole filesystem for a matrix (not restricted to the data folder). The generated
  // standard files still go into the project's data folder on convert.
  const browseMatrix = async (): Promise<void> => {
    const path = await window.api.pickDataFile()
    if (path) update(id, { matrix: path })
  }
  // Effective mode (tolerates legacy/unset values so a chip is always selected — see
  // resolveLoadMode); a fresh tile defaults to interactive.
  const mode = resolveLoadMode(config)
  // The manual samplesheet, read for two things before any run: its columns (a unit is only asked
  // for a condition the sheet carries) and the run's samplesheet check, shown as a warning — the
  // same rule the interactive import gates on (manualSheetIssues).
  // The "Manual data input" window (one section per input file), opened from the (i) beside
  // each file.
  const [formatTab, setFormatTab] = useState<DataFormatTab | null>(null)
  const formatButton = (tab: DataFormatTab): ReactNode => (
    <HoverTip tip="Manual data input — click for the columns, an example and the template">
      <button
        style={styles.formatBtn}
        onClick={() => setFormatTab(tab)}
        aria-label={`Manual data input: ${tab}`}
      >
        <StatusIcon kind="info" />
      </button>
    </HoverTip>
  )
  const sheetText = useInputText(mode === 'manual' ? config.samplesheet : null)
  const dataText = useInputText(mode === 'manual' ? config.data : null)
  // The samplesheet's conditions, as the run will read them: the presets whose column holds a value,
  // then its custom ones (detected as the run detects them) — what the Conditions section lists.
  const sheetConds = useMemo(
    () => (sheetText == null ? [] : manualSheetConditions(sheetText)),
    [sheetText]
  )
  const sheetCheck = useMemo(
    () =>
      sheetText == null
        ? null
        : manualSheetIssues(sheetText, dataText, config.data, declaredNumeric(config)),
    [sheetText, dataText, config]
  )
  // Interactive import is set up once the standard files have been generated (config.data set).
  const converted = !!config.data
  // The generated files' folder (the workflow folder's input — see convertInteractive), for the
  // jump to it in the project-folder viewer. That viewer shows the data folder, so only a folder
  // inside it can be jumped to: an unsaved project's sits in the session's temporary folder.
  const dataDir = useGraph((s) => s.dataDir)
  const dataDirMissing = useGraph((s) => s.dataDirMissing)
  const inputDir = useGraph((s) => {
    const scope = locationOf(s)?.scope
    return scope && typeof scope === 'object' ? `${scope.base}/input` : null
  })
  const canJump =
    !!dataDir &&
    !dataDirMissing &&
    !!inputDir &&
    inputDir.replace(/\\/g, '/').startsWith(dataDir.replace(/\\/g, '/').replace(/\/+$/, '') + '/')
  const [viewerOpen, setViewerOpen] = useState(false)
  const themeMode = useUiTheme((s) => s.mode)
  const doRefresh = async () => {
    if (refreshState === 'busy') return
    setRefreshState('busy')
    await refreshDataFiles()
    setRefreshState('done')
    window.setTimeout(() => setRefreshState('idle'), NOTICE_MS.done)
  }
  const refreshLabel =
    refreshState === 'busy' ? 'Refreshing…' : refreshState === 'done' ? '✓ Refreshed' : '⟳ Refresh'
  return (
    <>
      {/* Import mode: Manual = pick the three standard files; Interactive = pick one raw data
                matrix and configure samples in a dialog, which materializes the standard files. */}
      <Section
        title="Import mode"
        info={
          mode === 'manual'
            ? 'Provide the three standard input files.'
            : 'Provide one data matrix; configure samples to generate the standard files.'
        }
      >
        <ToggleSwitch
          label="Import mode"
          value={mode}
          options={[
            { value: 'interactive' as const, label: 'Interactive' },
            { value: 'manual' as const, label: 'Manual' }
          ]}
          onChange={(m) => update(id, { mode: m })}
        />
      </Section>

      <Section
        title={mode === 'manual' ? 'Input files' : 'Input file'}
        action={
          <button
            style={{
              ...styles.chip,
              ...(refreshState === 'done' ? styles.chipDone : null),
              opacity: refreshState === 'busy' ? 0.6 : 1
            }}
            disabled={refreshState === 'busy'}
            onClick={() => void doRefresh()}
          >
            {refreshLabel}
          </button>
        }
      >
        {mode === 'manual' ? (
          <>
            <div style={styles.hint}>Choose from files in the project&apos;s data folder.</div>
            <Field label="datamatrix" labelAside={formatButton('datamatrix')}>
              <Select
                value={config.data ?? ''}
                onChange={(v) => update(id, { data: v || null })}
                options={opts}
              />
            </Field>
            <Field label="samplesheet" labelAside={formatButton('samplesheet')}>
              <Select
                value={config.samplesheet ?? ''}
                onChange={(v) => update(id, { samplesheet: v || null })}
                options={opts}
              />
            </Field>
            <Field label="metadata" labelAside={formatButton('metadata')}>
              <Select
                value={config.db ?? ''}
                onChange={(v) => update(id, { db: v || null })}
                options={opts}
              />
            </Field>
            <button style={styles.linkNote} onClick={() => setFormatTab('datamatrix')}>
              How to prepare input files?
            </button>
            {/* The samplesheet's check, as the run will make it (manualSheetIssues): what would
                        stop the run, else a pass. */}
            {sheetCheck &&
              (sheetCheck.noSample || sheetCheck.issues.length > 0 ? (
                <StatusNote kind="warn">
                  {sheetCheck.noSample ? (
                    'The samplesheet needs a “sample” column naming each sample — the run will stop.'
                  ) : (
                    <>
                      Samplesheet: the run will stop until this is fixed. Every condition in use
                      needs a value for every sample, and dose and time must be numbers (a vehicle’s
                      dose is 0):
                      {sheetIssueLines(sheetCheck.issues).map((line) => (
                        <div key={line}>• {line}</div>
                      ))}
                    </>
                  )}
                </StatusNote>
              ) : (
                <StatusNote kind="ok" style={styles.doneNote}>
                  Samplesheet checked
                </StatusNote>
              ))}
            {formatTab && (
              <DataFormatDialog initialTab={formatTab} onClose={() => setFormatTab(null)} />
            )}
          </>
        ) : (
          <>
            {/* Stacked: the header on its own line, then Browse + the file dropdown below, so a long
                        filename gets the full panel width instead of sharing the row with the label. */}
            <div style={styles.fieldCol}>
              <label style={styles.fieldColLabel}>raw data</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                <button
                  style={styles.btn}
                  onClick={() => void browseMatrix()}
                  title="Choose a data file from anywhere on disk"
                >
                  Browse…
                </button>
                <Select
                  value={config.matrix ?? ''}
                  onChange={(v) => update(id, { matrix: v || null })}
                  options={matrixOpts}
                />
              </div>
            </div>
            {!converted && <StatusNote kind="warn">Not configured — pipeline blocked</StatusNote>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <ConfigureButton
                label={converted ? 'Edit samples…' : 'Configure samples…'}
                disabled={!config.matrix}
                title={config.matrix ? undefined : 'Choose the raw data file first'}
                onClick={() => setDialogOpen(true)}
              />
            </div>
            {/* What the tile's check found, when it's more than ready (see the store's checkLoad). */}
            {converted && loadInfo && (
              <StatusNote
                kind={
                  loadInfo.tone === 'bad' ? 'error' : loadInfo.tone === 'busy' ? 'progress' : 'warn'
                }
              >
                {loadInfo.label}
              </StatusNote>
            )}
            {converted && loadInfo?.tone !== 'bad' && (
              <StatusNote kind="ok" style={styles.doneNote}>
                {/* The workflow folder's input: convertInteractive writes every generated file
                                (data, samplesheet, ID map) there. */}
                Ready · parsed data saved to input
                <button
                  style={{ ...styles.jumpBtn, ...(canJump ? null : { opacity: 0.4 }) }}
                  disabled={!canJump}
                  onClick={() => setViewerOpen(true)}
                  title={
                    canJump
                      ? 'Show in project folder'
                      : 'Save the project to see its folder in the project-folder viewer'
                  }
                  aria-label="Show in project folder"
                >
                  <IconJump />
                </button>
              </StatusNote>
            )}
            {/* Portalled: the panel can sit in the zoomed canvas, which would scale and clip a
                        fixed-position modal inside it. */}
            {viewerOpen &&
              dataDir &&
              inputDir &&
              createPortal(
                // The theme's colour variables are set on the app root, not body: carry them over.
                <div style={cssVars(PALETTES[themeMode])}>
                  <ProjectFolderViewer
                    root={dataDir}
                    reveal={inputDir}
                    onClose={() => setViewerOpen(false)}
                  />
                </div>,
                document.body
              )}
            {dialogOpen && <InteractiveImportDialog id={id} onClose={() => setDialogOpen(false)} />}
          </>
        )}
      </Section>
      {/* A manual samplesheet has no mapping step, so its conditions' types and units are set here
                (the interactive import sets them on its Conditions step): each condition's cat/num chip
                — fixed for the presets, a click for a custom one, which re-runs what's below — and a
                numeric one's unit (display-only — no re-run). */}
      {mode === 'manual' && (
        <Section title="Conditions">
          {sheetConds.length === 0 ? (
            <span style={styles.condNone}>
              {sheetText == null
                ? 'Choose a samplesheet first.'
                : 'No conditions in the samplesheet.'}
            </span>
          ) : (
            sheetConds.map((c) => {
              const preset = c === 'cell' || c === 'cmpd' || c === 'dose' || c === 'time'
              const num = c === 'dose' || c === 'time' || declaredNumeric(config).includes(c)
              const key = preset ? c : `@${c}`
              const what = num
                ? 'Numeric: its values are numbers on a scale, with a unit'
                : 'Categorical: its values are labels'
              return (
                <Field key={c} label={c}>
                  <span style={styles.condRow}>
                    {preset ? (
                      <span style={styles.typeChip} title={`${what} (fixed for ${c}).`}>
                        {num ? 'num' : 'cat'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        style={{ ...styles.typeChip, ...styles.typeChipBtn }}
                        title={`${what}. Click to make it ${num ? 'categorical' : 'numeric'} (re-runs what's below).`}
                        onClick={() => setNumeric(id, c, !num)}
                      >
                        {num ? 'num' : 'cat'}
                      </button>
                    )}
                    {/* any text is a unit (nM, mg/mL, MIC, %, h…); the list only suggests */}
                    {num ? (
                      <UnitInput
                        style={styles.input}
                        value={(config.units as Record<string, string | undefined>)?.[key]}
                        suggestions={c === 'time' ? TIME_UNIT_SUGGESTIONS : DOSE_UNIT_SUGGESTIONS}
                        onChange={(u) => setUnits(id, { [key]: u })}
                      />
                    ) : (
                      <span style={styles.condNone}>no unit</span>
                    )}
                  </span>
                </Field>
              )
            })
          )}
        </Section>
      )}
    </>
  )
}

/** Its settings panel (nodes/settings.ts). */
export function Settings({ id, config }: StepSettingsProps): ReactNode {
  return <LoadPanel id={id} config={config as LoadConfig} />
}
