/** The app's own buttons, drawn inline in the User guide (`[[name]]` within a line; see
 *  guideMarkdown.ts UI_ELEMENTS): the real elements with the real styles and icons, made inert, so
 *  the guide shows exactly what the app shows and follows it when the app changes. */
import type { CSSProperties, ReactNode } from 'react'

import { IconGuide, IconHome } from '../app/icons'
import { IconFolderTree, IconPencil, IconSave, LayoutToggle } from '../app/NavBar'
import { TileFace } from '../graph/GraphNode'
import { NODE_SPECS } from '../graph/registry'
import type { NodeKind } from '../graph/types'
import { RUN_FACES, runButtonStyle, type RunState } from '../app/runFaces'
import { styles as app } from '../app/styles'
import { IconData, IconDownload } from '../dashboard/PanelTile'
import { TILE_BUTTON_STYLE } from '../dashboard/tileButton'
import type { UiElement } from './guideMarkdown'
import { IconCopy, IconGear } from './icons'
import { UI } from './theme'

/** Inline in a line of text: centred on it, a little smaller than in the app (a 30 px nav button
 *  would open up the line), and never clickable — it only shows the button. */
function Inert({ zoom = 0.75, children }: { zoom?: number; children: ReactNode }): ReactNode {
  return (
    <span aria-hidden style={{ ...s.inert, zoom }}>
      {children}
    </span>
  )
}

const nav = (icon: ReactNode, style: CSSProperties = app.navBtn): ReactNode => (
  <Inert>
    <span style={style}>{icon}</span>
  </Inert>
)
const run = (state: RunState): ReactNode => nav(RUN_FACES[state].icon, runButtonStyle(state))
// the control chip's buttons, each in the chip it sits in
const ctrl = (icon: ReactNode): ReactNode => (
  <Inert>
    <span style={app.ctrlChip}>
      <span style={app.ctrlBtn}>{icon}</span>
    </span>
  </Inert>
)
const tile = (icon: ReactNode): ReactNode => (
  <Inert zoom={0.85}>
    <span style={TILE_BUTTON_STYLE}>{icon}</span>
  </Inert>
)

const ELEMENTS: Record<UiElement, () => ReactNode> = {
  home: () => nav(<IconHome />),
  save: () => ctrl(<IconSave />),
  'save-as': () =>
    ctrl(
      <span style={app.saveAsWrap}>
        <IconSave />
        <span style={app.pencilBadge}>
          <IconPencil />
        </span>
      </span>
    ),
  undo: () => ctrl('↺'),
  redo: () => ctrl('↻'),
  'editor-layout': () => (
    <Inert>
      <LayoutToggle />
    </Inert>
  ),
  run: () => run('run'),
  rerun: () => run('rerun'),
  retry: () => run('retry'),
  stop: () => run('stop'),
  'project-folder': () => nav(<IconFolderTree />),
  guide: () => nav(<IconGuide />),
  settings: () => nav(<IconGear size={15} strokeWidth={1.7} />),
  'new-step': () => (
    <Inert>
      <span style={app.newStepBtn}>+ New step</span>
    </Inert>
  ),
  results: () => (
    <Inert>
      <span style={app.resultsLink}>Results →</span>
    </Inert>
  ),
  copy: () => tile(<IconCopy />),
  download: () => tile(<IconDownload />),
  'export-data': () => tile(<IconData />),
  'tile-settings': () => tile(<IconGear />)
}

/** The element `[[name]]` names, as the app draws it. */
export function GuideUi({ name }: { name: UiElement }): ReactNode {
  return ELEMENTS[name]()
}

/** Workflow steps as the canvas draws them (` ```tiles `), left to right with arrows between —
 *  each the real tile face (TileFace), a little smaller. A kind the app doesn't have shows as
 *  written, so a typo is visible. */
export function TileRow({ tiles }: { tiles: { kind: string; text: string }[] }): ReactNode {
  return (
    <div style={s.tiles}>
      {tiles.map((t, i) => (
        <span key={i} style={s.tileStep}>
          {i > 0 && <span style={s.arrow}>→</span>}
          {t.kind in NODE_SPECS ? (
            <span style={s.tileBox}>
              <TileFace kind={t.kind as NodeKind} text={t.text} />
            </span>
          ) : (
            <code>{t.kind}</code>
          )}
        </span>
      ))}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  tiles: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '0 0 14px' },
  tileStep: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  // the canvas's 230 px tile, scaled so four fit the guide's column; no shadow (it isn't floating)
  tileBox: { zoom: 0.72, display: 'inline-flex', pointerEvents: 'none' },
  arrow: { color: UI.textMuted, fontSize: 13 },
  inert: {
    display: 'inline-flex',
    verticalAlign: 'middle',
    margin: '0 2px',
    pointerEvents: 'none',
    userSelect: 'none'
  }
}
