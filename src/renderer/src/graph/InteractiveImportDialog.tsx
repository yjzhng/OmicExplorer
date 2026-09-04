/** Modal for interactive import — a 4-step wizard that recreates the standard input format from
 *  a raw data matrix, fully interactively:
 *   1. Columns  — classify each column: ID / Sample / Label / Metadata / Ignore.
 *   2. Conditions — tag each sample's strain/cmpd/dose/time/rep by clicking tokens.
 *   3. Samplesheet — review/correct the per-sample conditions.
 *   4. Metadata — review the DB (uniqID → gene + metadata) and convert.
 *  Portalled to <body> and flex-centred (crisp text). */
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import {
  applyFieldRule,
  columnFacet,
  deriveFieldRule,
  fieldRuleSpan,
  MATRIX_PRESETS,
  parseMatrix,
  type ColumnFacet,
  type FilterSpec,
  type InteractiveRole,
  type InteractiveSampleCond,
  type FieldRule,
  type MatrixPreset
} from '../engine'
import { cssVars, PALETTES, UI } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'
import { useGraph } from './store'
import { isStep, type AnnotationSet, type LoadConfig } from './types'

const FIELDS = ['strain', 'cmpd', 'dose', 'time', 'rep'] as const
type Field = (typeof FIELDS)[number]
type Rules = Partial<Record<Field, FieldRule>>

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** One colour per condition field, shared by the chips and the highlighted regions. */
const FIELD_COLORS: Record<Field, string> = {
  strain: '#4e79a7',
  cmpd: '#59a14f',
  dose: '#c99700',
  time: '#b07aa1',
  rep: '#e15759'
}

const DELIM = '_'

/** How many feature rows the step-4 DB review renders (a preview — the full DB is written on
 *  convert). Rendering every row of a large matrix is slow and needless. */
const PREVIEW_ROWS = 200

/** Review-grid columns (the active condition fields are chosen per-render in Stage2). */
type Col = 'include' | 'sample' | Field
/** Extra px added to a measured content width so the input isn't cramped. */
const COL_PAD = 12

/** Character index → field whose region covers it (or null). */
function fieldMap(name: string, rules: Rules): (Field | null)[] {
  const m: (Field | null)[] = new Array(name.length).fill(null)
  for (const f of FIELDS) {
    const rule = rules[f]
    if (!rule) continue
    const span = fieldRuleSpan(name, rule)
    if (!span) continue
    for (let k = span[0]; k < Math.min(span[1], name.length); k++) m[k] = f
  }
  return m
}

/** Split a name into consecutive same-field runs. */
function fieldRuns(
  name: string,
  map: (Field | null)[]
): Array<{ text: string; field: Field | null }> {
  const out: Array<{ text: string; field: Field | null }> = []
  let i = 0
  while (i < name.length) {
    const f = map[i]
    let j = i + 1
    while (j < name.length && map[j] === f) j++
    out.push({ text: name.slice(i, j), field: f })
    i = j
  }
  return out
}

/** Sample name with each learned field's region highlighted in its colour. Kept as inline
 *  spans so container-relative offsets still resolve for teaching. */
function HighlightedName({ name, rules }: { name: string; rules: Rules }): ReactNode {
  return (
    <>
      {fieldRuns(name, fieldMap(name, rules)).map((r, i) =>
        r.field ? (
          <mark
            key={i}
            style={{ background: `${FIELD_COLORS[r.field]}59`, color: 'inherit', padding: 0 }}
          >
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        )
      )}
    </>
  )
}

/** Ruler for the strip above the table: the first sample's text is hidden (reserving identical
 *  monospace widths) and each annotated region gets a centred, visible field label — so labels
 *  live above the table region, aligned to the substring in the first row below. */
function RulerName({ name, rules }: { name: string; rules: Rules }): ReactNode {
  return (
    <>
      {fieldRuns(name, fieldMap(name, rules)).map((r, i) =>
        r.field ? (
          <span key={i} style={{ position: 'relative', visibility: 'hidden' }}>
            {r.text}
            <span style={{ ...rulerLabel, visibility: 'visible', color: FIELD_COLORS[r.field] }}>
              {r.field}
            </span>
          </span>
        ) : (
          <span key={i} style={{ visibility: 'hidden' }}>
            {r.text}
          </span>
        )
      )}
    </>
  )
}

const rulerLabel: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 2,
  // Always angle labels 45° up so adjacent labels never overlap, even when their regions are only
  // a token or two apart. Anchored at the region's centre-bottom, ascending to the right.
  transform: 'rotate(-45deg)',
  transformOrigin: 'left bottom',
  fontSize: 11,
  lineHeight: 1,
  fontWeight: 700,
  letterSpacing: 0.2,
  whiteSpace: 'nowrap',
  pointerEvents: 'none'
}

/** Interactive first row: each delimiter-separated token is a clickable span. With a field
 *  active, click a token to tag it, or drag across tokens to tag a multi-token chunk. Applied
 *  regions show in their field colour; hover/drag previews in the active field's colour. */
function TeacherRow({
  name,
  rules,
  armed,
  onAnnotate
}: {
  name: string
  rules: Rules
  armed: Field | null
  onAnnotate: (charStart: number, charEnd: number) => void
}): ReactNode {
  const [drag, setDrag] = useState<{ a: number; f: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const tokens = name.split(DELIM)
  const starts: number[] = []
  let p = 0
  for (const t of tokens) {
    starts.push(p)
    p += t.length + DELIM.length
  }
  const map = fieldMap(name, rules)
  const lo = drag ? Math.min(drag.a, drag.f) : -1
  const hi = drag ? Math.max(drag.a, drag.f) : -1

  const finish = (): void => {
    if (drag && armed) onAnnotate(starts[lo], starts[hi] + tokens[hi].length)
    setDrag(null)
  }
  // `fallback` is the idle background: a faint chip for tokens (so token boundaries read as
  // discrete units), transparent for the delimiters between them (the visual gap).
  const bgFor = (applied: Field | null, active: boolean, fallback: string): string =>
    active && armed ? `${FIELD_COLORS[armed]}80` : applied ? `${FIELD_COLORS[applied]}59` : fallback

  return (
    <td
      style={{ ...styles.nameCell, ...styles.teachCell }}
      onMouseUp={finish}
      onMouseLeave={() => {
        setHover(null)
        setDrag(null)
      }}
    >
      {tokens.map((tok, i) => {
        const tokenActive = drag ? i >= lo && i <= hi : hover === i
        const delimActive = drag ? i >= lo && i < hi : false
        return (
          <Fragment key={i}>
            <span
              onMouseDown={armed ? () => setDrag({ a: i, f: i }) : undefined}
              onMouseEnter={() => {
                setHover(i)
                setDrag((d) => (d ? { a: d.a, f: i } : d))
              }}
              style={{
                background: bgFor(map[starts[i]], tokenActive, CHIP_BG),
                cursor: armed ? 'pointer' : 'default',
                borderRadius: 3,
                padding: '1px 0'
              }}
            >
              {tok}
            </span>
            {i < tokens.length - 1 && (
              <span
                style={{
                  background: bgFor(map[starts[i] + tok.length], delimActive, 'transparent')
                }}
              >
                {DELIM}
              </span>
            )}
          </Fragment>
        )
      })}
    </td>
  )
}

/** Faint idle background so each token reads as a discrete chip. */
const CHIP_BG = 'rgba(128,128,128,0.16)'

/** A scroll box (with a max height) that shows a soft shadow on any edge where content is
 *  scrolled out of view — so it's clear when the table extends past the visible area. */
function ScrollFade({ children }: { children: ReactNode }): ReactNode {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ top: false, bottom: false, left: false, right: false })
  // Height of a sticky header (if any) so the top/side fades start below it, not over it.
  const [headerH, setHeaderH] = useState(0)
  const update = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const thead = el.querySelector('thead')
    setHeaderH((h) => {
      const nh = thead instanceof HTMLElement ? thead.offsetHeight : 0
      return h === nh ? h : nh
    })
    const next = {
      top: el.scrollTop > 0,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
      left: el.scrollLeft > 0,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    }
    setEdges((prev) =>
      prev.top === next.top &&
      prev.bottom === next.bottom &&
      prev.left === next.left &&
      prev.right === next.right
        ? prev
        : next
    )
  }, [])
  useLayoutEffect(() => {
    update()
    const ro = new ResizeObserver(update)
    if (scrollRef.current) ro.observe(scrollRef.current)
    if (contentRef.current) ro.observe(contentRef.current)
    return () => ro.disconnect()
  }, [update])
  return (
    <div style={styles.fadeWrap}>
      <div ref={scrollRef} onScroll={update} style={styles.fadeScroll}>
        <div ref={contentRef}>{children}</div>
      </div>
      {edges.top && <div style={{ ...styles.fade, ...styles.fadeTop, top: headerH }} />}
      {edges.bottom && <div style={{ ...styles.fade, ...styles.fadeBottom }} />}
      {edges.left && <div style={{ ...styles.fade, ...styles.fadeLeft, top: headerH }} />}
      {edges.right && <div style={{ ...styles.fade, ...styles.fadeRight, top: headerH }} />}
    </div>
  )
}

/** Wizard stages: Columns · Filtering · Conditions · Samplesheet · Metadata. */
type Stage = 1 | 2 | 3 | 4 | 5

/** Next/previous stage, skipping Filtering (stage 2) when no column is a filter. */
function nextStage(s: Stage, hasFilters: boolean): Stage {
  if (s === 1) return hasFilters ? 2 : 3
  return Math.min(5, s + 1) as Stage
}
function prevStage(s: Stage, hasFilters: boolean): Stage {
  if (s === 3) return hasFilters ? 2 : 1
  return Math.max(1, s - 1) as Stage
}

