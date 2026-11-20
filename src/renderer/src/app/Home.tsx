import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import appLogo from '../assets/logo-256.png'
import { projectStanding } from '../graph/project'
import { useGraph } from '../graph/store'
import { REVEAL } from '../ui/fileLabels'
import { IconMenu } from '../ui/icons'
import { placeMenu } from '../ui/placeMenu'
import { StatusNote } from '../ui/StatusNote'
import { NOTICE_MS, PALETTES, UI } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'
import { REPO_URL, type UpdateInfo } from '../ui/useUpdateCheck'
import { IconGuide } from './icons'
import { UpdateTag } from './NavBar'
import { ROW_MENU_W } from './shared'
import { styles } from './styles'
import { APP_VERSION } from './version'

export function IconStart({ size = 17 }: { size?: number } = {}) {
  // A flag on its pole — the tutorial.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </svg>
  )
}
export function IconGlobe() {
  // Globe — the project website.
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
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </svg>
  )
}
export function IconPaper({ size = 13 }: { size?: number }) {
  // A page of text — the publication.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  )
}
export function IconGitHub() {
  // GitHub mark — the source repository.
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
export const WEBSITE_URL = 'https://yjzhng.github.io/open-bioware/apps/omicexplorer/'
/** The app's Website and GitHub buttons (part of the namecard, AppCard). */
export function AppLinks() {
  return (
    <div style={styles.homeLinks}>
      <a href={WEBSITE_URL} target="_blank" rel="noreferrer" style={styles.homeLink}>
        <IconGlobe />
        Website
      </a>
      <a href={REPO_URL} target="_blank" rel="noreferrer" style={styles.homeLink}>
        <IconGitHub />
        GitHub
      </a>
    </div>
  )
}
/** The namecard's "Cite this software": the reference (and DOI) from this version's release notes,
 *  baked in at build time (config/citation.ts), with a copy button — or a note that there's none
 *  yet. */
export function AppCitation() {
  const [copied, setCopied] = useState(false)
  const cite = __APP_CITATION__
  const copy = (): void => {
    if (!cite) return
    void window.api.copyText(cite.reference).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), NOTICE_MS.done)
    })
  }
  return (
    <>
      <div style={styles.recentHead}>Cite this software</div>
      <div style={{ ...styles.homeCard, ...styles.citeCard }}>
        {cite ? (
          <>
            <p style={styles.citeRef}>{cite.reference}</p>
            <div style={styles.citeFoot}>
              {/* doi.org resolves the DOI to the publication's page. */}
              {cite.doi && (
                <span style={styles.citeDoi}>
                  DOI:{' '}
                  <a
                    href={`https://doi.org/${cite.doi}`}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.citeDoiLink}
                    title={`Open the publication (https://doi.org/${cite.doi})`}
                  >
                    {cite.doi}
                  </a>
                </span>
              )}
              <button
                style={{ ...styles.homeLink, ...styles.citeCopy }}
                onClick={copy}
                title="Copy the reference"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </>
        ) : (
          <p style={styles.citeNone}>No reference available yet.</p>
        )}
      </div>
    </>
  )
}
/** The home page's Getting started section, under the namecard: Tutorial (a walkthrough — not
 *  ready yet, so shown disabled), Documentation (the user guide, as the nav's book button opens)
 *  and Publication (the paper, by the DOI in this version's citation — config/citation.ts —
 *  disabled until there is one). */
export function HomeGuides({ onGuide }: { onGuide: () => void }) {
  const doi = __APP_CITATION__?.doi
  return (
    <>
      <div style={styles.recentHead}>Getting started</div>
      <div style={styles.homeGuides}>
        <button
          className="oe-press oe-guide-btn"
          style={{ ...styles.homeSecondary, ...styles.homeGuideBtn, ...styles.homeGuideOff }}
          disabled
          title="Tutorial — coming soon"
        >
          <IconStart size={15} />
          Tutorial
        </button>
        <button
          className="oe-press oe-guide-btn"
          style={{ ...styles.homeSecondary, ...styles.homeGuideBtn }}
          onClick={onGuide}
          title="User guide"
        >
          <IconGuide size={15} />
          Documentation
        </button>
        <button
          className="oe-press oe-guide-btn"
          style={{
            ...styles.homeSecondary,
            ...styles.homeGuideBtn,
            ...(doi ? null : styles.homeGuideOff)
          }}
          disabled={!doi}
          onClick={() => doi && window.open(`https://doi.org/${doi}`, '_blank', 'noreferrer')}
          title={
            doi ? `The publication (https://doi.org/${doi})` : 'Publication — not available yet'
          }
        >
          <IconPaper size={15} />
          Publication
        </button>
      </div>
    </>
  )
}
/** A recent project's version tag, beside its name: the app version that last saved the file —
 *  amber when this app's migrations would change the file (Fix rewrites it) — not merely because an
 *  older release saved it — red when a newer app saved it. The tooltip has the file format and the version it was created with. */
