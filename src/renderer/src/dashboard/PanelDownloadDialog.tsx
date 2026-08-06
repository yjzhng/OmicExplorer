/** Small "Download panel" options window: pick a format (and DPI for plots), then save.
 *  Portalled to <body> because a dashboard tile sits inside react-grid-layout's transformed
 *  item, where a position:fixed panel would otherwise be offset instead of viewport-centred. */
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useGraph } from '../graph/store'
import { cssVars, PALETTES, UI } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'

export type DownloadFormat = 'png' | 'pdf' | 'csv' | 'xlsx'
export interface DownloadOpts {
  format: DownloadFormat
  dpi: number
  baseDir: string
}

const DPI_CHOICES = [96, 150, 300, 600]

export function PanelDownloadDialog({
  title,
  isPlot,
  busy,
  onClose,
  onConfirm
}: {
  title: string
  isPlot: boolean
  busy: boolean
  onClose: () => void
  onConfirm: (opts: DownloadOpts) => void
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

  return createPortal(
    <div style={cssVars(PALETTES[mode])}>
      <div style={styles.scrim} onClick={busy ? undefined : onClose} />
      <div style={styles.modal} role="dialog" aria-label="Download panel">
        <div style={styles.head}>Download · {title}</div>
        <div style={styles.body}>
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

          <div style={styles.foot}>
            <button style={styles.btnGhost} disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              style={{ ...styles.btnPrimary, opacity: busy || !baseDir ? 0.5 : 1 }}
              disabled={busy || !baseDir}
              onClick={() => baseDir && onConfirm({ format, dpi, baseDir })}
            >
              {busy ? 'Saving…' : 'Download'}
            </button>
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
