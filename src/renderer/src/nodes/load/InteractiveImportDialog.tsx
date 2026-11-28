/** Modal for interactive import — a wizard that recreates the standard input format from a raw
 *  data matrix, fully interactively:
 *   1. Columns  — classify each column: ID / Name / Sample / Metadata / Filter.
 *   2. Filtering — drop rows by a Filter column (skipped when there's none).
 *   3. Conditions — two cards: switch conditions on and tag each sample's cell/cmpd/dose/time/rep
 *      by clicking tokens; then review / correct the per-sample conditions (the samplesheet). The
 *      one in use lies flat, the other parked at its side at an angle.
 *   4. Metadata — review the DB (uniqID → gene + metadata) and convert.
 *  Portalled to <body> and flex-centred (crisp text). */
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  filterOn,
  type FilterSpec,
  groupMembers,
  type InteractiveRole,
  type InteractiveSampleCond,
  type MatrixPreset,
  parseMatrix,
  RESERVED_COND_NAMES,
  samplesheetIssues,
  sheetIssueLines,
  validCondName
} from '../../engine'
import { cssVars, PALETTES } from '../../ui/app/theme'
import { useUiTheme } from '../../ui/app/useUiTheme'
import { HoverTip } from '../../ui/controls/InfoTip'
import type { StatusKind } from '../../ui/controls/StatusNote'
import { DOCKED_CARD, DOCKED_WRAP, useDialogDock } from '../../graph/dialogs/dialogDock'
import { useGraph } from '../../graph/store'
import { declaredNumeric, type LoadConfig, type LoadedSheet } from '../../graph/config/load'
import { isStep } from '../../graph/types'
import { applySheet, readSheet, sheetMatches } from '../../graph/models/sheetMap'
import { stringTaxon } from '../kit/requirements'
import { nextStage, prevStage, type Stage, STAGES } from './import/stages'
import { Roadmap } from './import/Roadmap'
import {
  applyAnchor,
  condOf,
  DEFAULT_DELIM,
  deriveAnchor,
  type Field,
  fieldColorIn,
  PRESET_FIELDS,
  type RowSpans,
  spanValue,
  withCond,
  withEdited
} from './import/fields'
import { type CondCard, ConditionsStage } from './import/ConditionsStage'
import { colsForIds, sourceIds } from './import/annotationFields'
import { styles } from './import/styles'
import { Step1Columns } from './import/ColumnsStage'
import { FilterStage } from './import/FilterStage'
import { Step4Metadata } from './import/MetadataStage'

