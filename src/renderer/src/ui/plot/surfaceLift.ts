/**
 * A surface's grid, moved a hair toward the camera — where the lines drawn ON the surface go.
 *
 * WebGL depth-tests a line against the surface it lies on: at equal depth the two tie, so a line
 * exactly on the surface shows in broken, zig-zagging pieces, and one along the surface's edge can
 * vanish. Moved a sliver along the line of sight, the line is always just in front — and, moved
 * straight at the camera, it stays exactly where it was on screen (orthographic; within a hair in
 * perspective): no gap, no shift off the surface's edge.
 */

/** A scene axis as Plotly draws it: its range in axis units (log10 of the data on a log axis). */
export interface SceneAxis {
  range: [number, number]
  log: boolean
}

/** How far a line is moved, in Plotly's scene units (the box's sides are its aspect ratio). */
export const LIFT = 0.006

/** Every vertex of the surface `z` (rows along `y`, columns along `x`) moved `eps` scene units
 *  along `toward` (the camera's eye less its centre, in scene units). The scene: each axis's range
 *  and the aspect ratio (the box's side along it). Missing values stay missing. */
export function liftGrid(
  x: number[],
  y: number[],
  z: Array<Array<number | null>>,
  scene: { axes: [SceneAxis, SceneAxis, SceneAxis]; aspect: [number, number, number] },
  toward: [number, number, number],
  eps = LIFT
): { x: number[][]; y: number[][]; z: Array<Array<number | null>> } {
  const len = Math.hypot(...toward) || 1
  // per axis, the move in data terms: scene units → axis units → data
  const shift = scene.axes.map((a, i) => {
    const span = a.range[1] - a.range[0]
    const d = ((eps * toward[i]) / len / (scene.aspect[i] || 1)) * span
    return (v: number): number => (a.log ? 10 ** (Math.log10(v) + d) : v + d)
  })
  const ox: number[][] = []
  const oy: number[][] = []
  const oz: Array<Array<number | null>> = []
  for (let i = 0; i < y.length; i++) {
    ox.push(x.map((v, j) => (z[i]?.[j] == null ? v : shift[0](v))))
    oy.push(x.map((_, j) => (z[i]?.[j] == null ? y[i] : shift[1](y[i]))))
    oz.push(
      x.map((_, j) => {
        const v = z[i]?.[j]
        return v == null ? null : shift[2](v)
      })
    )
  }
  return { x: ox, y: oy, z: oz }
}
