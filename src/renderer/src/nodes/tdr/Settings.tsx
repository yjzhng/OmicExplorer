import { type ReactNode } from 'react'
import type { TdrConfig } from '../../graph/config/response'
import { ResponsePanel } from '../response/Settings'
import { type PlotSettingsProps } from '../settings'

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <ResponsePanel config={config as TdrConfig} measured {...props} />
}
