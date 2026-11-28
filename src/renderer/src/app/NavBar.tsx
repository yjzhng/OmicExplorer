import { Panel } from '@xyflow/react'
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { menuParts, useGeneMenuTabs } from '../dashboard/useGeneMenuTabs'
import { deriveTabs } from '../graph/results/groups'
import { NODE_SPECS } from '../graph/registry'
import { useGraph } from '../graph/store'
import { isStep, type StepNode } from '../graph/types'
import { Chevron } from '../ui/controls/Chevron'
import { GeneSelectMenu } from '../ui/genes/GeneSelectMenu'
import { IconTrash } from '../ui/controls/icons'
import { ProjectFolderViewer } from '../ui/app/ProjectFolderViewer'
import { SaveAsMenu } from '../ui/app/SaveAsMenu'
import { StatusIcon, StatusNote } from '../ui/controls/StatusNote'
import { motion, UI } from '../ui/app/theme'
import { ToggleSwitch } from '../ui/controls/ToggleSwitch'
import { useAppSettings } from '../ui/app/useAppSettings'
import { useAppView } from '../ui/app/useAppView'
import type { UpdateInfo } from '../ui/app/useUpdateCheck'
import { RUN_FACES, runButtonStyle, type RunState } from './runFaces'
import { LAYOUTS } from './shared'
import { styles } from './styles'

/** Top-right button from the canvas to the results dashboard — the way there; the dashboard's
 *  "← Workflow" is the way back. With a plot tile selected, it opens that tile's tab. */
export function ResultsLink() {
  const setView = useAppView((s) => s.setView)
  const open = (): void => {
    const g = useGraph.getState()
    const tabs = new Set(deriveTabs(g.nodes, g.edges).map((t) => t.id))
    // the tile whose settings are open, else the one tile selected on the canvas
    const picked = g.nodes.filter((n) => n.selected && tabs.has(n.id))
    const tab =
      g.selectedId && tabs.has(g.selectedId)
        ? g.selectedId
        : picked.length === 1
          ? picked[0].id
          : null
    if (tab) useAppView.getState().openResultsTab(tab)
    else setView('results')
  }
  return (
    <Panel position="top-right">
      <button
        className="new-step-btn oe-view-btn oe-press"
        data-tour="results"
        style={styles.resultsLink}
        onClick={open}
        title="Open the results dashboard"
      >
        Results →
      </button>
    </Panel>
  )
}
/** Settings › About › Updates: what the check found and the in-app update's progress — with its
 *  next step (Update now, Restart to update), or the release page when this copy can't update
 *  itself. */
export function UpdateStatus({ update }: { update: UpdateInfo }) {
  const { install } = update
  const link = (label: string) => (
    <a href={update.releaseUrl} target="_blank" rel="noreferrer" style={styles.aboutLink}>
      {label}
    </a>
  )
  if (install.phase === 'downloading')
    return (
      <span style={styles.aboutUpdate}>
        Downloading v{install.version ?? update.latest}…
        <span style={styles.updateBar}>
          <span style={{ ...styles.updateBarFill, width: `${install.percent ?? 0}%` }} />
        </span>
        <span style={styles.aboutMuted}>{install.percent ?? 0}%</span>
      </span>
    )
  if (install.phase === 'ready')
    return (
      <span style={styles.aboutUpdate}>
        <span style={styles.aboutDot} /> v{install.version} is ready
        <button style={styles.updatePrimary} onClick={update.restart}>
          Restart to update
        </button>
      </span>
    )
  if (update.checking) return <span style={styles.aboutMuted}>Checking…</span>
  if (install.phase === 'error')
    return (
      <span style={styles.aboutMuted}>
        Update failed: {install.message} {link('Download it instead')}
      </span>
    )
  if (update.updateAvailable)
    return (
      <span style={styles.aboutUpdate}>
        <span style={styles.aboutDot} /> v{update.latest} is available
        {install.unsupported ? (
          // the dash its own item, so the row's gap spaces it from both neighbours
          <>
            <span>—</span>
            {link('download')}
          </>
        ) : (
          <button style={styles.updatePrimary} onClick={update.download}>
            Update now
          </button>
        )}
      </span>
    )
  if (update.failed) return <span style={styles.aboutMuted}>Couldn’t check — try again later.</span>
  return <span style={styles.aboutMuted}>You’re on the latest version.</span>
}
/** The home namecard's update tag: starts the in-app update (or opens the release page when this
 *  copy can't update itself), then shows its progress and the restart. */
