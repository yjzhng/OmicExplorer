/** The import's Metadata stage: review the DB (uniqID → gene + metadata) before converting. */
import { type ReactNode, useMemo, useState } from 'react'
import { groupMembers } from '../../../engine'
import { ScrollFade } from '../../../ui/table/ScrollFade'
import { longestText } from '../../../ui/table/useVirtualRows'
import { VirtualTbody } from '../../../ui/table/VirtualRows'
import { type StatusKind, StatusNote } from '../../../ui/controls/StatusNote'
import { rowMatches } from '../../../ui/table/rowMatches'
import { TableSearch } from '../../../ui/table/TableSearch'
import type { AnnotationSet } from '../../../graph/config/load'
import { ANN_DEFAULT, ANN_GROUPS, UNIPROT_FIELDS } from './annotationFields'
import { AnnCategory } from './annotations'
import { styles } from './styles'
import { COL_PAD } from './fields'

// Default DB column widths, computed from content string length (deterministic — no DOM
// measurement, so it can't be inflated by a slow/stretched layout). ~7px per char at 12px.
const DB_CHAR_PX = 7
const DB_MIN_COL = 52
const DB_MAX_COL = 260

/** Step 4: preview the DB (ID map) that will be generated and confirm. Columns default to a
 *  content-fit width (capped) and are drag-resizable / double-click-to-refit. Always fixed
 *  layout, so long free-text never blows a column out. */
