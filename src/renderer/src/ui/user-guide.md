<!--
  The in-app User guide. Edit freely; the app reads this file as is (rebuild to ship changes).

  # Title          a page (listed in the guide's side list)
  ## Title         a sub-page (indented in the side list under the page before it)
  ### Heading      a heading within a page
  plain lines      a paragraph (a blank line starts a new one)
  - item           a bullet; indent following lines by 2 spaces to continue it
  **bold**  `code`

  Pictures, each on a line of its own:
    [[layouts]]  [[run-states]]  [[protein-groups]]  [[log-shapes]]  [[gene-selector]]  [[tile]]

  Pictures built from a fenced block:
    ```steps                    one card per line:   Title | text
    ```folder                   one entry per line, 2 spaces per level; a name ending in / is a
                                folder; an optional note after  |
    ```table <kind> <kind> …    a table: the header line, then one line per row, cells split by |.
                                One kind per column (id, sample, cond, label, plain) tints it;
                                add  missing-zero  to grey out blank / 0 / NA cells
    ```levels <Source name>     one level per line:  label | example   (the last is highlighted)

  Comments like this one are not shown.
-->

# Getting started

- Start by creating a workflow of analysis steps, from loading data to creating plots.
- The analysis workflow, the parameters, visualisation and results can all be saved in a single `.omicexplorer` project file.
- You can load and save data to different locations by selecting multiple **data folders** in a project
- You can also create different **workflows** to compare different analysis methods and settings from the same data
- Start one with
  **＋ New project** on the home screen, or reopen one with **Open project…** or from
  **Recent projects**.

```steps
Load data | Your data, samplesheet and DB — or one raw export, set up in the interactive import.
Clean data | One tidy per-sample table: clean-up, optional imputation, display scale.
Compare / Contrast | Treated vs vehicle, two-way ANOVA, or two comparisons side by side.
Plots | Volcano, MA, heatmap, cluster, enrichment, STRING… redrawn from results.
```

**Merge** pools several Clean data steps into one, for analyses across datasets.

### Workflow editor mode

Choose one in **Settings → Appearance**:

[[layouts]]

In **Flowchart**, move between the canvas and the dashboard with **Results →** and **← Workflow**. In
**Form**, interactive dialogs open in a panel on the right.

### Running

The button at the top right runs the whole workflow:

[[run-states]]

Each step also has its own Run. A step's **status dot** is green when it has results, and says why
when it can't run yet.

# Setting up analysis

From files on disk to plots, in order: where to keep the data, the workflow's steps, importing the
data, cleaning it, and setting up the plots.

## Where to save the data

A project points at a **data folder** on disk — add one from the folder chip with
**＋ Add folder…**. Keep your input files in its `input/` subfolder (the root and `data/` are
scanned too). Everything the app writes goes into one folder beside them, named after the project
file, with a subfolder per workflow:

```folder
my_folder/
  input/ | your input files
    mydata_datamatrix.csv | data matrix, wide or long
    mydata_samplesheet.csv | sample → conditions
    mydata_metadata.csv | optional: ID → gene + annotations
  My Study_data/ | named after My Study.omicexplorer
    Workflow 1/ | named after the workflow
      input/ | files made by the interactive import
      output/ | one folder per processing step
        WT vs clpP/ | named after the step: its downloads
```

- Only the data matrix is required; the samplesheet and DB come from the interactive import, or
  your own files (see **Import data**).
