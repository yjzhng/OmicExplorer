import { create } from 'zustand'

/** The resolved theme the app actually renders (palettes are keyed by this). */
export type ThemeMode = 'dark' | 'light'
/** What the user picked; `auto` follows the OS `prefers-color-scheme`. */
export type ThemePreference = 'dark' | 'light' | 'auto'

const KEY = 'omicexplorer-theme'

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
  return 'auto' // default: follow the OS colour scheme
}

function persist(preference: ThemePreference): void {
  try {
    localStorage.setItem(KEY, preference)
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
  return {
    preference,
    mode: resolve(preference),
    setPreference: (preference) => {
      persist(preference)
      set({ preference, mode: resolve(preference) })
    }
  }
})