export function Step4Metadata({
  idCol,
  labelCol,
  metaCols,
  rows,
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
  annotations?: AnnotationSet
  annBusy: boolean
  annMsg: { text: string; kind: StatusKind } | null
  onFetch: (fields: string[], refresh?: boolean) => void
  onSelectFields: (fields: string[]) => void
  onClearAnnotations: () => void
}): ReactNode {
  // Which fields are ticked — seeded from an already-fetched set so a reopened wizard matches.
  const [picked, setPicked] = useState<Set<string>>(() =>
    annotations
      ? new Set(
          UNIPROT_FIELDS.filter((f) => f.cols.some((c) => annotations.fields.includes(c))).map(
            (f) => f.id
          )
        )
      : new Set(ANN_DEFAULT)
  )
  // A new selection; already fetched → just re-slice the cached data, no network round-trip.
  const pick = (next: Set<string>): void => {
    setPicked(next)
    if (annotations) onSelectFields([...next])
  }
  const annCols = useMemo(() => annotations?.fields ?? [], [annotations])
  // The DB exactly as it will be written (buildStandardInputs): one row per PROTEIN, keyed by its
  // canonical accession — a protein group's members each get their own row, with that protein's
  // own gene name and annotation; a protein named by two groups appears once.
  const cols = useMemo(
    () => (idCol ? ['uniqID', 'gene', ...metaCols, ...annCols] : []),
    [idCol, metaCols, annCols]
  )
  // Built from EVERY kept row (not a preview sample), so the search below reaches any protein.
  const dbRows = useMemo(() => {
    const out: Record<string, string>[] = []
    if (!idCol) return out
    const written = new Set<string>()
    for (const r of rows ?? []) {
      const id = (r[idCol] ?? '').trim()
      const label = labelCol ? (r[labelCol] ?? '').trim() : ''
      const members = groupMembers(id)
      for (const uniqID of members.length ? members : [id]) {
        if (!uniqID || written.has(uniqID)) continue
        written.add(uniqID)
        const ann = annotations?.byId[uniqID]
        const row: Record<string, string> = { uniqID, gene: label || (ann?.geneName ?? '').trim() }
        for (const c of metaCols) row[c] = r[c] ?? ''
        for (const f of annCols) row[f] = ann?.[f] ?? ''
        out.push(row)
      }
    }
    return out
  }, [idCol, labelCol, metaCols, annCols, rows, annotations])
  const accessors = cols.map((c) => (r: Record<string, string>) => r[c] ?? '')

  // Search across every column; optionally only the proteins the fetch found nothing for.
  const [query, setQuery] = useState('')
  const [bareOnly, setBareOnly] = useState(false)
  const matches = useMemo(() => {
    const bare = (r: Record<string, string>): boolean => annCols.every((f) => !r[f])
    return dbRows.filter(
      (r) =>
        (!bareOnly || !annotations || bare(r)) &&
        rowMatches(
          cols.map((c) => r[c] ?? ''),
          query
        )
    )
  }, [dbRows, cols, annCols, annotations, bareOnly, query])

  // Per-column user override (px); null = the computed content-fit default. Reset when the
  // column set changes (adjust-state-during-render).
  const [widths, setWidths] = useState<(number | null)[]>(() => cols.map(() => null))
  const [colCount, setColCount] = useState(cols.length)
  if (colCount !== cols.length) {
    setColCount(cols.length)
    setWidths(cols.map(() => null))
  }

  if (!idCol) return <div style={styles.hint}>Pick an ID column in step 1.</div>
  // Every match scrolls; only those in view are drawn (ui/table/VirtualRows).
  // Content-fit width from the longest value (the header, or any match — a sample of many), capped.
  const fitWidth = (i: number): number => {
    const maxLen = Math.max(
      cols[i].length,
      longestText(matches.length, (k) => accessors[i](matches[k])).length
    )
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
      {/* Fetch external annotations (UniProt) by feature accession — merged into the DB and saved
          with the project. */}
      <div style={styles.annPanel}>
        <span style={styles.annTitle}>Fetch annotations</span>
        <div style={styles.annFields}>
          {ANN_GROUPS.map((g) => (
            <AnnCategory key={g.id} group={g} picked={picked} disabled={annBusy} onChange={pick} />
          ))}
          {/* Every fetchable field at once, or back to the default pick. */}
          <button
            style={{ ...styles.btn, opacity: annBusy ? 0.5 : 1 }}
            disabled={annBusy}
            title="Tick every available field"
            onClick={() =>
              pick(
                new Set(
                  ANN_GROUPS.flatMap((g) => g.members.filter((m) => !m.soon).map((m) => m.id))
                )
              )
            }
          >
            Select all
          </button>
          <button
            style={{ ...styles.btn, opacity: annBusy ? 0.5 : 1 }}
            disabled={annBusy}
            title="Back to the default fields (protein and gene name, GO, COG/KOG, KEGG, DEG, STRING)"
            onClick={() => pick(new Set(ANN_DEFAULT))}
          >
            Reset
          </button>
        </div>
        {/* Clear on the options' row, at its right end. Disabled rather than hidden during a
            fetch, so nothing shifts as it starts. */}
        {annotations && (
          <button
            style={{ ...styles.btn, marginLeft: 'auto', opacity: annBusy ? 0.5 : 1 }}
            disabled={annBusy}
            onClick={onClearAnnotations}
          >
            Clear
          </button>
        )}
        {/* Fetch / Re-fetch as one unit, on a row of their own below. */}
        <span style={styles.annActions}>
          <button
            style={{ ...styles.btnPrimary, opacity: annBusy || picked.size === 0 ? 0.5 : 1 }}
            disabled={annBusy || picked.size === 0}
            onClick={() => onFetch([...picked])}
          >
            {/* Both labels share one grid cell, the idle one hidden: the button is always as wide as
              "Fetching…", so going busy doesn't widen it and push Re-fetch onto the next row. */}
            <span style={{ display: 'inline-grid', justifyItems: 'center' }}>
              <span style={{ gridArea: '1 / 1', visibility: annBusy ? 'hidden' : 'visible' }}>
                Fetch
              </span>
              <span style={{ gridArea: '1 / 1', visibility: annBusy ? 'visible' : 'hidden' }}>
                Fetching…
              </span>
            </span>
          </button>
          {/* Annotations are cached per accession app-wide, so a value can be stale even in a project
            that has never fetched — hence a re-query that ignores the cache entirely. */}
          <button
            style={{ ...styles.btn, opacity: annBusy || picked.size === 0 ? 0.5 : 1 }}
            disabled={annBusy || picked.size === 0}
            title="Ignore cached annotations and query every source again"
            onClick={() => onFetch([...picked], true)}
          >
            Re-fetch
          </button>
          {/* The fetch's status, right of its buttons: in progress while it runs, then the
              outcome — done, partly done, or failed. */}
          {annMsg && (
            <StatusNote kind={annBusy ? 'progress' : annMsg.kind} style={styles.annNote}>
              {annMsg.text}
            </StatusNote>
          )}
        </span>
      </div>
      <ScrollFade
        title="Metadata DB"
        colNav
        headCenter={
          <>
            <TableSearch
              value={query}
              onChange={setQuery}
              placeholder="Search accession, gene, annotation…"
              title="Every word must appear in some column of the row"
            />
            {annotations && (
              <label
                style={styles.dbSearchToggle}
                title="Only the proteins the fetch returned no annotation for"
              >
                <input
                  type="checkbox"
                  checked={bareOnly}
                  onChange={(e) => setBareOnly(e.target.checked)}
                />
                Unannotated only
              </label>
            )}
            {/* A fixed width, so the count changing as you type doesn't nudge the centred search. */}
            <span style={{ ...styles.renameCount, minWidth: 120 }}>
              {matches.length.toLocaleString()}/{dbRows.length.toLocaleString()} proteins.
            </span>
          </>
        }
      >
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
                    onDoubleClick={() =>
                      setWidths((prev) => prev.map((w, k) => (k === i ? null : w)))
                    }
                  />
                </th>
              ))}
            </tr>
          </thead>
          <VirtualTbody
            count={matches.length}
            span={cols.length}
            row={(i) => (
              <tr key={i}>
                {accessors.map((get, ci) => {
                  const v = get(matches[i])
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
            )}
          />
        </table>
      </ScrollFade>
    </>
  )
}
