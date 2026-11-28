/**
 * An iWantHue-style categorical palette (after Mathieu Jacomy's iWantHue, médialab Sciences Po):
 * as many colours as a plot needs, each one as distinct as it can be from all before it, inside one
 * aesthetic band — and distinct for colour-blind viewers too.
 *
 * - **Band** — tab10's own: the CIELab lightness range of its ten colours, and the chroma range of
 *   its coloured nine (its grey left out). Colours outside it (near-black, neon, washed-out) are
 *   never picked, so the palette keeps one muted, mid-tone look however long it runs.
 * - **Colour-blind space** — two colours' distance is the SMALLEST of their CIELab distances seen
 *   with normal vision, protanopia, deuteranopia and tritanopia (iWantHue's "colorblind
 *   compromise", taken strictly), so a pair is only far apart if it is far apart for everyone.
 * - **Order** — greedy farthest-point: each next colour is the candidate farthest from every colour
 *   already chosen, less a nudge against hues already used often (purples, which the band has the
 *   most room for, would otherwise keep winning). So the list is already most-distinct-first, and
 *   colour k is the same whatever the total: a category keeps its colour as more are added.
 * - **Starts like tab10** — it opens on tab10's blue, and takes a tab10 colour (its grey left out)
 *   whenever one scores at least 80% of the best new candidate: blue, orange, cyan, … as far as
 *   colour-blind safety allows; tab10's green, pink and purple collide for colour-blind viewers
 *   with ones already taken, so new colours take their place.
 * - **No greys** — generated colours keep a chroma of at least MIN_CHROMA, so none reads as grey.
 *
 * Deterministic: a fixed candidate grid, ties broken by grid order.
 */
import { schemeCategory10 } from 'd3-scale-chromatic'

type Vec3 = [number, number, number]

// Colour-vision-deficiency simulation: Machado, Oliveira & Fernandes (2009), "A Physiologically-
// based Model for Simulation of Color Vision Deficiency", IEEE TVCG 15(6) — the severity 1.0
// matrices of Table 1 on the authors' page
// (https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html), applied to
// linear RGB. Row-major.
const PROTAN = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281, 0.099216],
  [-0.003882, -0.048116, 1.051998]
]
const DEUTAN = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881]
]
const TRITAN = [
  [1.255528, -0.076749, -0.178779],
  [-0.078411, 0.930809, 0.147602],
  [0.004733, 0.691367, 0.3039]
]

// sRGB ↔ linear and linear RGB → CIELab (D50), as d3-color computes them (d3-color/src/lab.js:
// rgb2lrgb, xyz2lab and its D50 matrix and white point), so these Labs match d3.lab's.
const toLinear = (v: number): number => {
  const x = v / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}
const T0 = 4 / 29
const T1 = 6 / 29
const T2 = 3 * T1 * T1
const T3 = T1 * T1 * T1
const xyz2lab = (t: number): number => (t > T3 ? Math.pow(t, 1 / 3) : t / T2 + T0)
function labOfLinear([r, g, b]: Vec3): Vec3 {
  const y = xyz2lab(0.2225045 * r + 0.7168786 * g + 0.0606169 * b)
  const x = xyz2lab((0.4360747 * r + 0.3850649 * g + 0.1430804 * b) / 0.96422)
  const z = xyz2lab((0.0139322 * r + 0.0971045 * g + 0.7141733 * b) / 0.82521)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const simulate = (m: number[][], [r, g, b]: Vec3): Vec3 => [
  clamp01(m[0][0] * r + m[0][1] * g + m[0][2] * b),
  clamp01(m[1][0] * r + m[1][1] * g + m[1][2] * b),
  clamp01(m[2][0] * r + m[2][1] * g + m[2][2] * b)
]
const hexRgb = (h: string): Vec3 => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16)
]
const hex = ([r, g, b]: Vec3): string =>
  '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** A colour as the four visions see it, each in CIELab. */
function visions(rgb: Vec3): Vec3[] {
  const lin: Vec3 = [toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2])]
  return [
    labOfLinear(lin),
    labOfLinear(simulate(PROTAN, lin)),
    labOfLinear(simulate(DEUTAN, lin)),
    labOfLinear(simulate(TRITAN, lin))
  ]
}
const chroma = (lab: Vec3): number => Math.hypot(lab[1], lab[2])

/** tab10's band: [min, max] lightness of its ten colours, [min, max] chroma of its coloured nine. */
export function tab10Band(): { l: [number, number]; c: [number, number] } {
  const labs = schemeCategory10.map((h) => visions(hexRgb(h))[0])
  const coloured = labs.filter((lab) => chroma(lab) > 10) // (its grey left out)
  const ls = labs.map((lab) => lab[0])
  const cs = coloured.map(chroma)
  return { l: [Math.min(...ls), Math.max(...ls)], c: [Math.min(...cs), Math.max(...cs)] }
}

/** sRGB grid steps per channel for the candidates (24³ ≈ 14k, the band keeps a few thousand). */
const GRID = 24

