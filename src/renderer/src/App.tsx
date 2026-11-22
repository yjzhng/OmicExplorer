import '@xyflow/react/dist/style.css'
import { useEffect, useState } from 'react'
import './app.css'

import { FlowViews } from './app/Canvas'
import { Home } from './app/Home'
import { IconGuide, IconHome } from './app/icons'
import {
  ControlChip,
  FolderChip,
  FolderViewerButton,
  LayoutToggle,
  NavGeneSelector,
  ProjectMenu,
  RunButton,
  WorkflowChip
} from './app/NavBar'
import { SettingsPopover } from './app/SettingsPopover'
import { styles } from './app/styles'
import { FormWorkflow } from './form/FormWorkflow'
import { useGraph } from './graph/store'
import { FreezeNotice } from './ui/FreezeNotice'
import { IconGear } from './ui/icons'
import { cssVars, PALETTES } from './ui/theme'
import { useAppSettings } from './ui/useAppSettings'
import { useAppView } from './ui/useAppView'
import { UserGuide } from './ui/UserGuide'
import { TutorialOverlay } from './ui/tutorial/TutorialOverlay'
import { useUiTheme } from './ui/useUiTheme'
import { useUpdateCheck } from './ui/useUpdateCheck'

export default function App() {
  // A window opened for a project file (double-clicked in Finder) opens it. Main hands the path
  // out once, so StrictMode's second run gets null.
  useEffect(() => {
    void window.api
      .takeLaunchProject?.()
      .then((path) => {
        if (path) void useGraph.getState().openProject(path)
      })
      .catch(() => undefined)
  }, [])
  // Back to the window: the Load tiles' files may have changed meanwhile (replaced, moved, synced).
  useEffect(() => {
    const onFocus = (): void => void useGraph.getState().checkLoads()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  const mode = useUiTheme((s) => s.mode)
  // Read here so a change re-renders the app (portals pick it up through cssVars on their next render).
  const accent = useUiTheme((s) => s.accent)
  const customAccent = useUiTheme((s) => s.customAccent)
  const view = useAppView((s) => s.view)
  const uiStyle = useAppSettings((s) => s.uiStyle)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  // Update check drives a notification dot on the settings gear + the About section.
  const update = useUpdateCheck()
  const [silenced, setSilenced] = useState(() => {
    try {
      return localStorage.getItem('omicexplorer.silenceUpdates') === '1'
    } catch {
      return false
    }
  })
  const toggleSilence = (): void =>
    setSilenced((s) => {
      const next = !s
      try {
        localStorage.setItem('omicexplorer.silenceUpdates', next ? '1' : '0')
      } catch {
        /* storage unavailable — keep in-memory only */
      }
      return next
    })
  const showUpdateDot = update.updateAvailable && !silenced

  const projectOpen = useGraph((s) => s.projectOpen)
  // A project still loading: named in the notice, by its file name.
  const opening = useGraph((s) => s.opening)
  const openingLabel = opening
    ? `Opening ${(opening.split(/[/\\]/).pop() ?? opening).replace(/\.omicexplorer$/i, '')}…`
    : null
  const goHome = useGraph((s) => s.goHome)
  const initProject = useGraph((s) => s.initProject)
  const pruneMissingRecents = useGraph((s) => s.pruneMissingRecents)
  useEffect(() => {
    void initProject().then(() => pruneMissingRecents())
  }, [initProject, pruneMissingRecents])
  useEffect(() => {
    document.documentElement.style.background = PALETTES[mode].bg
    // Make native UI (scrollbars, form controls) follow the app theme — otherwise
    // e.g. table scrollbars stay light in dark mode. The app paints its own surfaces
    // via CSS vars, so this only governs the browser-drawn chrome.
    document.documentElement.style.colorScheme = mode
  }, [mode])

  return (
    <div
      style={{ ...styles.root, ...cssVars(PALETTES[mode], { id: accent, custom: customAccent }) }}
    >
      {/* "Working…" while the main thread is stuck on heavy work, so a pause doesn't read as a hang;
          "Opening …" at once while a project loads. */}
      <FreezeNotice busy={openingLabel} />
      <header className="oe-nav" style={styles.header}>
        <button
          style={styles.navBtn}
          onClick={() => goHome()}
          title="Home (all projects)"
          aria-label="Home"
        >
          <IconHome />
        </button>
        <ProjectMenu />
        {projectOpen && (
          <>
            {/* Control chip: save / save-as / undo / redo. */}
            <ControlChip />
            {/* Folder + workflow selectors in one chip, split by a divider. */}
            <div style={styles.chipGroup}>
              <FolderChip />
              <div style={styles.chipDivider} />
              <WorkflowChip />
            </div>
            {/* The layout, switchable from the nav as well as Settings. */}
            <LayoutToggle />
          </>
        )}
        <div style={styles.navSpacer} />
        {/* The gene selector, centred in the space between the left group (ending at the
            folder / workflow selector) and the Run button: equal spacers on either side. */}
        {projectOpen && (
          <>
            <div data-tour="genes" style={{ display: 'flex' }}>
              <NavGeneSelector />
            </div>
            <div style={styles.navSpacer} />
          </>
        )}
        {/* Workflow action: run/re-run, split from the general buttons. */}
        {projectOpen && <RunButton />}
        {projectOpen && <FolderViewerButton />}
        {projectOpen && <div style={styles.navSep} />}
        <button
          data-open={guideOpen}
          data-tour="guide"
          style={styles.navBtn}
          onClick={() => setGuideOpen(true)}
          title="User guide"
          aria-label="User guide"
        >
          <IconGuide />
        </button>
        <button
          data-open={settingsOpen}
          style={{ ...styles.navBtn, position: 'relative' }}
          onClick={() => setSettingsOpen((o) => !o)}
          title={showUpdateDot ? `Settings — v${update.latest} available` : 'Settings'}
          aria-label={showUpdateDot ? 'Settings (update available)' : 'Settings'}
        >
          <IconGear size={15} strokeWidth={1.7} />
          {showUpdateDot && <span style={styles.navDot} />}
        </button>
        {settingsOpen && (
          <SettingsPopover
            onClose={() => setSettingsOpen(false)}
            update={update}
            silenced={silenced}
            onToggleSilence={toggleSilence}
          />
        )}
        {guideOpen && <UserGuide onClose={() => setGuideOpen(false)} />}
      </header>
      {!projectOpen ? (
        <Home update={update} showUpdate={showUpdateDot} onGuide={() => setGuideOpen(true)} />
      ) : uiStyle === 'form' ? (
        // Form mode has no Workflow/Results split — a step and its output are one view, so both
        // entries land on it (a project saved in Results still reopens on something).
        <div style={styles.canvasArea}>
          <FormWorkflow />
        </div>
      ) : (
        <FlowViews view={view} />
      )}
      <TutorialOverlay />
    </div>
  )
}
