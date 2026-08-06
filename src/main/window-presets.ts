/**
 * Window presets — DERIVED from package.json (`appConfig.platforms.aspectRatios`),
 * the single source of truth for platforms.
 *
 * A preset in config is minimal — `{ label, width, height }` — and the framework
 * derives the rest: aspect ratio (width / height), minimum size (half, unless
 * overridden), and aspect-ratio locking (OFF unless a preset opts in with `lock: true`,
 * so the window resizes freely). Add or edit shapes in package.json and the Platform
 * menu + window opener pick them up automatically.
 */
import pkg from '../../package.json'

/** A fully resolved preset (all fields present; derived values filled in). */
export interface WindowPreset {
  label: string
  width: number
  height: number
  minWidth: number
  minHeight: number
  lock: boolean
  /** Derived: width / height. */
  aspectRatio: number
}

interface RawPreset {
  label: string
  width: number
  height: number
  minWidth?: number
  minHeight?: number
  lock?: boolean
}

const rawPresets = pkg.appConfig.platforms.aspectRatios as Record<string, RawPreset>

export const WINDOW_PRESETS: Record<string, WindowPreset> = Object.fromEntries(
  Object.entries(rawPresets).map(([name, p]) => [
    name,
    {
      label: p.label,
      width: p.width,
      height: p.height,
      minWidth: p.minWidth ?? Math.round(p.width / 2),
      minHeight: p.minHeight ?? Math.round(p.height / 2),
      lock: p.lock ?? false,
      aspectRatio: p.width / p.height
    }
  ])
)

// Config-driven, so preset names aren't a compile-time union — validate at runtime.
export type WindowPresetName = string

export function assertPreset(name: string): WindowPresetName {
  if (!(name in WINDOW_PRESETS)) {
    throw new Error(
      `Unknown window preset "${name}". Defined in package.json: ${Object.keys(WINDOW_PRESETS).join(', ')}`
    )
  }
  return name
}
