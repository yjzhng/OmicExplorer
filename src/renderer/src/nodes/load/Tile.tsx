/** Load data's canvas tile: whether its data is loaded, and how its files stand. */
import type { ReactNode } from 'react'

import type { TileContext } from '../tiles'
import { loadCheckInfo } from '../../graph/loadCheck'
import { type LoadConfig, resolveLoadMode } from '../../graph/types'
import { muted } from '../kit/tile'

export function tile(t: TileContext): ReactNode {
  const { config, check } = t
  const cfg = config as LoadConfig
  const loaded = !!cfg.data && !!cfg.samplesheet
  const mode = resolveLoadMode(cfg)
  const info = loaded && check && check.state !== 'ok' ? loadCheckInfo(check, mode) : null
  return (
    <>
      <div style={muted}>
        {loaded
          ? `Data loaded ${mode === 'interactive' ? 'interactively' : 'manually'}`
          : 'Data not yet loaded'}
      </div>
      {info && (
        <div style={{ ...muted, color: info.tone === 'bad' ? '#e5484d' : '#e2b93b' }}>
          {info.label}
        </div>
      )}
    </>
  )
}
