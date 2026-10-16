/** Settings › Database: the app-wide reference cache (UniProt annotations, STRING networks)
 *  — what's in it, from which versions, how big — updating and clearing it. The cache is shared by
 *  every project on this computer; annotations a project already fetched are saved with the
 *  project, so clearing only means downloading again at the next import. */
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'

import { StatusDot, type StatusInfo } from '../graph/StatusDot'
import { Chevron } from './Chevron'
import { formatSize, REVEAL } from './fileLabels'
import { Select } from './Select'
import { TableSearch } from './TableSearch'
import { UI } from './theme'

type Summary = Awaited<ReturnType<Window['api']['refCacheSummary']>>
type BrowseQuery = Parameters<Window['api']['browseRefCache']>[0]
type BrowseResult = Awaited<ReturnType<Window['api']['browseRefCache']>>
type BrowseRow = BrowseResult['rows'][number]
type Target = Parameters<Window['api']['clearRefCache']>[0]

const date = (ms: number): string => (ms ? new Date(ms).toLocaleDateString() : '—')
const count = (n: number): string => n.toLocaleString()

// The workflow tiles' status colours (graph/StatusDot), so a dot means the same thing everywhere.
const GREEN = '#3fae5a'
const AMBER = '#e2b93b'
const RED = '#e5484d'

const RUNNING: StatusInfo = { color: AMBER, label: 'Updating…', pulse: true }

/** A cached version against the live one (null = not checked yet, '' = couldn't check). */
function versionStatus(have: string, live: string | null): StatusInfo {
  if (!have) return { color: UI.textMuted, label: 'Version unknown', pulse: false }
  if (live === null)
    return {
      color: UI.textMuted,
      label: 'Not checked — use Check for newer versions',
      pulse: false
    }
  if (!live)
    return { color: UI.textMuted, label: "Couldn't reach the source to check", pulse: false }
  if (live === have) return { color: GREEN, label: 'Current', pulse: false }
  return { color: AMBER, label: `${live} available`, pulse: false }
}

/** A version, with what the check found beside it. */
function Version({ have, live }: { have: string; live: string | null }): ReactNode {
  if (!have) return <span style={styles.muted}>unknown</span>
  const st = versionStatus(have, live)
  return (
    <>
      {have}
      {live !== null && <span style={{ ...styles.tag, color: st.color }}> · {st.label}</span>}
    </>
  )
}

/** A status dot with the cell's content beside it. */
function Dotted({ status, children }: { status: StatusInfo; children: ReactNode }): ReactNode {
  return (
    <span style={styles.dotted}>
      <StatusDot {...status} />
      <span>{children}</span>
    </span>
  )
}

/** An action button: `update` (blue) for one that fetches, `danger` (red) for one that deletes. */
function Btn({
  children,
  onClick,
  disabled,
  danger,
  update,
  title
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  update?: boolean
  title?: string
}): ReactNode {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...styles.small,
        ...(danger ? { color: UI.err } : null),
        ...(update ? { color: UI.info } : null),
        ...(disabled ? styles.disabled : null)
      }}
    >
      {children}
    </button>
  )
}

/** A fold-away block: a header (title, a one-line summary, its actions) over its table. */
function Section({
  title,
  summary,
  actions,
  open,
  onToggle,
  sub,
  children
}: {
  title: string
  summary?: string
  actions?: ReactNode
  open: boolean
  onToggle: () => void
  /** a table inside a section (smaller header) */
  sub?: boolean
  children: ReactNode
}): ReactNode {
  return (
    <div style={sub ? styles.subSection : styles.section}>
      <div style={styles.sectionHead}>
        <button style={styles.sectionToggle} onClick={onToggle} aria-expanded={open}>
          <Chevron deg={open ? 90 : 0} size={sub ? 10 : 12} />
          <span style={sub ? styles.tableTitle : styles.subTitle}>{title}</span>
          {summary && <span style={styles.sectionSummary}>{summary}</span>}
        </button>
        {actions}
      </div>
      {open && <div style={sub ? undefined : styles.sectionBody}>{children}</div>}
    </div>
  )
}