export function UpdateTag({ update }: { update: UpdateInfo }) {
  const { install } = update
  if (install.unsupported)
    return (
      <a
        href={update.releaseUrl}
        target="_blank"
        rel="noreferrer"
        style={styles.homeUpdateTag}
        title={`Download v${update.latest}`}
      >
        Update available · v{update.latest}
      </a>
    )
  const [label, title, onClick] =
    install.phase === 'downloading'
      ? [
          `Downloading v${install.version ?? update.latest} · ${install.percent ?? 0}%`,
          '',
          undefined
        ]
      : install.phase === 'ready'
        ? [`Restart to update · v${install.version}`, 'Quit, install it and reopen', update.restart]
        : install.phase === 'error'
          ? ['Update failed · try again', install.message ?? '', update.download]
          : [
              `Update available · v${update.latest}`,
              `Download and install v${update.latest}`,
              update.download
            ]
  return (
    <button
      style={{ ...styles.homeUpdateTag, ...styles.homeUpdateButton }}
      title={title}
      onClick={onClick}
      disabled={!onClick}
    >
      {label}
    </button>
  )
}
/** Flowchart / Form, in the main nav after the workflow selector: the same setting as the Settings
 *  tiles. */
/** A nav dropdown's menu: drops open under its chip and lifts away on close (.oe-menu-in / -out,
 *  as the gene selector's) — staying mounted through its exit, then unmounting. */
export function NavMenu({
  open,
  style,
  children,
  tour
}: {
  open: boolean
  style: CSSProperties
  children: ReactNode
  /** its name for the tutorial (data-tour), when a tour stop shows it */
  tour?: string
}) {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  const leaving = mounted && !open
  if (!mounted) return null
  return (
    <div
      className={leaving ? 'oe-menu-out' : 'oe-menu-in'}
      data-tour={tour}
      style={{ ...style, ...(leaving ? { pointerEvents: 'none' } : null) }}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && leaving) setMounted(false)
      }}
    >
      {children}
    </div>
  )
}
/** A nav dropdown's caret: the app's line chevron, pointing down, flipping up while it's open. */
export function NavCaret({ open }: { open: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        flex: '0 0 auto',
        transform: open ? 'rotate(180deg)' : 'none',
        transition: motion('transform', 'base')
      }}
    >
      <Chevron deg={90} size={10} />
    </span>
  )
}
export function LayoutToggle() {
  const uiStyle = useAppSettings((s) => s.uiStyle)
  const update = useAppSettings((s) => s.update)
  // The app's sliding switch, pill-shaped and in the subtle tone, so it sits as quietly as the
  // folder / workflow chip beside it.
  return (
    <ToggleSwitch
      label="Workflow editor mode"
      size="lg"
      tone="subtle"
      value={uiStyle}
      options={LAYOUTS.map((o) => ({
        value: o.v,
        label: (
          // One text line tall, so the switch matches the workflow chip's height; the negative
          // margin takes back some of the padding meant for a word.
          <span style={styles.layoutIconBox} aria-label={o.label}>
            <LayoutIcon kind={o.v} />
          </span>
        ),
        title: `${o.label} — ${o.hint}`
      }))}
      onChange={(v) => update({ uiStyle: v })}
    />
  )
}
/** A layout's small icon for the nav switch: the Settings glyph (below) redrawn at icon size —
 *  Flow, one node wired to two; Form, a step list beside two panels. */
