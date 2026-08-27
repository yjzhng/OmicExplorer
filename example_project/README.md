# Example project (synthetic test data)

A small, self-contained dataset for trying out OmicExplorer, in the same 3-file
format as a real project. All values are synthetic (generated, not measured).

## Files (`input/`)

| File | Columns | Role |
|------|---------|------|
| `example_long.csv` | `UniProtID,well,value` | tidy long-format intensities (stem ends `_long`) |
| `example_samplesheet.csv` | `well,strain,cmpd,dose,time,rep` | sample metadata, keyed by `well` |
| `example_DB.csv` | `uniqID,GeneID,locus_tag,UniProtID,type,gene,product` | ID map (`UniProtID` → `uniqID`) + gene labels |

## Design

Four conditions so **every plot type** has real data:
strain {`WT`, `mutant`} × cmpd {`drugA`, `drugB`, `DMSO` vehicle} × dose {1.25, 2.5, 5,
10, 20, 40, 80} (vehicle at 0) × time {0, 2, 4, 8, 16, 24 h}, 3 replicates =
**540 samples** (laid out across six 96-well plates, `P1_A1`…`P6_E12`). 400 proteins,
of which:

- ~110 respond to `drugA` and/or `drugB`, dose- **and** time-dependently (with a `t=0`
  untreated baseline of no effect), some with a strain-dependent interaction — so
  Dose/time-response, Bubble, TDR, two-way ANOVA, Contrast (WT vs mutant) and drug-vs-drug
  Compare all show real signal. Each drug carries its own per-gene effect, so `drugA` and
  `drugB` differ.
- `g0001`–`g0003` are forced strong responders (to **both** drugs) — reliable **focus
  genes** for GeneBar / TDR / Dumbbell (already set as the Standardize GOI in
  `example.omicexplorer`).
- **32 are low-coverage** (identified in only 3–10 of the 540 samples) — use these to try
  the Standardize **Clean-up** option (*Min. samples %*): e.g. 50% drops them.

### Plot coverage

| Upstream | Plots |
|----------|-------|
| Standardize | Heatmap, GeneBar, Cluster (PCA) |
| Compare (veh-norm `drugA`\|`DMSO`, or `drugA`\|`drugB`) | Volcano, MA, Dose-response, Bubble, TDR |
| Contrast (`WT` vs `mutant`) | Scatter (FC1 vs FC2), Dumbbell |

Dose/time-response and Bubble can switch their axis between **dose** and **time**;
faceting tabs partition by the other conditions (strain / time / dose).

## Using it

Open the ready-made **`example.omicexplorer`** (in this folder) — it wires Load →
Standardize → Compare/Contrast → one of **every** plot type (see the table below). Just
hit **Run**. (The project stores an absolute path to this folder; if you moved the repo,
the folder chip shows *not found* — click it to re-select.)

Or from scratch: New project → point the folder at `example_project/` → add a **Load**
step and select the three files → **Standardize** → build plot steps downstream.

Regenerate with `node example_project/generate.mjs` (deterministic; same seed → same files).