/** Which sections are folded, remembered across visits to Settings. */
const FOLD_KEY = 'omicexplorer-annotation-folds'
function loadFolded(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/** The confirm a delete asks for, over the Settings window. Esc or the scrim cancels. */
function ConfirmDelete({
  title,
  detail,
  onCancel,
  onConfirm
}: {
  title: string
  detail: string
  onCancel: () => void
  onConfirm: () => void
}): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCancel()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])
  return (
    <>
      <div style={styles.confirmScrim} onClick={onCancel} />
      <div style={styles.confirm} role="alertdialog" aria-label={title}>
        <div style={styles.confirmTitle}>{title}</div>
        <div style={styles.confirmText}>{detail}</div>
        <div style={styles.confirmButtons}>
          <button style={styles.btn} onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button style={{ ...styles.btn, ...styles.danger }} onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </>
  )
}

/** What a delete removes, in its confirm's words. */
function confirmText(t: Target): { title: string; detail: string } {
  const kept = 'Annotations already in your projects are kept.'
  switch (t.kind) {
    case 'uniprot':
      return {
        title: 'Clear the UniProt annotation cache?',
        detail: `Every protein is fetched from UniProt again the next time an import asks for annotations. ${kept}`
      }
    case 'uniprot-taxon':
      return {
        title: t.taxon
          ? `Delete the UniProt annotations for taxon ${t.taxon}?`
          : 'Delete the UniProt annotations with no taxon recorded?',
        detail: `These proteins are fetched from UniProt again the next time an import asks for them. ${kept}`
      }
    case 'string':
      return {
        title: `Delete the STRING network for taxon ${t.taxon}?`,
        detail:
          'Its network plots show nothing until the organism is downloaded again — with Update here, or in an import.'
      }
    case 'string-old':
      return {
        title: 'Remove older STRING versions?',
        detail:
          'Deletes files left from earlier STRING versions and unfinished downloads. The versions networks are read from are kept.'
      }
  }
}

/** Most species the source table gives a column of their own (the rest are in "All"). */
const MAX_TAXON_COLS = 4

