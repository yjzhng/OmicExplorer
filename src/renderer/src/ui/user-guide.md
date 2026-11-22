<!--
  The in-app User guide. Edit freely; the app reads this file as is (rebuild to ship changes).

  # Title          a page (listed in the guide's side list)
  ## Title         a sub-page (indented in the side list under the page before it)
  ### Heading      a heading within a page
  plain lines      a paragraph (a blank line starts a new one)
  - item           a bullet; indent following lines by 2 spaces to continue it
  **bold**  `code`

  Pictures, each on a line of its own:
    [[layouts]]  [[run-states]]  [[protein-groups]]  [[log-shapes]]

  The app's own buttons, drawn inline as the real element — [[name]] within a line:
    [[home]]  [[save]]  [[save-as]]  [[undo]]  [[redo]]  [[editor-layout]]  [[run]]  [[rerun]]
    [[retry]]  [[stop]]  [[project-folder]]  [[guide]]  [[settings]]  [[new-step]]  [[results]]
    [[copy]]  [[download]]  [[export-data]]  [[tile-settings]]

  Pictures built from a fenced block:
    ```steps                    one card per line:   Title | text
    ```tiles                    workflow steps as the canvas's own tiles, one per line:
                                node kind (load, standardize, compare…) | its description
    ```folder                   one entry per line, 2 spaces per level; a name ending in / is a
                                folder; an optional note after  |
    ```table <kind> <kind> …    a table: the header line, then one line per row, cells split by |.
                                One kind per column (id, sample, cond, label, plain) tints it;
                                add  missing-zero  to grey out blank / 0 / NA cells
    ```levels <Source name>     one level per line:  label | example   (the last is highlighted)

  Comments like this one are not shown.
-->

# Getting started

An analysis is a **workflow** of steps, from loading data to plots. A **project** holds your
workflows, their settings and results in one `.omicexplorer` file.

```tiles
load | Your data files, or one raw export set up in the interactive import.
standardize | Filter, normalise, correct batches, impute.
compare | Treated vs control, or an ANOVA. Or Curve fit for dose and time curves, Contrast for two comparisons side by side.
plotGroup | Volcano, heatmap, cluster, response curves, enrichment, STRING…
```

- Start with **＋ New project** on the home screen, or open a recent one. Double-clicking a
  `.omicexplorer` file opens it in its own window; several projects can be open at once.
- A project can use several **data folders** and hold several **workflows**, for example to compare
  methods on the same data.

### Top bar

From left to right:

- [[home]] Home, then the **project** chip: open, new, or start from a template.
- [[save]] save, [[save-as]] save as project or template, [[undo]] [[redo]] undo and redo.
- The **data folder** and **workflow** (⎇) chips, then [[editor-layout]] the editor layout.
- **Highlight genes**, in the middle.
- [[run]] Run, [[project-folder]] the project folder, [[guide]] this guide, [[settings]] Settings.

### Editor layout

[[layouts]]

Pick one here, in **Settings → Appearance**, or with [[editor-layout]] in the top bar. In
**Flowchart**, switch between the canvas and the results with [[results]] and **← Workflow**.

### Running

[[run-states]]

[[run]] at the top right runs the whole workflow; each step also has its own Run. A step's dot is
green when it has results, grey when it can't run yet (hover it for the reason).

# Setting up analysis

From files on disk to plots, in order: the data folder, the workflow, loading and cleaning the
data, the statistics, then the plots.

## Data folder

Add a folder from the folder chip with **＋ Add folder…**. Put your input files in its `input/`
subfolder. The app writes into one folder beside them, named after the project:

```folder
my_folder/
  input/ | your input files
    mydata_datamatrix.csv | data matrix, wide or long
    mydata_samplesheet.csv | sample → conditions
    mydata_metadata.csv | optional: ID → gene + annotations
  My Study_data/ | named after My Study.omicexplorer
    Workflow 1/ | named after the workflow
      input/ | files made by the interactive import
      output/ | one folder per step: its downloads
