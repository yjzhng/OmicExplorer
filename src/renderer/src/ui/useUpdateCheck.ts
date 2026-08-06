import { useEffect, useState } from 'react'

// Lightweight "is there a newer release?" check: compares the app's bundled version
// (__APP_VERSION__, injected at build time) against the latest GitHub release. No auto-update
// (that needs code signing) — this just surfaces a dot on the settings gear + a download link in
// the About section. One unauthenticated request per app session; failures (offline, rate-limit,
// CSP) are ignored silently. Adapted from the sibling UniOme app's useUpdateCheck.
const REPO = 'yjzhng/OmicExplorer'
export const RELEASES_URL = `https://github.com/${REPO}/releases`

export interface UpdateInfo {
  current: string
  /** null until the check resolves (or on failure) */
  latest: string | null
  updateAvailable: boolean
  /** the release page to view/download (latest, else the releases list) */
  releaseUrl: string
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
  const [info, setInfo] = useState<UpdateInfo>({
    current,
    latest: null,
    updateAvailable: false,
    releaseUrl: RELEASES_URL
  })
  useEffect(() => {
    let cancelled = false
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((rel: { tag_name?: string; html_url?: string } | null) => {
        if (cancelled || !rel?.tag_name) return
        const latest = rel.tag_name.replace(/^v/, '')
        setInfo({
          current,
          latest,
          updateAvailable: isNewer(latest, current),
          releaseUrl: rel.html_url || RELEASES_URL
        })
      })
      .catch(() => {
        /* offline / rate-limited / blocked → no update shown */
      })
    return () => {
      cancelled = true
    }
  }, [current])
  return info
}
