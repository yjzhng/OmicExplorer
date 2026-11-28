/** The samplesheet grid's rename bar: change a condition value across every sample at once. */
import { type ReactNode, useEffect, useState } from 'react'
import { Select as AppSelect } from '../../../ui/controls/Select'
import type { ColorOf, Field } from './fields'
import { styles } from './styles'
import { selectWidthFor } from './measure'

/** How the rename bar's value select shows a value — the empty one as "(blank)". */
const renameValueLabel = (v: string): string => (v === '' ? '(blank)' : v)

/** The colour dot and its gap ahead of a condition's name in the rename bar's condition select. */
const RENAME_DOT_W = 9 + 6

/** A pending refactor's matches: the condition, its values that would change (trimmed), and — in
 *  text mode — the text found in them (marked alone; otherwise the whole value is). */
export type RenamePreview = { field: Field; values: string[]; find?: string }

export function RenameBar({
  options,
  colorOf,
  onRename,
  onPreview
}: {
  /** each condition that carries values, with its distinct values (sorted) and how many samples
   *  carry each */
  options: Array<{ field: Field; values: Array<{ value: string; count: number }> }>
  colorOf: ColorOf
  onRename: (field: Field, map: Record<string, string>) => void
  /** the values the pending refactor would change (trimmed), for the table to highlight; null when
   *  nothing is pending */
  onPreview: (p: RenamePreview | null) => void
}): ReactNode {
  const [pickField, setPickField] = useState<Field | null>(null)
  const [pickValue, setPickValue] = useState<string | null>(null)
  const [next, setNext] = useState('')
  // 'value': one whole value → a new one. 'text': find text inside every value and replace it
  // (with nothing, to remove it — e.g. "min" from 360min).
  const [mode, setMode] = useState<'value' | 'text'>('value')
  const [find, setFind] = useState('')
  // While the bar has focus, the picked value is previewed even before a new one is typed.
  const [focused, setFocused] = useState(false)
  // Fall back to the first condition / value when the pick is gone (renamed away, untagged).
  const opt = options.find((o) => o.field === pickField) ?? options[0]
  const val = opt?.values.find((v) => v.value === pickValue) ?? opt?.values[0]
  const target = next.trim()
  // Text mode: each value containing the text, with every occurrence replaced (then trimmed).
  const textMap: Record<string, string> = {}
  let textCount = 0
  if (opt && mode === 'text' && find !== '')
    for (const v of opt.values)
      if (v.value.includes(find)) {
        const nv = v.value.split(find).join(next).trim()
        if (nv === v.value) continue
        textMap[v.value] = nv
        textCount += v.count
      }
  // What the table highlights: text mode's matches once there's text to find; value mode's picked
  // value while the bar has focus or a new value is typed. Cleared once applied (inputs reset).
  const previewValues =
    !opt || !val
      ? []
      : mode === 'text'
        ? Object.keys(textMap)
        : focused || target !== ''
          ? [val.value]
          : []
  const previewKey =
    opt && previewValues.length
      ? JSON.stringify([opt.field, previewValues, mode === 'text' ? find : undefined])
      : ''
  // Reported up only when the matches change (keyed by their JSON, not the fresh array each render).
  useEffect(() => {
    if (!previewKey) return onPreview(null)
    const [field, values, found] = JSON.parse(previewKey) as [Field, string[], string | null]
    onPreview({ field, values, ...(found ? { find: found } : null) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey])
  useEffect(
    () => () => onPreview(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  if (!opt || !val) return null
  const ready =
    mode === 'value' ? target !== '' && target !== val.value : Object.keys(textMap).length > 0
  const count = mode === 'value' ? val.count : textCount
  const apply = (): void => {
    if (!ready) return
    if (mode === 'value') {
      onRename(opt.field, { [val.value]: target })
      setPickValue(target)
    } else {
      onRename(opt.field, textMap)
      setFind('')
    }
    setNext('')
  }
  return (
    <div
      style={styles.renameBar}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <span style={styles.renameLabel}>refactor</span>
      <span
        // + the colour dot and its gap before each name
        style={{
          ...styles.renameSelect,
          width: selectWidthFor(options.map((o) => o.field)) + RENAME_DOT_W
        }}
        title="The condition whose value to refactor"
      >
        <AppSelect
          value={opt.field}
          options={options.map((o) => ({
            value: o.field,
            label: o.field,
            render: (
              <span style={styles.renameFieldOpt}>
                <span style={{ ...styles.chipDot, background: colorOf(o.field) }} />
                {o.field}
              </span>
            )
          }))}
          onChange={(f) => {
            setPickField(f)
            setPickValue(null)
          }}
        />
      </span>
      <span
        style={{ ...styles.renameSelect, width: selectWidthFor(['select', 'find']) }}
        title="Select: refactor one whole value · Find: replace text inside every value"
      >
        <AppSelect
          value={mode}
          options={[
            { value: 'value', label: 'select' },
            { value: 'text', label: 'find' }
          ]}
          onChange={(m) => setMode(m as 'value' | 'text')}
        />
      </span>
      {mode === 'value' ? (
        <span
          style={{
            ...styles.renameSelect,
            width: selectWidthFor(opt.values.map((v) => renameValueLabel(v.value)))
          }}
          title="The value to refactor, in every sample that carries it"
        >
          <AppSelect
            value={val.value}
            options={opt.values.map((v) => ({ value: v.value, label: renameValueLabel(v.value) }))}
            onChange={setPickValue}
          />
        </span>
      ) : (
        <input
          style={styles.renameInput}
          value={find}
          placeholder="find text"
          spellCheck={false}
          title="Text to replace inside every value of this condition"
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply()
            else if (e.key === 'Escape') setFind('')
          }}
        />
      )}
      <span style={styles.renameArrow}>→</span>
      <input
        style={styles.renameInput}
        value={next}
        placeholder={mode === 'value' ? 'new value' : 'replace with'}
        spellCheck={false}
        title={mode === 'text' ? 'Leave empty to remove the found text' : undefined}
        onChange={(e) => setNext(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply()
          else if (e.key === 'Escape') setNext('')
        }}
      />
      {/* The count and the action at the bar's right end. */}
      <span style={styles.renameEnd}>
        <span style={styles.renameCount}>
          {count} sample{count === 1 ? '' : 's'}
        </span>
        <button
          style={{ ...styles.btnPrimary, ...styles.renameBtn, opacity: ready ? 1 : 0.45 }}
          disabled={!ready}
          onClick={apply}
        >
          Refactor
        </button>
      </span>
    </div>
  )
}
