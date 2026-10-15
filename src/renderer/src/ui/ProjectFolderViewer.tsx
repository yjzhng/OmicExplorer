/** Project-folder viewer: a modal file tree of the active data folder (input/ and the
 *  project data folder with its workflows). Folders expand lazily, one level per click; a file can be opened
 *  in its default app or shown in the OS file manager (Finder / File Explorer). Nothing here writes
 *  to disk, except Clean up — and that only after its confirmation lists what it deletes. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'

import { dataRootOf, workflowDirOf } from '../graph/diskNames'
import { pendingRenames, useGraph, type CleanupPlan } from '../graph/store'
import { Chevron } from './Chevron'
import { formatSize, REVEAL } from './fileLabels'
import { UI } from './theme'

type DirEntry = Awaited<ReturnType<Window['api']['listDir']>>[number]
/** A folder's loaded children, or the error that listing it hit. */
type Listing = { entries: DirEntry[] } | { error: string }

/** A path in one spelling for comparing: `/` separators, no trailing one (and, on Windows, whose
 *  paths ignore case, lower-cased). */
const normPath = (p: string): string => {
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return window.api.platform === 'win32' ? n.toLowerCase() : n
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function ProjectFolderViewer({
  root,
  reveal,
  onClose
}: {
  root: string
  /** a folder under `root` to open on: its parents unfolded, it selected, open and scrolled to */
  reveal?: string
  onClose: () => void
}): ReactNode {
  // The current project's own places in this folder: its data folder (`<root>/<project>`), each of
  // its workflows' folders, and its project file — marked, so it stands out among the other
  // projects' folders and the inputs.
  const folders = useGraph((s) => s.folders)
  const projectPath = useGraph((s) => s.projectPath)
  const projectName = useGraph((s) => s.projectName)
  const scratchRoot = useGraph((s) => s.scratchRoot)
  const { dataRoot, ownRoot, own } = useMemo(() => {
    const folder = folders.find((f) => f.path && normPath(f.path) === normPath(root))
    const dataRoot = folder
      ? dataRootOf(folder, { saved: !!projectPath, projectName, scratch: scratchRoot })
      : null
    const paths = [
      ...(dataRoot ? [dataRoot, ...folder!.workflows.map((w) => workflowDirOf(dataRoot, w))] : []),
      ...(projectPath ? [projectPath] : [])
    ]
    return {
      dataRoot,
      ownRoot: dataRoot ? normPath(dataRoot) : null,
      own: new Set(paths.map(normPath))
    }
  }, [folders, root, projectPath, projectName, scratchRoot])

  // What the next save will rename (a project, workflow or step renamed since): shown on each
  // folder as "→ new name". Subscribed as one string, so the viewer redraws only when it changes.
  const renamesKey = useGraph((s) => JSON.stringify([...pendingRenames(s)]))
  const renames = useMemo(
    () =>
      new Map((JSON.parse(renamesKey) as [string, string][]).map(([p, to]) => [normPath(p), to])),
    [renamesKey]
  )

  const [listings, setListings] = useState<Record<string, Listing>>({})
  // Open on the root, with the project's own data folder already unfolded.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(dataRoot ? [root, dataRoot] : [root])
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  const load = useCallback(async (dir: string): Promise<void> => {
    try {
      const entries = await window.api.listDir(dir)
      setListings((m) => ({ ...m, [dir]: { entries } }))
    } catch (e) {
      setListings((m) => ({ ...m, [dir]: { error: e instanceof Error ? e.message : String(e) } }))
    }
  }, [])

  useEffect(() => {
    void load(root)
    if (dataRoot) void load(dataRoot)
    // Only on opening (the project's folder unfolded once, then left to the user).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, load])

  // Open on `reveal`: walk down from the root, listing each folder on the way and taking the entry
  // that leads to it (matched by normPath, so separators and Windows case don't matter); then unfold
  // the way, select it and bring it into view.
  const revealRow = useRef<string | null>(null)
  useEffect(() => {
    if (!reveal) return
    const target = normPath(reveal)
    if (!target.startsWith(normPath(root) + '/')) return
    let live = true
    void (async () => {
      const way: string[] = []
      let dir = root
      while (normPath(dir) !== target) {
        let entries: DirEntry[]
        try {
          entries = await window.api.listDir(dir)
        } catch {
          return
        }
        if (!live) return
        const at = dir
        setListings((m) => ({ ...m, [at]: { entries } }))
        way.push(dir)
        const next = entries.find(
          (e) => e.dir && (normPath(e.path) === target || target.startsWith(normPath(e.path) + '/'))
        )
        if (!next) return
        dir = next.path
      }
      await load(dir)
      if (!live) return
      revealRow.current = dir
      setExpanded((prev) => new Set([...prev, ...way, dir]))
      setSelected(dir)
    })()
    return () => {
      live = false
    }
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clean up: the plan its confirmation shows, while it's open; and how the last one went.
  const [plan, setPlan] = useState<CleanupPlan | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [cleanNote, setCleanNote] = useState<{ ok: boolean; text: string } | null>(null)
  const ownFolder = folders.find((f) => f.path && normPath(f.path) === normPath(root))

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // The confirmation first, then the viewer.
      if (plan) {
        if (!cleaning) setPlan(null)
      } else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, plan, cleaning])

  const toggle = (dir: string): void => {
    const next = new Set(expanded)
    if (next.has(dir)) next.delete(dir)
    else {
      next.add(dir)
      if (!listings[dir]) void load(dir)
    }
    setExpanded(next)
  }

  // A refresh flushes the list: it dims while the folders are re-read (for at least a beat, so a
  // quick one still reads as done), then the new contents come in row by row (`flush` re-keys the
  // list so its rows replay their entrance). The open folders keep their old contents until the
  // new ones land — no flash of "Loading…"; closed ones are just forgotten, re-read when opened.
  const [refreshing, setRefreshing] = useState(false)
  const [flush, setFlush] = useState(0)
  /** Re-read every open folder (files appear as runs and exports write them). */
  const refresh = async (): Promise<void> => {
    if (refreshing) return
    setRefreshing(true)
    void useGraph.getState().refreshDataFiles() // flags a deleted data folder
    setListings((m) => Object.fromEntries(Object.entries(m).filter(([d]) => expanded.has(d))))
    await Promise.all([
      ...[...expanded].map((dir) => load(dir)),
      new Promise((r) => window.setTimeout(r, 250))
    ])
    setRefreshing(false)
    setFlush((n) => n + 1)
  }

  // Clean up: work out what the project no longer uses, then ask before deleting it.
  const startCleanup = async (): Promise<void> => {
    if (!ownFolder) return
    setCleanNote(null)
    const p = await useGraph.getState().planCleanup(ownFolder.id)
    if (!p) setCleanNote({ ok: false, text: 'This project has no data folder here yet.' })
    else if (p.remove.length === 0)
      setCleanNote({ ok: true, text: 'Already clean — nothing here the project doesn’t use.' })
    else setPlan(p)
  }
  const confirmCleanup = async (): Promise<void> => {
    if (!plan) return
    setCleaning(true)
    const errors = await useGraph.getState().applyCleanup(plan)
    setCleaning(false)
    setPlan(null)
    setCleanNote(
      errors.length
        ? { ok: false, text: `Couldn’t remove ${errors.length}: ${errors[0]}` }
        : {
            ok: true,
            text: `Removed ${plan.remove.length} item${plan.remove.length === 1 ? '' : 's'}.`
          }
    )
    await refresh()
  }

  const open = async (p: string): Promise<void> => {
    const err = await window.api.openPath(p)
    setOpenError(err || null)
  }

  const renderDir = (dir: string, depth: number): ReactNode => {
    const listing = listings[dir]
    const pad = { paddingLeft: 12 + depth * 20 }
    if (!listing) return <div style={{ ...styles.note, ...pad }}>Loading…</div>
    if ('error' in listing)
      return <div style={{ ...styles.note, ...pad, color: UI.err }}>{listing.error}</div>
    if (listing.entries.length === 0)
      return <div style={{ ...styles.note, ...pad }}>Empty folder</div>
    return listing.entries.map((e, i) => {
      const isOpen = e.dir && expanded.has(e.path)
      const isSel = selected === e.path
      const isOwn = own.has(normPath(e.path))
      const renameTo = renames.get(normPath(e.path))
      return (
        <div key={e.path}>
          <div
            className={flush > 0 ? 'oe-row-in' : undefined}
            style={{
              ...styles.row,
              ...pad,
              // Rows come in one after another down each folder (capped, so a long one isn't slow).
              animationDelay: `${Math.min(i, 20) * 18}ms`,
              ...(isSel ? styles.rowSel : null)
            }}
            title={e.path}
            ref={
              revealRow.current === e.path
                ? (el) => {
                    if (!el) return
                    revealRow.current = null
                    // After the folds it sits in have slid open.
                    window.setTimeout(() => el.scrollIntoView({ block: 'center' }), 220)
                  }
                : undefined
            }
            onClick={() => {
              setSelected(e.path)
              if (e.dir) toggle(e.path)
            }}
            onDoubleClick={() => {
              if (!e.dir) void open(e.path)
            }}
          >
            <span style={styles.caret}>{e.dir && <FolderChevron open={isOpen} />}</span>
            <span style={{ ...styles.icon, ...(isOwn && e.dir ? { color: PROJECT_COLOR } : null) }}>
              {e.dir ? <IconFolder solid={isOwn} /> : <FileIcon name={e.name} />}
            </span>
            <span style={{ ...styles.name, ...(isOwn ? styles.nameOwn : null) }}>{e.name}</span>
            {renameTo && (
              <span
                style={styles.renameTo}
                title={`Will be renamed to “${renameTo}” when the project is saved`}
              >
                → {renameTo}
              </span>
            )}
            {ownRoot === normPath(e.path) && <span style={styles.ownTag}>this project</span>}
            {/* The name (and its rename / tag) sits left; the actions, size and date right. */}
            <span style={{ flex: 1 }} />
            {isSel && (
              <span style={styles.rowActions} onClick={(ev) => ev.stopPropagation()}>
                {!e.dir && (
                  <button style={styles.rowBtn} onClick={() => void open(e.path)}>
                    Open
                  </button>
                )}
                <button style={styles.rowBtn} onClick={() => void window.api.revealPath(e.path)}>
                  {REVEAL.item}
                </button>
              </span>
            )}
            <span style={styles.size}>{e.dir ? '' : formatSize(e.size)}</span>
            <span style={styles.date}>{dateFmt.format(e.mtime)}</span>
          </div>
          {/* Its contents slide open / shut (grid rows 0fr ↔ 1fr), kept mounted once read so
              folding animates too. */}
          {e.dir && (isOpen || listings[e.path]) && (
            <Fold open={isOpen}>{renderDir(e.path, depth + 1)}</Fold>
          )}
        </div>
      )
    })
  }

  return (
    <>
      <div style={styles.scrim} onClick={onClose} />
      <div style={styles.modal} role="dialog" aria-label="Project folder">
        <div style={styles.head}>
          <span style={styles.headTitle}>Project folder</span>
          <span style={styles.headPath} title={root}>
            {root}
          </span>
          <button style={styles.headBtn} onClick={() => void refresh()} title="Re-read the folder">
            <span style={styles.refreshIcon}>↻</span>
            Refresh
          </button>
          {ownFolder && (
            <button
              style={styles.headBtn}
              onClick={() => void startCleanup()}
              title="Remove what the project no longer uses from its data folder — asks first"
            >
              Clean up
            </button>
          )}
          <button style={styles.headBtn} onClick={() => void window.api.revealFolder(root)}>
            {REVEAL.folder}
          </button>
          <button style={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={styles.colHead}>
          <span style={{ flex: 1, paddingLeft: 12 }}>Name</span>
          <span style={styles.size}>Size</span>
          <span style={styles.date}>Modified</span>
        </div>
        <div
          className="oe-scroll"
          style={{ ...styles.body, ...(refreshing ? styles.bodyRefreshing : null) }}
        >
          {/* Re-keyed by each refresh (inside the scroll box, so it keeps its scroll). */}
          <div key={flush}>{renderDir(root, 0)}</div>
        </div>
        <div style={styles.foot}>
          {openError ? (
            <span style={{ color: UI.err }}>Couldn’t open: {openError}</span>
          ) : cleanNote ? (
            <span style={{ color: cleanNote.ok ? UI.text : UI.err }}>{cleanNote.text}</span>
          ) : (
            'Double-click a file to open it in its default app.'
          )}
        </div>
      </div>
      {plan && (
        <>
          <div style={styles.confirmScrim} onClick={() => !cleaning && setPlan(null)} />
          <div style={styles.confirm} role="alertdialog" aria-label="Clean up the project folder">
            <div style={styles.confirmTitle}>Clean up the project folder?</div>
            <div style={styles.confirmText}>
              These {plan.remove.length} item{plan.remove.length === 1 ? '' : 's'} in the project’s
              data folder aren’t used by the project as it is now (unsaved changes included):
              folders of removed workflows and steps, and input files no Load tile reads. They will
              be <b>permanently deleted</b> — not moved to the Trash. If you want to keep any, copy
              them somewhere else first.
            </div>
            <div className="oe-scroll" style={styles.confirmList}>
              {plan.remove.map((p) => (
                <div key={p} style={styles.confirmItem} title={p}>
                  {p.slice(plan.root.length).replace(/^[/\\]/, '')}
                </div>
              ))}
            </div>
            <div style={styles.confirmFoot}>
              <button
                style={styles.headBtn}
                onClick={() => void window.api.revealFolder(plan.root)}
                disabled={cleaning}
              >
                {REVEAL.folder}
              </button>
              <span style={{ flex: 1 }} />
              <button style={styles.headBtn} onClick={() => setPlan(null)} disabled={cleaning}>
                Cancel
              </button>
              <button
                style={{ ...styles.headBtn, ...styles.dangerBtn }}
                onClick={() => void confirmCleanup()}
                disabled={cleaning}
              >
                {cleaning
                  ? 'Deleting…'
                  : `Delete ${plan.remove.length} item${plan.remove.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

/** A folder's contents, sliding open / shut (grid rows 0fr ↔ 1fr, fading too). It mounts shut and
 *  opens a frame later, so a folder opened for the first time slides open as well. */
function Fold({ open, children }: { open: boolean; children: ReactNode }): ReactNode {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(open))
    return () => cancelAnimationFrame(id)
  }, [open])
  return (
    <div style={{ ...styles.fold, ...(shown ? styles.foldOpen : null) }}>
      <div style={styles.foldInner}>{children}</div>
    </div>
  )
}

/** A folder's open state: the app's line chevron, right when collapsed, turning down when open. */
function FolderChevron({ open }: { open: boolean }): ReactNode {
  return (
    <span
      style={{
        display: 'inline-flex',
        transform: open ? 'rotate(90deg)' : 'none',
        transition: 'transform 150ms ease-out'
      }}
    >
      <Chevron deg={0} size={12} />
    </span>
  )
}

/** What a file holds, by its extension: a table (data / results), a plot (exported figure), an
 *  OmicExplorer project, or anything else. */
const TABLE_EXT = new Set(['csv', 'tsv', 'txt', 'xlsx', 'xls'])
const PLOT_EXT = new Set(['png', 'pdf', 'svg', 'jpg', 'jpeg', 'tif', 'tiff'])
/** Their icons' colours: green for tables, orange for plots, purple for a project (readable on
 *  either theme); anything else stays muted like the folders. */
const TABLE_COLOR = '#59a14f'
const PLOT_COLOR = '#f28e2b'
const PROJECT_COLOR = '#9b6bd6'

// The viewer's icons, drawn like the app's own (ui/icons, the nav's): 20px on a 24 grid, 1.8 round
// strokes, plain shapes. A file is a page with a small mark for what it holds (a project, a globe).
const ICON = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}
/** The page every file icon is drawn on: a sheet with its corner folded. */
const PAGE = 'M6 3h8l4 4v14H6z M14 3v4h4'

function FileIcon({ name }: { name: string }): ReactNode {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  // A project is just a globe (the app's own mark), no page. The rest are the page with a mark,
  // as plain as it gets: a table two lines, a plot two bars.
  if (ext === 'omicexplorer')
    return (
      <span style={{ display: 'inline-flex', color: PROJECT_COLOR }} title="OmicExplorer project">
        <svg {...ICON}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17" />
          <path d="M12 3.5a13 13 0 0 1 0 17a13 13 0 0 1 0-17z" />
        </svg>
      </span>
    )
  const kind = TABLE_EXT.has(ext)
    ? { color: TABLE_COLOR, title: 'Table', mark: 'M9 13h6 M9 17h6' }
    : PLOT_EXT.has(ext)
      ? { color: PLOT_COLOR, title: 'Plot', mark: 'M10 18v-4 M14 18v-6' }
      : null
  return (
    <span style={{ display: 'inline-flex', color: kind?.color }} title={kind?.title}>
      <svg {...ICON}>
        <path d={PAGE} />
        {kind && <path d={kind.mark} />}
      </svg>
    </span>
  )
}

/** A folder: the same outline as the nav's project-folder button — filled solid for the current
 *  project's own folders. */
function IconFolder({ solid = false }: { solid?: boolean }): ReactNode {
  return (
    <svg {...ICON} fill={solid ? 'currentColor' : 'none'}>
      <path d="M3.5 6.5h5l2 2h10V18.5h-17z" />
    </svg>
  )
}

const styles: Record<string, CSSProperties> = {
  scrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60 },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 1000,
    maxWidth: '94vw',
    height: 720,
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 61,
    overflow: 'hidden'
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    flex: '0 0 auto'
  },
  headTitle: { fontWeight: 700, fontSize: 16, color: UI.text, flex: '0 0 auto' },
  headPath: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: UI.textMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    direction: 'rtl',
    textAlign: 'left'
  },
  headBtn: {
    flex: '0 0 auto',
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '5px 12px',
    fontSize: 13,
    cursor: 'pointer'
  },
  close: {
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    fontSize: 16,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1
  },
  colHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px 8px 0',
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto'
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '4px 0',
    transition: 'opacity 150ms ease-out'
  },
  bodyRefreshing: { opacity: 0.35 },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    height: 34,
    paddingRight: 16,
    fontSize: 15,
    color: UI.text,
    // Every row does something on a click (select; a folder also opens / folds).
    cursor: 'pointer',
    userSelect: 'none'
  },
  rowSel: { background: UI.panelAlt },
  // A folder's contents: 0 rows tall when shut, their own height when open, eased between.
  fold: {
    display: 'grid',
    gridTemplateRows: '0fr',
    opacity: 0,
    transition: 'grid-template-rows 200ms ease-out, opacity 200ms ease-out'
  },
  foldOpen: { gridTemplateRows: '1fr', opacity: 1 },
  foldInner: { overflow: 'hidden', minHeight: 0 },
  refreshIcon: { display: 'inline-block', marginRight: 5 },
  // The current project's data folder, its workflows' folders and its file: the name in bold (the
  // folder icon filled in the project purple, as its file's globe).
  nameOwn: { fontWeight: 600 },
  // A folder the next save renames: its new name after the current one, muted.
  renameTo: {
    flex: '0 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    fontStyle: 'italic',
    color: UI.textMuted
  },
  ownTag: {
    flex: '0 0 auto',
    padding: '1px 7px',
    borderRadius: 9,
    fontSize: 11,
    fontWeight: 600,
    color: PROJECT_COLOR,
    border: `1px solid color-mix(in srgb, ${PROJECT_COLOR} 50%, transparent)`
  },
  caret: { width: 12, flex: '0 0 auto', display: 'inline-flex', color: UI.textMuted },
  icon: { display: 'inline-flex', flex: '0 0 auto', color: UI.textMuted },
  name: {
    flex: '0 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  rowActions: { display: 'inline-flex', gap: 6, flex: '0 0 auto' },
  rowBtn: {
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '3px 10px',
    fontSize: 13,
    cursor: 'pointer'
  },
  size: { width: 80, flex: '0 0 auto', textAlign: 'right', color: UI.textMuted, fontSize: 13 },
  date: { width: 170, flex: '0 0 auto', textAlign: 'right', color: UI.textMuted, fontSize: 13 },
  note: { fontSize: 13, color: UI.textMuted, paddingTop: 6, paddingBottom: 6, paddingRight: 16 },
  // Clean up's confirmation, over the viewer.
  confirmScrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 62 },
  confirm: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 560,
    maxWidth: '90vw',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 18,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
    zIndex: 63
  },
  confirmTitle: { fontSize: 15, fontWeight: 700, color: UI.text },
  confirmText: { fontSize: 13, color: UI.text, lineHeight: 1.45 },
  confirmList: {
    maxHeight: 240,
    overflowY: 'auto',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '6px 8px',
    background: UI.panelAlt,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 12
  },
  confirmItem: {
    color: UI.text,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    padding: '1px 0'
  },
  confirmFoot: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 },
  dangerBtn: { background: UI.err, borderColor: UI.err, color: '#fff', fontWeight: 600 },
  foot: {
    flex: '0 0 auto',
    padding: '8px 16px',
    fontSize: 13,
    color: UI.textMuted,
    borderTop: `1px solid ${UI.border}`,
    background: UI.panelAlt
  }
}