export function LayoutIcon({ kind }: { kind: 'flow' | 'form' }): ReactNode {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    style: { display: 'block', flex: '0 0 auto' }
  }
  return kind === 'flow' ? (
    <svg {...common}>
      <rect x="1" y="6" width="4" height="4" rx="1" />
      <rect x="11" y="1.5" width="4" height="4" rx="1" />
      <rect x="11" y="10.5" width="4" height="4" rx="1" />
      <path d="M5 8 C8 8 8 3.5 11 3.5" />
      <path d="M5 8 C8 8 8 12.5 11 12.5" />
    </svg>
  ) : (
    <svg {...common}>
      <rect x="1" y="1.5" width="5" height="13" rx="1" />
      <rect x="8" y="1.5" width="7" height="5.5" rx="1" />
      <rect x="8" y="9" width="7" height="5.5" rx="1" />
    </svg>
  )
}
/** A layout's glyph for its Settings tile, drawn in currentColor. Flow: three nodes wired left to
 *  right, the canvas in miniature. Form: a step list down the left beside a stack of panels. */
export function LayoutGlyph({ kind }: { kind: 'flow' | 'form' }): ReactNode {
  const common = {
    width: 72,
    height: 48,
    viewBox: '0 0 72 48',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true
  }
  return kind === 'flow' ? (
    <svg {...common}>
      <rect x="3" y="18" width="16" height="12" rx="3" />
      <rect x="29" y="5" width="16" height="12" rx="3" />
      <rect x="29" y="31" width="16" height="12" rx="3" />
      <rect x="54" y="18" width="15" height="12" rx="3" />
      <path d="M19 24 C24 24 24 11 29 11" />
      <path d="M19 24 C24 24 24 37 29 37" />
      <path d="M45 11 C50 11 49 24 54 24" />
    </svg>
  ) : (
    <svg {...common}>
      <rect x="3" y="4" width="20" height="40" rx="3" />
      <path d="M8 12h10M8 20h10M8 28h10M8 36h6" />
      <rect x="29" y="4" width="40" height="17" rx="3" />
      <rect x="29" y="27" width="40" height="17" rx="3" />
      <path d="M35 12h20M35 35h14" />
    </svg>
  )
}
/** The workflow editor mode as two tiles, each a glyph, a name and a line — Settings › Appearance,
 *  and the User guide, which shows (and sets) the same choice. */
export function LayoutPicker() {
  const uiStyle = useAppSettings((s) => s.uiStyle)
  const update = useAppSettings((s) => s.update)
  return (
    <div style={styles.layoutTiles} role="radiogroup" aria-label="Workflow editor mode">
      {LAYOUTS.map((o) => {
        const on = uiStyle === o.v
        return (
          <button
            key={o.v}
            role="radio"
            aria-checked={on}
            onClick={() => update({ uiStyle: o.v })}
            style={{
              ...styles.layoutTile,
              // Whole shorthand, so nothing is left behind when the choice moves.
              border: `2px solid ${on ? UI.accent : UI.border}`,
              background: on ? UI.panelAlt : 'transparent'
            }}
          >
            <span style={{ color: on ? UI.accent : UI.textMuted }}>
              <LayoutGlyph kind={o.v} />
            </span>
            <span style={styles.layoutTileTitle}>{o.label}</span>
            <span style={styles.layoutTileText}>{o.hint}</span>
          </button>
        )
      })}
    </div>
  )
}
/** The gene selector, in the top nav in both layouts: the selection it drives is shared by every
 *  plot, on the dashboard and in the form alike, so it sits with the app-wide controls rather than
 *  inside one view. */
