import { create } from 'zustand'

import { ACCENT_LABELS, DEFAULT_CUSTOM_ACCENT, setAccentInEffect, type AccentId } from './theme'

/** The resolved theme the app actually renders (palettes are keyed by this). */
export type ThemeMode = 'dark' | 'light'
/** What the user picked; `auto` follows the OS `prefers-color-scheme`. */
export type ThemePreference = 'dark' | 'light' | 'auto'

const KEY = 'omicexplorer-theme'
const ACCENT_KEY = 'omicexplorer-accent'
const CUSTOM_KEY = 'omicexplorer-accent-custom'

/** The OS's current colour scheme (defaults to dark if unavailable). */
function systemMode(): ThemeMode {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function initialPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'auto') return v
  } catch {
    /* ignore */
  }
  return 'light' // default
}

function initialAccent(): AccentId {
  try {
    const v = localStorage.getItem(ACCENT_KEY)
    if (v && v in ACCENT_LABELS) return v as AccentId
  } catch {
    /* ignore */
  }
  return 'graphite'
}

function initialCustom(): string {
  try {
    const v = localStorage.getItem(CUSTOM_KEY)
    if (v && /^#[0-9a-f]{6}$/i.test(v)) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_CUSTOM_ACCENT
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

const resolve = (preference: ThemePreference): ThemeMode =>
  preference === 'auto' ? systemMode() : preference

interface UiThemeState {
  /** the user's choice: dark / light / auto */
  preference: ThemePreference
  /** the resolved theme in effect right now */
  mode: ThemeMode
  /** set the preference (the Settings appearance switch, incl. `auto`) */
  setPreference: (preference: ThemePreference) => void
  /** the accent colour (Settings → Appearance); applied through theme.ts's cssVars */
  accent: AccentId
  setAccent: (accent: AccentId) => void
  /** the Custom accent's colour (#rrggbb) — kept when another accent is chosen */
  customAccent: string
  /** pick the Custom accent's colour, and switch to it */
  setCustomAccent: (color: string) => void
}

/** Global theme, persisted to localStorage. `preference` may be `auto`, in which case
 *  `mode` tracks the OS colour scheme (and updates live when it changes). */
export const useUiTheme = create<UiThemeState>((set, get) => {
  // Keep `mode` in sync with the OS while the preference is `auto`.
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (get().preference === 'auto') set({ mode: systemMode() })
    })
  } catch {
    /* matchMedia unavailable — no live OS tracking */
  }

  const preference = initialPreference()
  const accent = initialAccent()
  const customAccent = initialCustom()
  setAccentInEffect(accent, customAccent)
  return {
    preference,
    mode: resolve(preference),
    setPreference: (preference) => {
      persist(KEY, preference)
      set({ preference, mode: resolve(preference) })
    },
    accent,
    setAccent: (accent) => {
      persist(ACCENT_KEY, accent)
      setAccentInEffect(accent, get().customAccent)
      set({ accent })
    },
    customAccent,
    setCustomAccent: (customAccent) => {
      persist(ACCENT_KEY, 'custom')
      persist(CUSTOM_KEY, customAccent)
      setAccentInEffect('custom', customAccent)
      set({ accent: 'custom', customAccent })
    }
  }
})
