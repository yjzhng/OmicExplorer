/** Stage 1 of the import: classify each column — ID / Name / Sample / Metadata / Filter. */
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type InteractiveRole, MATRIX_PRESETS, type MatrixPreset } from '../../../engine'
import { UI } from '../../../ui/app/theme'
import { ScrollFade } from '../../../ui/table/ScrollFade'
import { longestText } from '../../../ui/table/useVirtualRows'
import { ProbeRow, VirtualTbody } from '../../../ui/table/VirtualRows'
import { InfoTip } from '../../../ui/controls/InfoTip'
import { Select as AppSelect } from '../../../ui/controls/Select'
import { ToggleSwitch } from '../../../ui/controls/ToggleSwitch'
import { styles } from './styles'
import { IconPaint } from './NamePainting'
import { scrollParentX } from './geometry'
import { COL_PAD, GENERATED_FILE } from './fields'
import { ROLE_CHIPS, ROLE_COLORS, ROLE_LABEL } from './roles'

/** Step 1: show the tile-selected matrix (auto-read on open), then classify columns by arming a
 *  role chip and clicking column headers. The preview is in normal (untransposed) form — columns
 *  across the top, first rows below — with each column's assigned role labelled above its header,
 *  mirroring the condition-tagging step. */
export function Step1Columns({
  matrix,
  inputFiles,
  inputFileFolders,
  onMatrix,
  onBrowse,
  preset,
  onPreset,
  detecting,
  onDetect,
  columns,
  roles,
  rows,
  onAssign
}: {
  matrix: string | null
  inputFiles: string[]
  /** each file's folder, relative to the data folder ('' = the folder itself) */
  inputFileFolders: Record<string, string>
  onMatrix: (file: string) => void
  onBrowse: () => void
  preset: MatrixPreset | 'custom'
  onPreset: (p: MatrixPreset) => void
  detecting: boolean
  onDetect: () => void
  columns: string[]
  roles: Record<string, InteractiveRole>
  rows: Record<string, string>[]
  onAssign: (headers: string[], role: InteractiveRole) => void
}): ReactNode {
  const [armed, setArmed] = useState<InteractiveRole | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  // A data file in the list: its folder (muted) before its name, so files in different subfolders
  // read apart.
  const fileOption = (f: string): { value: string; label: string; render?: ReactNode } => {
    const dir = inputFileFolders[f]
    return dir
      ? {
          value: f,
          label: `${dir}/${f}`,
          render: (
            <span>
              <span style={styles.fileDir}>{dir}/</span>
              {f}
            </span>
          )
        }
      : { value: f, label: f }
  }
  // Column-header drag range (indices into `columns`): `a` = anchor, `f` = current end.
  const [drag, setDrag] = useState<{ a: number; f: number } | null>(null)
  // Every row of the matrix scrolls; only those in view are drawn (ui/table/VirtualRows). Each column's
  // widest value (from a sample) sits in a hidden probe row, so the first fit-to-content sizing
  // fits the data, not just the rows drawn.
  const widest = useMemo(
    () => columns.map((c) => longestText(rows.length, (i) => rows[i][c] ?? '')),
    [columns, rows]
  )
  const lo = drag ? Math.min(drag.a, drag.f) : -1
  const hi = drag ? Math.max(drag.a, drag.f) : -1
  // The last header clicked without Shift: a Shift-click labels everything from it to the one
  // clicked, like a list's range select.
  const anchorRef = useRef<number | null>(null)
  // Press on a header: start a range (from the anchor when Shift is held) and follow the pointer
  // at document level until release — so a drag can run past the table's edge, which scrolls the
  // table and keeps extending the range: a long run of sample columns is one sweep.
  const startDrag = (i: number, e: React.MouseEvent): void => {
    if (!armed) return
    e.preventDefault()
    const role = armed
    const a = e.shiftKey && anchorRef.current != null ? anchorRef.current : i
    if (!e.shiftKey) anchorRef.current = i
    let range = { a, f: i }
    setDrag(range)
    const scroller = scrollParentX(headRefs.current[i])
    let x = e.clientX
    // The header under x, clamped into the visible part of the table (beyond an edge = the edge
    // column, while the auto-scroll brings more in).
    const colAt = (): number => {
      const box = scroller?.getBoundingClientRect()
      const cx = box ? Math.min(box.right - 2, Math.max(box.left + 2, x)) : x
      const heads = headRefs.current
      for (let k = 0; k < columns.length; k++) {
        const r = heads[k]?.getBoundingClientRect()
        if (r && cx < r.right) return k
      }
      return columns.length - 1
    }
    const track = (): void => {
      const f = colAt()
      if (f !== range.f) setDrag((range = { a, f }))
    }
    // Auto-scroll while the pointer is within EDGE px of an edge (or past it), faster the further.
    const EDGE = 40
    let raf = 0
    const tick = (): void => {
      raf = 0
      if (!scroller) return
      const box = scroller.getBoundingClientRect()
      const over =
        x > box.right - EDGE
          ? x - (box.right - EDGE)
          : x < box.left + EDGE
            ? x - (box.left + EDGE)
            : 0
      if (over === 0) return
      const before = scroller.scrollLeft
      scroller.scrollLeft += Math.sign(over) * Math.min(40, 4 + Math.abs(over) / 3)
      track()
      if (scroller.scrollLeft !== before) raf = requestAnimationFrame(tick)
    }
    const onMove = (ev: MouseEvent): void => {
      x = ev.clientX
      track()
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (raf) cancelAnimationFrame(raf)
      const cols = columns.slice(Math.min(range.a, range.f), Math.max(range.a, range.f) + 1)
      // A single header that already holds the armed role toggles back to Ignore.
      const clear = cols.length === 1 && roles[cols[0]] === role
      onAssign(cols, clear ? 'ignore' : role)
      setDrag(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Column widths (like the review grid): null = fit-to-content, which measures + pins the
  // column; a number is a user-set width. Reset to fit whenever the column set changes — done
  // during render (React's adjust-state-on-prop-change pattern) rather than in an effect.
  const headRefs = useRef<(HTMLTableCellElement | null)[]>([])
  const [widths, setWidths] = useState<(number | null)[]>(() => columns.map(() => null))
  const [colCount, setColCount] = useState(columns.length)
  if (colCount !== columns.length) {
    setColCount(columns.length)
    setWidths(columns.map(() => null))
  }
  const sized = widths.length === columns.length
  const fixed = sized && widths.every((w) => w != null)
  useLayoutEffect(() => {
    if (widths.length === columns.length && widths.some((w) => w == null)) {
      setWidths((prev) =>
        prev.map((w, i) => (w != null ? w : (headRefs.current[i]?.offsetWidth ?? 0) + COL_PAD))
      )
    }
  }, [widths, columns.length])
  const startResize = (i: number, startX: number): void => {
    const startW = widths[i] ?? headRefs.current[i]?.offsetWidth ?? 60
    const onMove = (ev: MouseEvent): void => {
      const w = Math.max(40, startW + (ev.clientX - startX))
      setWidths((prev) => prev.map((x, k) => (k === i ? w : x)))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  return (
    <>
      <div style={styles.row}>
        <span style={styles.label}>Data file</span>
        {/* The data file is chosen in the tile, but can be swapped here — the app's dropdown, so
            the user can re-point the import without leaving the wizard. An external file (picked
            via Browse, an absolute path outside the data folder) shows as its own option. */}
        <span style={styles.fileSelect} title={matrix ?? 'Choose a data file'}>
          <AppSelect
            value={matrix ?? ''}
            placeholder="— choose a data file —"
            onChange={onMatrix}
            options={[
              ...(matrix && !inputFiles.includes(matrix)
                ? [{ value: matrix, label: `${matrix.replace(/^.*[\\/]/, '')} (external)` }]
                : []),
              // Raw data files first; the standard files an import generates (…_datamatrix,
              // …_samplesheet, …_metadata; older …_wide, …_long, …_DB) grouped below under their
              // own heading.
              ...inputFiles.filter((f) => !GENERATED_FILE.test(f)).map(fileOption),
              ...(inputFiles.some((f) => GENERATED_FILE.test(f))
                ? [
                    {
                      value: '__generated__',
                      label: 'Generated files',
                      disabled: true,
                      render: <span style={styles.fileGroupHead}>Generated files</span>
                    },
                    ...inputFiles.filter((f) => GENERATED_FILE.test(f)).map(fileOption)
                  ]
                : [])
            ]}
          />
        </span>
        <button
          style={styles.btn}
          onClick={onBrowse}
          title="Choose a data file from anywhere on disk"
        >
          Browse…
        </button>
        <button
          style={{ ...styles.btn, opacity: !matrix || detecting ? 0.5 : 1 }}
          disabled={!matrix || detecting}
          onClick={onDetect}
          title="Re-read the data file columns"
        >
          {detecting ? 'Reading…' : 'Re-read'}
        </button>
      </div>
      {/* Preset: 'None' paints nothing; a tool preset auto-classifies for that export shape;
          'Custom' lights up automatically once columns are hand-edited. */}
      {/* A little air before the column-type chips, now that no hint paragraph sits between. */}
      <div style={{ ...styles.row, marginBottom: 6 }}>
        <span style={styles.label}>Preset</span>
        <ToggleSwitch
          label="Preset"
          value={preset}
          disabled={!matrix || detecting}
          options={[
            ...MATRIX_PRESETS.map(({ value, label }) => ({
              value: value as MatrixPreset | 'custom',
              label,
              title:
                value === 'none'
                  ? 'Clear all column labels'
                  : `Auto-detect columns as ${label} output`
            })),
            // Indicator only — set automatically on manual edits, not directly clickable.
            {
              value: 'custom' as const,
              label: 'Custom',
              disabled: true,
              title: 'Set automatically when you edit the column labels'
            }
          ]}
          onChange={(v) => {
            if (v !== 'custom') onPreset(v)
          }}
        />
      </div>
      {columns.length === 0 ? (
        <div style={styles.hint}>
          {matrix
            ? detecting
              ? 'Reading columns…'
              : 'No columns read yet — click Re-read, or pick a matrix in the Load tile.'
            : 'Pick a raw data matrix in the Load tile to begin.'}
        </div>
      ) : (
        <>
          <div style={styles.chips}>
            {/* What the chips do: pick one, then paint it onto column headers — how, in the (i). */}
            <span style={styles.paintLabel}>
              <IconPaint />
              Set column type
              <InfoTip label="How to set column types">
                Click a role, then click a column header — drag across several (past the edge to
                scroll), or Shift-click to take every column since the last one — to label them.
                Exactly one <b>ID</b> and one <b>Name</b>; any number of <b>Sample</b> and{' '}
                <b>Metadata</b>. Unlabelled columns are ignored.
              </InfoTip>
            </span>
            {ROLE_CHIPS.map((role) => {
              const on = armed === role
              const color = ROLE_COLORS[role]!
              const n = columns.filter((c) => roles[c] === role).length
              return (
                <button
                  key={role}
                  onClick={() => setArmed(on ? null : role)}
                  style={{
                    ...styles.chip,
                    background: on ? `${color}33` : 'transparent',
                    color: UI.text,
                    borderColor: on ? color : UI.border
                  }}
                >
                  <span style={{ ...styles.chipDot, background: color }} />
                  {ROLE_LABEL[role]}
                  {n > 0 && <span style={styles.chipCount}>{n}</span>}
                </button>
              )
            })}
          </div>
          <ScrollFade>
            <table style={{ ...styles.grid, tableLayout: fixed ? 'fixed' : 'auto' }}>
              <colgroup>
                {columns.map((c, i) => (
                  <col
                    key={c}
                    style={{ width: sized && widths[i] != null ? `${widths[i]}px` : undefined }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((c, i) => {
                    const role = roles[c] ?? 'ignore'
                    // Preview the armed role while dragging across the range, or hovering a header.
                    const inRange = drag ? i >= lo && i <= hi : hover === c
                    const preview = !!armed && inRange
                    const shownRole = preview ? armed! : role
                    const shownColor = ROLE_COLORS[shownRole]
                    return (
                      <th
                        key={c}
                        ref={(el) => {
                          headRefs.current[i] = el
                        }}
                        onMouseDown={armed ? (e) => startDrag(i, e) : undefined}
                        onMouseEnter={() => setHover(c)}
                        onMouseLeave={() => setHover((h) => (h === c ? null : h))}
                        title={
                          armed ? `Click, drag or Shift-click to label as ${ROLE_LABEL[armed]}` : c
                        }
                        style={{
                          ...styles.th,
                          ...styles.colHead,
                          cursor: armed ? 'pointer' : 'default',
                          // The role tint is translucent; laid over the header's solid colour so
                          // the sticky row stays opaque (rows scrolling under it don't show through).
                          background: shownColor
                            ? `linear-gradient(${shownColor}${preview ? '55' : '22'}, ${shownColor}${preview ? '55' : '22'}), ${UI.panelAlt}`
                            : UI.panelAlt
                        }}
                      >
                        <div style={{ ...styles.colRole, color: shownColor ?? 'transparent' }}>
                          {ROLE_LABEL[shownRole] ?? ' '}
                        </div>
                        <div style={styles.colName}>{c}</div>
                        <span
                          style={styles.resizer}
                          title="Drag to resize · double-click to fit content"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            startResize(i, e.clientX)
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            setWidths((prev) => prev.map((w, k) => (k === i ? null : w)))
                          }}
                        />
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <VirtualTbody
                count={rows.length}
                span={columns.length}
                tail={
                  <ProbeRow texts={widest} cellStyle={{ ...styles.td, ...styles.sampleCell }} />
                }
                row={(i) => {
                  const r = rows[i]
                  return (
                    <tr key={i}>
                      {columns.map((c) => {
                        const color = ROLE_COLORS[roles[c] ?? 'ignore']
                        return (
                          <td
                            key={c}
                            style={{
                              ...styles.td,
                              ...styles.sampleCell,
                              ...(fixed ? styles.clip : null),
                              color: UI.textMuted,
                              background: color ? `${color}0d` : undefined
                            }}
                            title={r[c]}
                          >
                            {r[c] ?? ''}
                          </td>
                        )
                      })}
                    </tr>
                  )
                }}
              />
            </table>
          </ScrollFade>
        </>
      )}
    </>
  )
}