/** The least chroma (CIELab) a generated colour may have. tab10's own floor (its brown, ≈27) let
 *  greyish colours in — sage, dusty pinks — and the colour-blind distance favours them, being far
 *  from every vivid colour for everyone; a category colour should read as a colour. */
const MIN_CHROMA = 40
/** tab10's colours the palette starts from and prefers (its grey left out: no grey category). */
const SEEDS = schemeCategory10.filter((h) => h !== '#7f7f7f')
/** A tab10 colour is taken over a new one whenever it scores at least this share of the best. */
const TAB10_PREFER = 0.8
/** How strongly a hue already used counts against a candidate (see hueScore). */
const HUE_SPREAD = 0.6
/** The hue window (degrees, either side) that counts as "already used". */
const HUE_WINDOW = 30

interface Pool {
  hexes: string[]
  /** per candidate, its four visions' Labs, flat: 12 numbers */
  labs: Float64Array
  /** its hue (degrees, normal vision) */
  hues: Float64Array
  /** the first SEEDS.length candidates are tab10's */
  seeds: number
  /** each candidate's distance to the nearest colour chosen so far */
  near: Float64Array
  /** how many colours chosen so far lie within HUE_WINDOW of each candidate's hue */
  crowd: Float64Array
  chosen: string[]
}
let pool: Pool | null = null

const hueOf = (lab: Vec3): number => ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360

function buildPool(): Pool {
  const band = tab10Band()
  const hexes: string[] = []
  const labs: number[] = []
  const hues: number[] = []
  const add = (h: string, v: Vec3[]): void => {
    hexes.push(h)
    hues.push(hueOf(v[0]))
    for (const lab of v) labs.push(...lab)
  }
  // tab10's colours first (taken as they are, in or out of the band), then the band's grid
  for (const h of SEEDS) add(h, visions(hexRgb(h)))
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++)
      for (let k = 0; k < GRID; k++) {
        const rgb: Vec3 = [i, j, k].map((v) => (v * 255) / (GRID - 1)) as Vec3
        const v = visions(rgb)
        const [l] = v[0]
        const c = chroma(v[0])
        if (l < band.l[0] || l > band.l[1] || c < MIN_CHROMA || c > band.c[1]) continue
        add(hex(rgb), v)
      }
  return {
    hexes,
    labs: Float64Array.from(labs),
    hues: Float64Array.from(hues),
    seeds: SEEDS.length,
    near: new Float64Array(hexes.length).fill(Infinity),
    crowd: new Float64Array(hexes.length),
    chosen: []
  }
}

/** The colour-blind-safe distance between candidates p and q: the smallest of their four
 *  visions' CIELab distances. */
function distance(labs: Float64Array, p: number, q: number): number {
  let d = Infinity
  for (let v = 0; v < 4; v++) {
    const a = p * 12 + v * 3
    const b = q * 12 + v * 3
    const e = Math.hypot(labs[a] - labs[b], labs[a + 1] - labs[b + 1], labs[a + 2] - labs[b + 2])
    if (e < d) d = e
  }
  return d
}

const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** A candidate's score: its distance to the nearest colour chosen, less a share for how crowded
 *  its hue already is (the share of chosen colours within HUE_WINDOW of it) — so purples, which
 *  the band has the most room for, don't keep winning. */
function hueScore(p: Pool, q: number): number {
  const n = p.chosen.length
  return n ? p.near[q] * (1 - (HUE_SPREAD * p.crowd[q]) / n) : p.near[q]
}

/** The palette's first `n` colours (fewer only if the band runs out of candidates). The same
 *  prefix whatever `n`: grown on demand and kept. Starts with tab10's blue; each next colour is
 *  the best-scoring candidate (hueScore) — a tab10 colour instead whenever one scores at least
 *  TAB10_PREFER of it, so the palette opens like tab10 as far as colour-blind safety allows. */
export function iwanthueColors(n: number): string[] {
  const p = (pool ??= buildPool())
  const count = p.hexes.length
  while (p.chosen.length < Math.min(n, count)) {
    let best = 0 // the first: tab10's blue
    if (p.chosen.length > 0) {
      let far = -1
      let seedFar = -1
      let seedBest = -1
      for (let q = 0; q < count; q++) {
        const sc = hueScore(p, q)
        if (sc > far) {
          far = sc
          best = q
        }
        if (q < p.seeds && sc > seedFar) {
          seedFar = sc
          seedBest = q
        }
      }
      if (seedBest >= 0 && seedFar >= TAB10_PREFER * far) best = seedBest
    }
    p.chosen.push(p.hexes[best])
    const h = p.hues[best]
    for (let q = 0; q < count; q++) {
      const d = distance(p.labs, best, q)
      if (d < p.near[q]) p.near[q] = d
      if (hueGap(h, p.hues[q]) < HUE_WINDOW) p.crowd[q]++
    }
  }
  return p.chosen.slice(0, n)
}

/** How many colours the palette list holds as a categorical scheme: past this a plot's colours
 *  cycle, as every scheme's do. (Long past the point where any two still read apart.) */
export const IWANTHUE_LENGTH = 256
