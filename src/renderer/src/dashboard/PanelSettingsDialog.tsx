/** Per-tile settings window, opened from the gear button in a panel header. Gathers the
 *  controls that used to live inline in the header — the All/GOI gene toggle, the
 *  landscape/portrait orientation switch — alongside the download options (format, DPI,
 *  destination). View controls apply live; Download is an explicit action.
 *  Portalled to <body> because a dashboard tile sits inside react-grid-layout's transformed
 *  item, where a position:fixed panel would otherwise be offset instead of viewport-centred. */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useGraph } from '../graph/store'
import type { ClusterConfig, PlotOrient } from '../graph/types'
import { cssVars, PALETTES, UI } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'

/** PCA/cluster computation controls, surfaced in the settings dialog. `standardize` gates the
 *  options that only apply to the sample (Standardize) path. */
export interface PcaSettings {
  cfg: ClusterConfig
  onChange: (patch: Partial<ClusterConfig>) => void
  standardize: boolean
}

export type DownloadFormat = 'png' | 'pdf' | 'csv' | 'xlsx'
export interface DownloadOpts {
  format: DownloadFormat
  dpi: number
  baseDir: string
}

const DPI_CHOICES = [96, 150, 300, 600]

export function PanelSettingsDialog({
  title,
  canToggle,
  goiOnly,
  onGoi,
  canOrient,
  orient,
  onOrient,
  canDownload,
  isPlot,
  pca,
  busy,
  onClose,
  onDownload
}: {
  title: string
  canToggle: boolean
  goiOnly: boolean
  onGoi: (v: boolean) => void
  canOrient: boolean
  orient: PlotOrient
  onOrient: (o: PlotOrient) => void
  canDownload: boolean
  isPlot: boolean
  pca?: PcaSettings
  busy: boolean
  onClose: () => void
  onDownload: (opts: DownloadOpts) => void
}): ReactNode {
  const dataDir = useGraph((s) => s.dataDir)
  const [format, setFormat] = useState<DownloadFormat>(isPlot ? 'png' : 'csv')
  const [dpi, setDpi] = useState(300)
  const [baseDir, setBaseDir] = useState<string | null>(dataDir ? `${dataDir}/output` : null)
  // The portal target (document.body) is outside the app root that defines the theme CSS
  // variables, so re-apply them here or UI.* (var(--…)) would resolve to nothing.
  const mode = useUiTheme((s) => s.mode)

  async function chooseFolder(): Promise<void> {
    const picked = await window.api.pickDataDir()
    if (picked) setBaseDir(`${picked}/output`)
  }

  const hasView = canToggle || canOrient

  return createPortal(
    <div style={cssVars(PALETTES[mode])}>
      <div style={styles.scrim} onClick={busy ? undefined : onClose} />
      <div style={styles.modal} role="dialog" aria-label="Panel settings">
        <div style={styles.head}>Settings · {title}</div>
        <div style={styles.body}>
          {pca && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>PCA</div>
              <Field label="Scaling">
                <Segmented
                  value={pca.cfg.scale ?? 'none'}
                  onChange={(v) => pca.onChange({ scale: v as ClusterConfig['scale'] })}
                  options={[
                    { v: 'none', label: 'Covariance' },
                    { v: 'unit', label: 'Unit variance' }
                  ]}
                />
              </Field>
              <Field label="Missing values">
                <Segmented
                  value={pca.cfg.missing ?? 'complete'}
                  onChange={(v) => pca.onChange({ missing: v as ClusterConfig['missing'] })}
                  options={[
                    { v: 'complete', label: 'Complete only' },
                    { v: 'impute', label: 'Impute mean' }
                  ]}
                />
              </Field>
              <Field label="Features">
                <Segmented
                  value={String(pca.cfg.topVar ?? 0)}
                  onChange={(v) => pca.onChange({ topVar: Number(v) })}
                  options={[
                    { v: '0', label: 'All' },
                    { v: '100', label: 'Top 100' },
                    { v: '250', label: 'Top 250' },
                    { v: '500', label: 'Top 500' }
                  ]}
                />
              </Field>
              {pca.standardize && (
                <>
                  <Field label="Normalize (per sample)">
                    <Segmented
                      value={pca.cfg.center ?? 'none'}
                      onChange={(v) => pca.onChange({ center: v as ClusterConfig['center'] })}
                      options={[
                        { v: 'none', label: 'None' },
                        { v: 'median', label: 'Median' },
                        { v: 'zscore', label: 'Z-score' },
                        { v: 'quantile', label: 'Quantile' }
                      ]}
                    />
                  </Field>
                  <Field label="Transform">
                    <Segmented
                      value={pca.cfg.transform ?? 'auto'}
                      onChange={(v) => pca.onChange({ transform: v as ClusterConfig['transform'] })}
                      options={[
                        { v: 'auto', label: 'Auto' },
                        { v: 'log2', label: 'log₂' },
                        { v: 'log10', label: 'log₁₀' },
                        { v: 'none', label: 'Linear' }
                      ]}
                    />
                  </Field>
                  <Field label="Replicates">
                    <Segmented
                      value={pca.cfg.replicates ?? 'individual'}
                      onChange={(v) => pca.onChange({ replicates: v as ClusterConfig['replicates'] })}
                      options={[
                        { v: 'individual', label: 'Individual' },
                        { v: 'mean', label: 'Condition mean' }
                      ]}
                    />
                  </Field>
                </>
              )}
            </div>
          )}
          {hasView && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>View</div>
              {canToggle && (
                <Field label="Genes">
                  <Segmented
                    value={goiOnly ? 'goi' : 'all'}
                    onChange={(v) => onGoi(v === 'goi')}
                    options={[
                      { v: 'all', label: 'All' },
                      { v: 'goi', label: 'GOI' }
                    ]}
                  />
                </Field>
              )}
              {canOrient && (
                <Field label="Orientation">
                  <Segmented
                    value={orient}
                    onChange={(v) => onOrient(v as PlotOrient)}
                    options={[
                      { v: 'landscape', label: 'Landscape' },
                      { v: 'portrait', label: 'Portrait' }
                    ]}
                  />
                </Field>
              )}
            </div>
          )}

          {canDownload && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Download</div>
              <Field label="Format">
                <Segmented
                  value={format}
                  onChange={(v) => setFormat(v as DownloadFormat)}
                  options={
                    isPlot
                      ? [
                          { v: 'png', label: 'PNG' },
                          { v: 'pdf', label: 'PDF' }
                        ]
                      : [
                          { v: 'csv', label: 'CSV' },
                          { v: 'xlsx', label: 'XLSX' }
                        ]
                  }
                />
              </Field>

              {isPlot && (
                <Field label="Quality">
                  <Segmented
                    value={String(dpi)}
                    onChange={(v) => setDpi(Number(v))}
                    options={DPI_CHOICES.map((d) => ({ v: String(d), label: `${d} dpi` }))}
                  />
                </Field>
              )}

              <Field label="Destination">
                <div style={styles.dest}>
                  <span style={styles.destPath} title={baseDir ?? ''}>
                    {baseDir ?? 'No project folder — choose one'}
                  </span>
                  <button style={styles.linkBtn} disabled={busy} onClick={chooseFolder}>
                    Change…
                  </button>
                </div>
              </Field>
            </div>
          )}

          <div style={styles.foot}>
            <button style={styles.btnGhost} disabled={busy} onClick={onClose}>
              Close
            </button>
            {canDownload && (
              <button
                style={{ ...styles.btnPrimary, opacity: busy || !baseDir ? 0.5 : 1 }}
                disabled={busy || !baseDir}
                onClick={() => baseDir && onDownload({ format, dpi, baseDir })}
              >
                {busy ? 'Saving…' : 'Download'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
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
  options: Array<{ v: string; label: string }>
}): ReactNode {
  return (
    <div style={styles.segmented}>
      {options.map((o) => {
        const on = value === o.v
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            style={{
              ...styles.segment,
              background: on ? UI.accent : 'transparent',
              color: on ? UI.accentText : UI.text
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
    width: 340,
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
    background: UI.panelAlt,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  body: { padding: 16, display: 'flex', flexDirection: 'column', gap: 18 },
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  sectionTitle: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: 700,
    color: UI.text,
    borderBottom: `1px solid ${UI.border}`,
    paddingBottom: 6
  },
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
    whiteSpace: 'nowrap',
    cursor: 'pointer'
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
  foot: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
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
  }
}
