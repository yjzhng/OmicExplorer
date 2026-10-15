/** The Save as dropdown's contents: save the project under a new name, or save a template of it.
 *  Project goes straight to the system save window; Template first expands to the sections it
 *  keeps (see graph/template.ts), then opens the save window on Save template. */
import { useState, type CSSProperties, type ReactNode } from 'react'

import { useGraph } from '../graph/store'
import {
  DEFAULT_TEMPLATE_SECTIONS,
  TEMPLATE_SECTIONS,
  type TemplateSections
} from '../graph/template'
import { UI } from './theme'

export function SaveAsMenu({ onClose }: { onClose: () => void }): ReactNode {
  const saveProjectAs = useGraph((s) => s.saveProjectAs)
  const saveTemplate = useGraph((s) => s.saveTemplate)
  const [template, setTemplate] = useState(false)
  const [sections, setSections] = useState<TemplateSections>(DEFAULT_TEMPLATE_SECTIONS)
  const [busy, setBusy] = useState(false)

  const asProject = (): void => {
    onClose()
    void saveProjectAs()
  }
  const asTemplate = async (): Promise<void> => {
    setBusy(true)
    const ok = await saveTemplate(sections)
    setBusy(false)
    // cancelled in the save window: stay open, so the choices aren't lost
    if (ok) onClose()
  }

  return (
    <>
      <div style={styles.head}>Save as</div>
      <button style={styles.action} onClick={asProject}>
        Project
      </button>
      <button
        style={{ ...styles.action, background: template ? UI.panelAlt : 'transparent' }}
        onClick={() => setTemplate((t) => !t)}
      >
        Template
      </button>

      {template && (
        <div style={styles.template}>
          <Row label="Workflows" checked disabled />
          {TEMPLATE_SECTIONS.map((s) => (
            <Row
              key={s.key}
              label={s.label}
              checked={sections[s.key]}
              onChange={(v) => setSections({ ...sections, [s.key]: v })}
            />
          ))}
          <div style={styles.foot}>
            <button style={styles.btnGhost} onClick={onClose}>
              Cancel
            </button>
            <button
              style={{ ...styles.btnPrimary, opacity: busy ? 0.5 : 1 }}
              disabled={busy}
              onClick={() => void asTemplate()}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/** One section's tickbox. */
function Row({
  label,
  checked,
  disabled,
  onChange
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange?: (v: boolean) => void
}): ReactNode {
  return (
    <label
      style={{
        ...styles.row,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        style={{ margin: 0 }}
      />
      {label}
    </label>
  )
}

const styles: Record<string, CSSProperties> = {
  // as the project menu's headings
  head: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    fontWeight: 700,
    padding: '8px 10px 4px'
  },
  action: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    color: UI.text,
    padding: '7px 10px',
    fontSize: 13,
    cursor: 'pointer',
    borderRadius: 6
  },
  template: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '8px 10px 6px',
    marginTop: 4,
    borderTop: `1px solid ${UI.border}`
  },
  row: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: UI.text },
  foot: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 },
  btnGhost: {
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: UI.accent,
    color: UI.accentText,
    border: 'none',
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  }
}
