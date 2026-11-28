import { type ReactNode } from 'react'
import type { CompareConfig } from '../../graph/config/compare'
import { ComparePanel } from '../compare/Settings'
import { type StepSettingsProps } from '../settings'

/** Its settings panel (nodes/settings.ts). */
export function Settings({ id, config }: StepSettingsProps): ReactNode {
  return <ComparePanel id={id} config={config as CompareConfig} curve />
}
