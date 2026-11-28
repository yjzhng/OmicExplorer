/** The import wizard's stages and its roadmap header. */
import { Fragment, type ReactNode } from 'react'
import { UI } from '../../../ui/app/theme'
import { styles } from './styles'

/** Completed-stage green, matching the tile status dot. */
const DONE_GREEN = '#3fae5a'

/** Top-of-modal roadmap: the 4 wizard stages as numbered pills joined by connectors. A stage
 *  the user has finished (before the current one) reads green with a ✓; the current stage is
 *  accent-highlighted; stages not yet reached stay grey. When `allDone` (the import was already
 *  converted), every stage reads green. Display-only. */
export function Roadmap({
  stage,
  steps,
  allDone,
  onJump
}: {
  stage: number
  /** each step's stage number (what's saved and jumped to) and name; shown numbered 1, 2, … */
  steps: Array<{ stage: number; name: string }>
  allDone: boolean
  onJump: (stage: number) => void
}): ReactNode {
  return (
    <div style={styles.roadmap}>
      {steps.map(({ stage: n, name }, i) => {
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
                {done && !current ? '✓' : i + 1}
              </span>
              <span
                style={{
                  ...styles.roadLabel,
                  color: current ? UI.accent : done ? UI.ok : UI.textMuted,
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
