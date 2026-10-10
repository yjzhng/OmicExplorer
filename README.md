# OmicExplorer

Desktop app for exploring omic data — load sample × gene/protein matrices, build
analysis pipelines in a flow-based editor, and explore live interactive
visualizations and multi-condition comparisons. Runs as a macOS desktop app or
from source in the browser.

Features:

- Flow-based pipeline editor ([React Flow](https://reactflow.dev)) — chain
  **Clean data → Compare / Contrast → plots** on a canvas
- Standardization with clean-up (drop genes seen in <n% of samples), vehicle
  normalization, direct comparisons, two-way ANOVA, and correlated contrasts
- Live interactive plots ([Plotly](https://plotly.com/javascript/)) — volcano,
  MA, heatmap, bubble, dumbbell, dose/time-response, cluster (PCA/UMAP/t-SNE),
  and more, with linked hover/selection across every panel
- Reconfigurable results dashboard — drag/resize tiles, shared facet context
  (cell / dose / time), landscape ⇄ portrait per plot
- Export any panel to PNG/PDF and any table to CSV/XLSX
- Pure-TypeScript in-memory engine — no Python or external services at runtime

## Quick start — install the app (macOS)

1. Download the `.dmg` from the [latest release](https://github.com/yjzhng/OmicExplorer/releases/latest) — `arm64` (Apple Silicon).
2. Open it and drag **OmicExplorer** to Applications.
3. **First launch** may be blocked by system security:
   - **macOS 15 (Sequoia) or newer:** double-click OmicExplorer → a "not opened"
     alert appears → open **System Settings → Privacy & Security**, scroll down,
     and click **Open Anyway**.
   - **macOS 14 or older:** **right-click** OmicExplorer → **Open** → **Open** in
     the dialog.
4. After that it opens normally.

> [!TIP]
> Terminal alternative to the Gatekeeper prompt, once installed:
> `xattr -dr com.apple.quarantine /Applications/OmicExplorer.app`

### Load your data

A project is a folder with an `input/` directory holding three CSVs: a
**data** table (wide or long), a **samplesheet** describing each sample's
conditions (e.g. cell line/strain, compound, dose, time), and an optional **gene
database** (DB) for labels and annotation. Open a `.omicexplorer` project file, or
point the app at a new data folder to start one. An included demo and example
project show the expected layout.

The Load tile has two modes. **Manual** reads the three files as described below.
**Interactive** takes one raw export (DIA-NN, Spectronaut, MaxQuant or any
matrix) and writes the three files for you.

#### Data file

The filename stem must end in `_wide` (one row per feature, one column per sample)
or `_long` (one row per feature × sample), e.g. `run1_wide.csv`.

| Column | Format | Needed | What it holds |
| --- | --- | --- | --- |
| first column (any name) | wide | required | Feature ID, e.g. `UniProtID` |
| one column per sample | wide | required | That sample's values; the header is the sample name |
| ID column (any name) | long | required | Feature ID; the first column that isn't `sample` or `value` |
| `sample` (or `position`, `well`) | long | required | Sample name, matching the samplesheet |
| `value` | long | required | The measured value |
| `peptides` | long | optional | Peptide count; read but not used in analysis yet |

- In a long file, `sample`, `position`, `well`, `value` and `peptides` are
  lowercase and case-sensitive.
- Give the ID column the same name as the DB's ID column to pick up labels and
  annotations.
- In a wide file every column after the first is a sample. One the samplesheet
  doesn't list is dropped.
- A blank cell, `NA`, `NaN` and `0` all mean "not measured". Raw or logged values
  both work.
- A protein group is one ID with its proteins `;`-joined (`Q13547;Q92769-2`).

#### Samplesheet

One row per sample. Headers are matched case-insensitively.

| Column | Needed | What it holds |
| --- | --- | --- |
| `sample` | one sample key | Sample name, matching the data file |
| `position` | one sample key | Used as the sample name when there's no `sample` |
| `plate` + `well` | one sample key | Sample name becomes `plate_well` (e.g. `P1_A1`) |
| `well` | one sample key | Used as the sample name when there's no `sample`, `position` or `plate` |
| `cell` | optional | Cell line or strain, text (`strain` is also accepted) |
| `cmpd` | optional | Compound, text |
| `dose` | optional | Dose, a number (`0` is the vehicle) |
| `time` | optional | Time point, a number |
| `rep` | optional | Replicate number; numbered automatically when absent |
| your own (e.g. `medium`) | optional | A custom condition, always categorical |

- Sample keys are checked in the order above. Only samples listed here are kept.
- Units for `dose` and `time` are set on the Load tile.
- Custom condition names start with a lowercase letter, then lowercase letters,
  digits and `_`. Reserved names (`sample`, `value`, `uniqid`, `gene`, `taxon`, …)
  can't be used. A column that differs on every sample (notes, timestamps) is
  ignored.

#### DB file (optional)

One row per protein. Column names are case-sensitive. Cells with several values
separate them with `;`.

| Column | Needed | What it holds |
| --- | --- | --- |
| `uniqID` | required | Stable feature ID; a row without one is skipped |
| ID column (same name as the data's) | required | Accession matched to the data's feature IDs (`Q9ULV3-5` finds `Q9ULV3`) |
| `gene` | optional | Gene name, shown as the feature's label |
| `locus_tag` | optional | The label when `gene` is empty |
| `taxon` | optional | NCBI taxon id; the most common one sets the STRING species |
| `GO_BP`, `GO_MF`, `GO_CC` | optional | GO terms: biological process, molecular function, cellular component |
| `KEGG` | optional | KEGG pathway(s) |
| `KEGG_cat`, `KEGG_grp` | optional | Each pathway's category and group, in the same order as `KEGG` |
| `Reactome` | optional | Reactome level-3 pathway(s) (human) |
| `Reactome_grp`, `Reactome_cat` | optional | Each term's level-2 and top-level pathway, in the same order |
| `COG` | optional | COG orthologous group name(s) (prokaryotes) |
| `COG_cat`, `COG_area` | optional | COG functional category, and the area each sits under |
| `KOG`, `KOG_cat`, `KOG_area` | optional | The same three for KOG (eukaryotes) |
| `MSigDB` | optional | MSigDB hallmark gene set(s) |
| `stringId` | optional | The protein's STRING id, for the STRING network |
| `DEG` | optional | Essentiality from the Database of Essential Genes |
| `CEG_NEG` | optional | Essentiality from the curated human CEG/NEG sets |
| anything else (e.g. `product`) | optional | Carried along as an annotation |

Older column names are still read: `GO` (with the GO aspects), `keggPathway` and
`KG_PW` (→ `KEGG`), `cogCategory` (→ `COG_cat`), `cogArea` (→ `COG_area`),
`reactomePathway` (→ `Reactome`), `msigdbSet` (→ `MSigDB`), `essentiality`
(→ `DEG`), `essentialityCEG` (→ `CEG_NEG`).

## Run from source (developers)

Needs [Node.js](https://nodejs.org) + git.

- **Native window (macOS):** clone the repo and double-click `OmicExplorer.app`
  (a dev launcher that runs `npm run dev`), or `npm run make:launcher` to
  regenerate it.
- **Browser / any OS:** `npm install && npm run dev` → http://localhost:5673

## Build the installer

```sh
npm install          # one-time
npm run package      # → dist/OmicExplorer-<version>-arm64.dmg (+ zip)
npm run package:dir  # unpacked .app only (fast, no installer)
```

Ad-hoc signed (no Apple Developer ID), which is why a downloaded copy shows the
"unidentified developer / Open Anyway" dialog above.

App identity (name, bundle id, build output) is derived entirely from
`package.json` — edit the `name` / `productName` / `appConfig` block there and
every consumer follows.

## Built with

- [React Flow](https://reactflow.dev) — the flow-based pipeline canvas.
- [Plotly](https://plotly.com/javascript/) — interactive scientific charts.
- [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) — the draggable results dashboard.
- [umap-js](https://github.com/PAIR-code/umap-js) — dimensionality reduction for cluster embeddings.
- [PapaParse](https://www.papaparse.com/) — CSV parsing.
- [Zustand](https://github.com/pmndrs/zustand) — state management.
- [React](https://react.dev/) · [Vite](https://vitejs.dev/) · [Electron](https://www.electronjs.org/) + [electron-builder](https://www.electron.build) — UI, build, desktop shell & packaging.
