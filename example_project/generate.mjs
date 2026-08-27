// Generate a synthetic example dataset in the demo project's 3-file format:
//   example_long.csv       UniProtID,well,value        (tidy long intensities)
//   example_samplesheet.csv well,strain,cmpd,dose,time,rep  (sample metadata)
//   example_DB.csv          uniqID,GeneID,locus_tag,UniProtID,type,gene,product
//
// Design mirrors the demo: 2 strains (WT, mutant) x {two drugs, vehicle} x a dose
// series x a time course x 3 reps. A subset of proteins respond to each drug
// (dose- and time-dependent), some with a strain-dependent interaction, and a
// handful are low-coverage (identified in only a few samples) to exercise the
// Standardize clean-up (minSamplePct) filter.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'input')
mkdirSync(OUT, { recursive: true })

// ── deterministic PRNG (mulberry32) so regenerating gives identical files ──────
let _s = 0x9e3779b9
function rnd() {
  _s |= 0
  _s = (_s + 0x6d2b79f5) | 0
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const uniform = (lo, hi) => lo + (hi - lo) * rnd()
// Box–Muller standard normal.
function gauss() {
  const u = Math.max(1e-9, rnd())
  const v = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

// ── experimental design: strain x cmpd x dose x time ───────────────────────────
// Full enough to exercise every plot type: strain {WT, mutant} for two-way factors
// and Contrast; two drugs {drugA, drugB} vs a DMSO vehicle for veh-norm and
// drug-vs-drug Compare; a 7-point dose series and a 6-point time course (starting
// at an untreated t=0 baseline) so Dose/time-response, Bubble and TDR have real axes.
const STRAINS = ['WT', 'mutant']
const DRUGS = ['drugA', 'drugB']
const VEH = 'DMSO' // vehicle (denominator; always dose 0)
const DOSES = [1.25, 2.5, 5, 10, 20, 40, 80] // drug dose series
const TIMES = [0, 2, 4, 8, 16, 24] // time course (hours); 0 = untreated baseline
const N_REP = 3
const MAX_DOSE = Math.max(...DOSES)
const MAX_TIME = Math.max(...TIMES)

// One sample per (strain, condition, rep). Vehicle appears at every (strain, time)
// so veh-norm can match it against each drug dose. 2 strains x (2 drugs x 7 doses
// + 1 veh) x 6 times x 3 reps = 540 wells, laid out across 96-well plates P1..P6.
const samples = [] // { well, strain, cmpd, dose, time, rep }
for (const strain of STRAINS) {
  for (const time of TIMES) {
    for (const drug of DRUGS) {
      for (const dose of DOSES) {
        for (let r = 1; r <= N_REP; r++) samples.push({ strain, cmpd: drug, dose, time, rep: r })
      }
    }
    for (let r = 1; r <= N_REP; r++) samples.push({ strain, cmpd: VEH, dose: 0, time, rep: r })
  }
}
// Well ids follow a 96-well plate layout (rows A–H × cols 1–12), across as many
// plates as the design needs: P1_A1 … P1_H12, P2_A1 …
const PLATE_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const PLATE_COLS = 12
const PER_PLATE = PLATE_ROWS.length * PLATE_COLS
samples.forEach((s, i) => {
  const plate = Math.floor(i / PER_PLATE) + 1
  const within = i % PER_PLATE
  const row = PLATE_ROWS[Math.floor(within / PLATE_COLS)]
  const col = (within % PLATE_COLS) + 1
  s.well = `P${plate}_${row}${col}`
})

// ── protein universe ───────────────────────────────────────────────────────────
const N_GENES = 400 // proteins seen in the data
const N_DB_EXTRA = 120 // extra organism proteins in the DB but not measured
const N_LOWCOV = 32 // low-coverage proteins (clean-up targets)

// plausible lowercase gene symbols; ~60% of proteins get one, the rest blank
const CONS = 'bcdfghklmnprstv'
const VOW = 'aeiou'
function geneSymbol(n) {
  let s = ''
  for (let i = 0; i < 3; i++) s += pick(CONS.split('')) + pick(VOW.split(''))
  return s.slice(0, 3 + (n % 2)) + (n % 3 === 0 ? String.fromCharCode(65 + (n % 6)) : '')
}
const PRODUCTS = [
  'hypothetical protein',
  'ABC transporter ATP-binding protein',
  'DNA-binding response regulator',
  'ribosomal protein',
  'NADH dehydrogenase subunit',
  'putative oxidoreductase',
  '50S ribosomal protein',
  'cell division protein',
  'transcriptional regulator'
]

// A per-drug response for a gene: direction, magnitude, and an optional
// strain-dependent interaction (the mutant blunts <1 or amplifies >1 the effect).
function drugResponse(forced) {
  return {
    dir: forced ? 1 : rnd() < 0.5 ? 1 : -1, // up- or down-regulated
    effect: forced ? 2.4 : uniform(0.6, 2.6), // |log2 FC| at max dose & time
    inter: forced || rnd() < 0.35, // strain-dependent interaction
    sfac: forced ? 0.35 : rnd() < 0.5 ? 0.2 : 1.8 // mutant blunts (<1) or amplifies (>1)
  }
}

const genes = [] // { …ids, measured, lowcov, base, resp, effects: { drugA?, drugB? } }
for (let i = 1; i <= N_GENES + N_DB_EXTRA; i++) {
  const uniqID = 'g' + String(i).padStart(4, '0')
  const measured = i <= N_GENES
  const lowcov = measured && i > N_GENES - N_LOWCOV // last block of measured genes
  // First 3 measured proteins are forced strong responders (to BOTH drugs) with a
  // strain interaction, so g0001–g0003 make reliable focus genes for GeneBar / TDR /
  // dumbbell testing.
  const forced = i <= 3
  const hasGene = forced || rnd() < 0.6
  const resp = measured && (forced || rnd() < 0.25) // responds to at least one drug
  // Give responders a per-drug effect. Forced genes respond to both; others respond
  // to drugA and/or drugB independently (guaranteed at least one), often with
  // different magnitude/direction so drugA-vs-drugB Compare shows real contrast.
  const effects = {}
  if (resp) {
    let a = forced || rnd() < 0.75
    let b = forced || rnd() < 0.6
    if (!a && !b) (rnd() < 0.5 ? (a = true) : (b = true))
    if (a) effects.drugA = drugResponse(forced)
    if (b) effects.drugB = drugResponse(forced)
  }
  genes.push({
    uniqID,
    geneid: 3900000 + i,
    locus: 'SYN_' + String(i).padStart(5, '0'),
    uniprot: 'P' + String(10000 + i),
    gene: hasGene ? geneSymbol(i) : '',
    product: pick(PRODUCTS),
    measured,
    lowcov,
    base: Math.exp(gauss() * 1.1 + 6.0), // log-normal abundance, ~like demo (50–5000)
    resp,
    effects
  })
}

// ── emit intensities ───────────────────────────────────────────────────────────
// A responder's drug effect grows with dose AND time (linear time ramp from a t=0
// baseline of zero effect), so Dose/time-response, Bubble and TDR all show trends;
// the mutant scales the effect (interaction) so Contrast (WT vs mutant) and two-way
// ANOVA have real signal. drugA and drugB carry independent effects.
function intensity(g, s) {
  let log2v = Math.log2(g.base)
  const e = g.effects[s.cmpd]
  if (e) {
    const doseF = s.dose / MAX_DOSE // 0.0156 → 1 across the dose series
    const timeF = s.time / MAX_TIME // 0 at the t=0 baseline → 1 at the last timepoint
    let eff = e.dir * e.effect * doseF * timeF
    if (s.strain === STRAINS[1] && e.inter) eff *= e.sfac // strain-dependent interaction
    log2v += eff
  }
  log2v += gauss() * 0.15 // ~10% CV replicate noise
  return Math.pow(2, log2v)
}

const dataLines = ['UniProtID,well,value']
for (const g of genes) {
  if (!g.measured) continue
  if (g.lowcov) {
    // identified in only k of the wells → well below typical minSamplePct thresholds
    const k = Math.floor(uniform(3, 11))
    const wells = [...samples].sort(() => rnd() - 0.5).slice(0, k)
    for (const s of wells) dataLines.push(`${g.uniprot},${s.well},${intensity(g, s).toFixed(4)}`)
  } else {
    for (const s of samples) {
      if (rnd() < 0.02) continue // ~2% random dropout, like real proteomics
      dataLines.push(`${g.uniprot},${s.well},${intensity(g, s).toFixed(4)}`)
    }
  }
}

// ── emit samplesheet ───────────────────────────────────────────────────────────
const ssLines = ['well,strain,cmpd,dose,time,rep']
for (const s of samples)
  ssLines.push(`${s.well},${s.strain},${s.cmpd},${s.dose},${s.time},${s.rep}`)

// ── emit DB (organism-wide superset of the measured proteins) ──────────────────
const dbLines = ['uniqID,GeneID,locus_tag,UniProtID,type,gene,product']
for (const g of genes) {
  const product = /,/.test(g.product) ? `"${g.product}"` : g.product
  dbLines.push(
    `${g.uniqID},${g.geneid},${g.locus},${g.uniprot},CDS,${g.gene},${product}`
  )
}

writeFileSync(join(OUT, 'example_long.csv'), dataLines.join('\n') + '\n')
writeFileSync(join(OUT, 'example_samplesheet.csv'), ssLines.join('\n') + '\n')
writeFileSync(join(OUT, 'example_DB.csv'), dbLines.join('\n') + '\n')

console.log('samples:', samples.length, '(strains', STRAINS.length, 'x drugs', DRUGS.length,
  'x doses', DOSES.length, '+veh x times', TIMES.length, 'x reps', N_REP, ')')
console.log('conditions: strain, cmpd, dose, time')
console.log('measured proteins:', genes.filter((g) => g.measured).length)
console.log('low-coverage proteins:', genes.filter((g) => g.lowcov).length)
console.log('responders:', genes.filter((g) => g.resp).length,
  '(drugA', genes.filter((g) => g.effects.drugA).length,
  ', drugB', genes.filter((g) => g.effects.drugB).length, ')')
console.log('forced focus genes: g0001, g0002, g0003')
console.log('data rows:', dataLines.length - 1)
console.log('DB rows:', dbLines.length - 1)
