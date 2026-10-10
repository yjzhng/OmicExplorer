/** Canvas frames (Group on the canvas) can nest: a frame's members are tiles and/or other frames.
 *  Grouping frames keeps them whole inside the new one; ungrouping a frame hands its members back
 *  to wherever it sat. Every item (tile or frame) has at most one parent frame. Only tiles are
 *  ever selected: a frame counts as selected when all of its tiles are. Pure functions over the
 *  frame list. */
import type { CanvasFrame } from './types'

/** item id → the frame directly holding it */
export function parentMap(frames: CanvasFrame[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const f of frames) for (const id of f.members) m.set(id, f.id)
  return m
}

/** Every tile inside a frame, through any nested frames. */
export function frameTiles(frames: CanvasFrame[], frameId: string): string[] {
  const byId = new Map(frames.map((f) => [f.id, f]))
  const out: string[] = []
  const walk = (id: string, seen: Set<string>): void => {
    const f = byId.get(id)
    if (!f || seen.has(id)) return
    seen.add(id)
    for (const m of f.members) {
      if (byId.has(m)) walk(m, seen)
      else out.push(m)
    }
  }
  walk(frameId, new Set())
  return out
}

/** How deep each frame sits (0 = not inside another frame). */
export function frameDepths(frames: CanvasFrame[]): Map<string, number> {
  const parent = parentMap(frames)
  const depth = new Map<string, number>()
  for (const f of frames) {
    let d = 0
    for (let p = parent.get(f.id); p && d < frames.length; p = parent.get(p)) d++
    depth.set(f.id, d)
  }
  return depth
}

/** Drop frames left with no members, repeatedly (emptying one can empty its parent). */
function pruneEmpty(frames: CanvasFrame[]): CanvasFrame[] {
  let cur = frames
  for (;;) {
    const empty = new Set(cur.filter((f) => f.members.length === 0).map((f) => f.id))
    if (!empty.size) return cur
    cur = cur
      .filter((f) => !empty.has(f.id))
      .map((f) => ({ ...f, members: f.members.filter((m) => !empty.has(m)) }))
  }
}

/** Group the selected tiles into a new frame. A frame whose tiles are all selected counts as
 *  selected and goes in whole; its members are the TOP-LEVEL selected items, so a tile inside a
 *  selected frame comes along with that frame rather than being pulled out of it. Each member
 *  leaves the frame it was in. */
export function groupInto(
  frames: CanvasFrame[],
  selected: string[],
  isItem: (id: string) => boolean,
  frame: { id: string; label: string }
): CanvasFrame[] {
  const sel = new Set(selected.filter(isItem))
  // A frame all of whose members are selected counts as selected itself (through nesting).
  for (let grew = true; grew;) {
    grew = false
    for (const f of frames)
      if (!sel.has(f.id) && f.members.length && f.members.every((m) => sel.has(m))) {
        sel.add(f.id)
        grew = true
      }
  }
  const parent = parentMap(frames)
  const insideSelected = (id: string): boolean => {
    for (let p = parent.get(id); p; p = parent.get(p)) if (sel.has(p)) return true
    return false
  }
  const members = [...sel].filter((id) => !insideSelected(id))
  if (!members.length) return frames
  const moving = new Set(members)
  const rest = frames.map((f) => ({ ...f, members: f.members.filter((m) => !moving.has(m)) }))
  return pruneEmpty([...rest, { id: frame.id, label: frame.label, members }])
}

/** The outermost frame holding an item (through nesting), or undefined when it's in none. */
export function outermostFrame(frames: CanvasFrame[], id: string): string | undefined {
  const parent = parentMap(frames)
  let top: string | undefined
  for (let p = parent.get(id), n = 0; p && n <= frames.length; p = parent.get(p), n++) top = p
  return top
}

/** Frames all of whose tiles are selected (through nesting) — selection is kept on tiles only, and
 *  a frame counts as selected when every tile in it is. */
export function fullFrames(
  frames: CanvasFrame[],
  isSelected: (id: string) => boolean
): Set<string> {
  const out = new Set<string>()
  for (const f of frames) {
    const tiles = frameTiles(frames, f.id)
    if (tiles.length && tiles.every(isSelected)) out.add(f.id)
  }
  return out
}

/** Of the fully selected frames, those not inside another fully selected one: what reads as the
 *  selected groups. */
export function topFullFrames(
  frames: CanvasFrame[],
  isSelected: (id: string) => boolean
): string[] {
  const full = fullFrames(frames, isSelected)
  const parent = parentMap(frames)
  return [...full].filter((id) => !full.has(parent.get(id) ?? ''))
}

/** Whether a tile sits in some fully selected frame — it then reads as part of that selected group
 *  rather than as selected on its own. */
export function inFullFrame(
  frames: CanvasFrame[],
  id: string,
  isSelected: (id: string) => boolean
): boolean {
  const parent = parentMap(frames)
  for (let p = parent.get(id), n = 0; p && n <= frames.length; p = parent.get(p), n++)
    if (frameTiles(frames, p).every(isSelected)) return true
  return false
}

/** Ungroup the selected tiles: dissolve the outermost fully selected frames, handing each one's
 *  members to its own parent frame (or to no frame); with no whole frame selected, the frame
 *  directly holding each selected tile. */
export function ungroupFrom(frames: CanvasFrame[], tiles: string[]): CanvasFrame[] {
  const sel = new Set(tiles)
  const parent = parentMap(frames)
  const top = topFullFrames(frames, (id) => sel.has(id))
  const dissolve = new Set(
    top.length ? top : tiles.map((id) => parent.get(id)).filter((p): p is string => !!p)
  )
  if (!dissolve.size) return frames
  const byId = new Map(frames.map((f) => [f.id, f]))
  // A dissolved frame's members, resolved through any dissolved frames inside it.
  const expand = (id: string): string[] =>
    dissolve.has(id) ? byId.get(id)!.members.flatMap(expand) : [id]
  return pruneEmpty(
    frames
      .filter((f) => !dissolve.has(f.id))
      .map((f) => ({ ...f, members: f.members.flatMap(expand) }))
  )
}

/** Take deleted tiles out of their frames (and any frame left empty with them). */
export function withoutTiles(frames: CanvasFrame[], gone: Set<string>): CanvasFrame[] {
  return pruneEmpty(frames.map((f) => ({ ...f, members: f.members.filter((m) => !gone.has(m)) })))
}
