/** The Results grid's column pitch, px (a column's width and the gap after it), for what's inside
 *  a tile: a plot that lays itself out from its tile's width can step with the grid — recomputing
 *  only as the tile's width passes a column, as it will snap to — rather than at every pixel of a
 *  resize drag. 0 outside the grid (not yet measured, or a plot drawn elsewhere). */
import { createContext } from 'react'

export const GridPitchContext = createContext(0)