export function NavGeneSelector() {
  // Only the results' gene names and annotations, so a plot's run (which stores a marker) doesn't
  // rebuild the menu — see menuParts.
  const tabs = useGeneMenuTabs(useGraph(useShallow(menuParts)))
  return <GeneSelectMenu tabs={tabs} />
}
/** The folder chip: shows the active folder and a dropdown to switch/add/delete. */
export function FolderChip() {
  const folders = useGraph((s) => s.folders)
  const activeFolderId = useGraph((s) => s.activeFolderId)
  const dataDirMissing = useGraph((s) => s.dataDirMissing)
  const switchFolder = useGraph((s) => s.switchFolder)
  const addFolder = useGraph((s) => s.addFolder)
  const deleteFolder = useGraph((s) => s.deleteFolder)
  const repathFolder = useGraph((s) => s.repathFolder)
  const moveFolder = useGraph((s) => s.moveFolder)
  const [open, setOpen] = useState(false)
  const active = folders.find((f) => f.id === activeFolderId) ?? null
  const label = active ? (active.path ? active.name : 'Select folder…') : 'no folder'

  return (
    <div style={{ position: 'relative' }}>
      <button
        id="oe-folder-chip"
        data-open={open}
        style={{ ...styles.chipSeg, ...(dataDirMissing ? styles.chipSegWarn : null) }}
        title={dataDirMissing ? `Folder not found: ${active?.path}` : active?.path || 'folder'}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ ...styles.chipIcon, ...(dataDirMissing ? { color: UI.warn } : null) }}>
          {dataDirMissing ? <StatusIcon kind="warn" /> : <IconFolder />}
        </span>
        {label}
        <NavCaret open={open} />
      </button>
      {open && <div style={styles.scrim} onClick={() => setOpen(false)} />}
      <NavMenu open={open} style={styles.folderMenu} tour="folder-menu">
        {folders.map((f) => {
          const missing = f.id === activeFolderId && dataDirMissing
          // A path-less folder is an unset placeholder (a new project's first folder): no row of
          // its own — "＋ Add folder…" below sets its path in place (see addFolder).
          if (!f.path && !missing) return null
          return (
            <div
              key={f.id}
              style={{
                ...styles.folderRow,
                background: f.id === activeFolderId ? UI.panelAlt : 'transparent'
              }}
            >
              <button
                style={styles.folderPick}
                title={f.path || 'Select a data folder'}
                onClick={() => {
                  // A missing folder needs a folder picked for it; otherwise just switch to it.
                  if (missing || !f.path) void repathFolder(f.id)
                  else switchFolder(f.id)
                  setOpen(false)
                }}
              >
                {missing ? (
                  <StatusNote kind="warn" style={{ marginTop: 0, fontSize: 12 }}>
                    {f.name} — not found
                  </StatusNote>
                ) : (
                  <span style={styles.folderName}>{f.name}</span>
                )}
                <span style={{ ...styles.folderPath, ...(missing ? styles.pathWarn : null) }}>
                  {f.path || '—'}
                </span>
                {missing && (
                  <StatusNote kind="warn" style={{ marginTop: 2, fontWeight: 600 }}>
                    Click to re-select folder…
                  </StatusNote>
                )}
              </button>
              {!missing && (
                <button
                  style={styles.rowIconBtn}
                  title="Change location… (moves the project data; copies the input files used)"
                  aria-label="Change folder location"
                  onClick={() => {
                    void moveFolder(f.id)
                    setOpen(false)
                  }}
                >
                  <IconEdit />
                </button>
              )}
              <button
                style={{ ...styles.rowIconBtn, color: '#e15759' }}
                title={
                  folders.length > 1 ? 'Delete folder' : 'Delete folder (resets to an empty folder)'
                }
                aria-label="Delete folder"
                onClick={() => deleteFolder(f.id)}
              >
                <IconTrash />
              </button>
            </div>
          )
        })}
        <button
          style={styles.folderAdd}
          onClick={() => {
            void addFolder()
            setOpen(false)
          }}
        >
          ＋ Add folder…
        </button>
      </NavMenu>
    </div>
  )
}
/** Workflow chip: switch/rename/delete workflows in the active folder, or add one. */
export function WorkflowChip() {
  const folders = useGraph((s) => s.folders)
  const activeFolderId = useGraph((s) => s.activeFolderId)
  const activeWorkflowId = useGraph((s) => s.activeWorkflowId)
  const switchWorkflow = useGraph((s) => s.switchWorkflow)
  const addWorkflow = useGraph((s) => s.addWorkflow)
  const renameWorkflow = useGraph((s) => s.renameWorkflow)
  const deleteWorkflow = useGraph((s) => s.deleteWorkflow)
  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')

  const workflows = folders.find((f) => f.id === activeFolderId)?.workflows ?? []
  const active = workflows.find((w) => w.id === activeWorkflowId) ?? null

  const commitRename = (): void => {
    if (renamingId && renameText.trim()) renameWorkflow(renamingId, renameText.trim())
    setRenamingId(null)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        data-open={open}
        style={styles.chipSeg}
        title="Workflow menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span style={styles.chipIcon}>⎇</span>
        {active ? active.name : 'no workflow'}
        <NavCaret open={open} />
      </button>
      {open && (
        <div
          style={styles.scrim}
          onClick={() => {
            setOpen(false)
            setRenamingId(null)
          }}
        />
      )}
      <NavMenu open={open} style={styles.projectMenu}>
        <div style={styles.menuHead}>Workflows</div>
        {workflows.map((w) => (
          <div
            key={w.id}
            style={{
              ...styles.folderRow,
              background: w.id === activeWorkflowId ? UI.panelAlt : 'transparent'
            }}
          >
            {renamingId === w.id ? (
              <input
                autoFocus
                style={styles.renameInput}
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  else if (e.key === 'Escape') setRenamingId(null)
                }}
                onBlur={commitRename}
              />
            ) : (
              <button
                style={styles.folderPick}
                onClick={() => {
                  switchWorkflow(w.id)
                  setOpen(false)
                }}
              >
                <span style={styles.folderName}>{w.name}</span>
              </button>
            )}
            <button
              style={styles.rowIconBtn}
              title="Rename workflow"
              aria-label="Rename workflow"
              onClick={() => {
                setRenamingId(w.id)
                setRenameText(w.name)
              }}
            >
              <IconEdit />
            </button>
            {workflows.length > 1 && (
              <button
                style={{ ...styles.rowIconBtn, color: '#e15759' }}
                title="Delete workflow"
                aria-label="Delete workflow"
                onClick={() => deleteWorkflow(w.id)}
              >
                <IconTrash />
              </button>
            )}
          </div>
        ))}
        <button
          style={styles.folderAdd}
          onClick={() => {
            addWorkflow()
            setOpen(false)
          }}
        >
          ＋ New workflow
        </button>
      </NavMenu>
    </div>
  )
}
/** Run/Stop the whole pipeline, mirroring a step tile's Run control. */
export function RunButton() {
  const nodes = useGraph((s) => s.nodes)
  const runningAll = useGraph((s) => s.runningAll)
  const runAll = useGraph((s) => s.runAll)
  const stopAll = useGraph((s) => s.stopAll)

  const runnable = nodes.filter((n): n is StepNode => isStep(n) && NODE_SPECS[n.data.kind].hasRun)
  const hasRunnable = runnable.length > 0
  const allDone = hasRunnable && runnable.every((n) => n.data.status === 'done')
  const anyError = runnable.some((n) => n.data.status === 'error')
  const state: RunState = runningAll ? 'stop' : allDone ? 'rerun' : anyError ? 'retry' : 'run'
  const rs = RUN_FACES[state]

  return (
    <>
      {/* While the whole pipeline runs, say so beside its Stop button. Positioned out of the
                row's flow, so it never shifts the centred gene selector. */}
      {runningAll && (
        // zero width, and the header's 12px gap cancelled, so the row lays out as if absent
        <span style={{ position: 'relative', width: 0, marginRight: -12, alignSelf: 'stretch' }}>
          <StatusNote
            kind="progress"
            inline
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12
            }}
          >
            Running…
          </StatusNote>
        </span>
      )}
      <button
        data-tour="run"
        style={{ ...runButtonStyle(state), opacity: !hasRunnable && !runningAll ? 0.5 : 1 }}
        disabled={!hasRunnable && !runningAll}
        onClick={() => (runningAll ? stopAll() : void runAll())}
        title={rs.title}
        aria-label={rs.title}
      >
        {rs.icon}
      </button>
    </>
  )
}
/** Opens the project-folder viewer on the active data folder; disabled when there's none on disk. */
export function FolderViewerButton() {
  const dataDir = useGraph((s) => s.dataDir)
  const dataDirMissing = useGraph((s) => s.dataDirMissing)
  const [open, setOpen] = useState(false)
  const usable = !!dataDir && !dataDirMissing
  const title = usable ? 'Project folder' : 'No project folder — add one from the folder chip'
  return (
    <>
      <button
        data-open={open}
        style={{ ...styles.navBtn, opacity: usable ? 1 : 0.5 }}
        disabled={!usable}
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
      >
        <IconFolderTree />
      </button>
      {open && dataDir && <ProjectFolderViewer root={dataDir} onClose={() => setOpen(false)} />}
    </>
  )
}
/** Project name as a dropdown chip: switch to a recent project, open one, or start new.
 *  With no project open it shows a placeholder; the dropdown still offers open/new. */