export function ProjectVersionTag({ path }: { path: string | null }): ReactNode {
  const h = useGraph((s) => (path ? s.recentHeaders[path] : undefined))
  const upgrades = useGraph((s) => (path ? s.recentUpgrades[path] : undefined))
  if (!h) return null
  const standing = projectStanding(h, APP_VERSION, upgrades)
  const color = standing === 'older' ? '#e2b93b' : standing === 'newer' ? UI.err : UI.textMuted
  const title = [
    h.savedBy ? `Last saved by OmicExplorer ${h.savedBy}` : 'Saved before OmicExplorer 0.3.5',
    `Created with ${h.createdWith ?? 'an unrecorded version (before 0.3.7)'}`,
    `File format ${h.format ?? '?'}`,
    standing === 'older'
      ? 'Written in an older form — it opens fine; Fix rewrites it in the current one'
      : standing === 'newer'
        ? `Saved by a newer app than this one (${APP_VERSION ?? '?'}) — update before editing it`
        : ''
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span
      title={title}
      style={{ ...styles.versionTag, color, borderColor: `${color}66`, background: `${color}14` }}
    >
      {h.savedBy ? `v${h.savedBy}` : 'pre-0.3.5'}
    </span>
  )
}
/** A Last / Recent project row's actions, behind the hamburger at its right: open it (resume, for
 *  the session still live), show the file in the OS file manager, Fix — only for a file in an older
 *  form: rewrite it in the current format, a copy of the old file kept beside it, then say how it
 *  went — and remove it from the list (the file itself stays on disk). */
