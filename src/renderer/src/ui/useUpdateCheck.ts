import { useCallback, useEffect, useMemo, useState } from 'react'

// Lightweight "is there a newer release?" check: compares the app's bundled version
// (__APP_VERSION__, injected at build time) against the latest GitHub release. No auto-update
// (that needs code signing) — this just surfaces a dot on the settings gear + the About page's
// Updates section. One unauthenticated request per app session, and one per "Check now"; a
// failure (offline, rate-limit, CSP) shows no update, and the Updates section says it failed. Adapted from the sibling UniOme app's useUpdateCheck.
const REPO = 'yjzhng/OmicExplorer'
export const REPO_URL = `https://github.com/${REPO}`
export const RELEASES_URL = `${REPO_URL}/releases`

export interface UpdateInfo {
  current: string
  /** null until the check resolves (or on failure) */
  latest: string | null
  updateAvailable: boolean
  /** the release page to view/download (latest, else the releases list) */
  releaseUrl: string
  /** a check is under way */
  checking: boolean
  /** the last check failed (offline, rate-limited, blocked) */
  failed: boolean
  /** check again now (Settings → About → Updates) */
  check: () => void
}

/** Compare dotted versions numerically ("0.2.0" > "0.1.5"); tolerant of a leading "v". */
function isNewer(a: string, b: string): boolean {
  const pa = a
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  const pb = b
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0
  }
  return false
}

export function useUpdateCheck(): UpdateInfo {
  const current = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
  const [state, setState] = useState<Omit<UpdateInfo, 'current' | 'check'>>({
    latest: null,
    updateAvailable: false,
    releaseUrl: RELEASES_URL,
    checking: true,
    failed: false
  })
  // bumped by check(): each bump runs the request once more
  const [run, setRun] = useState(0)
  useEffect(() => {
    let cancelled = false
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((rel: { tag_name?: string; html_url?: string } | null) => {
        if (cancelled) return
        if (!rel?.tag_name) {
          setState((s) => ({ ...s, checking: false, failed: true }))
          return
        }
        const latest = rel.tag_name.replace(/^v/, '')
        setState({
          latest,
          updateAvailable: isNewer(latest, current),
          releaseUrl: rel.html_url || RELEASES_URL,
          checking: false,
          failed: false
        })
      })
      .catch(() => {
        // offline / rate-limited / blocked → no update shown; the Updates section says so
        if (!cancelled) setState((s) => ({ ...s, checking: false, failed: true }))
      })
    return () => {
      cancelled = true
    }
  }, [current, run])
  // (the first check starts as `checking`; a later one sets it here, as it's asked for)
  const check = useCallback(() => {
    setState((s) => ({ ...s, checking: true }))
    setRun((n) => n + 1)
  }, [])
  return useMemo(() => ({ current, ...state, check }), [current, state, check])
}