```

- Renaming a project, workflow or step renames its folder when you next save.
- Until the first save, files are kept aside; the first save moves them here. **Save as** copies
  the data folder.
- Files the app removes go to the Bin, not deleted.

## Building a workflow

```steps
+ New step | Click it, then click the canvas to place the step.
Pick a category | Data, Processing or Visualisation.
Pick the step | e.g. Clean data, Compare, Volcano.
```

- **Flowchart:** [[new-step]] at the bottom of the canvas, or drag from a step's right-hand
  handle onto empty canvas for a step already wired. Drag between handles to wire; select a link
  to delete it.
- **Form:** **+ Add step** wires the new step to the last one that can feed it. Drag steps to
  reorder; set inputs in a step's **Input** row.
- **Select several:** drag on empty canvas, then Group, Duplicate or Delete. The pencil on a group's
  frame adds or removes members; ✓ applies.
- **Copy and paste:** ⌘C / ⌘V (or right-click → Paste) copies steps, links and groups into any
  workflow, project or window. Pasted steps arrive not run.
- **Undo / redo:** [[undo]] [[redo]] in the top bar.

## Load data

Two modes, set by **Import mode**:

- **Interactive** (default): pick one raw export (DIA-NN, Spectronaut, MaxQuant or any matrix) with
  **Browse…**, then **Configure samples…**. The import writes the data, samplesheet and metadata
  files into the workflow's `input/`.
- **Manual:** pick your own datamatrix, samplesheet and metadata files from the data folder.

### Interactive import

```steps
Columns | Mark the ID, Name, Sample, Metadata and Filter columns. A preset does it for common tools.
Filtering | Drop rows by a Filter column, e.g. decoys or contaminants.
Conditions | Switch conditions on, then map them from the sample names or from a samplesheet.
Metadata | Fetch annotations from UniProt and check the result.
```

- **Columns:** one ID and one Name; any number of the others. Click a header, drag across several,
  or Shift-click a range.
- **Conditions:** switch on cell, cmpd, dose, time, rep, or a **new condition**. Each is categorical
  (**cat**) or numeric (**num**). Numeric ones need a unit.
  - **Sample names:** click the parts of each name that hold a condition.
  - **Samplesheet:** **Load samplesheet…** reads CSV, TSV or Excel in any layout. Rows are matched to
    samples by name; drag an unmatched row onto its sample.
  - **Refine & edit:** rename values or edit cells, then tick **Everything is correct**.
- **Status:** the Load step warns when its raw file changed or went missing. A changed file that
  still fits is converted again automatically.

### Data file

Values per feature and sample. **Wide** (a column per sample) or **long** (one row per feature ×
sample, with `sample` and `value` columns); the app tells which.

```table id sample sample sample sample missing-zero
UniProtIDs | A1 | A2 | B1 | B2
O05154 | 305.15 | 260.60 | 298.4 | 271.9
P99999 | 1024.7 | | 1102.5 | 0
Q13547;Q92769-2 | 88.1 | 91.4 | NA | 85.0
```

- The first column (wide) or the first column that isn't `sample` / `value` (long) is the ID.
- Blank, `NA`, `NaN` and `0` mean not measured. Raw or logged values both work.
- IDs can stay as exported: protein groups (`Q13547;Q92769-2`), isoforms, FASTA headers.
- Decoys (`REV__`, `rev_`, `DECOY_`, `reverse_`) are analysed but never annotated.
- A sample missing from the samplesheet is dropped.

### Samplesheet

One row per sample. Headers are case-insensitive.

```table sample cond cond cond cond
sample | cell | cmpd | dose | rep
A1 | WT | Amk | 10 | 1
A2 | WT | Amk | 10 | 2
B1 | clpP | Amk | 5 | 1
```

```table plain plain
Column | What it holds
sample (required) | Sample name, matching the data file
cell | Cell line or strain (strain also accepted)
cmpd | Compound
dose | Dose, a number (0 is the vehicle)
time | Time point, a number
rep | Replicate; numbered automatically when absent
your own, e.g. medium | A custom condition: categorical, or numeric when switched to num on the Load step
```

- Units for dose, time and numeric custom conditions are set on the Load step.
- Custom names: lowercase letters, digits and `_`, starting with a letter. Reserved names
  (`sample`, `value`, `uniqid`, `gene`, `taxon`…) can't be used.
- A column that differs on every sample (notes, timestamps) is ignored.

### Metadata file

Optional. One row per protein, one accession per `uniqID`. Column names are case-sensitive; separate
several values in a cell with `;`.

```table id label label
uniqID | gene | proteinName
Q2G2H5 | dnaA | Chromosomal replication initiator
Q2G2H4 | | Beta sliding clamp
```

```table plain plain
Column | What it holds
uniqID (required) | One accession, e.g. P06733. Data IDs match it on the canonical accession
gene | Gene name, used as the label
locus | Systematic gene name; the label when gene is empty
proteinName | Protein description
taxon | NCBI taxon id; sets the STRING species
GO_BP, GO_MF, GO_CC | GO terms by aspect
KEGG, KEGG_cat, KEGG_grp | KEGG pathways, with each one's category and group
Reactome, Reactome_grp, Reactome_cat | Reactome pathways (human), with level 2 and top level
COG, COG_cat, COG_area | COG groups (prokaryotes); KOG_… the same for eukaryotes
MSigDB | Hallmark gene sets
stringId | STRING id
DEG | Essentiality (Database of Essential Genes)
anything else | Kept as an annotation
```

Paired columns (`_cat`, `_grp`, `_area`) list one entry per term, in the same order. Older names
(`GO`, `keggPathway`, `KG_PW`, `cogCategory`, `locus_tag`…) are still read.

[[protein-groups]]

### Annotations

The import's **Metadata** step fetches annotations into the metadata file, cached on your machine.
They drive enrichment, gene browsing and the STRING network. Enrichment tests the last level:

```levels KEGG
category | Metabolism
group | Carbohydrate metabolism
pathway | Glycolysis / Gluconeogenesis
```

```levels GO
aspect | Biological process
term | DNA repair
```

## Clean data

Turns the loaded data into one tidy table. Can follow Load data, Subset, Merge or another Clean
data.

### Log-transform

[[log-shapes]]

**none** (default), **log10** or **log2**. Histograms show your values before and after, marked
normal or non-normal. It only sets the scale tables and plots show; analyses give the same result
either way.

### Settings

Each is off until switched on:

- **Clean-up:** drop genes measured in fewer than **Min. coverage** % of samples (50% to start).
  With **Coverage per** a condition, a gene is kept if any one group clears the bar.
- **Normalisation:** **Median** or **Distribution** (Perseus width adjustment), on common or all
  genes. Or **Reference protein**: shift each sample so one chosen protein reads the same
  everywhere.
- **Batch correction:** removes each batch's offset while protecting your conditions. Fill batches
  from a condition or from **Merge inputs**, then adjust them by hand. It refuses a design where
  batches and conditions can't be told apart.
- **Imputation:** fill gaps with low values drawn below each sample's distribution (Perseus;
  **downshift** 1.8, **width** 0.3). Needs clean-up on.

### Table views

The Data table shows **Matrix**, **Long** or **QC**. QC lists each sample's measured, imputed and
missing counts, abundance quartiles and group CV.

## Subset and Merge

- **Subset** keeps chosen values of each condition, chosen replicates, or drops single samples.
  After Load data it filters the import; after Clean data it filters what follows.
- **Merge** pools two or more Clean data steps by uniqID. Add a Clean data after it to
  batch-correct across the inputs.

## Compare

Tests each gene between conditions. **Configure…** opens the setup:

- Switch on the condition(s) to **compare on**; pick the **test** values and the **control**. The
  other conditions are the **context** each comparison runs in.
- **analysis:** **t-test** (each test group against its control) or **ANOVA** (an F-test per
  factor and interaction, over any number of conditions).
- In an ANOVA a numeric condition is a **slope** (a trend over its levels, log or linear) by
  default, or a **factor**.
- With batches, a t-test accounts for them; **per batch** gives one comparison per batch.
- **Preview** lists every comparison before you apply.

### Calling genes

In the **Statistic** section:

- **method:** P-value, or SAM (t-test only).
- **boundary:** a linear cutoff, or a hyperbolic boundary (default) that needs a larger fold change
  at weaker significance.
- **effect size:** the log₂FC cutoff; **asymmetric** sets up and down separately.
- **significance:** a p-value, or a q-value with **FDR control** on (Benjamini–Hochberg or
  Bonferroni).

Drag the cutoff lines on a volcano, MA or scatter plot to change them live.

## Contrast

Puts two comparisons side by side: two groups within one dataset, or two datasets (A on y, B on x)
matched on shared conditions. Fed by Compare, Curve fit or Clean data.

- **correlated** (default): calls genes outside a band around the fitted line (or y = x). Set the
  % outside the band, down to 0.001%.
- **independent:** cuts each axis like a volcano, starting from each Compare's own cutoffs. Leave a
  box empty for no cutoff.
- Drag the band or lines on the scatter to change them.

## Curve fit

Fits each gene's response along a numeric condition (dose, time, temperature…), or over two of them
as a surface.

- **dimensions:** **1D** (a curve along one **axis**) or **2D** (a surface over two numeric
  conditions).
- **method:** **4PL** (default, the CurveCurator method), **Hybrid** (a spline detects responses, a
  4PL describes them) or **custom** (pick the detector and description per axis).
- **baseline:** the control (vehicle), or the axis's first point, e.g. for thermal melts.
- Each axis is log or linear, from the spacing of its levels.
- **Statistic:** CurveCurator's **Relevance score** (default, |log₂FC| ≥ 0.5) or a P-value. Call by
  α or by a target FDR, estimated with decoy curves.
- Results per gene: EC50 / pEC50, slope, plateaus, curve log₂FC, R², p and q.

## Plots

Plots are steps too, added after the step they draw. Each needs certain upstream steps:

```table plain plain plain plain plain
Plot | Clean data | Compare | Curve fit | Contrast
Data table | ✓ | ✓ | ✓ | ✓
QC · Cluster · Correlation · Bar | ✓ | | |
Heatmap | ✓ | ✓ | ✓ |
Volcano · Enrichment · STRING | | ✓ | ✓ |
MA | | t-test | |
Variance · Interaction | | ANOVA | |
Bubble · Dose & Time response | | ✓ | |
Dose / time response | | ✓ | ✓ | ✓
Dose & Time surface (3-D) | | | 2D |
Potency · Curve metrics · curve QC | | | ✓ |
Scatter | | t-test | | ✓
Dumbbell | | | | ✓
```

### What each shows

- **Volcano:** log₂FC vs significance. **MA:** abundance vs log₂FC.
- **Scatter:** the two groups, or the two sides of a Contrast. **Dumbbell:** each gene's change in
  A and B.
- **Heatmap:** abundance or fold change, with optional gene and condition trees.
- **Cluster:** samples by PCA, UMAP or t-SNE. Colour by clusters, or by one or more conditions (each
  combination gets its own colour).
- **QC:** per-sample intensity, CV or protein count. **Correlation:** sample × sample.
  **Bar:** a gene's values across conditions.
- **Bubble:** genes × levels of a numeric condition.
- **Dose / time response:** one plot per numeric condition, in **global**, **detailed** or
  **focused** view. **Dose & Time response:** one per pair of numeric conditions; a surface fit
  draws it in 3-D.
- **Variance:** each factor's share of a gene's variation. **Interaction:** a gene's means across
  two factors.
- **Potency:** pEC50 vs curve fold change. **Curve metrics:** a gene's fit parameters as bars.
  **QC** (after Curve fit): residuals and fit quality.
- **Enrichment:** over-represented terms. **STRING:** the protein network of the top genes.

A plot that can't draw says why on its tile.

### Plot groups

Tick several plots in the picker and choose **Add N visualisations as a group**: one step, one
input, several plots. **Select plots** adds or removes plots later. **Settings → Plot defaults**
sets which plots a new group starts with, per step type.

### Plot settings

Open from the plot step's panel or [[tile-settings]] on its tile. Sections, in order:

- **Statistic:** the upstream Compare or Contrast cutoffs, editable here.
- **General:** what the plot shows, **Label limit**, **Max genes**, **show legend** and palettes.
- **Points**, **Lines** or **Bars:** size, opacity, outline and labels, for plain, selected and
  not-selected points.
- **Axes and lines:** titles, range, ticks, gridlines, frame.

- **Quick access:** the switch beside a setting shows it as a bar on the tile.
- **genes All / Selected** (bubble, dumbbell) and **Landscape / Portrait** are in the tile's
  settings.
- **Apply to all** copies the settings to every plot of that kind, after you confirm.

# Exploring results

Open the results with [[results]]. Each plot group has a tab (drag to reorder, click the active
one to rename). Drag tiles by the header, resize from any edge; **Reset layout** tidies the tab.

### Conditions

The bar above the tiles has a switcher per condition (dose, time, cell, your own). Every plot in the
tab follows it.

### Highlighting genes

- **Hover** a gene to highlight it in every plot; **click** a point or table row to pin it. Click a
  legend entry to pin its whole group.
- **Highlight genes** (top centre) searches genes and pathways, or browses them by **Function**,
  **Pathway** or **Essentiality**.
- **Current selection** is always first; **Save as** keeps it as a gene group.
- **Gene groups:** create, rename, edit or delete. Click groups to highlight them, each in its own
  colour. The mode button cycles **union**, **intersect** and **switch** (one group at a time).

# Saving and exporting

### The project

[[save]] **Save** and [[save-as]] **Save as…** are in the top bar; a dot on the project chip means unsaved
changes. There's no autosave: you're asked before closing.

### Plots and tables

- [[copy]] **Copy** puts the plot on the clipboard as PNG or SVG.
- [[download]] **Download** saves plots as SVG, PNG or PDF and tables as CSV or XLSX, into the step's folder in
  `output/`. Names follow the pattern `tab - plot - view`.
- [[export-data]] **Export data** (Enrichment, STRING) saves every facet's data: all tested terms, or the network's
  nodes and edges.
- Formats, resolution and background are set in **Settings → Export**.

# Settings and help

Open with [[settings]] at the top right.

- **Appearance:** light / dark, accent colour, editor layout, plots per row on the results page.
- **Customisation:** plot font and palettes.
- **Plot defaults:** the plots a new plot step starts with, their order on the results page, and
  each plot kind's starting settings.
- **Export:** clipboard and download formats, resolution, background, table format.
- **Database:** the annotation cache.
- **About:** **Check now** for updates; **Update now** installs on the next restart.

**File → New Window** (⌘N) opens another window. **Help → Copy Diagnostics** copies recent errors
with app and system details for a bug report; **Help → Show Log File** opens the log.