export function ProjectRowMenu({
  path,
  openLabel = 'Open',
  onOpen,
  onDelete
}: {
  path: string | null
  /** the open item's label ('Resume' for the live session) */
  openLabel?: string
  onOpen: () => void
  /** remove from the recents; unset = not listed there (an unsaved live session) */
  onDelete?: () => void
}): ReactNode {
  const h = useGraph((s) => (path ? s.recentHeaders[path] : undefined))
  const upgradeProject = useGraph((s) => s.upgradeProject)
  const isOpen = useGraph((s) => s.projectOpen && s.projectPath === path)
  const [state, setState] = useState<
    { busy: true } | { busy: false; ok: boolean; text: string } | null
  >(null)
  const [at, setAt] = useState<CSSProperties | null>(null)
  // The menu is portalled to <body>, outside the app root that carries the theme's CSS variables,
  // so it's coloured from the palette itself (as the app's Select menu is).
  const p = PALETTES[useUiTheme((s) => s.mode)]
  const upgrades = useGraph((s) => (path ? s.recentUpgrades[path] : undefined))
  const older = !!path && !!h && projectStanding(h, APP_VERSION, upgrades) === 'older'
  const fix = async (): Promise<void> => {
    if (!path) return
    setState({ busy: true })
    const r = await upgradeProject(path)
    setState(
      r.error
        ? { busy: false, ok: false, text: `Couldn't fix: ${r.error}` }
        : {
            busy: false,
            ok: true,
            text: `Fixed — old file kept as ${(r.backup ?? '').split(/[/\\]/).pop()}`
          }
    )
  }
  // Each item closes the menu, then acts.
  const item = (
    label: string,
    act: (() => void) | null,
    title?: string,
    danger?: boolean
  ): ReactNode => (
    <button
      style={{
        ...styles.menuAction,
        color: danger ? p.err : p.text,
        ...(act ? null : { color: p.textMuted, opacity: 0.5, cursor: 'default' })
      }}
      disabled={!act}
      title={title}
      onClick={() => {
        setAt(null)
        act?.()
      }}
    >
      {label}
    </button>
  )
  return (
    <span style={styles.fixWrap}>
      {state && (
        <span
          style={{ ...styles.fixNote, color: state.busy || state.ok ? UI.textMuted : UI.err }}
          title={state.busy ? undefined : state.text}
        >
          {state.busy ? 'Fixing…' : state.text}
        </span>
      )}
      <button
        className="oe-row-menu-btn"
        style={{ ...styles.recentMenuBtn, ...(at ? styles.recentMenuBtnOpen : null) }}
        title="Project actions"
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={(e) => {
          e.stopPropagation()
          if (at) return setAt(null)
          // Under the button, its right edge lined up with the button's (it sits at the row's end).
          const r = e.currentTarget.getBoundingClientRect()
          const place = placeMenu(r, ROW_MENU_W, 220)
          setAt({ ...place, left: Math.max(8, r.right - ROW_MENU_W) })
        }}
      >
        <IconMenu />
      </button>
      {at &&
        createPortal(
          <>
            <div style={styles.scrim} onClick={() => setAt(null)} />
            <div
              className="oe-menu-in oe-row-menu"
              role="menu"
              style={{ ...styles.rowMenu, background: p.panel, borderColor: p.border, ...at }}
              onClick={(e) => e.stopPropagation()}
            >
              {item(openLabel, onOpen)}
              {item(REVEAL.item, path ? () => void window.api.revealPath(path) : null)}
              {item(
                'Fix',
                older && !state?.busy ? () => void fix() : null,
                older
                  ? isOpen
                    ? 'Save the open project in the current format (its unsaved changes too); a copy of the old file is kept beside it'
                    : 'Rewrite this project in the current format; a copy of the old file is kept beside it'
                  : 'Already in the current format'
              )}
              <div style={{ ...styles.menuDivider, background: p.border }} />
              {item(
                'Remove',
                onDelete ?? null,
                'Remove from recent projects — the file stays on disk',
                true
              )}
            </div>
          </>,
          document.body
        )}
    </span>
  )
}
export function Home({
  update,
  showUpdate,
  onGuide
}: {
  update: UpdateInfo
  showUpdate: boolean
  /** open the user guide */
  onGuide: () => void
}) {
  const newProject = useGraph((s) => s.newProject)
  const newFromTemplate = useGraph((s) => s.newFromTemplate)
  const openProject = useGraph((s) => s.openProject)
  const resumeProject = useGraph((s) => s.resumeProject)
  const recents = useGraph((s) => s.recentProjects)
  const forgetRecent = useGraph((s) => s.forgetRecent)
  const loadRecentHeaders = useGraph((s) => s.loadRecentHeaders)
  // Each recent file's header, for its version tag — re-read whenever the list changes.
  useEffect(() => {
    void loadRecentHeaders()
  }, [recents, loadRecentHeaders])
  const openError = useGraph((s) => s.openError)
  const projectName = useGraph((s) => s.projectName)
  const projectPath = useGraph((s) => s.projectPath)
  const dirty = useGraph((s) => s.dirty)
  // "Last project": resume the project still live in this session (goHome keeps it in memory, so its
  // unsaved changes survive an accidental trip home). On a fresh session with none live, fall back to
  // the most-recently opened project, which "resumes" by opening it from disk.
  const hasSession = useGraph((s) => s.folders.length > 0)
  const last = hasSession
    ? { mode: 'resume' as const, name: projectName, path: projectPath, dirty }
    : recents.length > 0
      ? { mode: 'open' as const, name: recents[0].name, path: recents[0].path, dirty: false }
      : null
  // Don't list the last project again under Recent (avoid a duplicate row).
  const recentRest = last?.path ? recents.filter((r) => r.path !== last.path) : recents
  return (
    <div style={styles.home}>
      <div style={styles.homeInner}>
        {/* Left: the app's namecard. */}
        <div style={styles.homeLeft}>
          <AppCard update={update} showUpdate={showUpdate}>
            <HomeGuides onGuide={onGuide} />
          </AppCard>
        </div>
        {/* Right: projects — new / open, the last one, recent ones (only the list scrolls). */}
        <div style={styles.homeRight}>
          <p style={styles.homeSub}>Create or open a project to begin.</p>
          <div style={styles.homeActions}>
            <button
              style={{ ...styles.homePrimary, ...styles.homeAction }}
              onClick={() => void newProject()}
            >
              ＋ New project
            </button>
            <button
              style={{ ...styles.homeSecondary, ...styles.homeAction }}
              onClick={() => void openProject()}
            >
              Open project…
            </button>
            <button
              style={{ ...styles.homeSecondary, ...styles.homeAction }}
              onClick={() => void newFromTemplate()}
            >
              From template…
            </button>
            {/* not wired up yet: shown so the home page's layout is final */}
            <button
              style={{
                ...styles.homeSecondary,
                ...styles.homeAction,
                opacity: 0.45,
                cursor: 'default'
              }}
              disabled
              title="Coming soon"
            >
              Example project
            </button>
          </div>
          {openError && (
            <div style={styles.openError}>
              <StatusNote kind="error" style={{ marginTop: 0, fontSize: 12 }}>
                {openError}
              </StatusNote>
            </div>
          )}
          {last && (
            <>
              <div style={styles.recentHead}>Last project</div>
              <div style={styles.homeCard}>
                <div style={styles.recentRow}>
                  <button
                    style={styles.recentItem}
                    title={
                      last.mode === 'resume'
                        ? 'Resume where you left off (keeps unsaved changes)'
                        : (last.path ?? '')
                    }
                    onClick={() =>
                      last.mode === 'resume'
                        ? resumeProject()
                        : void openProject(last.path ?? undefined)
                    }
                  >
                    <span
                      style={{
                        ...styles.recentName,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <span
                        style={{
                          ...styles.statusDot,
                          background: last.dirty ? '#e2b93b' : '#3fb950'
                        }}
                      />
                      {last.name}
                      <ProjectVersionTag path={last.path} />
                    </span>
                    <span style={styles.recentPath}>
                      {last.mode === 'resume'
                        ? last.dirty
                          ? 'Unsaved changes — resume to keep them'
                          : (last.path ?? 'Resume this session')
                        : (last.path ?? '')}
                    </span>
                  </button>
                  <ProjectRowMenu
                    path={last.path}
                    openLabel={last.mode === 'resume' ? 'Resume' : 'Open'}
                    onOpen={() =>
                      last.mode === 'resume'
                        ? resumeProject()
                        : void openProject(last.path ?? undefined)
                    }
                    onDelete={
                      last.path && recents.some((r) => r.path === last.path)
                        ? () => forgetRecent(last.path!)
                        : undefined
                    }
                  />
                </div>
              </div>
            </>
          )}
          {/* Recent list, minus whatever is already shown as the Last project. This card fills the
              rest of the window and is the only part that scrolls; the header above stays put. */}
          <div style={styles.recentHead}>Recent projects</div>
          <div
            className="oe-scroll"
            style={{ ...styles.homeCard, ...(recentRest.length > 2 ? styles.recentScroll : null) }}
          >
            {recentRest.length === 0 ? (
              <div style={styles.recentEmpty}>
                {last ? 'No other recent projects.' : 'No recent projects yet.'}
              </div>
            ) : (
              recentRest.map((r, i) => (
                <div
                  key={r.path}
                  style={{ ...styles.recentRow, ...(i > 0 ? styles.recentDivider : null) }}
                >
                  <button
                    style={styles.recentItem}
                    title={r.path}
                    onClick={() => void openProject(r.path)}
                  >
                    <span style={styles.recentNameLine}>
                      <span style={styles.recentName}>{r.name}</span>
                      <ProjectVersionTag path={r.path} />
                    </span>
                    <span style={styles.recentPath}>{r.path}</span>
                  </button>
                  <ProjectRowMenu
                    path={r.path}
                    onOpen={() => void openProject(r.path)}
                    onDelete={() => forgetRecent(r.path)}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The app's namecard — logo, name, version (with the update tag), Website / GitHub, and how to
 *  cite it. The same card on the home page's left column and in Settings → About; `children` go
 *  between the name and the citation (the home page's Getting started section). */
export function AppCard({
  update,
  showUpdate,
  children
}: {
  update: UpdateInfo
  showUpdate: boolean
  children?: ReactNode
}) {
  return (
    <>
      <div style={styles.homeBrand}>
        <img src={appLogo} alt="" style={styles.homeLogo} draggable={false} />
        <div>
          <div style={styles.homeTitle}>{__APP_NAME__}</div>
          <div style={styles.homeVersion}>
            v{__APP_VERSION__}
            {showUpdate && <UpdateTag update={update} />}
          </div>
          <AppLinks />
        </div>
      </div>
      {children}
      <AppCitation />
    </>
  )
}
