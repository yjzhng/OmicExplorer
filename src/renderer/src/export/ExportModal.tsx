/** "Export" dialog: pick plots and/or tables, folder layout, per-type format (and DPI for
 *  plots), then write them under the project folder. A centred overlay (the app's only
 *  modal-style panel; every other popover is an anchored dropdown). */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import { useGraph } from '../graph/store'
import { UI } from '../ui/theme'
import {
  collectSpecs,
  collectTableExports,
  planPlotJobs,
  runExport,
  type ExportOptions,
  type ExportSummary
} from './plotExport'

type Scope = 'all' | 'selection'
type Structure = 'subfolder' | 'flat'

const DPI_CHOICES = [96, 150, 300, 600]

export function ExportModal({ onClose }: { onClose: () => void }): ReactNode {
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const results = useGraph((s) => s.results)
  const dataDir = useGraph((s) => s.dataDir)
  const canvasSelection = useGraph((s) => s.canvasSelection)
  const sel = useMemo(() => new Set(canvasSelection), [canvasSelection])

  // Plot chips count plots; the Export button counts files (a GOI-capable plot with focus
  // genes yields two files: all-genes + a GOI-subset variant).
  const specsAll = useMemo(() => collectSpecs(nodes, edges, results), [nodes, edges, results])
  const specsSel = useMemo(
    () => collectSpecs(nodes, edges, results, sel),
    [nodes, edges, results, sel]
  )
  const plotAll = specsAll.length
  const plotSel = specsSel.length
  // File counts fan out over facets + GOI variants (the same jobs the export renders).
  const plotFilesAll = useMemo(
    () => planPlotJobs(specsAll, edges, results).length,
    [specsAll, edges, results]
  )
  const plotFilesSel = useMemo(
    () => planPlotJobs(specsSel, edges, results).length,
    [specsSel, edges, results]
  )
  const tableAll = useMemo(
    () => collectTableExports(nodes, edges, results).length,
    [nodes, edges, results]
  )
  const tableSel = useMemo(
    () => collectTableExports(nodes, edges, results, sel).length,
    [nodes, edges, results, sel]
  )

  const [scope, setScope] = useState<Scope>('all')
  const [structure, setStructure] = useState<Structure>('subfolder')
  const [includePlots, setIncludePlots] = useState(true)
  const [includeTables, setIncludeTables] = useState(false)
  const [plotFormat, setPlotFormat] = useState<'png' | 'pdf'>('png')
  const [dpi, setDpi] = useState(300)
  const [tableFormat, setTableFormat] = useState<'csv' | 'xlsx'>('csv')
  const [baseDir, setBaseDir] = useState<string | null>(dataDir ? `${dataDir}/output` : null)

  const [phase, setPhase] = useState<'config' | 'running' | 'done'>('config')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [summary, setSummary] = useState<ExportSummary | null>(null)

  // "Selection" is only meaningful when the marquee holds ≥1 exportable item; else fall back.
  const selectionHasContent = plotSel + tableSel > 0
  const effectiveScope: Scope = scope === 'selection' && selectionHasContent ? 'selection' : 'all'
  const plotN = effectiveScope === 'selection' ? plotSel : plotAll
  const plotFiles = effectiveScope === 'selection' ? plotFilesSel : plotFilesAll
  const tableN = effectiveScope === 'selection' ? tableSel : tableAll
  const count = (includePlots ? plotFiles : 0) + (includeTables ? tableN : 0)
  const running = phase === 'running'

  async function chooseFolder(): Promise<void> {
    const picked = await window.api.pickDataDir()
    if (picked) setBaseDir(`${picked}/output`)
  }

  async function doExport(): Promise<void> {
    if (!baseDir) return
    setPhase('running')
    setProgress({ done: 0, total: count })
    const opts: ExportOptions = {
      scope: effectiveScope,
      structure,
      includePlots,
      includeTables,
      plotFormat,
      dpi,
      tableFormat,
      baseDir
    }
    try {
      const res = await runExport(opts, (done, total) => setProgress({ done, total }))
      setSummary(res)
    } catch (e) {
      setSummary({
        dir: baseDir,
        written: 0,
        skipped: 0,
        total: count,
        errors: [e instanceof Error ? e.message : String(e)]
      })
    }
    setPhase('done')
  }

  return (
    <>
      <div style={styles.scrim} onClick={running ? undefined : onClose} />
      <div style={styles.modal} role="dialog" aria-label="Export">
        <div style={styles.head}>Export</div>

        {phase === 'done' && summary ? (
          <DoneView summary={summary} onClose={onClose} />
        ) : running ? (
          <div style={styles.body}>
            <div style={styles.progressLabel}>
              Exporting {Math.min(progress.done + 1, progress.total)} / {progress.total}…
            </div>
            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressFill,
                  width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%'
                }}
              />
            </div>
          </div>
        ) : (
          <div style={styles.body}>
            <Field label="Include">
              <div style={styles.segmented}>
                <ToggleBtn
                  label={`Plots (${plotN})`}
                  on={includePlots}
                  disabled={plotAll === 0}
                  onClick={() => setIncludePlots((v) => !v)}
                />
                <ToggleBtn
                  label={`Tables (${tableN})`}
                  on={includeTables}
                  disabled={tableAll === 0}
                  onClick={() => setIncludeTables((v) => !v)}
                />
              </div>
            </Field>

            <Field label="Scope">
              <Segmented
                value={effectiveScope}
                onChange={(v) => setScope(v as Scope)}
                options={[
                  { v: 'all', label: 'All' },
                  { v: 'selection', label: 'Selection', disabled: !selectionHasContent }
                ]}
              />
            </Field>

            <Field label="Folder structure">
              <Segmented
                value={structure}
                onChange={(v) => setStructure(v as Structure)}
                options={[
                  { v: 'subfolder', label: 'Subfolder per analysis' },
                  { v: 'flat', label: 'Flat' }
                ]}
              />
            </Field>

            {includePlots && (
              <>
                <Field label="Plot format">
                  <Segmented
                    value={plotFormat}
                    onChange={(v) => setPlotFormat(v as 'png' | 'pdf')}
                    options={[
                      { v: 'png', label: 'PNG' },
                      { v: 'pdf', label: 'PDF' }
                    ]}
                  />
                </Field>
                <Field label="Plot quality">
                  <Segmented
                    value={String(dpi)}
                    onChange={(v) => setDpi(Number(v))}
                    options={DPI_CHOICES.map((d) => ({ v: String(d), label: `${d} dpi` }))}
                  />
                </Field>
              </>
            )}

            {includeTables && (
              <Field label="Table format">
                <Segmented
                  value={tableFormat}
                  onChange={(v) => setTableFormat(v as 'csv' | 'xlsx')}
                  options={[
                    { v: 'csv', label: 'CSV' },
                    { v: 'xlsx', label: 'XLSX' }
                  ]}
                />
              </Field>
            )}

            <Field label="Destination">
              <div style={styles.dest}>
                <span style={styles.destPath} title={baseDir ?? ''}>
                  {baseDir ?? 'No project folder — choose one'}
                </span>
                <button style={styles.linkBtn} onClick={chooseFolder}>
                  Change…
                </button>
              </div>
            </Field>

            <div style={styles.foot}>
              <button style={styles.btnGhost} onClick={onClose}>
                Cancel
              </button>
              <button
                style={{
                  ...styles.btnPrimary,
                  opacity: baseDir && count > 0 ? 1 : 0.5,
                  cursor: baseDir && count > 0 ? 'pointer' : 'default'
                }}
                disabled={!baseDir || count === 0}
                onClick={doExport}
              >
                Export {count} file{count === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function ToggleBtn({
  label,
  on,
  disabled,
  onClick
}: {
  label: string
  on: boolean
  disabled?: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        ...styles.segment,
        background: on && !disabled ? UI.accent : 'transparent',
        color: disabled ? UI.textMuted : on ? UI.accentText : UI.text,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer'
      }}
    >
      {label}
    </button>
  )
}

function DoneView({
  summary,
  onClose
}: {
  summary: ExportSummary
  onClose: () => void
}): ReactNode {
  return (
    <div style={styles.body}>
      <div style={styles.doneMsg}>
        Exported <b>{summary.written}</b> plot{summary.written === 1 ? '' : 's'}
        {summary.skipped > 0 ? ` · skipped ${summary.skipped} (no plot / not run)` : ''}.
      </div>
      <div style={styles.destPath} title={summary.dir}>
        {summary.dir}
      </div>
      {summary.errors.length > 0 && (
        <div style={styles.errBox}>
          {summary.errors.slice(0, 5).map((e, i) => (
            <div key={i}>{e}</div>
          ))}
          {summary.errors.length > 5 && <div>…and {summary.errors.length - 5} more</div>}
        </div>
      )}
      <div style={styles.foot}>
        <button style={styles.btnGhost} onClick={() => void window.api.revealFolder(summary.dir)}>
          Reveal folder
        </button>
        <button style={styles.btnPrimary} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div style={styles.field}>
      <div style={styles.fieldLabel}>{label}</div>
      {children}
    </div>
  )
}

function Segmented({
  value,
  onChange,
  options
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ v: string; label: string; disabled?: boolean }>
}): ReactNode {
  return (
    <div style={styles.segmented}>
      {options.map((o) => {
        const on = value === o.v
        return (
          <button
            key={o.v}
            disabled={o.disabled}
            onClick={() => onChange(o.v)}
            style={{
              ...styles.segment,
              background: on ? UI.accent : 'transparent',
              color: o.disabled ? UI.textMuted : on ? UI.accentText : UI.text,
              opacity: o.disabled ? 0.5 : 1,
              cursor: o.disabled ? 'default' : 'pointer'
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  scrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60 },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 440,
    maxWidth: '92vw',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 61,
    overflow: 'hidden'
  },
  head: {
    padding: '12px 16px',
    fontWeight: 700,
    fontSize: 14,
    color: UI.text,
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt
  },
  body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted
  },
  segmented: {
    display: 'inline-flex',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    overflow: 'hidden',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexWrap: 'wrap'
  },
  segment: {
    border: 'none',
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap'
  },
  dest: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '6px 8px'
  },
  destPath: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    color: UI.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    direction: 'rtl',
    textAlign: 'left'
  },
  linkBtn: {
    background: 'transparent',
    border: 'none',
    color: UI.accent,
    fontSize: 12,
    cursor: 'pointer',
    flex: '0 0 auto'
  },
  foot: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4
  },
  btnGhost: {
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 13,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: UI.accent,
    color: UI.accentText,
    border: 'none',
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  },
  progressLabel: { fontSize: 13, color: UI.text },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    overflow: 'hidden'
  },
  progressFill: { height: '100%', background: UI.accent, transition: 'width 120ms linear' },
  doneMsg: { fontSize: 13, color: UI.text },
  errBox: {
    fontSize: 11,
    color: '#e06c6c',
    background: UI.panelAlt,
    borderRadius: 6,
    padding: 8,
    maxHeight: 120,
    overflow: 'auto'
  }
}