/** Proteins per source: all of them, and — with more than one species — each species' own. */
function SourceTable({
  uni,
  busy,
  onUpdate
}: {
  uni: NonNullable<Summary['uniprot']>
  /** the running update's key (`src:<field>` / `org:<taxon>`), or null */
  busy: string | null
  onUpdate: (field: string, label: string) => void
}): ReactNode {
  const cols = [
    { key: 'all', head: 'All', sources: uni.sources },
    ...(uni.species.length > 1
      ? uni.species.slice(0, MAX_TAXON_COLS).map((sp) => ({
          key: String(sp.taxon),
          head: sp.taxon ? String(sp.taxon) : 'no taxon',
          sources: sp.sources
        }))
      : [])
  ]
  return (
    <>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.colHead}>Source</th>
            {cols.map((c) => (
              <th key={c.key} style={{ ...styles.colHead, ...styles.num }}>
                {c.head}
              </th>
            ))}
            <th style={styles.colHead} />
          </tr>
        </thead>
        <tbody>
          {uni.sources.map((s, i) => {
            const status: StatusInfo =
              busy === `src:${s.field}`
                ? RUNNING
                : s.outdated > 0
                  ? { color: AMBER, label: `${count(s.outdated)} to refresh`, pulse: false }
                  : { color: GREEN, label: 'Read by this version of the app', pulse: false }
            return (
              <tr key={s.label}>
                <td style={styles.td}>
                  <Dotted status={status}>{s.label}</Dotted>
                </td>
                {cols.map((c) => {
                  const cell = c.sources[i]
                  return (
                    <td key={c.key} style={{ ...styles.td, ...styles.num }}>
                      {cell.count ? count(cell.count) : <span style={styles.muted}>—</span>}
                      {cell.outdated > 0 && (
                        <div style={{ ...styles.tag, color: AMBER }}>
                          {count(cell.outdated)} to refresh
                        </div>
                      )}
                    </td>
                  )
                })}
                <td style={styles.actions}>
                  <Btn
                    update
                    disabled={!!busy}
                    onClick={() => onUpdate(s.field, s.label)}
                    title={`Fetch ${s.label} again for the ${count(s.count + s.outdated)} cached proteins that have it`}
                  >
                    Update
                  </Btn>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {uni.species.length > MAX_TAXON_COLS + 1 && (
        <div style={styles.hint}>
          Columns for the {MAX_TAXON_COLS} species with the most proteins; All counts every one.
        </div>
      )}
    </>
  )
}

/** Proteins the browser fetches per page. */
const BROWSE_PAGE = 100

/** The sources a species' proteins were looked up for. */
const sourcesOf = (sp: NonNullable<Summary['uniprot']>['species'][number] | undefined): string[] =>
  (sp?.sources ?? []).filter((s) => s.count + s.outdated > 0).map((s) => s.field)

/** Browse the cache one species and one source at a time: pick both, then search and page
 *  through that slice — its proteins with their gene name and the source's values. A row opens to
 *  its values in full. `uni.updated` re-runs the search when the cache changes under it. */
function CacheBrowser({ uni }: { uni: NonNullable<Summary['uniprot']> }): ReactNode {
  const [taxon, setTaxon] = useState(() => uni.species[0]?.taxon ?? 0)
  const species = uni.species.find((sp) => sp.taxon === taxon) ?? uni.species[0]
  const available = sourcesOf(species)
  const [pickedField, setField] = useState('')
  // A source the species wasn't looked up for falls back to its first one.
  const field = available.includes(pickedField) ? pickedField : (available[0] ?? '')
  const [query, setQuery] = useState('')
  const [emptyOnly, setEmptyOnly] = useState(false)
  const [page, setPage] = useState<{ cols: string[]; total: number; rows: BrowseRow[] }>({
    cols: [],
    total: 0,
    rows: []
  })
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [openAcc, setOpenAcc] = useState<Set<string>>(new Set())
  const spTaxon = species?.taxon ?? 0
  // One page from the main process; a failure is shown rather than left as a search that never
  // ends. (The browser's handler lives in the main process and preload, which an open app picks up
  // only on restart.)
  const search = async (q: BrowseQuery): Promise<BrowseResult | null> => {
    try {
      if (typeof window.api.browseRefCache !== 'function')
        throw new Error('restart the app to load the cache browser')
      const r = await window.api.browseRefCache(q)
      setFailed(null)
      return r
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
      return null
    }
  }

  // A new slice or search starts from the first page — after a short pause in typing, and only
  // its own reply lands (a slower, older one is dropped).
  useEffect(() => {
    if (!field) return
    let live = true
    const t = setTimeout(() => {
      setLoading(true)
      void search({ taxon: spTaxon, field, query, emptyOnly, offset: 0, limit: BROWSE_PAGE })
        .then((r) => {
          if (!live || !r) return
          setPage(r)
          setOpenAcc(new Set())
        })
        .finally(() => live && setLoading(false))
    }, 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [spTaxon, field, query, emptyOnly, uni.updated])
  const more = (): void => {
    setLoading(true)
    void search({
      taxon: spTaxon,
      field,
      query,
      emptyOnly,
      offset: page.rows.length,
      limit: BROWSE_PAGE
    })
      .then((r) => r && setPage((prev) => ({ ...r, rows: [...prev.rows, ...r.rows] })))
      .finally(() => setLoading(false))
  }
  const flip = (acc: string): void =>
    setOpenAcc((prev) => {
      const next = new Set(prev)
      if (!next.delete(acc)) next.add(acc)
      return next
    })

  const label = uni.sources.find((s) => s.field === field)?.label ?? field
  // The gene column, unless the source IS gene names.
  const withGene = !page.cols.includes('geneName')
  const { rows, total, cols } = page

  return (
    <>
      <div style={styles.browseBar}>
        <span style={styles.pick}>
          <span style={styles.muted}>Species</span>
          <Select
            value={String(spTaxon)}
            options={uni.species.map((sp) => ({
              value: String(sp.taxon),
              label: `${sp.taxon || 'not recorded'} · ${count(sp.count)} proteins`
            }))}
            onChange={(v) => setTaxon(Number(v))}
          />
        </span>
        <span style={styles.pick}>
          <span style={styles.muted}>Source</span>
          <Select
            value={field}
            options={uni.sources
              .filter((s) => available.includes(s.field))
              .map((s) => ({ value: s.field, label: s.label }))}
            onChange={setField}
          />
        </span>
      </div>
      <div style={styles.browseBar}>
        <TableSearch
          value={query}
          onChange={setQuery}
          placeholder="Accession, gene, value…"
          title="Every word must appear in the accession, the gene name or one of the values"
        />
        <label
          style={styles.check}
          title={`Proteins looked up for ${label} that UniProt returned nothing for`}
        >
          <input
            type="checkbox"
            checked={emptyOnly}
            onChange={(e) => setEmptyOnly(e.target.checked)}
          />
          No value only
        </label>
        <span style={styles.muted}>
          {failed ? (
            <span style={{ color: RED }}>Couldn&apos;t search the cache: {failed}</span>
          ) : loading && rows.length === 0 ? (
            'Searching…'
          ) : (
            `${count(total)} proteins`
          )}
        </span>
      </div>
      {rows.length > 0 && (
        <table style={{ ...styles.table, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 120 }} />
            {withGene && <col style={{ width: 100 }} />}
            {cols.map((c) => (
              <col key={c} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={styles.colHead}>Accession</th>
              {withGene && <th style={styles.colHead}>Gene</th>}
              {cols.map((c) => (
                <th key={c} style={styles.colHead}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = openAcc.has(r.acc)
              const cell = { ...styles.td, ...(isOpen ? styles.wrap : styles.clip) }
              const none = r.values.every((v) => !v)
              return (
                <tr
                  key={r.acc}
                  style={styles.browseRow}
                  onClick={() => flip(r.acc)}
                  title={isOpen ? 'Clip the values to one line' : 'Show the values in full'}
                >
                  <td style={{ ...styles.td, ...styles.clip, verticalAlign: 'top' }}>
                    <span style={styles.dotted}>
                      <Chevron deg={isOpen ? 90 : 0} size={9} />
                      {r.acc}
                    </span>
                  </td>
                  {withGene && (
                    <td style={{ ...cell, verticalAlign: 'top' }}>
                      {r.gene || <span style={styles.muted}>—</span>}
                    </td>
                  )}
                  {r.values.map((v, i) => (
                    <td key={cols[i]} style={{ ...cell, verticalAlign: 'top' }}>
                      {v ||
                        (none && i === 0 ? (
                          <span style={{ ...styles.muted, color: AMBER }}>no value</span>
                        ) : (
                          <span style={styles.muted}>—</span>
                        ))}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {rows.length < total && (
        <div style={styles.hint}>
          <Btn disabled={loading} onClick={more}>
            Show {count(Math.min(BROWSE_PAGE, total - rows.length))} more
          </Btn>
          <span style={{ marginLeft: 8 }}>
            {count(rows.length)} of {count(total)} shown
          </span>
        </div>
      )}
    </>
  )
}

/** One update: the row it marks as running, its label, and the work. */
interface Step {
  key: string
  label: string
  job: () => Promise<{ text: string; error?: string }>
}

export function AnnotationCache(): ReactNode {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [latest, setLatest] = useState<{ uniprot: string; string: string } | null>(null)
  const [checking, setChecking] = useState(false)
  /** the update running (one at a time): its row key and label, with its progress; then its
   *  outcome until the next */
  const [busy, setBusy] = useState<{ key: string; label: string } | null>(null)
  const [progress, setProgress] = useState('')
  const [outcome, setOutcome] = useState<{ text: string; error: boolean } | null>(null)
  const [confirming, setConfirming] = useState<Target | null>(null)
  const [folded, setFolded] = useState<Set<string>>(loadFolded)

  const load = useCallback(() => {
    window.api
      .refCacheSummary()
      .then((s) => {
        setSummary(s)
        setError(null)
      })
      .catch((e) => setError(String(e)))
  }, [])
  useEffect(load, [load])

  const toggle = (id: string) => () =>
    setFolded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify([...next]))
      } catch {
        /* storage unavailable — the folds just aren't remembered */
      }
      return next
    })

  const cancelConfirm = useCallback(() => setConfirming(null), [])
  const clear = (target: Target): void => {
    setConfirming(null)
    void window.api.clearRefCache(target).then(load)
  }
  // Progress of the update running: the UniProt pass counts proteins; a downstream source (KEGG,
  // COG, …) and STRING's download report a stage.
  useEffect(() => {
    const offAnnot = window.api.onRefCacheProgress(({ done, total, stage }) =>
      setProgress(stage ?? (total ? `${count(done)} / ${count(total)} proteins` : ''))
    )
    const offString = window.api.onStringProgress(({ stage, loaded, total }) =>
      setProgress(
        `Downloading ${stage}${total ? ` — ${Math.round((100 * loaded) / total)}%` : '…'}`
      )
    )
    return () => {
      offAnnot()
      offString()
    }
  }, [])

  /** Run updates one after another, each row's dot pulsing while it's its turn. */
  const runSteps = async (steps: Step[]): Promise<void> => {
    setOutcome(null)
    const fails: string[] = []
    let last = ''
    for (const [i, st] of steps.entries()) {
      setBusy({
        key: st.key,
        label: steps.length > 1 ? `Updating all (${i + 1}/${steps.length}) — ${st.label}` : st.label
      })
      setProgress('')
      try {
        const r = await st.job()
        if (r.error) fails.push(`${st.label}: ${r.error}`)
        else last = r.text
      } catch (e) {
        fails.push(`${st.label}: ${String(e)}`)
      }
    }
    setBusy(null)
    load()
    setOutcome(
      fails.length
        ? { text: fails.join(' · '), error: true }
        : {
            text: steps.length > 1 ? `Updated all ${steps.length} annotation sets.` : last,
            error: false
          }
    )
  }
  const sourceStep = (field: string, label: string): Step => ({
    key: `src:${field}`,
    label: `Updating ${label}`,
    job: async () => {
      const r = await window.api.updateRefCacheSource(field)
      return { text: `${label} updated for ${count(r.proteins)} proteins.`, error: r.error }
    }
  })
  const orgStep = (taxon: number): Step => ({
    key: `org:${taxon}`,
    label: `Updating STRING for taxon ${taxon}`,
    job: async () => {
      const r = await window.api.ensureStringOrg(taxon)
      return {
        text: r.cached
          ? `STRING for taxon ${taxon} is already the newest version (${r.version}).`
          : `STRING for taxon ${taxon} updated to version ${r.version}.`,
        error: r.error
      }
    }
  })

  const check = (): void => {
    setChecking(true)
    void window.api
      .refCacheLatest()
      .then(setLatest)
      .catch(() => setLatest({ uniprot: '', string: '' }))
      .finally(() => setChecking(false))
  }

  if (error) return <div style={styles.muted}>Couldn&apos;t read the cache: {error}</div>
  if (!summary) return <div style={styles.muted}>Reading the cache…</div>
  const uni = summary.uniprot
  const orgs = summary.string
  const total = (uni?.bytes ?? 0) + orgs.reduce((n, o) => n + o.bytes + o.oldBytes, 0)
  const oldBytes = orgs.reduce((n, o) => n + o.oldBytes, 0)
  const empty = !uni && orgs.length === 0
  const busyKey = busy?.key ?? null
  const ask = (t: Target) => () => setConfirming(t)
  const allSteps = [
    ...(uni?.sources ?? []).map((s) => sourceStep(s.field, s.label)),
    ...orgs.map((o) => orgStep(o.taxon))
  ]
  const open = (id: string): boolean => !folded.has(id)

  return (
    <>
      <div style={styles.bar}>
        <span style={styles.muted}>
          {empty ? 'Nothing cached yet.' : `${formatSize(total)} in total`}
        </span>
        <span style={{ flex: 1 }} />
        {!empty && (
          <button style={styles.btn} onClick={() => void window.api.openPath(summary.root)}>
            {REVEAL.folder}
          </button>
        )}
        <button
          style={styles.btn}
          onClick={check}
          disabled={checking}
          title="Ask UniProt and STRING for their current versions"
        >
          {/* Both labels share one grid cell, so the button keeps the longer one's width. */}
          <span style={styles.stack}>
            <span style={{ ...styles.stacked, visibility: checking ? 'hidden' : 'visible' }}>
              Check for newer versions
            </span>
            <span style={{ ...styles.stacked, visibility: checking ? 'visible' : 'hidden' }}>
              Checking…
            </span>
          </span>
        </button>
        {allSteps.length > 0 && (
          <button
            style={{ ...styles.btn, color: UI.info, ...(busy ? styles.disabled : null) }}
            disabled={!!busy}
            onClick={() => void runSteps(allSteps)}
            title="Fetch every annotation source again for the proteins that have it, and bring every STRING organism up to the newest version"
          >
            Update all
          </button>
        )}
      </div>
      {(busy || outcome) && (
        <div style={styles.status} role="status">
          <Dotted
            status={
              busy
                ? RUNNING
                : outcome?.error
                  ? { color: RED, label: 'Failed', pulse: false }
                  : { color: GREEN, label: 'Done', pulse: false }
            }
          >
            {busy ? `${busy.label}…${progress ? ` ${progress}` : ''}` : outcome?.text}
          </Dotted>
        </div>
      )}

      <Section
        title="UniProt annotations"
        summary={uni ? `${count(uni.accessions)} proteins · ${formatSize(uni.bytes)}` : 'empty'}
        open={open('uniprot')}
        onToggle={toggle('uniprot')}
        actions={
          uni && (
            <Btn danger disabled={!!busy} onClick={ask({ kind: 'uniprot' })}>
              Clear all
            </Btn>
          )
        }
      >
        {!uni ? (
          <div style={styles.muted}>No proteins cached.</div>
        ) : (
          <>
            <table style={styles.table}>
              <tbody>
                <tr>
                  <th style={styles.rowHead}>Proteins</th>
                  <td style={styles.td}>{count(uni.accessions)}</td>
                </tr>
                <tr>
                  <th style={styles.rowHead}>Release</th>
                  <td style={styles.td}>
                    {uni.releases.length === 0
                      ? '—'
                      : uni.releases.map((r, i) => (
                          <div key={r.release || i}>
                            <Dotted
                              status={versionStatus(r.release, latest ? latest.uniprot : null)}
                            >
                              <Version have={r.release} live={latest ? latest.uniprot : null} />
                              {uni.releases.length > 1 && (
                                <span style={styles.muted}> — {count(r.count)} proteins</span>
                              )}
                            </Dotted>
                          </div>
                        ))}
                  </td>
                </tr>
                <tr>
                  <th style={styles.rowHead}>Size</th>
                  <td style={styles.td}>
                    {formatSize(uni.bytes)} · updated {date(uni.updated)}
                  </td>
                </tr>
              </tbody>
            </table>

            <Section
              sub
              title="By species"
              summary={`${uni.species.length}`}
              open={open('uniprot-species')}
              onToggle={toggle('uniprot-species')}
            >
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.colHead}>Taxon</th>
                    <th style={{ ...styles.colHead, ...styles.num }}>Proteins</th>
                    <th style={styles.colHead}>Release</th>
                    <th style={{ ...styles.colHead, ...styles.num }}>Size</th>
                    <th style={styles.colHead} />
                  </tr>
                </thead>
                <tbody>
                  {uni.species.map((sp) => (
                    <tr key={sp.taxon}>
                      <td style={styles.td}>
                        <Dotted
                          status={versionStatus(
                            sp.releases[0] ?? '',
                            latest ? latest.uniprot : null
                          )}
                        >
                          {sp.taxon || <span style={styles.muted}>not recorded</span>}
                        </Dotted>
                      </td>
                      <td style={{ ...styles.td, ...styles.num }}>{count(sp.count)}</td>
                      <td style={styles.td}>
                        {sp.releases.length === 0
                          ? '—'
                          : sp.releases.map((r, i) => (
                              <div key={r}>
                                <Version
                                  have={r}
                                  live={i === 0 && latest ? latest.uniprot : null}
                                />
                              </div>
                            ))}
                      </td>
                      <td style={{ ...styles.td, ...styles.num }}>≈ {formatSize(sp.bytes)}</td>
                      <td style={styles.actions}>
                        <Btn
                          danger
                          disabled={!!busy}
                          onClick={ask({ kind: 'uniprot-taxon', taxon: sp.taxon })}
                        >
                          Delete
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {uni.species.some((sp) => !sp.taxon) && (
                <div style={styles.hint}>
                  A protein&apos;s taxon is recorded only when an import asked for STRING ids or
                  MSigDB.
                </div>
              )}
            </Section>

            {uni.sources.length > 0 && (
              <Section
                sub
                title="By source"
                summary={`${uni.sources.length}`}
                open={open('uniprot-sources')}
                onToggle={toggle('uniprot-sources')}
              >
                <SourceTable
                  uni={uni}
                  busy={busyKey}
                  onUpdate={(field, label) => void runSteps([sourceStep(field, label)])}
                />
                <div style={styles.hint}>
                  A protein is fetched again when UniProt has a newer release, or when the app has
                  changed how it reads a source (&ldquo;to refresh&rdquo;) — both at the next import
                  that asks for it, or now with Update.
                </div>
              </Section>
            )}

            {/* Closed until asked for (opening it reads the whole store), so its key is in the
                remembered set when OPEN, unlike the other sections'. */}
            <Section
              sub
              title="Browse proteins"
              summary={count(uni.accessions)}
              open={folded.has('uniprot-browse-open')}
              onToggle={toggle('uniprot-browse-open')}
            >
              <CacheBrowser uni={uni} />
            </Section>
          </>
        )}
      </Section>

      <Section
        title="STRING networks"
        summary={
          orgs.length
            ? `${orgs.length} organism${orgs.length === 1 ? '' : 's'} · ${formatSize(
                orgs.reduce((n, o) => n + o.bytes + o.oldBytes, 0)
              )}`
            : 'empty'
        }
        open={open('string')}
        onToggle={toggle('string')}
        actions={
          oldBytes > 0 && (
            <Btn danger disabled={!!busy} onClick={ask({ kind: 'string-old' })}>
              Remove older versions ({formatSize(oldBytes)})
            </Btn>
          )
        }
      >
        {orgs.length === 0 ? (
          <div style={styles.muted}>No organisms downloaded.</div>
        ) : (
          <>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.colHead}>Taxon</th>
                  <th style={styles.colHead}>Version</th>
                  <th style={styles.colHead}>Gene names</th>
                  <th style={{ ...styles.colHead, ...styles.num }}>Size</th>
                  <th style={styles.colHead}>Downloaded</th>
                  <th style={styles.colHead} />
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.taxon}>
                    <td style={styles.td}>
                      <Dotted
                        status={
                          busyKey === `org:${o.taxon}`
                            ? RUNNING
                            : !o.version
                              ? {
                                  color: RED,
                                  label: 'Incomplete download — Update to finish it',
                                  pulse: false
                                }
                              : versionStatus(o.version, latest ? latest.string : null)
                        }
                      >
                        {o.taxon}
                      </Dotted>
                    </td>
                    <td style={styles.td}>
                      {o.version ? (
                        <Version have={o.version} live={latest ? latest.string : null} />
                      ) : (
                        <span style={{ color: RED }}>incomplete</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      {o.names ? 'yes' : <span style={styles.muted}>no</span>}
                    </td>
                    <td style={{ ...styles.td, ...styles.num }}>{formatSize(o.bytes)}</td>
                    <td style={styles.td}>{date(o.updated)}</td>
                    <td style={styles.actions}>
                      <Btn
                        update
                        disabled={!!busy}
                        onClick={() => void runSteps([orgStep(o.taxon)])}
                        title="Download the newest STRING version of this organism, if there is one"
                      >
                        Update
                      </Btn>
                      <Btn
                        danger
                        disabled={!!busy}
                        onClick={ask({ kind: 'string', taxon: o.taxon })}
                      >
                        Delete
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={styles.hint}>
              Network plots read these files offline. Update (or the import&apos;s STRING download)
              brings an organism up to the newest version.
            </div>
          </>
        )}
      </Section>

      {confirming && (
        <ConfirmDelete
          {...confirmText(confirming)}
          onCancel={cancelConfirm}
          onConfirm={() => clear(confirming)}
        />
      )}
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  hint: { marginTop: 8, fontSize: 11, color: UI.textMuted },
  muted: { fontSize: 12, color: UI.textMuted },
  tag: { fontSize: 11 },
  status: { fontSize: 12, margin: '-8px 0 14px', color: UI.text },
  dotted: { display: 'inline-flex', alignItems: 'center', gap: 7 },
  stack: { display: 'inline-grid' },
  stacked: { gridArea: '1 / 1', textAlign: 'center' },
  bar: { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 18px' },
  btn: {
    padding: '4px 10px',
    fontSize: 12,
    borderRadius: 6,
    border: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    color: UI.text,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  small: {
    padding: '2px 9px',
    marginLeft: 6,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.5,
    borderRadius: 6,
    border: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    color: UI.text,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  disabled: { opacity: 0.45, cursor: 'default' },
  danger: { color: '#fff', background: UI.err, borderColor: UI.err },
  section: { border: `1px solid ${UI.border}`, borderRadius: 8, marginBottom: 14 },
  subSection: { marginTop: 14 },
  sectionHead: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 6px' },
  sectionToggle: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '2px 4px',
    background: 'transparent',
    border: 'none',
    color: UI.text,
    cursor: 'pointer',
    textAlign: 'left'
  },
  sectionSummary: { fontSize: 11, color: UI.textMuted, marginLeft: 4 },
  sectionBody: { padding: '0 12px 12px' },
  subTitle: { fontSize: 12, fontWeight: 700, color: UI.text },
  tableTitle: { fontSize: 11, fontWeight: 600, color: UI.textMuted },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, color: UI.text },
  colHead: {
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: UI.textMuted,
    padding: '4px 8px',
    borderBottom: `1px solid ${UI.border}`
  },
  rowHead: {
    textAlign: 'left',
    fontWeight: 600,
    color: UI.textMuted,
    padding: '4px 8px',
    width: 130,
    verticalAlign: 'top',
    borderBottom: `1px solid ${UI.border}`
  },
  td: { padding: '5px 8px', verticalAlign: 'middle', borderBottom: `1px solid ${UI.border}` },
  actions: {
    padding: '5px 8px',
    verticalAlign: 'middle',
    borderBottom: `1px solid ${UI.border}`,
    textAlign: 'right',
    whiteSpace: 'nowrap'
  },
  num: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  clip: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  wrap: { whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.45 },
  browseBar: { display: 'flex', alignItems: 'center', gap: 12, margin: '2px 0 8px' },
  check: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer'
  },
  browseRow: { cursor: 'pointer' },
  pick: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12 },
  // Above the Settings window (its scrim is 60, the window 61).
  confirmScrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 70 },
  confirm: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 380,
    maxWidth: '90vw',
    zIndex: 71,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    padding: '18px 20px 16px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.35)'
  },
  confirmTitle: { fontSize: 14, fontWeight: 700, marginBottom: 8 },
  confirmText: { fontSize: 12, color: UI.textMuted, lineHeight: 1.5 },
  confirmButtons: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }
}