/** Completed-stage green, matching the tile status dot. */
const DONE_GREEN = '#3fae5a'

/** Top-of-modal roadmap: the 4 wizard stages as numbered pills joined by connectors. A stage
 *  the user has finished (before the current one) reads green with a ✓; the current stage is
 *  accent-highlighted; stages not yet reached stay grey. When `allDone` (the import was already
 *  converted), every stage reads green. Display-only. */
function Roadmap({
  stage,
  names,
  allDone,
  onJump
}: {
  stage: number
  names: string[]
  allDone: boolean
  onJump: (stage: number) => void
}): ReactNode {
  return (
    <div style={styles.roadmap}>
      {names.map((name, i) => {
        const n = i + 1
        const done = allDone || n < stage
        // The stage the user is on — marked even when every stage is complete, so "you are here"
        // stays visible among all-green pills (accent ring + accent label).
        const current = n === stage
        // Completed (green) stages are clickable to jump straight there; the current stage and
        // not-yet-reached stages aren't.
        const clickable = !current && done
        // The current pill always uses the accent look (ring + accent fill + number), whether or
        // not the import is complete — so "you are here" reads identically in both states.
        const dotBg = current ? UI.accent : done ? DONE_GREEN : 'transparent'
        const dotBorder = current ? UI.accent : done ? DONE_GREEN : UI.border
        const dotFg = done || current ? '#fff' : UI.textMuted
        return (
          <Fragment key={name}>
            {i > 0 && (
              <div
                style={{
                  ...styles.roadLine,
                  background: allDone || n <= stage ? DONE_GREEN : UI.border
                }}
              />
            )}
            <div
              style={{ ...styles.roadStep, cursor: clickable ? 'pointer' : 'default' }}
              onClick={clickable ? () => onJump(n) : undefined}
              role={clickable ? 'button' : undefined}
              title={clickable ? `Go to ${name}` : undefined}
            >
              <span
                style={{
                  ...styles.roadDot,
                  background: dotBg,
                  borderColor: dotBorder,
                  color: dotFg,
                  // A ring around the current pill so it reads as "here" even when it's green.
                  ...(current ? { boxShadow: `0 0 0 3px ${UI.accent}55` } : null)
                }}
              >
                {done && !current ? '✓' : n}
              </span>
              <span
                style={{
                  ...styles.roadLabel,
                  color: current ? UI.accent : done ? DONE_GREEN : UI.textMuted,
                  fontWeight: current ? 700 : 600
                }}
              >
                {name}
              </span>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

/** UniProt fields offered by the annotation fetch (id → display label + resulting DB column).
 *  A fetch always pulls ALL of these and caches them, so toggling which are shown never refetches. */
const UNIPROT_FIELDS: { id: string; label: string; col: string }[] = [
  { id: 'protein_name', label: 'Protein name', col: 'proteinName' },
  { id: 'gene_names', label: 'Gene name', col: 'geneName' },
  { id: 'go', label: 'GO terms', col: 'GO' },
  { id: 'kegg', label: 'KEGG pathway', col: 'keggPathway' },
  { id: 'string', label: 'STRING', col: 'stringId' },
  // Local DEG (Database of Essential Genes) join by UniProt accession — no network.
  { id: 'essentiality', label: 'Essential gene (DEG)', col: 'essentiality' }
]
const colsForIds = (ids: string[]): string[] =>
  UNIPROT_FIELDS.filter((f) => ids.includes(f.id)).map((f) => f.col)

export function InteractiveImportDialog({ id, onClose }: { id: string; onClose: () => void }): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const cfg = useGraph((s) => {
    const n = s.nodes.find((x) => x.id === id)
    return n && isStep(n) && n.data.kind === 'load' ? (n.data.config as LoadConfig) : null
  })
  const dataDir = useGraph((s) => s.dataDir)
  const inputFiles = useGraph((s) => s.inputFiles)
  const update = useGraph((s) => s.updateConfig)
  const detectInteractive = useGraph((s) => s.detectInteractive)
  const convertInteractive = useGraph((s) => s.convertInteractive)
  const setInteractive = useGraph((s) => s.setInteractive)

  // Wizard step + preset are restored from config so reopening lands on the last stage the user
  // was on (roadmap included), with the same column preset — mirroring how roles/conditions persist.
  const [stage, setStage] = useState<Stage>(() => {
    const s = cfg?.interactive?.step
    return s && s >= 1 && s <= 5 ? (s as Stage) : 1
  })
  const [armed, setArmed] = useState<Field | null>(null)
  const [preview, setPreview] = useState<{
    rows: Record<string, string>[]
    total: number
  } | null>(null)
  // The FULL parsed matrix rows (not just the capped preview), so the Filtering step can compute
  // distinct-value facets and kept-row counts over every row. Set once per matrix load.
  const [allRows, setAllRows] = useState<Record<string, string>[]>([])
  const [detecting, setDetecting] = useState(false)
  const [converting, setConverting] = useState(false)
  const [confirmedSheet, setConfirmedSheet] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // Annotation fetch (Metadata step): status text + in-flight flag.
  const [annBusy, setAnnBusy] = useState(false)
  const [annMsg, setAnnMsg] = useState<string | null>(null)
  // Active classification mode: 'none' (default, nothing painted) or a tool preset re-runs
  // detection; 'custom' is set automatically once the user hand-edits any column's role.
  const [preset, setPreset] = useState<MatrixPreset | 'custom'>(
    () => cfg?.interactive?.preset ?? 'none'
  )
  // Persist the current stage + preset so reopening the wizard restores them. Only write once the
  // import spec exists (columns detected), so we never create a degenerate interactive object.
  useEffect(() => {
    if (cfg?.interactive && cfg.interactive.step !== stage) setInteractive(id, { step: stage })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])
  useEffect(() => {
    if (cfg?.interactive && cfg.interactive.preset !== preset) setInteractive(id, { preset })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  const matrix = cfg?.matrix ?? null
  // Load the matrix once for previews: the data rows for step 1 and the DB rows for step 4.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!matrix || !dataDir) {
        if (!cancelled) {
          setPreview(null)
          setAllRows([])
        }
        return
      }
      const text = await window.api.readDataFile(dataDir, matrix)
      if (cancelled) return
      try {
        // Cap the rendered preview rows (step 1 shows a handful, step 4 a review sample) — rendering
        // every feature row is slow and needless; the full DB is written from the matrix on convert.
        const info = text ? parseMatrix(text) : null
        setAllRows(info?.rows ?? [])
        setPreview(info ? { rows: info.rows.slice(0, PREVIEW_ROWS), total: info.rows.length } : null)
      } catch {
        setAllRows([])
        setPreview(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [matrix, dataDir])

  // Auto-read columns when the dialog opens with a matrix already chosen (from the tile) and
  // nothing classified yet — so step 1 is populated without a manual "Read columns" click. Only
  // fires while unclassified, so it never overwrites an existing classification (flips false once
  // detect populates columns).
  const needsDetect = !!matrix && !!dataDir && (cfg?.interactive?.columns?.length ?? 0) === 0
  useEffect(() => {
    if (!needsDetect) return
    let cancelled = false
    void (async () => {
      setDetecting(true)
      setMsg(null)
      const res = await detectInteractive(id)
      // Always clear the busy flag (else the preset chips stay disabled); only skip the message
      // when this run has been superseded (e.g. columns already populated → needsDetect flipped).
      setDetecting(false)
      if (!cancelled) {
        setMsg(res.ok ? `Found ${res.count} sample columns` : `Error: ${res.error}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [needsDetect, id, detectInteractive])

  if (!cfg) return null
  const interactive = cfg.interactive
  // A previously-completed import has its three standard files generated (see convertInteractive);
  // reopening it shows every roadmap stage green.
  const completed = !!(cfg.data && cfg.samplesheet && cfg.db)
  const roles = interactive?.roles ?? {}
  const conditions = interactive?.conditions ?? {}
  const columns = interactive?.columns ?? []
  const sampleCols = columns.filter((c) => roles[c] === 'sample')
  const idCol = columns.find((c) => roles[c] === 'id') ?? null
  const labelCol = columns.find((c) => roles[c] === 'label') ?? null
  const metaCols = columns.filter((c) => roles[c] === 'meta')
  const filterCols = columns.filter((c) => roles[c] === 'filter')
  const filters = interactive?.filters ?? {}
  // Learned condition-name regions (Conditions step). Persisted in config like column roles, so
  // reopening the wizard restores the highlights and the applied conditions read back together.
  const rules: Rules = (interactive?.rules as Rules | undefined) ?? {}
  // Bulk commit — the Filtering step edits a local draft and writes it all at once on Apply/Reset.
  const setFilters = (next: Record<string, FilterSpec>): void => {
    setInteractive(id, { filters: next })
  }
  const blank = (h: string): InteractiveSampleCond => ({
    sample: h,
    include: true,
    strain: '',
    cmpd: '',
    dose: '',
    time: '',
    rep: ''
  })
  const samples: InteractiveSampleCond[] = sampleCols.map((sc) => conditions[sc] ?? blank(sc))

  // Assign a role to one or more columns in a single merge (so a drag over several headers
  // applies to all of them, rather than each write clobbering the previous).
  const setRoles = (headers: string[], role: InteractiveRole): void => {
    if (headers.length === 0) return
    const next: Record<string, InteractiveRole> = { ...roles }
    for (const h of headers) next[h] = role
    // Exactly one id / label — keep the last selected and demote any other holder to metadata.
    if (role === 'id' || role === 'label') {
      const keep = headers[headers.length - 1]
      for (const c of columns) if (c !== keep && next[c] === role) next[c] = 'meta'
    }
    setInteractive(id, { roles: next })
  }

  const setCell = (i: number, key: keyof InteractiveSampleCond, value: string | boolean): void => {
    const h = sampleCols[i]
    const cur = conditions[h] ?? blank(h)
    setInteractive(id, { conditions: { ...conditions, [h]: { ...cur, [key]: value } } })
  }

  // Refactor (bulk-rename) one condition value across every sample that carries it — e.g. rename
  // "drugA" → "Drug A" in the cmpd column everywhere in one edit.
  const renameConditionValue = (field: Field, oldVal: string, newVal: string): void => {
    if (oldVal === newVal) return
    const next: Record<string, InteractiveSampleCond> = { ...conditions }
    for (const sc of sampleCols) {
      const cur = conditions[sc] ?? blank(sc)
      if (String(cur[field] ?? '') === oldVal) next[sc] = { ...cur, [field]: newVal }
    }
    setInteractive(id, { conditions: next })
  }

  // Tag the active field from a token/char range on the FIRST sample header, apply to every
  // sample. Re-tagging the same range clears the field.
  const annotate = (charStart: number, charEnd: number): void => {
    const field = armed
    if (!field || sampleCols.length === 0) return
    const rule = deriveFieldRule(sampleCols[0], charStart, charEnd)
    if (!rule) return
    const cur = rules[field]
    const same = cur ? JSON.stringify(cur) === JSON.stringify(rule) : false
    const nextConditions: Record<string, InteractiveSampleCond> = { ...conditions }
    for (const sc of sampleCols) {
      const base = nextConditions[sc] ?? blank(sc)
      nextConditions[sc] = { ...base, [field]: same ? '' : applyFieldRule(sc, rule) }
    }
    // Persist the learned region alongside the applied conditions in one patch, so both are
    // remembered together (re-tagging the same region clears the field's rule).
    const nextRules: Rules = { ...rules }
    if (same) delete nextRules[field]
    else nextRules[field] = rule
    setInteractive(id, { conditions: nextConditions, rules: nextRules as Record<string, FieldRule> })
    setMsg(same ? `Cleared ${field}` : `Applied ${field} to ${sampleCols.length} samples`)
  }

  // Read the current matrix and (re)seed the column classification using a preset.
  const detectWith = async (p: MatrixPreset): Promise<void> => {
    setDetecting(true)
    setMsg(null)
    const res = await detectInteractive(id, p)
    setDetecting(false)
    if (!res.ok) setMsg(`Error: ${res.error}`)
    else setMsg(p === 'none' ? 'Cleared — assign columns or pick a preset.' : `Found ${res.count} sample columns`)
  }
  // A 'custom' state has no detector — re-reading falls back to 'none' (paint nothing).
  const detectPreset: MatrixPreset = preset === 'custom' ? 'none' : preset
  const runDetect = (): Promise<void> => detectWith(detectPreset)
  // Pick a preset: remember it and re-classify the columns for that tool's export shape.
  const applyPreset = async (p: MatrixPreset): Promise<void> => {
    setPreset(p)
    await detectWith(p)
  }
  // Manual role edits flip the mode to 'custom' (see the preset toggle).
  const assignRoles = (headers: string[], role: InteractiveRole): void => {
    setRoles(headers, role)
    setPreset('custom')
  }
  // Switch the source data file from within the dialog, then re-read its columns.
  const changeMatrix = async (file: string): Promise<void> => {
    if (!file || file === matrix) return
    update(id, { matrix: file })
    setPreset(detectPreset)
    await detectWith(detectPreset)
  }
  // Browse the whole filesystem for a matrix (not restricted to the data folder), then switch to it.
  const browseMatrix = async (): Promise<void> => {
    const path = await window.api.pickDataFile()
    if (path) await changeMatrix(path)
  }

  const STEP_NAMES = ['Columns', 'Filtering', 'Conditions', 'Samplesheet', 'Metadata']
  const hasFilters = filterCols.length > 0
  // Filtering (stage 2) is skipped entirely when no column is classified `filter`: Next from
  // Columns jumps to Conditions, and Back from Conditions jumps to Columns.
  const goNext = (): void => {
    setMsg(null)
    setStage((s) => nextStage(s, hasFilters))
  }
  const goBack = (): void => {
    setMsg(null)
    setStage((s) => prevStage(s, hasFilters))
  }
  const canNext =
    stage === 1 ? !!idCol && sampleCols.length > 0 : stage === 4 ? confirmedSheet : true
  // Why Next is blocked (shown next to the button), so it's clear what's still needed.
  const nextBlock =
    canNext || stage >= 5
      ? ''
      : stage === 1
        ? !idCol && sampleCols.length === 0
          ? 'Mark an ID column and at least one Sample column'
          : !idCol
            ? 'Mark an ID column'
            : 'Mark at least one Sample column'
        : stage === 4
          ? 'Tick “Everything is correct” to continue'
          : ''

  // Metadata preview must reflect the Filtering step — rows dropped by an active filter must not
  // appear in (or be counted for) the generated DB. Computed only on the Metadata step (a single
  // pass over the full matrix); with no active filters it's the plain preview.
  const metaPreview = ((): { rows: Record<string, string>[]; total: number } | null => {
    if (stage !== 5) return preview
    const active = filterCols
      .filter((c) => filters[c]?.active)
      .map((c) => ({ col: c, drop: new Set(filters[c].drop ?? []), spec: filters[c] }))
    if (active.length === 0) return preview
    const rows: Record<string, string>[] = []
    let total = 0
    for (const r of allRows) {
      let ok = true
      for (const { col, drop, spec } of active) {
        const raw = (r[col] ?? '').trim()
        if (drop.size > 0 && drop.has(raw)) {
          ok = false
          break
        }
        if (spec.min != null || spec.max != null) {
          const x = Number(raw)
          if (!Number.isFinite(x) || (spec.min != null && x < spec.min) || (spec.max != null && x > spec.max)) {
            ok = false
            break
          }
        }
      }
      if (ok) {
        total++
        if (rows.length < PREVIEW_ROWS) rows.push(r)
      }
    }
    return { rows, total }
  })()

  const annotations = interactive?.annotations
  // Toggling which annotation columns are shown just re-slices the cached data — no refetch.
  const setAnnotationFields = (selectedIds: string[]): void => {
    if (!annotations) return
    setInteractive(id, { annotations: { ...annotations, fields: colsForIds(selectedIds) } })
  }
  // Fetch annotations for every kept feature and merge them into the DB (persisted in config,
  // written on convert). Runs in the main process (no renderer CSP) via window.api. Only the
  // SELECTED fields are fetched, but results are MERGED into any previously-fetched columns — so
  // a plain re-slice of already-fetched fields (see setAnnotationFields) never hits the network.
  const runFetchAnnotations = async (selectedIds: string[]): Promise<void> => {
    if (!idCol || annBusy) return
    const wantsString = selectedIds.includes('string')
    setAnnBusy(true)
    setAnnMsg(wantsString ? '1/3 Fetching annotations & STRING ids (UniProt)…' : 'Fetching from UniProt…')
    try {
      const active = filterCols
        .filter((c) => filters[c]?.active)
        .map((c) => ({ col: c, drop: new Set(filters[c].drop ?? []), spec: filters[c] }))
      const passes = (r: Record<string, string>): boolean => {
        for (const { col, drop, spec } of active) {
          const raw = (r[col] ?? '').trim()
          if (drop.size > 0 && drop.has(raw)) return false
          if (spec.min != null || spec.max != null) {
            const x = Number(raw)
            if (
              !Number.isFinite(x) ||
              (spec.min != null && x < spec.min) ||
              (spec.max != null && x > spec.max)
            )
              return false
          }
        }
        return true
      }
      // A feature id → clean UniProt accession: first of a `;`-group, middle of `sp|ACC|NAME`,
      // minus any isoform suffix.
      const accOf = (uid: string): string => {
        const first = uid.split(';')[0].trim()
        const parts = first.split('|')
        return (parts.length >= 2 ? parts[1] : first).replace(/-\d+$/, '').trim()
      }
      const accByUniq = new Map<string, string>()
      const accSet = new Set<string>()
      for (const r of allRows) {
        if (active.length && !passes(r)) continue
        const uid = (r[idCol] ?? '').trim()
        if (!uid || accByUniq.has(uid)) continue
        const acc = accOf(uid)
        accByUniq.set(uid, acc)
        if (acc) accSet.add(acc)
      }
      if (accSet.size === 0) {
        setAnnMsg('No accessions found in the ID column.')
        return
      }
      const base = wantsString ? '1/3 Fetching annotations & STRING ids (UniProt)…' : 'Fetching from UniProt…'
      const offAnn = window.api.onAnnotProgress((p) => {
        setAnnMsg(p.total > 0 ? `${base} ${p.done}/${p.total}` : base)
      })
      let res: Awaited<ReturnType<typeof window.api.fetchUniprot>>
      try {
        res = await window.api.fetchUniprot([...accSet], selectedIds)
      } finally {
        offAnn()
      }
      // Merge onto any previously-fetched columns so this fetch only adds/refreshes the selected
      // ones instead of wiping the rest of the cache.
      const prev = annotations?.byId ?? {}
      const byId: Record<string, Record<string, string>> = {}
      for (const [uid, acc] of accByUniq) {
        const rec = res.byId[acc]
        if (prev[uid] || rec) byId[uid] = { ...(prev[uid] ?? {}), ...(rec ?? {}) }
      }
      // Keep any species / KEGG-org / categories already learned from a prior fetch if this one
      // didn't resolve them (a fully-cached fetch returns no new categories).
      const taxon = res.taxon && res.taxon > 0 ? res.taxon : annotations?.taxon
      const keggOrg = res.keggOrg || annotations?.keggOrg
      const keggCategories =
        res.keggCategories && Object.keys(res.keggCategories).length
          ? { ...annotations?.keggCategories, ...res.keggCategories }
          : annotations?.keggCategories
      setInteractive(id, {
        annotations: {
          source: 'uniprot',
          fields: colsForIds(selectedIds),
          byId,
          taxon,
          keggOrg,
          keggCategories
        }
      })
      const n = Object.keys(byId).length
      const sp = taxon ? ` • species taxon ${taxon}` : ''
      const catN = keggCategories ? Object.keys(keggCategories).length : 0
      const cat = catN ? ` • ${catN} KEGG pathway categories` : ''
      // When STRING is selected, download the organism's interactome so the network builds offline.
      if (wantsString && taxon) {
        setAnnMsg(`2/3 Resolving species — taxon ${taxon}…`)
        const stageLabel: Record<string, string> = {
          links: 'interactome',
          info: 'gene names',
          aliases: 'gene-name map'
        }
        const off = window.api.onStringProgress((p) => {
          const pct = p.total > 0 ? ` ${Math.round((p.loaded / p.total) * 100)}%` : ''
          setAnnMsg(`3/3 STRING data — ${stageLabel[p.stage] ?? p.stage} for taxon ${taxon}…${pct}`)
        })
        try {
          const r = await window.api.ensureStringOrg(taxon)
          setAnnMsg(
            r.error
              ? `Annotated ${n} features${sp}${cat}. STRING download failed: ${r.error}`
              : `Annotated ${n} features${sp}${cat}. STRING v${r.version} ${r.cached ? 'ready (cached)' : 'downloaded'}.`
          )
        } finally {
          off()
        }
      } else {
        setAnnMsg(
          res.error
            ? `Partial: ${n}/${accByUniq.size} annotated (${res.error})${sp}${cat}`
            : `Annotated ${n} of ${accByUniq.size} features.${sp}${cat}`
        )
      }
    } catch (e) {
      setAnnMsg(e instanceof Error ? e.message : 'Fetch failed.')
    } finally {
      setAnnBusy(false)
    }
  }
  const clearAnnotations = (): void => {
    setInteractive(id, { annotations: undefined })
    setAnnMsg(null)
  }

  return createPortal(
    <div style={{ ...cssVars(PALETTES[mode]), ...styles.overlay }}>
      <div style={styles.scrim} onClick={onClose} />
      <div style={styles.modal} role="dialog" aria-label="Interactive import">
        <div style={styles.head}>
          Interactive import
          <div style={{ flex: 1 }} />
          <button style={styles.closeBtn} onClick={onClose} title="Close" aria-label="Close">
            ✕
          </button>
        </div>

        <Roadmap
          stage={stage}
          names={STEP_NAMES}
          allDone={completed}
          onJump={(target) => {
            setMsg(null)
            setStage(target as Stage)
          }}
        />

        <div style={styles.body}>
          {stage === 1 && (
            <Step1Columns
              matrix={matrix}
              inputFiles={inputFiles}
              onMatrix={changeMatrix}
              onBrowse={browseMatrix}
              preset={preset}
              onPreset={applyPreset}
              detecting={detecting}
              onDetect={runDetect}
              columns={columns}
              roles={roles}
              rows={preview?.rows ?? []}
              onAssign={assignRoles}
            />
          )}
          {stage === 2 && (
            <FilterStage
              filterCols={filterCols}
              allRows={allRows}
              filters={filters}
              setFilters={setFilters}
              columns={columns}
            />
          )}
          {stage === 3 &&
            (sampleCols.length > 0 ? (
              <Stage1
                samples={samples}
                rules={rules}
                armed={armed}
                setArmed={setArmed}
                onAnnotate={annotate}
              />
            ) : (
              <div style={styles.hint}>Mark at least one Sample column in step 1.</div>
            ))}
          {stage === 4 && (
            <Stage2
              samples={samples}
              rules={rules}
              setCell={setCell}
              onRenameValue={renameConditionValue}
            />
          )}
          {stage === 5 && (
            <Step4Metadata
              idCol={idCol}
              labelCol={labelCol}
              metaCols={metaCols}
              rows={metaPreview?.rows ?? null}
              total={metaPreview?.total ?? 0}
              annotations={annotations}
              annBusy={annBusy}
              annMsg={annMsg}
              onFetch={runFetchAnnotations}
              onSelectFields={setAnnotationFields}
              onClearAnnotations={clearAnnotations}
            />
          )}
          {msg && <div style={styles.hint}>{msg}</div>}
        </div>

        <div style={styles.foot}>
          {stage > 1 && (
            <button style={styles.btn} onClick={goBack}>
              ← Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          {stage === 4 && (
            <label style={styles.confirm}>
              <input
                type="checkbox"
                checked={confirmedSheet}
                onChange={(e) => setConfirmedSheet(e.target.checked)}
              />
              Everything is correct
            </label>
          )}
          {stage < 5 ? (
            <>
              {nextBlock && <span style={styles.nextBlock}>{nextBlock}</span>}
              <button
                style={{ ...styles.btnPrimary, opacity: canNext ? 1 : 0.5 }}
                disabled={!canNext}
                onClick={goNext}
              >
                Next →
              </button>
            </>
          ) : (
            <>
              <label style={styles.confirm}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Everything is correct
              </label>
              <button
                style={{ ...styles.btnPrimary, opacity: !confirmed || converting ? 0.5 : 1 }}
                disabled={!confirmed || converting}
                onClick={async () => {
                  setConverting(true)
                  setMsg(null)
                  const res = await convertInteractive(id)
                  setConverting(false)
                  if (res.ok) onClose()
                  else setMsg(`Error: ${res.error}`)
                }}
              >
                {converting ? 'Saving…' : 'Confirm & save'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

/** One colour per assignable column role — shared by the chips, header tints, and labels. */
const ROLE_COLORS: Partial<Record<InteractiveRole, string>> = {
  id: '#e15759',
  sample: '#4e79a7',
  label: '#59a14f',
  meta: '#c99700',
  filter: '#8a5cf6'
}
/** Display names for the assignable roles (Ignore is the unassigned default — it has no chip). */
const ROLE_LABEL: Partial<Record<InteractiveRole, string>> = {
  id: 'ID',
  sample: 'Sample',
  label: 'Name',
  meta: 'Metadata',
  filter: 'Filter'
}
const ROLE_CHIPS: InteractiveRole[] = ['id', 'label', 'meta', 'filter', 'sample']

/** Step 1: show the tile-selected matrix (auto-read on open), then classify columns by arming a
 *  role chip and clicking column headers. The preview is in normal (untransposed) form — columns
 *  across the top, first rows below — with each column's assigned role labelled above its header,
 *  mirroring the condition-tagging step. */
function Step1Columns({
  matrix,
  inputFiles,
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
  // Column-header drag range (indices into `columns`): `a` = anchor, `f` = current end.
  const [drag, setDrag] = useState<{ a: number; f: number } | null>(null)
  const shown = rows.slice(0, 10)
  const lo = drag ? Math.min(drag.a, drag.f) : -1
  const hi = drag ? Math.max(drag.a, drag.f) : -1
  // Finish a header drag: assign the armed role to every column in the range. A single header
  // that already holds the armed role toggles back to Ignore.
  const finish = (): void => {
    if (drag && armed) {
      const range = columns.slice(lo, hi + 1)
      const clear = range.length === 1 && roles[range[0]] === armed
      onAssign(range, clear ? 'ignore' : armed)
    }
    setDrag(null)
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
        {/* The data file is chosen in the tile, but can be swapped here — a chip-style select so
            the user can re-point the import without leaving the wizard. An external file (picked via
            Browse, an absolute path outside the data folder) shows as its own option. */}
        <select
          style={styles.fileChip}
          value={matrix ?? ''}
          onChange={(e) => onMatrix(e.target.value)}
          title={matrix ?? 'Choose a data file'}
        >
          {!matrix && <option value="">— choose a data file —</option>}
          {matrix && !inputFiles.includes(matrix) && (
            <option value={matrix}>{`${matrix.replace(/^.*[\\/]/, '')} (external)`}</option>
          )}
          {inputFiles.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
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
      <div style={styles.row}>
        <span style={styles.label}>Preset</span>
        <div style={styles.segmented}>
          {MATRIX_PRESETS.map(({ value, label }) => {
            const on = preset === value
            return (
              <button
                key={value}
                onClick={() => onPreset(value)}
                disabled={!matrix || detecting}
                title={value === 'none' ? 'Clear all column labels' : `Auto-detect columns as ${label} output`}
                style={{
                  ...styles.segment,
                  background: on ? UI.accent : 'transparent',
                  color: on ? UI.accentText : UI.text,
                  borderColor: on ? UI.accent : UI.border,
                  cursor: !matrix || detecting ? 'default' : 'pointer',
                  opacity: !matrix || detecting ? 0.6 : 1
                }}
              >
                {label}
              </button>
            )
          })}
          {/* Indicator only — set automatically on manual edits, not directly clickable. */}
          <button
            disabled
            title="Set automatically when you edit the column labels"
            style={{
              ...styles.segment,
              background: preset === 'custom' ? UI.accent : 'transparent',
              color: preset === 'custom' ? UI.accentText : UI.textMuted,
              borderColor: preset === 'custom' ? UI.accent : UI.border,
              cursor: 'default',
              opacity: preset === 'custom' ? 1 : 0.6
            }}
          >
            Custom
          </button>
        </div>
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
          <div style={styles.hint}>
            Click a role, then click a column header — or drag across several — to label them.
            Exactly one <b>ID</b> and one <b>Name</b>; any number of <b>Sample</b> and{' '}
            <b>Metadata</b>. Unlabelled columns are ignored.
          </div>
          <div style={styles.chips}>
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
                <tr onMouseUp={finish} onMouseLeave={() => setDrag(null)}>
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
                        onMouseDown={
                          armed
                            ? (e) => {
                                e.preventDefault()
                                setDrag({ a: i, f: i })
                              }
                            : undefined
                        }
                        onMouseEnter={() => {
                          setHover(c)
                          setDrag((d) => (d ? { a: d.a, f: i } : d))
                        }}
                        onMouseLeave={() => setHover((h) => (h === c ? null : h))}
                        title={armed ? `Click or drag to label as ${ROLE_LABEL[armed]}` : c}
                        style={{
                          ...styles.th,
                          ...styles.colHead,
                          cursor: armed ? 'pointer' : 'default',
                          background: preview
                            ? `${shownColor}55`
                            : shownColor
                              ? `${shownColor}22`
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
              <tbody>
                {shown.map((r, i) => (
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
                ))}
              </tbody>
            </table>
          </ScrollFade>
        </>
      )}
    </>
  )
}

// Default DB column widths, computed from content string length (deterministic — no DOM
// measurement, so it can't be inflated by a slow/stretched layout). ~7px per char at 12px.
const DB_CHAR_PX = 7
const DB_MIN_COL = 52
const DB_MAX_COL = 260

/** Step 4: preview the DB (ID map) that will be generated and confirm. Columns default to a
 *  content-fit width (capped) and are drag-resizable / double-click-to-refit. Always fixed
 *  layout, so long free-text never blows a column out. */
function Step4Metadata({
  idCol,
  labelCol,
  metaCols,
  rows,
  total,
  annotations,
  annBusy,
  annMsg,
  onFetch,
  onSelectFields,
  onClearAnnotations
}: {
  idCol: string | null
  labelCol: string | null
  metaCols: string[]
  rows: Record<string, string>[] | null
  total: number
  annotations?: AnnotationSet
  annBusy: boolean
  annMsg: string | null
  onFetch: (fields: string[]) => void
  onSelectFields: (fields: string[]) => void
  onClearAnnotations: () => void
}): ReactNode {
  // Which fields are ticked — seeded from an already-fetched set so a reopened wizard matches.
  const [picked, setPicked] = useState<Set<string>>(() =>
    annotations
      ? new Set(UNIPROT_FIELDS.filter((f) => annotations.fields.includes(f.col)).map((f) => f.id))
      : new Set(['protein_name', 'gene_names'])
  )
  const annCols = annotations?.fields ?? []
  const cols = idCol ? ['uniqID', 'gene', ...metaCols, ...annCols] : []
  const accessors: ((r: Record<string, string>) => string)[] = idCol
    ? [
        (r) => r[idCol] ?? '',
        (r) => (labelCol ? (r[labelCol] ?? '') : ''),
        ...metaCols.map((c) => (r: Record<string, string>) => r[c] ?? ''),
        ...annCols.map(
          (f) => (r: Record<string, string>) =>
            annotations?.byId[(r[idCol] ?? '').trim()]?.[f] ?? ''
        )
      ]
    : []

  // Per-column user override (px); null = the computed content-fit default. Reset when the
  // column set changes (adjust-state-during-render).
  const [widths, setWidths] = useState<(number | null)[]>(() => cols.map(() => null))
  const [colCount, setColCount] = useState(cols.length)
  if (colCount !== cols.length) {
    setColCount(cols.length)
    setWidths(cols.map(() => null))
  }

  if (!idCol) return <div style={styles.hint}>Pick an ID column in step 1.</div>
  const shown = rows ?? []
  // Content-fit width from the longest value (header or any shown cell), capped.
  const fitWidth = (i: number): number => {
    let maxLen = cols[i].length
    for (const r of shown) {
      const l = accessors[i](r).length
      if (l > maxLen) maxLen = l
    }
    return Math.max(DB_MIN_COL, Math.min(maxLen * DB_CHAR_PX + COL_PAD, DB_MAX_COL))
  }
  const colWidth = (i: number): number =>
    (widths.length === cols.length ? widths[i] : null) ?? fitWidth(i)
  const startResize = (i: number, startX: number): void => {
    const startW = colWidth(i)
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
      <div style={styles.hint}>
        ID map to be written: <b>uniqID</b> ← {idCol}, <b>gene</b> ← {labelCol ?? '(none)'}
        {metaCols.length ? `, + ${metaCols.length} metadata column(s)` : ''}
        {annCols.length ? `, + ${annCols.length} annotation column(s)` : ''}.{' '}
        {total > shown.length
          ? `Showing first ${shown.length} of ${total} rows (all written on save).`
          : `${shown.length} rows.`}
      </div>
      {/* Fetch external annotations (UniProt) by feature accession — merged into the DB and saved
          with the project. */}
      <div style={styles.annPanel}>
        <span style={styles.annTitle}>Fetch annotations (UniProt)</span>
        <div style={styles.annFields}>
          {UNIPROT_FIELDS.map((f) => {
            const on = picked.has(f.id)
            return (
              <label key={f.id} style={styles.annField}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={annBusy}
                  onChange={() => {
                    const next = new Set(picked)
                    if (next.has(f.id)) next.delete(f.id)
                    else next.add(f.id)
                    setPicked(next)
                    // Already fetched → just re-slice the cached data, no network round-trip.
                    if (annotations) onSelectFields([...next])
                  }}
                />
                {f.label}
              </label>
            )
          })}
        </div>
        <button
          style={{ ...styles.btnPrimary, opacity: annBusy || picked.size === 0 ? 0.5 : 1 }}
          disabled={annBusy || picked.size === 0}
          onClick={() => onFetch([...picked])}
        >
          {annBusy ? 'Fetching…' : 'Fetch'}
        </button>
        {annotations && !annBusy && (
          <button style={styles.btn} onClick={onClearAnnotations}>
            Clear
          </button>
        )}
        {annMsg && (
          <span style={styles.annMsg}>
            {annBusy && (
              <>
                <style>{`@keyframes oe-spin{to{transform:rotate(360deg)}}`}</style>
                <span style={styles.spinner} />
              </>
            )}
            {annMsg}
          </span>
        )}
      </div>
      <div style={styles.tableTitle}>Metadata DB</div>
      <ScrollFade>
        {/* Always fixed layout with computed widths + minWidth:0 (not the shared grid's 100%), so
            long values clip instead of stretching the column and the table doesn't fill the width. */}
        <table style={{ ...styles.grid, tableLayout: 'fixed', minWidth: 0 }}>
          <colgroup>
            {cols.map((c, i) => (
              <col key={c} style={{ width: `${colWidth(i)}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c} style={{ ...styles.th, ...styles.clip }}>
                  {c}
                  <span
                    style={styles.resizer}
                    title="Drag to resize · double-click to fit content"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      startResize(i, e.clientX)
                    }}
                    onDoubleClick={() => setWidths((prev) => prev.map((w, k) => (k === i ? null : w)))}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {accessors.map((get, ci) => {
                  const v = get(r)
                  return (
                    <td
                      key={cols[ci]}
                      style={{ ...styles.td, ...styles.sampleCell, ...styles.clip }}
                      title={v}
                    >
                      {v}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollFade>
    </>
  )
}

/** Stage 1: field chips + a monospace list of every sample name with the learned regions
 *  colour-highlighted. Only the first (bright) row is interactive — the rest are dimmed to
 *  point the user at where to highlight. */
function Stage1({
  samples,
  rules,
  armed,
  setArmed,
  onAnnotate
}: {
  samples: InteractiveSampleCond[]
  rules: Rules
  armed: Field | null
  setArmed: (f: Field | null) => void
  onAnnotate: (charStart: number, charEnd: number) => void
}): ReactNode {
  return (
    <>
      <div style={styles.hint}>
        Click a field to activate it, then click a token in the first (bright) row to tag it — or
        drag across tokens for a multi-part value. Click it again to clear. The region is read from
        every row; fix exceptions in the next step.
      </div>
      <div style={styles.chips}>
        {FIELDS.map((f) => {
          const on = armed === f
          // `applied` = this condition has a learned region (it's been tagged). An applied chip is
          // tinted in the field colour; the currently-armed chip is the SAME colour but a stronger
          // opacity, so the current selection stands out from the merely-applied ones.
          const applied = !!rules[f]
          return (
            <button
              key={f}
              onClick={() => setArmed(on ? null : f)}
              title={applied ? `${f} applied — click to re-tag` : `Tag ${f}`}
              style={{
                ...styles.chip,
                background: on ? `${FIELD_COLORS[f]}aa` : applied ? `${FIELD_COLORS[f]}26` : 'transparent',
                color: UI.text,
                borderColor: on || applied ? FIELD_COLORS[f] : UI.border
              }}
            >
              <span style={{ ...styles.chipDot, background: FIELD_COLORS[f] }} />
              {f}
            </button>
          )
        })}
      </div>
      <div style={styles.tableTitle}>Sample names</div>
      <div style={styles.gridWrap}>
        <table style={styles.nameTable}>
          <thead>
            <tr>
              <td style={styles.rulerCell}>
                <RulerName name={samples[0].sample} rules={rules} />
              </td>
            </tr>
          </thead>
          <tbody>
            {samples.map((s, i) =>
              i === 0 ? (
                <tr key={s.sample}>
                  <TeacherRow name={s.sample} rules={rules} armed={armed} onAnnotate={onAnnotate} />
                </tr>
              ) : (
                <tr key={s.sample}>
                  <td style={{ ...styles.nameCell, ...styles.dimCell }}>
                    <HighlightedName name={s.sample} rules={rules} />
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** One condition field's distinct values, each editable IN PLACE to bulk-rename every sample that
 *  has it. If a value has been renamed, its original is shown as small grey text below the input. */
function ValueRefactor({
  field,
  values,
  origOf,
  onRename
}: {
  field: Field
  values: string[]
  origOf: (field: Field, value: string) => string | undefined
  onRename: (field: Field, oldVal: string, newVal: string) => void
}): ReactNode {
  const commit = (oldVal: string, el: HTMLInputElement): void => {
    const v = el.value.trim()
    if (v !== '' && v !== oldVal) onRename(field, oldVal, v)
    else el.value = oldVal // reject empty / no-op, restore
  }
  return (
    <div style={styles.refactorRow}>
      <span style={{ ...styles.refactorField, color: FIELD_COLORS[field] }}>{field}</span>
      {values.map((v) => {
        const orig = origOf(field, v)
        const changed = orig !== undefined && orig !== v
        return (
          // Keyed by value so a successful rename remounts the input with its new default.
          <span key={`${field}::${v}`} style={styles.refactorCell}>
            <input
              style={styles.refactorInput}
              defaultValue={v}
              title={`Rename every "${v}" in ${field}`}
              size={Math.max(v.length + 1, 4)}
              onBlur={(e) => commit(v, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'Escape') {
                  e.currentTarget.value = v
                  e.currentTarget.blur()
                }
              }}
            />
            {changed && (
              <span style={styles.refactorWas} title={`Original: ${orig || '(empty)'}`}>
                {orig === '' ? '(empty)' : orig}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

/** Stage 2: editable grid — include checkbox + per-cell overrides for naming exceptions, plus a
 *  refactor panel to bulk-rename a condition value across every sample at once. */
function Stage2({
  samples,
  rules,
  setCell,
  onRenameValue
}: {
  samples: InteractiveSampleCond[]
  rules: Rules
  setCell: (i: number, key: keyof InteractiveSampleCond, value: string | boolean) => void
  onRenameValue: (field: Field, oldVal: string, newVal: string) => void
}): ReactNode {
  // Only show condition columns that carry at least one value — an untagged (inactive) condition
  // is hidden rather than shown as an empty column. `include` + `sample` always show.
  const activeFields = FIELDS.filter((f) =>
    samples.some((s) => String(s[f] ?? '').trim() !== '')
  )
  // Distinct non-empty values per active field, for the refactor panel (numeric-aware order).
  const distinctByField = activeFields.map((f) => ({
    field: f,
    values: [...new Set(samples.map((s) => String(s[f] ?? '').trim()).filter((v) => v !== ''))].sort(
      (a, b) => a.localeCompare(b, undefined, { numeric: true })
    )
  }))
  // The ORIGINAL value behind each current value, derived from the persisted region rules by
  // re-parsing every sample name (applyFieldRule) — independent of any refactor. So a changed
  // value's original is shown even after reopening a completed import. Per field: current → the
  // distinct original(s) that differ from it (joined when a rename merged several).
  const origByField: Record<string, Record<string, string | undefined>> = {}
  for (const f of activeFields) {
    const rule = rules[f]
    const bucket: Record<string, Set<string>> = {}
    for (const s of samples) {
      const cur = String(s[f] ?? '').trim()
      if (cur === '') continue
      const orig = rule ? applyFieldRule(s.sample, rule) : cur
      ;(bucket[cur] ??= new Set()).add(orig)
    }
    const resolved: Record<string, string | undefined> = {}
    for (const [cur, set] of Object.entries(bucket)) {
      const diff = [...set].filter((o) => o !== cur)
      resolved[cur] = diff.length ? diff.join(', ') : undefined
    }
    origByField[f] = resolved
  }
  const origOf = (f: Field, v: string): string | undefined => origByField[f]?.[v]
  const cols: Col[] = ['include', 'sample', ...activeFields]

  const headRefs = useRef<(HTMLTableCellElement | null)[]>([])
  const [widths, setWidths] = useState<(number | null)[]>(() => cols.map(() => null))
  const [colCount, setColCount] = useState(cols.length)
  if (colCount !== cols.length) {
    setColCount(cols.length)
    setWidths(cols.map(() => null))
  }
  const fixed = widths.length === cols.length && widths.every((w) => w != null)

  // A null width means "(re)fit to content": while any column is null the table lays out `auto`
  // (that column sizes to its content); we then measure it (+ padding) and pin it, returning to
  // a fixed layout. Runs on mount (all null), after a column set change, and after a reset.
  useLayoutEffect(() => {
    if (widths.length === cols.length && widths.some((w) => w == null)) {
      setWidths((prev) =>
        prev.map((w, i) => (w != null ? w : (headRefs.current[i]?.offsetWidth ?? 0) + COL_PAD))
      )
    }
  }, [widths, cols.length])

  const startResize = (i: number, startX: number): void => {
    const startW = widths[i] ?? headRefs.current[i]?.offsetWidth ?? 60
    const onMove = (ev: MouseEvent): void => {
      const w = Math.max(28, startW + (ev.clientX - startX))
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
      <div style={styles.hint}>
        Review the parsed conditions and correct any cell. Drag a column border to resize; uncheck a
        row to drop it.
      </div>
      {distinctByField.length > 0 && (
        <>
          <div style={styles.tableTitle}>Refactor values</div>
          <div style={styles.hint}>
            Edit a value to rename it across <b>every</b> sample in that condition (press Enter or
            click away to apply).
          </div>
          <div style={styles.refactorPanel}>
            {distinctByField.map(({ field, values }) => (
              <ValueRefactor
                key={field}
                field={field}
                values={values}
                origOf={origOf}
                onRename={onRenameValue}
              />
            ))}
          </div>
        </>
      )}
      <div style={styles.tableTitle}>Condition samplesheet</div>
      <ScrollFade>
        {/* minWidth:0 (not the shared grid's 100%) so columns fit their content — the sample
            column sizes to the longest sample name instead of stretching to fill the modal. */}
        <table style={{ ...styles.grid, tableLayout: fixed ? 'fixed' : 'auto', minWidth: 0 }}>
          <colgroup>
            {cols.map((c, i) => (
              <col key={c} style={{ width: widths[i] != null ? `${widths[i]}px` : undefined }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c, i) => {
                // Every shown field column is active (empty ones are hidden), so colour its header.
                const active = (FIELDS as readonly string[]).includes(c)
                return (
                  <th
                    key={c}
                    ref={(el) => {
                      headRefs.current[i] = el
                    }}
                    style={{
                      ...styles.th,
                      ...(active ? { color: FIELD_COLORS[c as Field] } : null)
                    }}
                    aria-label={c === 'include' ? 'include' : undefined}
                  >
                    {c === 'include' ? '' : c}
                    <span
                      style={styles.resizer}
                      title="Drag to resize · double-click to fit content"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        startResize(i, e.clientX)
                      }}
                      onDoubleClick={() =>
                        setWidths((prev) => prev.map((w, k) => (k === i ? null : w)))
                      }
                    />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {samples.map((s, i) => {
              const on = s.include !== false
              return (
                <tr key={s.sample} style={{ opacity: on ? 1 : 0.45 }}>
                  <td style={styles.td}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setCell(i, 'include', e.target.checked)}
                    />
                  </td>
                  <td
                    style={{ ...styles.td, ...styles.sampleCell, ...(fixed ? styles.clip : null) }}
                    title={s.sample}
                  >
                    {s.sample}
                  </td>
                  {activeFields.map((f) => (
                    <td key={f} style={styles.td}>
                      <input
                        style={{ ...styles.cellInput, ...(fixed ? { width: '100%' } : null) }}
                        size={Math.max(String(s[f] ?? '').length, f.length, 3)}
                        value={String(s[f] ?? '')}
                        disabled={!on}
                        onChange={(e) => setCell(i, f, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </ScrollFade>
    </>
  )
}

/** A select-style button whose multiselect list floats (portalled) just below it — so it isn't
 *  clipped by the modal's scroll area. Checked = kept; unchecked values are dropped. */
function ValueDropdown({
  values,
  dropped,
  disabled,
  color,
  truncated,
  onToggle,
  onSelectAll,
  onClearAll
}: {
  values: string[]
  dropped: Set<string>
  disabled: boolean
  color: string
  truncated: boolean
  onToggle: (v: string) => void
  onSelectAll: () => void
  onClearAll: () => void
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<{ right: number; top: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const kept = values.filter((v) => !dropped.has(v)).length
  const summary =
    kept === values.length ? 'All values' : kept === 0 ? 'None kept' : `${kept}/${values.length} kept`
  // Deactivating the tile closes the menu without a state sync (derive rather than setState-in-effect).
  const isOpen = open && !disabled

  useEffect(() => {
    if (!isOpen) return
    const b = btnRef.current?.getBoundingClientRect()
    // Right-align the menu to the button so it never spills past the dialog's right edge.
    if (b) setRect({ right: window.innerWidth - b.right, top: b.bottom + 4, width: b.width })
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const close = (): void => setOpen(false)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', close, true) // capture: any ancestor scroll dismisses
    window.addEventListener('resize', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen])

  return (
    <>
      <button
        ref={btnRef}
        disabled={disabled}
        style={{ ...styles.dropdownBtn, borderColor: isOpen ? color : UI.border }}
        onClick={() => setOpen((o) => !o)}
      >
        {summary}
        <span style={styles.dropdownCaret}>{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              ...cssVars(PALETTES[mode]),
              ...styles.dropdownMenu,
              right: rect.right,
              top: rect.top,
              minWidth: Math.max(rect.width, 180)
            }}
          >
            <div style={styles.dropdownTools}>
              <button style={styles.filterLink} onClick={onSelectAll}>
                Select all
              </button>
              <button style={styles.filterLink} onClick={onClearAll}>
                Clear all
              </button>
            </div>
            <div style={styles.dropdownList}>
              {values.map((v) => {
                const isKept = !dropped.has(v)
                return (
                  <label key={v} style={styles.dropdownItem}>
                    <input type="checkbox" checked={isKept} onChange={() => onToggle(v)} />
                    <span style={isKept ? undefined : styles.dropdownItemOff}>
                      {v === '' ? '(empty)' : v}
                    </span>
                  </label>
                )
              })}
            </div>
            {truncated && (
              <div style={styles.hint}>
                Showing the first {values.length} distinct values; rarer values are kept.
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}

/** Stage 2 (Filtering): one card per `filter`-role column. A categorical column picks its kept
 *  values from a floating multiselect dropdown; a numeric column offers a min/max range.
 *  Rows failing any active filter are dropped on convert. Only shown when ≥1 filter column. */
function FilterStage({
  filterCols,
  allRows,
  filters,
  setFilters,
  columns
}: {
  filterCols: string[]
  allRows: Record<string, string>[]
  filters: Record<string, FilterSpec>
  setFilters: (next: Record<string, FilterSpec>) => void
  columns: string[]
}): ReactNode {
  const colKey = filterCols.join(' ')
  // Filter edits sync live: every control writes straight to the import config, and the stats +
  // data table below recompute immediately.
  const setFilter = (col: string, spec: FilterSpec): void =>
    setFilters({ ...filters, [col]: spec })
  // The per-tile checkbox: activate/deactivate a column's filter (keeping any edited values).
  const setActive = (col: string, on: boolean): void =>
    setFilters({ ...filters, [col]: { ...(filters[col] ?? {}), active: on } })
  // Distinct-value / numeric-range facet per filter column, computed over ALL rows once.
  const facets = useMemo(() => {
    const m: Record<string, ColumnFacet> = {}
    for (const c of filterCols) m[c] = columnFacet(allRows, c)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colKey, allRows])
  const total = allRows.length
  // One pass over every row: count survivors and collect a capped sample of the DROPPED rows for
  // the preview below (so the user can see exactly what a filter is removing).
  const { kept, removedTotal, displayRows } = useMemo(() => {
    const active = filterCols
      .filter((c) => filters[c]?.active)
      .map((c) => ({ col: c, drop: new Set(filters[c].drop ?? []), spec: filters[c] }))
    let keptN = 0
    let removedN = 0
    // Capped samples for the table below — removed rows first (shown on top, red), then kept.
    const removedRows: Record<string, string>[] = []
    const keptRows: Record<string, string>[] = []
    for (const r of allRows) {
      let ok = true
      for (const { col, drop, spec } of active) {
        const raw = (r[col] ?? '').trim()
        if (drop.size > 0 && drop.has(raw)) {
          ok = false
          break
        }
        if (spec.min != null || spec.max != null) {
          const x = Number(raw)
          if (!Number.isFinite(x) || (spec.min != null && x < spec.min) || (spec.max != null && x > spec.max)) {
            ok = false
            break
          }
        }
      }
      if (ok) {
        keptN++
        if (keptRows.length < KEPT_PREVIEW_CAP) keptRows.push(r)
      } else {
        removedN++
        if (removedRows.length < REMOVED_PREVIEW_CAP) removedRows.push(r)
      }
    }
    const displayRows = [
      ...removedRows.map((r) => ({ r, removed: true })),
      ...keptRows.map((r) => ({ r, removed: false }))
    ]
    return { kept: keptN, removedTotal: removedN, displayRows }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colKey, filters, allRows, total])

  const pct = total > 0 ? Math.round((kept / total) * 1000) / 10 : 0
  // Filter columns first (leftmost) so the values driving each drop are easy to scan, then the
  // rest of the matrix columns in their original order.
  const filterSet = new Set(filterCols)
  const orderedCols = [...filterCols, ...columns.filter((c) => !filterSet.has(c))]
  const numColor = ROLE_COLORS.filter!
  return (
    <>
      <div style={styles.hint}>
        These columns filter which feature rows are kept. Uncheck values to drop them, or set a
        numeric range — rows matching <b>all</b> filters are written; the rest are dropped.
      </div>
      {filterCols.map((col) => {
        const facet = facets[col]
        const spec = filters[col]
        if (!facet) return null
        const isActive = spec?.active === true
        const dropSet = new Set(spec?.drop ?? [])
        return (
          <div key={col} style={isActive ? styles.filterCard : { ...styles.filterCard, ...styles.filterCardOff }}>
            {/* Checkbox at the far left turns the filter active; label next; controls at the right. */}
            <div style={styles.filterHead}>
              <input
                type="checkbox"
                checked={isActive}
                title={isActive ? 'Active — uncheck to ignore this filter' : 'Inactive — check to enable'}
                onChange={(e) => setActive(col, e.target.checked)}
              />
              <span style={{ ...styles.chipDot, background: numColor }} />
              <span style={{ ...styles.filterName, ...(isActive ? null : styles.offText) }}>{col}</span>
              <span style={styles.filterMeta}>
                {facet.numeric
                  ? `numeric · ${facet.min}–${facet.max}`
                  : `${facet.values.length}${facet.truncated ? '+' : ''} value${facet.values.length === 1 ? '' : 's'}`}
              </span>
              <div
                style={{ ...styles.filterControls, ...(isActive ? null : styles.controlsOff) }}
                aria-disabled={!isActive}
              >
                {facet.numeric ? (
                  <>
                    <label style={styles.numLabel}>
                      min
                      <input
                        style={styles.numInput}
                        type="number"
                        disabled={!isActive}
                        placeholder={String(facet.min)}
                        value={spec?.min ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value)
                          setFilter(col, { ...spec, active: true, min: v })
                        }}
                      />
                    </label>
                    <label style={styles.numLabel}>
                      max
                      <input
                        style={styles.numInput}
                        type="number"
                        disabled={!isActive}
                        placeholder={String(facet.max)}
                        value={spec?.max ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value)
                          setFilter(col, { ...spec, active: true, max: v })
                        }}
                      />
                    </label>
                  </>
                ) : (
                  // Categorical values are chosen from a floating multiselect dropdown.
                  <ValueDropdown
                    values={facet.values}
                    dropped={dropSet}
                    disabled={!isActive}
                    color={numColor}
                    truncated={facet.truncated}
                    onToggle={(v) => {
                      const nd = new Set(spec?.drop ?? [])
                      if (nd.has(v)) nd.delete(v)
                      else nd.add(v)
                      setFilter(
                        col,
                        nd.size > 0 ? { ...spec, active: true, drop: [...nd] } : { active: true }
                      )
                    }}
                    onSelectAll={() => setFilter(col, { active: true })}
                    onClearAll={() => setFilter(col, { active: true, drop: [...facet.values] })}
                  />
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* Row stats, below the filter sections. */}
      <div style={styles.filterStats}>
        Removing <b style={styles.removingNum}>{removedTotal.toLocaleString()}</b> rows. Keeping{' '}
        <b>{kept.toLocaleString()}</b> of {total.toLocaleString()} rows ({pct}%).
      </div>

      {/* Full data below: removed rows on top (red), then the kept rows. Both are capped samples —
          every filtered row is applied on convert regardless of what's shown here. */}
      <div style={styles.removedScroll}>
        <table style={{ ...styles.grid, tableLayout: 'auto' }}>
          <thead>
            <tr>
              {orderedCols.map((c) => (
                <th
                  key={c}
                  style={filterSet.has(c) ? { ...styles.th, color: numColor } : styles.th}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map(({ r, removed }, i) => (
              <tr key={i} style={removed ? styles.removedRow : undefined}>
                {orderedCols.map((c) => (
                  <td key={c} style={{ ...styles.td, ...styles.sampleCell }} title={r[c]}>
                    {r[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** How many removed / kept rows the Filtering-step data table renders (a sample — every filtered
 *  row is applied on convert regardless; the cap just keeps the DOM light). */
const REMOVED_PREVIEW_CAP = 200
const KEPT_PREVIEW_CAP = 200

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60
  },
  scrim: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' },
  modal: {
    position: 'relative',
    width: 1040,
    maxWidth: '94vw',
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 1,
    overflow: 'hidden'
  },
  head: {
    padding: '10px 12px 10px 16px',
    fontWeight: 700,
    fontSize: 14,
    color: UI.text,
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    display: 'flex',
    alignItems: 'center',
    gap: 10
  },
  // Roadmap stepper bar under the header: numbered stage pills + labels, joined by connectors.
  roadmap: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    padding: '12px 20px',
    background: UI.panelAlt,
    borderBottom: `1px solid ${UI.border}`
  },
  roadStep: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 5,
    flex: '0 0 auto'
  },
  roadDot: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    border: '2px solid',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1
  },
  roadLabel: { fontSize: 11, letterSpacing: 0.2, whiteSpace: 'nowrap' },
  // Connector between two stage pills — vertically centred on the 26px dot row.
  roadLine: { flex: 1, height: 2, marginTop: 13, borderRadius: 1, minWidth: 16 },
  closeBtn: {
    flex: '0 0 auto',
    width: 26,
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: UI.textMuted,
    border: 'none',
    borderRadius: 5,
    fontSize: 14,
    cursor: 'pointer'
  },
  body: {
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflow: 'auto',
    flex: 1,
    minHeight: 0
  },
  foot: {
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderTop: `1px solid ${UI.border}`,
    background: UI.panelAlt
  },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  label: { fontSize: 11, color: UI.textMuted, width: 54, flex: '0 0 54px' },
  select: {
    flex: 1,
    minWidth: 0,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '5px 8px',
    fontSize: 12
  },
  hint: { color: UI.textMuted, fontSize: 12, lineHeight: 1.45 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  chipDot: { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto' },
  // ── Filtering stage ──
  filterStats: {
    fontSize: 13,
    color: UI.text,
    fontVariantNumeric: 'tabular-nums',
    paddingTop: 4
  },
  removingNum: { color: '#e15759' },
  // Red-tinted background marking a dropped row in the data table.
  removedRow: { background: 'rgba(225,87,89,0.18)' },
  filterCard: {
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: UI.panelAlt
  },
  // Inactive filter tile: greyed out until its checkbox is ticked (the default).
  filterCardOff: { opacity: 0.55 },
  offText: { color: UI.textMuted },
  // Controls in an inactive tile: dimmed and inert (the checkbox stays clickable).
  controlsOff: { opacity: 0.5, pointerEvents: 'none' },
  filterHead: { display: 'flex', alignItems: 'center', gap: 8 },
  filterName: { fontSize: 13, fontWeight: 700, color: UI.text, fontFamily: MONO },
  filterMeta: { fontSize: 11, color: UI.textMuted },
  // Filter control cluster, pushed to the right end of the tile (wraps right-aligned if long).
  filterControls: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8
  },
  // Apply / Reset row beneath the filter cards.
  filterActions: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 },
  filterDirty: { fontSize: 11, color: '#e2b93b', fontStyle: 'italic' },
  // Reason the Next button is disabled, shown just to its left.
  nextBlock: { fontSize: 11, color: '#e2b93b', alignSelf: 'center', textAlign: 'right', maxWidth: 320 },
  filterTools: { display: 'flex', gap: 10 },
  filterLink: {
    background: 'transparent',
    color: UI.accent,
    border: 'none',
    padding: 0,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  valueChip: {
    border: '1px solid',
    borderRadius: 12,
    padding: '3px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontVariantNumeric: 'tabular-nums'
  },
  // Categorical filter: a select-style button that opens an in-card multiselect list.
  dropdownBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 120,
    justifyContent: 'space-between',
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  dropdownCaret: { fontSize: 8, color: UI.textMuted },
  // Floating menu portalled to <body>, positioned just below the button (fixed, so the modal's
  // scroll area can't clip it).
  dropdownMenu: {
    position: 'fixed',
    zIndex: 9999,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panel,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    boxShadow: '0 10px 30px rgba(0,0,0,0.45)'
  },
  dropdownTools: { display: 'flex', gap: 12 },
  dropdownList: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflow: 'auto' },
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer',
    padding: '2px 4px',
    fontVariantNumeric: 'tabular-nums'
  },
  dropdownItemOff: { color: UI.textMuted, textDecoration: 'line-through' },
  // Bounded scroll box for the data table (removed rows on top). Scrolls both axes so the full
  // set of columns is reachable without stretching the modal.
  removedScroll: {
    maxHeight: 300,
    overflow: 'auto',
    border: `1px solid ${UI.border}`,
    borderRadius: 6
  },
  // ── Refactor-values panel (Samplesheet step) ──
  refactorPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 10,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    background: UI.panelAlt
  },
  // Top-align rows so a value with a "was …" caption below doesn't shift its neighbours.
  refactorRow: { display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 },
  // One value: the inline input, with its original (if changed) centred underneath.
  refactorCell: { display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2 },
  refactorWas: {
    fontSize: 10,
    color: UI.textMuted,
    fontVariantNumeric: 'tabular-nums',
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'center'
  },
  refactorField: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    width: 52,
    flex: '0 0 52px'
  },
  refactorInput: {
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: '3px 10px',
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'center'
  },
  numRow: { display: 'flex', gap: 14 },
  numLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: UI.textMuted
  },
  numInput: {
    width: 100,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 8px',
    fontSize: 12
  },
  // Segmented toggle for the tool preset (DIA-NN / Spectronaut / MaxQuant).
  segmented: { display: 'inline-flex', gap: 4, flexWrap: 'wrap' },
  segment: {
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  // Chip-style select for swapping the source data file inside the wizard.
  fileChip: {
    flex: '0 1 auto',
    minWidth: 0,
    maxWidth: 360,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  chipCount: {
    marginLeft: 2,
    fontSize: 10,
    fontWeight: 700,
    opacity: 0.75,
    fontVariantNumeric: 'tabular-nums'
  },
  // Clickable column header for the step-1 classifier: centred, with the role label stacked above
  // the column name (like the ruler labels over the condition step).
  colHead: {
    textAlign: 'center',
    // Name centres vertically in the cell; the field label is lifted out of flow (below) and
    // pinned to the top, with the top padding reserving its row. NB: no `position` here — that
    // would override the sticky header's `position: sticky` and break stickiness.
    verticalAlign: 'middle',
    padding: '17px 10px 6px',
    userSelect: 'none',
    // Wide enough to fit the widest role label (METADATA), since the label is out of flow and so
    // doesn't push the fit-to-content width of a short-named column.
    minWidth: 82,
    maxWidth: 200
  },
  // Absolutely pinned to the top of the header cell (the sticky `th` is its containing block), so
  // labels line up along one row regardless of how tall each header wraps. Inert to the pointer so
  // it never blocks the header click/drag.
  colRole: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    textAlign: 'center',
    whiteSpace: 'nowrap',
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1.3,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    pointerEvents: 'none'
  },
  // Wrap long headers (e.g. run file paths), breaking unbroken strings so a long path folds
  // in-column; centred horizontally (vertical centring comes from the cell's middle alignment).
  colName: {
    color: UI.text,
    fontSize: 12,
    fontFamily: MONO,
    textAlign: 'center',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word'
  },
  nameTable: {
    borderCollapse: 'collapse',
    width: 'max-content',
    minWidth: '100%',
    fontFamily: MONO,
    fontSize: 12
  },
  // Label strip above the table; same left padding + monospace as the rows so the hidden text
  // reserves matching widths and the centred labels line up with the first row's substrings.
  rulerCell: {
    position: 'sticky',
    top: 0,
    // Extra headroom for the 45°-angled field labels, which ascend above the region text.
    padding: '34px 10px 2px',
    whiteSpace: 'nowrap',
    background: UI.panel,
    borderBottom: `1px solid ${UI.border}`
  },
  nameCell: { padding: '3px 10px', whiteSpace: 'nowrap', borderBottom: `1px solid ${UI.border}` },
  // First row: light/raised; tokens are clicked (not text-selected).
  teachCell: { userSelect: 'none', background: UI.panelRaised },
  // Remaining rows: dimmer background + muted text, inert — just showing the applied highlights.
  dimCell: { userSelect: 'none', background: UI.panelAlt, color: UI.textMuted },
  confirm: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer'
  },
  tableTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted
  },
  annPanel: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    padding: '8px 10px',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panelAlt
  },
  annTitle: { fontSize: 12, fontWeight: 700, color: UI.text, flex: '0 0 auto' },
  annFields: { display: 'inline-flex', flexWrap: 'wrap', gap: 12 },
  annField: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer'
  },
  annMsg: {
    fontSize: 12,
    color: UI.textMuted,
    flex: '1 1 100%',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6
  },
  spinner: {
    width: 12,
    height: 12,
    border: `2px solid ${UI.border}`,
    borderTopColor: UI.text,
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'oe-spin 0.7s linear infinite',
    flex: '0 0 auto'
  },
  gridWrap: { overflow: 'auto', border: `1px solid ${UI.border}`, borderRadius: 6 },
  fadeWrap: { position: 'relative', flex: 1, minHeight: 0, display: 'flex' },
  fadeScroll: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    border: `1px solid ${UI.border}`,
    borderRadius: 6
  },
  fade: { position: 'absolute', pointerEvents: 'none', zIndex: 2 },
  fadeTop: {
    top: 0,
    left: 0,
    right: 0,
    height: 10,
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), transparent)'
  },
  fadeBottom: {
    bottom: 0,
    left: 0,
    right: 0,
    height: 10,
    background: 'linear-gradient(to top, rgba(0,0,0,0.1), transparent)'
  },
  fadeLeft: {
    top: 0,
    bottom: 0,
    left: 0,
    width: 10,
    background: 'linear-gradient(to right, rgba(0,0,0,0.1), transparent)'
  },
  fadeRight: {
    top: 0,
    bottom: 0,
    right: 0,
    width: 10,
    background: 'linear-gradient(to left, rgba(0,0,0,0.1), transparent)'
  },
  // width:max-content so each column sizes to its content (the row scrolls if wide).
  // border-collapse: separate (not collapse) so the sticky header actually sticks in Chromium.
  grid: {
    borderCollapse: 'separate',
    borderSpacing: 0,
    width: 'max-content',
    minWidth: '100%',
    fontSize: 12
  },
  th: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: UI.panelAlt,
    color: UI.textMuted,
    fontWeight: 600,
    textAlign: 'left',
    padding: '6px 8px',
    borderBottom: `1px solid ${UI.border}`
  },
  td: { padding: '3px 8px', borderBottom: `1px solid ${UI.border}`, color: UI.text },
  // Fit to content by default; when a column is narrowed the sample name clips with an ellipsis.
  sampleCell: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  clip: { overflow: 'hidden', textOverflow: 'ellipsis' },
  // Drag handle on a header's right edge to resize its column: a wide invisible hit area with a
  // visible 2px grip line centred on the column boundary.
  resizer: {
    position: 'absolute',
    top: 0,
    right: -5,
    width: 10,
    height: '100%',
    cursor: 'col-resize',
    userSelect: 'none',
    zIndex: 1,
    background: `linear-gradient(to right, transparent 4.5px, ${UI.border} 4.5px, ${UI.border} 5.5px, transparent 5.5px)`
  },
  cellInput: {
    boxSizing: 'border-box',
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 3,
    padding: '3px 5px',
    fontSize: 12
  },
  btn: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: UI.accent,
    color: UI.accentText,
    border: `1px solid ${UI.accent}`,
    borderRadius: 5,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  }
}
