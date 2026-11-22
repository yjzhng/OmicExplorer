/**
 * Whether this install has been offered the tutorial yet — the offer is for new users only.
 *
 * A new user is told apart by what the app has stored before: anything under an `omicexplorer…`
 * localStorage key (recent projects, settings, the theme, the last view) means the app has been
 * used here before this check existed, so the offer is marked as made and never shown. Nothing
 * stored at all is a first launch. Either way the answer is stored, so it's decided once.
 *
 * Read when this module is first imported — main.tsx imports it before anything else, so no other
 * module has stored anything for this launch yet.
 */
const KEY = 'omicexplorer-tutorial'

interface Stored {
  /** the offer was made (taken, skipped) — or this is an existing user's install */
  offered: boolean
}

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Stored>
    return { offered: v.offered === true }
  } catch {
    return null
  }
}

function write(s: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: the answer lasts this session */
  }
}

/** Anything the app stored before, other than this flag. */
function usedBefore(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k !== KEY && k.startsWith('omicexplorer')) return true
    }
  } catch {
    /* unreadable: treat as used, so nobody is offered it by mistake */
    return true
  }
  return false
}

const initial: Stored = read() ?? { offered: usedBefore() }
write(initial)

/** The offer was made on this install (or it predates the tutorial). */
export const tutorialOffered = (): boolean => initial.offered

/** Record that the offer was made, whatever the answer. */
export function markTutorialOffered(): void {
  initial.offered = true
  write(initial)
}