export function ProjectMenu() {
  const projectOpen = useGraph((s) => s.projectOpen)
  const projectName = useGraph((s) => s.projectName)
  const projectPath = useGraph((s) => s.projectPath)
  const dirty = useGraph((s) => s.dirty)
  const saving = useGraph((s) => s.saving)
  const recents = useGraph((s) => s.recentProjects)
  const openProject = useGraph((s) => s.openProject)
  const newProject = useGraph((s) => s.newProject)
  const newFromTemplate = useGraph((s) => s.newFromTemplate)
  const forgetRecent = useGraph((s) => s.forgetRecent)
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        data-open={open}
        data-tour="project"
        style={{ ...styles.projectChip, color: projectOpen ? UI.text : UI.textMuted }}
        title="Project menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span style={styles.projectChipName}>{projectOpen ? projectName : 'No project'}</span>
        {projectOpen &&
          (saving ? (
            // While a save is written: the spinner (on the compositor, so it turns regardless).
            <span style={styles.savingIcon} title="Saving…">
              <StatusIcon kind="progress" />
            </span>
          ) : (
            // Green only once the project is on disk with nothing pending: a project never saved
            // (no file yet) is unsaved even before its first edit.
            <span
              style={{
                ...styles.statusDot,
                background: dirty || !projectPath ? '#e2b93b' : '#3fb950'
              }}
              title={
                !projectPath ? 'Not saved yet' : dirty ? 'Unsaved changes' : 'All changes saved'
              }
            />
          ))}
        <NavCaret open={open} />
      </button>
      {open && <div style={styles.scrim} onClick={() => setOpen(false)} />}
      <NavMenu open={open} style={styles.projectMenu}>
        <div style={styles.menuHead}>Recent projects</div>
        {recents.length === 0 ? (
          <div style={styles.menuEmpty}>None yet</div>
        ) : (
          recents.map((r) => (
            <div
              key={r.path}
              style={{
                ...styles.menuRow,
                background: r.path === projectPath ? UI.panelAlt : 'transparent'
              }}
            >
              <button
                title={r.path}
                style={styles.menuRowOpen}
                onClick={() => {
                  void openProject(r.path)
                  setOpen(false)
                }}
              >
                <span style={styles.menuName}>{r.name}</span>
                <span style={styles.menuPath}>{r.path}</span>
              </button>
              <button
                style={styles.recentForget}
                title="Remove from recents"
                onClick={(e) => {
                  e.stopPropagation()
                  forgetRecent(r.path)
                }}
              >
                ✕
              </button>
            </div>
          ))
        )}
        <div style={styles.menuDivider} />
        <button
          style={styles.menuAction}
          onClick={() => {
            void openProject()
            setOpen(false)
          }}
        >
          Open project…
        </button>
        <button
          style={styles.menuAction}
          onClick={() => {
            void newProject()
            setOpen(false)
          }}
        >
          New project
        </button>
        <button
          style={styles.menuAction}
          onClick={() => {
            void newFromTemplate()
            setOpen(false)
          }}
        >
          New project from template…
        </button>
      </NavMenu>
    </div>
  )
}
/** Minimal monochrome line icons (inline SVG → no font/emoji dependency). */
export function IconSave() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h6V4" />
      <rect x="8" y="13" width="8" height="7" />
    </svg>
  )
}
export function IconFolder() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6.5h5l2 2h9V19H4z" />
    </svg>
  )
}
export function IconFolderTree() {
  // Plain folder outline — the project-folder viewer.
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 6.5h5l2 2h10V18.5h-17z" />
    </svg>
  )
}
export function IconPencil() {
  // Two passes: a thick panel-coloured underlay knocks out just the pencil's silhouette
  // from the floppy behind it (so the disk draws right up to the pencil, trimmed only a
  // hair), then the pencil is stroked on top.
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20l1-4L17 4l3 3L8 19z" stroke={UI.panel} strokeWidth="6" />
      <path d="M4 20l1-4L17 4l3 3L8 19z" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  )
}
/** Minimalist rename (pencil) icon for menu rows. */
export function IconEdit() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M14 7l3 3" />
    </svg>
  )
}
/** Control chip: save / save-as / undo / redo, one bordered group split by dividers. */
export function ControlChip() {
  // A never-saved project has something to save even before its first edit (its first save
  // writes the file — saveProject routes to save-as).
  const dirty = useGraph((s) => s.dirty || !s.projectPath)
  const saveProject = useGraph((s) => s.saveProject)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const canUndo = useGraph((s) => s.past.length > 0)
  const canRedo = useGraph((s) => s.future.length > 0)
  const undo = useGraph((s) => s.undo)
  const redo = useGraph((s) => s.redo)
  const saveError = useGraph((s) => s.saveError)
  const saveWarning = useGraph((s) => s.saveWarning)
  const clearSaveError = useGraph((s) => s.clearSaveError)
  // Cmd/Ctrl+S saves, as the save button does (nothing to save, or a save running → no-op);
  // with Shift it saves as a new project file (the save-as menu's first entry).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      const s = useGraph.getState()
      if (s.saving) return
      if (e.shiftKey) void s.saveProjectAs()
      else if (s.dirty || !s.projectPath) void s.saveProject()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div style={{ ...styles.ctrlChip, position: 'relative' }}>
      {/* A failed save says why, just under the controls — as does a save whose folders couldn't
                all be renamed to match. Click to dismiss. */}
      {(saveError || saveWarning) && (
        <div style={styles.saveError} onClick={clearSaveError} title="Dismiss">
          <StatusNote kind={saveError ? 'error' : 'warn'} style={{ margin: 0 }}>
            {saveError ?? saveWarning}
          </StatusNote>
        </div>
      )}
      <button
        data-tour="save"
        style={{
          ...styles.ctrlBtn,
          color: saveError ? UI.err : dirty ? UI.text : UI.textMuted,
          opacity: dirty ? 1 : 0.5,
          cursor: dirty ? 'pointer' : 'default'
        }}
        title={dirty ? 'Save project' : 'All changes saved'}
        disabled={!dirty}
        onClick={() => void saveProject()}
      >
        <IconSave />
      </button>
      {/* Save as: a dropdown — a new project file, or a template (its sections expand in place). */}
      <div style={{ position: 'relative', display: 'flex' }}>
        <button
          style={styles.ctrlBtn}
          title="Save as project or template…"
          onClick={() => setSaveAsOpen((o) => !o)}
        >
          <span style={styles.saveAsWrap}>
            <IconSave />
            <span style={styles.pencilBadge}>
              <IconPencil />
            </span>
          </span>
        </button>
        {saveAsOpen && <div style={styles.scrim} onClick={() => setSaveAsOpen(false)} />}
        <NavMenu open={saveAsOpen} style={styles.saveAsMenu}>
          <SaveAsMenu onClose={() => setSaveAsOpen(false)} />
        </NavMenu>
      </div>
      <button
        style={{ ...styles.ctrlBtn, opacity: canUndo ? 1 : 0.4 }}
        title="Undo"
        disabled={!canUndo}
        onClick={undo}
      >
        ↺
      </button>
      <button
        style={{ ...styles.ctrlBtn, opacity: canRedo ? 1 : 0.4 }}
        title="Redo"
        disabled={!canRedo}
        onClick={redo}
      >
        ↻
      </button>
    </div>
  )
}