- **output/** is described in **Saving results**.
- Renaming the project, a workflow or a step renames its folder **when you next save** — until
  then files keep going to the current folders, and a rename you don't save moves nothing.
- Before a project's first save its files are kept aside; the first save moves them into the data
  folder. **Save project as…** copies the data folder for the new project, so the original keeps
  its own.
- The folder button beside **Run** shows the data folder's files.

## Create a workflow

A project can hold several workflows. The **workflow chip** (⎇) in the top bar switches between
them, and has **＋ New workflow**, rename (pencil) and delete.

### Adding steps

```steps
+ New step | Click it, then click the canvas to place the step.
Pick a category | Data, Processing or Visualisation.
Pick the step | e.g. Clean data, Compare, Volcano.
```

- **Flowchart:** **+ New step** at the bottom of the canvas (Esc cancels), or drag from a step's
  right-hand handle onto empty canvas — the new step comes already wired, and if only one kind of
  step can follow, it's created straight away.
- **Form:** **+ Add step** opens the same picker; the step is wired to the last step that can feed
  it.
- **Wiring:** in Flowchart, drag between handles; select a connection to delete it. In Form, use a
  step's **Input** row. Form steps can be dragged to reorder.
- **Editing:** a step's panel has **Duplicate** and **Delete**. In Flowchart, drag on empty canvas to
  select several steps, then Group, Duplicate or Delete them. **↺ / ↻** in the top bar undo and
  redo.

### Compare and Contrast

- **Compare** → **Configure…**: choose **t-test** or **2-way ANOVA**, and switch on the
  condition(s) to **compare on**; the other conditions set the context each comparison runs in. A
  preview lists every comparison before you **Apply**.
- **Contrast** sets two comparisons side by side — within one dataset, or across two wired inputs
  (dataset A on the y-axis, B on the x-axis) matched on shared conditions.

## Import data

**Load data** has two modes. **Manual** picks the data, samplesheet and DB files from the folder.
**Interactive** takes one raw export (DIA-NN, Spectronaut, MaxQuant or any matrix) — click
**Configure** and it writes the three files for you:

```steps
Columns | Label each column: ID, Name, Sample, Metadata, Filter.
Filtering | Drop rows by a column — decoys, contaminants.
Conditions | Switch conditions on, paint them onto sample names, review the samplesheet.
Metadata | Fetch annotations; preview the DB.
```

- **Columns:** one **ID** and one **Name**; any number of **Sample**, **Metadata** and **Filter**
  columns. A preset labels a tool's export for you. Pick a role, then click a header, drag across
  several (past the edge to scroll), or Shift-click to take every column since the last one.
- **Conditions:** three panels side by side.
  - **Active conditions** — switch on the ones your samples carry: cell, compound, dose, time,
    replicate, or your own with **custom**. Dose and time ask for their unit.
  - **Map conditions** — pick a condition, then click or drag the parts of a sample name that hold
    it; the **Separator** above the names sets how they're split.
  - **Refine & edit** — the resulting samplesheet: rename a value everywhere at once, or type into
    any cell. Tick **Everything is correct** to go on.

### Data file

The intensity / abundance matrix, named e.g. `mydata_datamatrix.csv`. It can be **wide** (one row
per feature, one column per sample) or **long** (one row per feature × sample, with a `sample` and a
`value` column); the app tells them apart from the columns.

```table id sample sample sample sample missing-zero
UniProtIDs | A1 | A2 | B1 | B2
O05154 | 305.15 | 260.60 | 298.4 | 271.9
P99999 | 1024.7 | | 1102.5 | 0
Q13547;Q92769-2 | 88.1 | 91.4 | NA | 85.0
```

Accepted columns:

```table plain plain plain
Column | Needed | What it holds
first column | wide: required | Feature ID as the search engine wrote it, e.g. `UniProtIDs`
one per sample | wide: required | That sample's values; the header is the sample name
ID column (any name) | long: required | Feature ID; the first column that isn't sample or value
sample | long: required | Sample name, matching the samplesheet
value | long: required | The measured value
peptides | long: optional | Peptide count; read but not used in analysis yet
```

- **Names:** in a long file, `sample`, `value` and `peptides` are lowercase and case-sensitive.
  The ID column (e.g. `UniProtIDs`) is matched to the metadata file's `uniqID`.
- **Wide files:** every column after the first is read as a sample. One the samplesheet doesn't
  list is dropped.
- **Missing:** a blank cell, `NA`, `NaN` and `0` all mean "not measured".
- **Raw or logged:** either works — see **Clean data**.
- **IDs as exported:** the IDs can be left as your search engine wrote them — a protein group
  `;`-joined (`Q13547;Q92769-2`, which stays one feature), an isoform (`P06733-2`) or a FASTA
  header (`sp|O14733|MP2K7_HUMAN`) all find their proteins in the metadata file.
- **Decoys:** an ID starting `REV__`, `rev_`, `DECOY_` or `reverse_` is kept and analysed like any
  other, but never gets annotations — not from the metadata file, not from the fetch — so it
  can't borrow the label of the real protein it mirrors.

### Samplesheet

Each sample's conditions, one row per sample, named e.g. `mydata_samplesheet.csv`. Headers are
matched case-insensitively.

```table sample cond cond cond cond
sample | cell | cmpd | dose | rep
A1 | WT | Amk | 10 | 1
A2 | WT | Amk | 10 | 2
B1 | clpP | Amk | 5 | 1
```

Accepted columns:

```table plain plain plain
Column | Needed | What it holds
sample | required | Sample name, matching the data file
cell | optional | Cell line or strain, text (strain is also accepted)
cmpd | optional | Compound, text
dose | optional | Dose, a number (0 is the vehicle)
time | optional | Time point, a number
rep | optional | Replicate number; numbered automatically when absent
your own (e.g. medium) | optional | A custom condition, always categorical
```

- **Samples:** only samples listed here are kept.
- **Units:** set the units for `dose` and `time` on the Load tile.
- **Your own conditions:** any further column (`medium`, `batch`…) becomes a condition like
  `cell`. Names start with a lowercase letter, then lowercase letters, digits and `_`; the
  reserved names (`sample`, `value`, `uniqid`, `gene`, `taxon`…) can't be used.
- A column different on every sample (a note, a timestamp) is left alone.

### ID mapping (DB file)

**Optional.** Named e.g. `mydata_metadata.csv`. Maps feature IDs to a gene label and annotations
— **one row per protein, one accession per `uniqID`**. The data's IDs are matched to `uniqID` on
the canonical accession (`Q9ULV3-5` finds `Q9ULV3`); a protein group finds each member's row.

```table id label label
uniqID | gene | proteinName
Q2G2H5 | dnaA | Chromosomal replication initiator
Q2G2H4 | | Beta sliding clamp
```

Accepted columns (names are case-sensitive):

```table plain plain plain
Column | Needed | What it holds
uniqID | required | One protein's accession, e.g. `P06733`; one row each
gene | optional | Gene name, shown as the feature's label
locus | optional | Systematic gene name (e.g. Rv0001, YAL001C; UniProt's ordered locus name, fetched as **Gene locus**); the label when gene is empty
taxon | optional | NCBI taxon id; the most common one sets the STRING species
GO_BP, GO_MF, GO_CC | optional | GO terms: biological process, molecular function, component
KEGG | optional | KEGG pathway(s)
KEGG_cat, KEGG_grp | optional | Each pathway's category and group, in the same order as KEGG
Reactome | optional | Reactome level-3 pathway(s) (human)
Reactome_grp, Reactome_cat | optional | Each term's level-2 and top-level pathway, same order
COG | optional | COG orthologous group name(s) (prokaryotes)
COG_cat, COG_area | optional | COG functional category, and the area each sits under
KOG, KOG_cat, KOG_area | optional | The same three for KOG (eukaryotes)
MSigDB | optional | MSigDB hallmark gene set(s)
stringId | optional | The protein's STRING id, for the STRING network
DEG | optional | Essentiality from the Database of Essential Genes
anything else (e.g. product) | optional | Carried along as an annotation
```

- **Several values in one cell:** separate them with `;` (`GO` terms, pathways, gene names).
- **Paired columns:** `KEGG_cat` / `KEGG_grp`, `Reactome_grp` / `Reactome_cat` and the `_area`
  columns list one entry per term, in the same order as the column they belong to.
- **Older names:** `GO` (read with the GO aspects), `keggPathway` and `KG_PW` (→ `KEGG`),
  `cogCategory` (→ `COG_cat`), `cogArea` (→ `COG_area`), `reactomePathway` (→ `Reactome`),
  `msigdbSet` (→ `MSigDB`), `essentiality` (→ `DEG`), `locus_tag` (→ `locus`).

[[protein-groups]]

### Annotations

The import's **Metadata** step fetches annotations per protein into the DB, cached on your machine
(**Re-fetch** ignores the cache). They drive enrichment, the gene highlighter's groupings and the
STRING network. Terms are grouped in levels; the last level is what enrichment tests:

```levels KEGG
category | Metabolism
group | Carbohydrate metabolism
pathway | Glycolysis / Gluconeogenesis
```

```levels Reactome
top level | Cell Cycle
level 2 | Cell Cycle Checkpoints
level 3 | G2/M Checkpoints
```

```levels GO
aspect | Biological process
term | DNA repair
```

```levels COG / KOG
area | Information storage and processing
category | Transcription
```

- **KEGG** — `KEGG`, `KEGG_cat`, `KEGG_grp`. **Reactome (human)** — `Reactome`, `Reactome_grp`,
  `Reactome_cat`.
- **GO** — `GO_BP`, `GO_MF`, `GO_CC`. **COG** (prokaryotes) / **KOG** (eukaryotes) — `COG`,
  `COG_cat`, `COG_area`; the same for KOG.
- **MSigDB** — hallmark gene sets. **Essentiality** — `DEG`. **STRING** —
  `stringId`, each protein's STRING id.
- Your own DB can carry these columns too — see **ID mapping (DB file)** for the full list.

## Clean data

### Log-transform

[[log-shapes]]

A histogram of your values appears as soon as Load data points at a file, labelled **normal** or
**non-normal** from its shape. The switch (none / log10 / log2) sets the scale Clean data's table
and CSV show values on, with a second histogram previewing it. It starts at **none**: pick a
log yourself if you want one.

It never changes the analyses: they work on the same values whether your data arrived raw or
logged, and Compare's own "log₂-transform before testing" is applied once, to them.

### Clean-up

Drop genes measured in fewer than a set % of samples — over all samples, or **per** group of
conditions (e.g. per cell), keeping a gene that clears the bar in any one group.

### Imputation

Optionally fill the remaining gaps with low values drawn just below each sample's distribution
(Perseus-style; shift and width adjustable, reproducible).

## Control plots

Plots are steps too, added after the step whose results they draw. Each plot accepts only certain
upstream steps:

```table plain plain plain plain
Plot | Clean data | Compare | Contrast
QC · Correlation · Cluster · Bar | ✓ | |
Heatmap | ✓ | ✓ |
Volcano · MA · Bubble · Dose & Time response | | ✓ |
Enrichment · STRING | | ✓ |
Scatter · Dose/time-response | | ✓ | ✓
Dumbbell | | | ✓
Data table | ✓ | ✓ | ✓
```

- **Plot group:** tick several plots in the picker and choose **Add N visualisations as a group**
  — one tile with one upstream, its plots stacked inside. **Select plots** adds or removes plots
  later.
- **Settings:** a plot step's panel — or the **gear** on its results tile — holds its settings:
  label and gene caps, points and colours, top terms, axes (text, range, ticks, gridlines…).
  Changes apply live.
- **Apply to all** copies a plot's settings to every other plot of that kind, after you confirm.
- **Quick access:** a setting can be shown as a switch bar in the tile itself (e.g. View, Colour),
  to flip without opening the settings.
- **Defaults:** **Settings → Customisation** sets the starting settings for new plots of each kind;
  existing plots are never changed.

# Exploring data

Open the results with **Results →**. Each analysis has its own tab (drag tabs to reorder); its
tiles can be dragged by the header and resized from any edge.

### Conditions

A bar above the tiles has one pill row per condition (cell, dose, time, your own). Every plot in
the analysis follows it, so switching a dose redraws them all.

### Highlighting genes

[[gene-selector]]

- Hover a gene to highlight it in every plot; click a point or a table row to pin it.
- **Highlight genes** at the top centre searches genes and pathways, or picks them by
  **Function**, **Pathway** or **Essentiality**, grouped by source.
- **Gene groups:** **+ New gene group** saves an empty group or the highlighted genes. A group's
  genes change only while it's being edited (the pencil, then **Confirm**). Click a group's name
  to highlight its genes — several groups can be highlighted, each in its own colour on
  volcano / MA / scatter — and again to take them out.
- Per-gene plots (dose-response, bubble, dumbbell…) have an **All / Selected** toggle.

# Saving results

### The project

**Save project** and **Save project as…** are in the top bar; the project chip's dot shows unsaved
changes. There's no autosave — you're asked before closing or opening another project.

### Plots and tables

[[tile]]

- **Copy** puts the plot on the clipboard (PNG or SVG), matching what's on screen.
- **Download** saves plots as SVG / PNG / PDF and tables as CSV / XLSX — offered in the
  workflow's `output/`, in the folder of the processing step the tile belongs to. **Export** writes
  there too, one folder per step.
- Formats and DPI are set in **Settings → Export**.

### Plot data

Nothing is saved behind your back — results live in the project file, and you save what you want:

- A step's results table: **Download** on its Data table tile, or **Export** with Tables ticked.
- **Enrichment** and **STRING** tiles also have an **Export data** button (the file icon, right
  of Download): it saves the plot's data for every facet, not just the one drawn — every tested term,
  or the network's nodes and edges (two files, `…_nodes` and `…_edges`). It's offered in the
  step's `output/` folder as `<group tile>_Enrichment` / `<group tile>_STRING network`, in the
  table format set in **Settings → Export**.
