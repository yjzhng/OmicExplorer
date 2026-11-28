/** The project folder viewer's file and folder icons (ProjectFolderViewer), shared with the
 *  folder trees that picture the same folders (the User Guide's, the Manual data input window's)
 *  so a file looks the same wherever it's shown. */
import type { ReactNode } from 'react'

/** What a file holds, by its extension: a table (data / results), a plot (exported figure), an
 *  OmicExplorer project, or anything else. */
const TABLE_EXT = new Set(['csv', 'tsv', 'txt', 'xlsx', 'xls'])
const PLOT_EXT = new Set(['png', 'pdf', 'svg', 'jpg', 'jpeg', 'tif', 'tiff'])
/** Their icons' colours: green for tables, orange for plots, purple for a project (readable on
 *  either theme); anything else stays muted like the folders. */
const TABLE_COLOR = '#59a14f'
const PLOT_COLOR = '#f28e2b'
export const PROJECT_COLOR = '#9b6bd6'

// The viewer's icons, drawn like the app's own (ui/controls/icons, the nav's): 20px on a 24 grid, 1.8 round
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

/** `size` in px (20, the viewer's, by default). */
export function FileIcon({ name, size = 20 }: { name: string; size?: number }): ReactNode {
  const dim = { width: size, height: size }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  // A project is just a globe (the app's own mark), no page. The rest are the page with a mark,
  // as plain as it gets: a table two lines, a plot two bars.
  if (ext === 'omicexplorer')
    return (
      <span style={{ display: 'inline-flex', color: PROJECT_COLOR }} title="OmicExplorer project">
        <svg {...ICON} {...dim}>
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
      <svg {...ICON} {...dim}>
        <path d={PAGE} />
        {kind && <path d={kind.mark} />}
      </svg>
    </span>
  )
}

/** A folder: the same outline as the nav's project-folder button — filled solid for the current
 *  project's own folders. */
export function IconFolder({
  solid = false,
  size = 20
}: {
  solid?: boolean
  size?: number
}): ReactNode {
  return (
    <svg {...ICON} width={size} height={size} fill={solid ? 'currentColor' : 'none'}>
      <path d="M3.5 6.5h5l2 2h10V18.5h-17z" />
    </svg>
  )
}