export function InteractiveImportDialog({
  id,
  onClose
}: {
  id: string
  onClose: () => void
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  // Docked (the form workflow's details column): rendered into that pane, with no scrim.
  const dock = useDialogDock()
  const cfg = useGraph((s) => {
    const n = s.nodes.find((x) => x.id === id)
    return n && isStep(n) && n.data.kind === 'load' ? (n.data.config as LoadConfig) : null
  })
  const dataDir = useGraph((s) => s.dataDir)
  const inputFiles = useGraph((s) => s.inputFiles)
  const inputFileFolders = useGraph((s) => s.inputFileFolders)
  const update = useGraph((s) => s.updateConfig)
  const detectInteractive = useGraph((s) => s.detectInteractive)
  const convertInteractive = useGraph((s) => s.convertInteractive)
  const setInteractive = useGraph((s) => s.setInteractive)
  const setLoadUnits = useGraph((s) => s.setLoadUnits)
  const setLoadNumeric = useGraph((s) => s.setLoadNumeric)

  // Wizard step + preset are restored from config so reopening lands on the last stage the user
  // was on (roadmap included), with the same column preset — mirroring how roles/conditions persist.
  const [stage, setStage] = useState<Stage>(() => {
    const s = cfg?.interactive?.step
    // An old saved 4 (the former Samplesheet step) is part of Conditions now.
    return s === 4 ? 3 : s === 1 || s === 2 || s === 3 || s === 5 ? s : 1
  })
  const [armed, setArmed] = useState<Field | null>(null)
  // Conditions switched on with no values yet — shared by the Conditions and Samplesheet steps (a
  // condition holding values is on by its values). See Stage1 / Stage2.
  const [activated, setActivated] = useState<Set<Field>>(() => new Set())
  // The parsed matrix rows, every one: the Columns step scrolls them all (windowed), the Filtering
  // step computes distinct-value facets and kept-row counts over them. Set once per matrix load.
  const [allRows, setAllRows] = useState<Record<string, string>[]>([])
  const [detecting, setDetecting] = useState(false)
  const [converting, setConverting] = useState(false)
  const [confirmedSheet, setConfirmedSheet] = useState(false)
  // Which way the last step turn went: the new step swipes in from the right going forward, from
  // the left going back (or jumping back on the roadmap).
  const [shownStage, setShownStage] = useState(stage)
  const [swipe, setSwipe] = useState<'next' | 'back'>('next')
  if (shownStage !== stage) {
    setShownStage(stage)
    setSwipe(stage > shownStage ? 'next' : 'back')
  }
  // The Conditions step's card in front (see ConditionsStage): 0 · switch on + map, 1 · Refine &
  // edit. The step is gated on the second — Next on the first turns to it, and only there can it
  // be confirmed and left; Back on the second turns back to the first.
  const [condCard, setCondCard] = useState<CondCard>(0)
  const [confirmed, setConfirmed] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // Annotation fetch (Metadata step): status text + in-flight flag.
  const [annBusy, setAnnBusy] = useState(false)
  // The fetch's status line and how it reads: progress (info), done (ok), partly done (warn), failed.
  const [annMsg, setAnnNote] = useState<{ text: string; kind: StatusKind } | null>(null)
  const setAnnMsg = (text: string | null, kind: StatusKind = 'info'): void =>
    setAnnNote(text == null ? null : { text, kind })
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
        if (!cancelled) setAllRows([])
        return
      }
      const text = await window.api.readDataFile(dataDir, matrix)
      if (cancelled) return
      try {
        const info = text ? parseMatrix(text) : null
        setAllRows(info?.rows ?? [])
      } catch {
        setAllRows([])
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
  // Per-sample applied token spans (Conditions step). Persisted in config like column roles, so
  // reopening restores the highlights; the value, highlight and "original" all derive from these.
  const spans: Record<string, RowSpans> = (interactive?.spans as Record<string, RowSpans>) ?? {}
  // Token separator for the Conditions step. Spans are token indexes under it, so a change of the
  // EFFECTIVE separator drops every span (the extracted values stay; the user re-paints under the
  // new tokenisation). A blank box falls back to the default.
  const separator = interactive?.separator ?? DEFAULT_DELIM
  const delims = [separator || DEFAULT_DELIM]
  const setSeparator = (sep: string): void => {
    const same = (sep || DEFAULT_DELIM) === delims[0]
    setInteractive(id, same ? { separator: sep } : { separator: sep, spans: {} })
  }
  // Bulk commit — the Filtering step edits a local draft and writes it all at once on Apply/Reset.
  const setFilters = (next: Record<string, FilterSpec>): void => {
    setInteractive(id, { filters: next })
  }
  const blank = (h: string): InteractiveSampleCond => ({
    sample: h,
    include: true,
    cell: '',
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

  // The custom condition axes the user added beyond the five presets, and the full field list.
  const customConditions = interactive?.customConditions ?? []
  const fields: Field[] = [...PRESET_FIELDS, ...customConditions]
  const colorOf = (f: Field): string => fieldColorIn(f, customConditions)
  // Conditions switched off that keep their values (see ConditionState): saved with the import, so
  // switching one back on restores them.
  const hiddenConditions = interactive?.hiddenConditions ?? []
  const hidden = new Set<Field>(hiddenConditions)
  // The custom conditions declared numeric (their chip switched to num): each takes a unit, and
  // its values must be numbers.
  // (on the Load tile, shared with the manual panel; the pipeline goes stale on Apply)
  const numericConditions = declaredNumeric(cfg)
  const setNumeric = (name: string, on: boolean): void =>
    setLoadNumeric(id, name, on, { stale: false })
  const setHidden = (f: Field, off: boolean): void => {
    if (off === hidden.has(f)) return
    setInteractive(id, {
      hiddenConditions: off ? [...hiddenConditions, f] : hiddenConditions.filter((n) => n !== f)
    })
  }

  /** Add a custom condition. Returns why the name can't be used, or null on success. The name
   *  becomes a samplesheet column and a `@name` condition key, so it goes through the engine's own
   *  rule rather than a second copy of it here. */
  const addCustomCondition = (name: string): string | null => {
    if (!validCondName(name))
      return RESERVED_COND_NAMES.includes(name)
        ? `“${name}” is reserved`
        : 'Use lowercase letters, digits and _ (starting with a letter)'
    setInteractive(id, { customConditions: [...customConditions, name] })
    return null
  }

  /** Drop a custom condition: the axis itself, every sample's value for it, and its painted spans
   *  (which are keyed by field name and would otherwise linger and re-highlight a stale region). */
  const removeCustomCondition = (name: string): void => {
    const nextConditions: Record<string, InteractiveSampleCond> = {}
    for (const [sc, c] of Object.entries(conditions)) {
      if (c.extra?.[name] == null) {
        nextConditions[sc] = c
        continue
      }
      const extra = { ...c.extra }
      delete extra[name]
      nextConditions[sc] = { ...c, extra }
    }
    const nextSpans: Record<string, RowSpans> = {}
    for (const [sc, rs] of Object.entries(spans)) {
      const next = { ...rs }
      delete next[name]
      nextSpans[sc] = next
    }
    if (armed === name) setArmed(null)
    setLoadNumeric(id, name, false, { stale: false })
    const sheetMap = { ...(interactive?.sheet?.map ?? {}) }
    delete sheetMap[name]
    setInteractive(id, {
      customConditions: customConditions.filter((n) => n !== name),
      hiddenConditions: hiddenConditions.filter((n) => n !== name),
      ...(interactive?.sheet ? { sheet: { ...interactive.sheet, map: sheetMap } } : null),
      conditions: nextConditions,
      spans: nextSpans as Record<string, Partial<Record<string, [number, number]>>>
    })
  }

  const setCell = (i: number, field: Field, value: string): void => {
    const h = sampleCols[i]
    const cur = conditions[h] ?? blank(h)
    setInteractive(id, {
      conditions: { ...conditions, [h]: withEdited(withCond(cur, field, value), field, true) }
    })
  }

  // The Conditions step's samplesheet mode: a sheet in any layout, its rows matched to the samples
  // and its columns mapped to conditions (see sheetMap). Every change to it rewrites the mapped
  // conditions' values; the sheet is saved with the import, so reopening shows it as it was.
  const condSource = interactive?.condSource ?? 'names'
  const sheet = interactive?.sheet
  const setSheet = (next: LoadedSheet): void => {
    const out = applySheet(conditions, spans, sampleCols, sheet, next, blank)
    // A condition just mapped (or moved to another column) is in use: switched back on if it was
    // off. One mapped before and since switched off stays off — the switch is the user's.
    const fresh = Object.keys(next.map).filter((f) => sheet?.map[f] !== next.map[f])
    setInteractive(id, {
      sheet: next,
      conditions: out.conditions,
      spans: out.spans,
      hiddenConditions: hiddenConditions.filter((f) => !fresh.includes(f))
    })
    setActivated((prev) => new Set([...prev, ...fresh]))
  }
  const loadSamplesheet = async (): Promise<void> => {
    const file = await window.api.openFile({
      title: 'Choose a samplesheet',
      filters: [
        { name: 'Samplesheet', extensions: ['csv', 'tsv', 'txt', 'xlsx'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!file) return
    // Only to the conditions switched on is a column named as one mapped by itself: mapping one
    // that's off would fill it, and so switch it on.
    const on = (f: Field): boolean =>
      !hidden.has(f) && (activated.has(f) || samples.some((s) => condOf(s, f).trim() !== ''))
    const next = readSheet(file.name, file.content, sampleCols, fields.filter(on))
    if (!next.columns.length || !next.rows.length) return setMsg(`${file.name} has no rows`)
    setSheet(next)
    const n = sheetMatches(next, sampleCols).size
    setMsg(
      `${file.name}: ${n} of ${sampleCols.length} samples matched` +
        (next.rows.length > n ? ` · ${next.rows.length - n} rows unmatched (red)` : '')
    )
  }

  const setInclude = (i: number, on: boolean): void => {
    const h = sampleCols[i]
    const cur = conditions[h] ?? blank(h)
    setInteractive(id, { conditions: { ...conditions, [h]: { ...cur, include: on } } })
  }

  // Refactor (bulk-rename) condition values across every sample that carries them, in one edit —
  // `map` is old value → new value: e.g. "drugA" → "Drug A" in the cmpd column, or (the bar's text
  // mode) every time value with "min" removed.
  const renameConditionValue = (field: Field, map: Record<string, string>): void => {
    const next: Record<string, InteractiveSampleCond> = { ...conditions }
    for (const sc of sampleCols) {
      const cur = conditions[sc] ?? blank(sc)
      // Trimmed, as the rename bar lists values — so "(blank)" also takes whitespace-only cells.
      const old = condOf(cur, field).trim()
      if (Object.prototype.hasOwnProperty.call(map, old) && map[old] !== old)
        next[sc] = withEdited(withCond(cur, field, map[old]), field, true)
    }
    setInteractive(id, { conditions: next })
  }

  // Tag the active field from a token range painted on `refName` (any active row). The region is
  // anchored relative to that row's already-painted neighbours (see deriveAnchor) and re-placed on
  // each ACTIVE row against ITS OWN layout — so rows with internal underscores on only some names
  // (cellA vs cell_typeA) are tagged correctly without disturbing an existing paint. Each row keeps
  // its own span; nothing is applied globally. Re-tagging a field's exact region clears it.
  const annotate = (
    refName: string,
    tokStart: number,
    tokEnd: number,
    activeSamples: string[]
  ): void => {
    const field = armed
    if (!field || activeSamples.length === 0) return
    // Placed among the conditions that are on: a switched-off one's spans aren't shown, so they
    // neither anchor a paint nor block its tokens. Tags are exclusive, the last on top: a paint
    // over a switched-off one's tokens takes them, and that tag (and its value on the row) goes.
    const shown = (rs: RowSpans | undefined): RowSpans =>
      Object.fromEntries(Object.entries(rs ?? {}).filter(([f]) => !hidden.has(f)))
    const refSpans = shown(spans[refName])
    // Re-painting a field's own current region (on the row it was derived from) clears it.
    const existing = refSpans[field]
    const same = !!existing && existing[0] === tokStart && existing[1] === tokEnd
    const desc = deriveAnchor(refName, tokStart, tokEnd, refSpans, field, delims)
    const nextConditions: Record<string, InteractiveSampleCond> = { ...conditions }
    const nextSpans: Record<string, RowSpans> = { ...spans }
    let hit = 0
    for (const sc of activeSamples) {
      const base = nextConditions[sc] ?? blank(sc)
      const rowSpans: RowSpans = { ...(nextSpans[sc] ?? {}) }
      if (same) {
        delete rowSpans[field]
        nextConditions[sc] = withEdited(withCond(base, field, ''), field, false)
      } else {
        const span = applyAnchor(sc, shown(rowSpans), desc, field, delims)
        if (!span) continue
        let next = base
        for (const [f, sp] of Object.entries(rowSpans)) {
          if (f === field || !sp || !hidden.has(f) || sp[1] <= span[0] || sp[0] >= span[1]) continue
          delete rowSpans[f]
          next = withEdited(withCond(next, f, ''), f, false)
        }
        rowSpans[field] = span
        nextConditions[sc] = withEdited(
          withCond(next, field, spanValue(sc, span, delims)),
          field,
          false
        )
        hit++
      }
      nextSpans[sc] = rowSpans
    }
    setInteractive(id, {
      conditions: nextConditions,
      spans: nextSpans as Record<string, Partial<Record<string, [number, number]>>>
    })
    setMsg(
      same
        ? `Cleared ${field} on ${activeSamples.length} sample${activeSamples.length > 1 ? 's' : ''}`
        : `Applied ${field} to ${hit} sample${hit === 1 ? '' : 's'}`
    )
  }

  // Read the current matrix and (re)seed the column classification using a preset.
  const detectWith = async (p: MatrixPreset): Promise<void> => {
    setDetecting(true)
    setMsg(null)
    const res = await detectInteractive(id, p)
    setDetecting(false)
    if (!res.ok) setMsg(`Error: ${res.error}`)
    else
      setMsg(
        p === 'none'
          ? 'Cleared — assign columns or pick a preset.'
          : `Found ${res.count} sample columns`
      )
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

  const hasFilters = filterCols.length > 0
  // Filtering (stage 2) is skipped entirely when no column is classified `filter`: Next from
  // Columns jumps to Conditions, and Back from Conditions jumps to Columns.
  const goNext = (): void => {
    setMsg(null)
    if (stage === 3 && condCard === 0) return setCondCard(1)
    const to = nextStage(stage, hasFilters)
    if (to === 3) setCondCard(0)
    setStage(to)
  }
  const goBack = (): void => {
    setMsg(null)
    if (stage === 3 && condCard === 1) return setCondCard(0)
    const to = prevStage(stage, hasFilters)
    // Back from Metadata lands where the step was left: the samplesheet.
    if (to === 3) setCondCard(1)
    setStage(to)
  }
  // The numeric conditions carrying values with no unit picked yet — the Conditions and Samplesheet
  // steps ask for one (a.u. counts) before going on, so every dose / time reaches the analyses with
  // its unit. (The chips on both steps pick it.)
  const unitsMissing = (['dose', 'time', ...numericConditions] as string[]).filter(
    (f) =>
      !hidden.has(f) &&
      !(cfg?.units as Record<string, string | undefined> | undefined)?.[
        f === 'dose' || f === 'time' ? f : `@${f}`
      ] &&
      samples.some((s) => {
        const v = condOf(s, f).trim()
        return s.include !== false && v !== '' && Number.isFinite(Number(v))
      })
  )
  // What blocks the samplesheet (as the run would refuse it — samplesheetIssues): a condition in
  // use left empty for an included sample, or a dose / time that isn't a number. A condition
  // switched off isn't written, so isn't checked.
  // (one pass over the samples — cheap, so not memoised; this sits after the early return)
  const sheetIssues = samplesheetIssues(
    samples
      .filter((s) => s.include !== false)
      .map((s) => ({
        sample: s.sample,
        ...Object.fromEntries(fields.filter((f) => !hidden.has(f)).map((f) => [f, condOf(s, f)]))
      })),
    customConditions.filter((n) => !hidden.has(n)),
    numericConditions.filter((n) => !hidden.has(n))
  )
  const canNext =
    stage === 1
      ? !!idCol && sampleCols.length > 0
      : stage === 3
        ? condCard === 0 ||
          (confirmedSheet && unitsMissing.length === 0 && sheetIssues.length === 0)
        : true
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
        : stage === 3 && condCard === 1 && sheetIssues.length
          ? `Fix the samplesheet first (${sheetIssues.length} issue${sheetIssues.length === 1 ? '' : 's'})`
          : unitsMissing.length
            ? `Pick a unit for ${unitsMissing.join(' and ')}`
            : stage === 3
              ? 'Tick “Everything is correct” to continue'
              : ''

  // The samplesheet's blocking problems, as the import would refuse them — kept off the page and
  // shown as the Next-block message's tooltip.
  const nextBlockDetail =
    stage === 3 && condCard === 1 && sheetIssues.length ? (
      <>
        Every condition in use needs a value for every sample, and dose, time and every condition
        switched to num must be numbers (a vehicle’s dose is 0):
        {sheetIssueLines(sheetIssues).map((line) => (
          <div key={line}>• {line}</div>
        ))}
      </>
    ) : null

  // The Metadata step's rows must reflect the Filtering step — rows dropped by an active filter must
  // not appear in (or be counted for) the generated DB. EVERY kept row, not the preview's first
  // few, so its search finds any protein (the step renders only the first matches). Computed only
  // on the Metadata step (a single pass over the full matrix).
  const metaPreview = ((): { rows: Record<string, string>[]; total: number } | null => {
    if (stage !== 5) return null
    const active = filterCols
      .filter((c) => filters[c] && filterOn(filters[c]))
      .map((c) => ({ col: c, drop: new Set(filters[c].drop ?? []), spec: filters[c] }))
    if (active.length === 0) return { rows: allRows, total: allRows.length }
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
          if (
            !Number.isFinite(x) ||
            (spec.min != null && x < spec.min) ||
            (spec.max != null && x > spec.max)
          ) {
            ok = false
            break
          }
        }
      }
      if (ok) {
        total++
        rows.push(r)
      }
    }
    return { rows, total }
  })()

  const annotations = interactive?.annotations
  // Toggling which annotation columns are shown just re-slices the cached data — no refetch.
  const setAnnotationFields = (selectedIds: string[]): void => {
    if (!annotations) return
    // Only columns the fetched data actually holds: annotations fetched before a column existed
    // (COG_area, say) would otherwise show it, empty, until the next fetch.
    const held = new Set(Object.values(annotations.byId).flatMap((rec) => Object.keys(rec)))
    const fields = colsForIds(selectedIds).filter((c) => held.has(c))
    setInteractive(id, { annotations: { ...annotations, fields } })
  }
  // Fetch annotations for every kept feature and merge them into the DB (persisted in config,
  // written on convert). Runs in the main process (no renderer CSP) via window.api. Only the
  // SELECTED fields are fetched, but results are MERGED into any previously-fetched columns — so
  // a plain re-slice of already-fetched fields (see setAnnotationFields) never hits the network.
  const runFetchAnnotations = async (selectedIds: string[], refresh = false): Promise<void> => {
    if (!idCol || annBusy) return
    const wantsString = selectedIds.includes('string')
    setAnnBusy(true)
    setAnnMsg(
      wantsString ? '1/3 Fetching annotations & STRING ids (UniProt)…' : 'Fetching from UniProt…'
    )
    try {
      const active = filterCols
        .filter((c) => filters[c] && filterOn(filters[c]))
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
      // Every distinct protein the kept features name: each member of a `;`-group, unwrapped
      // from `sp|ACC|NAME`, isoforms folded into their entry (accession.ts). Annotation is
      // fetched and saved per protein; a group carries its members' union downstream.
      const accSet = new Set<string>()
      for (const r of allRows) {
        if (active.length && !passes(r)) continue
        for (const acc of groupMembers((r[idCol] ?? '').trim())) accSet.add(acc)
      }
      if (accSet.size === 0) {
        setAnnMsg('No accessions found in the ID column.', 'warn')
        return
      }
      const base = refresh
        ? 'Re-querying UniProt (ignoring cache)…'
        : wantsString
          ? '1/3 Fetching annotations & STRING ids (UniProt)…'
          : 'Fetching from UniProt…'
      const offAnn = window.api.onAnnotProgress((p) => {
        // A `stage` means the UniProt pass is done and a downstream source is resolving — those
        // steps have no per-accession count, so show what they're doing instead of a stale 0/0.
        if (p.stage) setAnnMsg(p.stage)
        else setAnnMsg(p.total > 0 ? `${base} ${p.done}/${p.total}` : base)
      })
      let res: Awaited<ReturnType<typeof window.api.fetchUniprot>>
      try {
        res = await window.api.fetchUniprot([...accSet], sourceIds(selectedIds), { refresh })
      } finally {
        offAnn()
      }
      // Merge onto any previously-fetched columns so this fetch only adds/refreshes the selected
      // ones instead of wiping the rest of the cache.
      const prev = annotations?.byId ?? {}
      const byId: Record<string, Record<string, string>> = {}
      for (const acc of accSet) {
        const rec = res.byId[acc]
        if (prev[acc] || rec) byId[acc] = { ...(prev[acc] ?? {}), ...(rec ?? {}) }
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
      // A low match rate almost always means the ID column holds something other than UniProt
      // accessions (gene symbols, say) — say so rather than report "1 of 2376" as a success.
      const lowMatch = n < accSet.size * 0.5
      const pct = (n / accSet.size) * 100
      const idWarn = lowMatch
        ? `ID column likely not UniProt IDs: ${n} of ${accSet.size} match only (${pct > 0 && pct < 1 ? '<1' : Math.round(pct)}%). `
        : ''
      // When STRING is selected, download the organism's interactome so the network builds offline
      // — STRING's organism, from its ids, which can differ from UniProt's taxon (stringTaxon)
      const stringOrg = stringTaxon(byId) || taxon
      if (wantsString && stringOrg) {
        setAnnMsg(`2/3 Resolving species — STRING taxon ${stringOrg}…`)
        const stageLabel: Record<string, string> = {
          links: 'interactome',
          info: 'gene names',
          aliases: 'gene-name map'
        }
        const off = window.api.onStringProgress((p) => {
          const pct = p.total > 0 ? ` ${Math.round((p.loaded / p.total) * 100)}%` : ''
          setAnnMsg(
            `3/3 STRING data — ${stageLabel[p.stage] ?? p.stage} for taxon ${stringOrg}…${pct}`
          )
        })
        try {
          const r = await window.api.ensureStringOrg(stringOrg)
          setAnnMsg(
            r.error
              ? `${idWarn}Annotated ${n} proteins${sp}${cat}. STRING download failed: ${r.error}`
              : `${idWarn}Annotated ${n} proteins${sp}${cat}. STRING v${r.version} ${r.cached ? 'ready (cached)' : 'downloaded'}.`,
            r.error || lowMatch ? 'warn' : 'ok'
          )
        } finally {
          off()
        }
      } else {
        setAnnMsg(
          res.error
            ? `${idWarn}Partial: ${n}/${accSet.size} proteins annotated (${res.error})${sp}${cat}`
            : lowMatch
              ? `${idWarn.trim()}${sp}${cat}`
              : `Annotated ${n} of ${accSet.size} proteins.${sp}${cat}`,
          res.error || lowMatch ? 'warn' : 'ok'
        )
      }
    } catch (e) {
      setAnnMsg(e instanceof Error ? e.message : 'Fetch failed.', 'error')
    } finally {
      setAnnBusy(false)
    }
  }
  const clearAnnotations = (): void => {
    setInteractive(id, { annotations: undefined })
    setAnnMsg(null)
  }

  return createPortal(
    <div style={{ ...cssVars(PALETTES[mode]), ...(dock ? DOCKED_WRAP : styles.overlay) }}>
      {!dock && <div style={styles.scrim} onClick={onClose} />}
      <div
        style={{
          ...styles.modal,
          ...(dock ? DOCKED_CARD : null)
        }}
        role="dialog"
        aria-label="Interactive import"
      >
        <div style={styles.head}>
          Interactive import
          <div style={{ flex: 1 }} />
          <button style={styles.closeBtn} onClick={onClose} title="Close" aria-label="Close">
            ✕
          </button>
        </div>

        <Roadmap
          stage={stage}
          steps={STAGES}
          allDone={completed}
          onJump={(target) => {
            setMsg(null)
            if (target === 3) setCondCard(0)
            setStage(target as Stage)
          }}
        />

        <div style={styles.body}>
          {/* Keyed by the step, so each turn mounts afresh and swipes in from the side it comes
              from (see .oe-step-in). */}
          <div
            key={stage}
            className={`oe-step-in ${swipe === 'back' ? 'oe-step-in-back' : ''}`}
            style={styles.stepPane}
          >
            {stage === 1 && (
              <Step1Columns
                matrix={matrix}
                inputFiles={inputFiles}
                inputFileFolders={inputFileFolders}
                onMatrix={changeMatrix}
                onBrowse={browseMatrix}
                preset={preset}
                onPreset={applyPreset}
                detecting={detecting}
                onDetect={runDetect}
                columns={columns}
                roles={roles}
                rows={allRows}
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
                <ConditionsStage
                  samples={samples}
                  spans={spans}
                  fields={fields}
                  colorOf={colorOf}
                  armed={armed}
                  setArmed={setArmed}
                  activated={activated}
                  setActivated={setActivated}
                  hidden={hidden}
                  onHide={setHidden}
                  onAddCustom={addCustomCondition}
                  onRemoveCustom={removeCustomCondition}
                  onAnnotate={annotate}
                  delims={delims}
                  separator={separator}
                  onSeparator={setSeparator}
                  units={cfg?.units ?? {}}
                  onUnits={(u) => setLoadUnits(id, u)}
                  numeric={numericConditions}
                  onNumeric={setNumeric}
                  setCell={setCell}
                  setInclude={setInclude}
                  onRenameValue={renameConditionValue}
                  condSource={condSource}
                  onCondSource={(v) => {
                    setArmed(null)
                    setInteractive(id, { condSource: v })
                  }}
                  sheet={sheet}
                  sampleCols={sampleCols}
                  onLoadSheet={() => void loadSamplesheet()}
                  onSheet={setSheet}
                  card={condCard}
                  onCard={setCondCard}
                />
              ) : (
                <div style={styles.hint}>Mark at least one Sample column in step 1.</div>
              ))}
            {stage === 5 && (
              <Step4Metadata
                idCol={idCol}
                labelCol={labelCol}
                metaCols={metaCols}
                rows={metaPreview?.rows ?? null}
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
        </div>

        <div style={styles.foot}>
          {stage > 1 && (
            <button style={styles.btn} onClick={goBack}>
              ← Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          {stage === 3 && condCard === 1 && (
            <label style={styles.confirm}>
              <input
                type="checkbox"
                checked={confirmedSheet}
                onChange={(e) => setConfirmedSheet(e.target.checked)}
              />
              Everything is correct
            </label>
          )}
          {stage === 3 && condCard === 0 ? null : stage < 5 ? (
            // (On the Conditions step's first card, its own arrow over the parked card is Next.)
            <>
              {nextBlock &&
                (nextBlockDetail ? (
                  <HoverTip
                    tip={nextBlockDetail}
                    above
                    style={{
                      ...styles.nextBlock,
                      cursor: 'help',
                      textDecoration: 'underline dotted'
                    }}
                  >
                    {nextBlock}
                  </HoverTip>
                ) : (
                  <span style={styles.nextBlock}>{nextBlock}</span>
                ))}
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
    dock ?? document.body
  )
}
