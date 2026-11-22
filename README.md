<p align="center">
  <img src="build-resources/icon.png" width="96" alt="OmicExplorer icon">
</p>

<h1 align="center">OmicExplorer</h1>

<p align="center">
  Desktop app for exploring proteomics and other omic data: build an analysis as a workflow of
  steps, then explore linked, interactive plots.
</p>

<p align="center">
  <a href="https://github.com/yjzhng/OmicExplorer/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/yjzhng/OmicExplorer"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

## Features

- **Workflow editor**: chain steps on a canvas or as a form, e.g. Load data → Clean data →
  Compare → plots. Save the whole analysis in one `.omicexplorer` project file.
- **Import**: read your own data, samplesheet and metadata files, or turn one raw export
  (DIA-NN, Spectronaut, MaxQuant or any matrix) into those files with a guided import. Annotations
  (GO, KEGG, Reactome, COG/KOG, MSigDB, STRING) are fetched for you.
- **Clean data**: filter by missing values, impute, normalise to a reference protein, and correct
  batch effects. Subset and Merge steps pick samples or pool datasets.
- **Statistics**:
  - **Compare**: t-tests, or an ANOVA over any number of conditions.
  - **Contrast**: two comparisons side by side.
  - **Curve fit**: dose and time responses, with 4PL curves, a spline detector, the CurveCurator
    score and two-condition response surfaces.
- **Plots**: volcano, MA, scatter, heatmap, PCA / UMAP / t-SNE, enrichment, STRING network,
  dose/time response, 3-D response surfaces, ANOVA variance and interaction, curve potency and
  metrics, sample QC and correlation.
- **Linked exploration**: hover or pin a gene to highlight it in every plot. Search genes and
  pathways, and save gene groups.
- **Results dashboard**: drag and resize tiles, and switch dose, time or any other condition for
  every plot at once.
- **Export**: plots as SVG, PNG or PDF (vector shapes stay editable in Illustrator), tables as CSV
  or XLSX.
- **Local and fast**: a TypeScript engine runs in the app. No Python, server or account is needed,
  and your data never leaves your machine.

## Install

Download the latest installer from
[Releases](https://github.com/yjzhng/OmicExplorer/releases/latest):

| Platform                      | File                                                  |
| ----------------------------- | ----------------------------------------------------- |
| macOS, Apple silicon or Intel | `.dmg`: open it and drag OmicExplorer to Applications |
| Windows                       | `.exe` installer                                      |

Updates install from **Settings → About → Updates**.

The app isn't signed with an Apple Developer ID, so macOS blocks the first launch:

- **macOS 15 or newer**: open the app, then **System Settings → Privacy & Security → Open Anyway**.
- **macOS 14 or older**: right-click the app → **Open** → **Open**.

Or run `xattr -dr com.apple.quarantine /Applications/OmicExplorer.app` once.

### Build from source instead

This needs [git](https://git-scm.com) and [Node.js](https://nodejs.org), and avoids the security
prompt. Run the same command again to update.

```sh
# macOS (installs to /Applications)
git clone https://github.com/yjzhng/OmicExplorer.git ~/OmicExplorer
cd ~/OmicExplorer && ./scripts/install-from-source.sh
```

```powershell
# Windows, in PowerShell (installs for the current user)
git clone https://github.com/yjzhng/OmicExplorer.git $HOME\OmicExplorer
cd $HOME\OmicExplorer; powershell -ExecutionPolicy Bypass -File scripts\install-from-source.ps1
```

## Getting started

1. Put your files in a folder, inside an `input/` subfolder.
2. In the app, choose **＋ New project** and add that folder.
3. Add a **Load data** step and pick your files, or use **Interactive** import on a raw export.
4. Add **Clean data**, then **Compare**, then the plots you want, and press **Run**.

The in-app **User guide** (the book icon in the top bar) covers every step and plot.

## Input data

A project reads three CSV files. Only the data matrix is required.

| File                | Contents                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*_datamatrix.csv`  | Values per feature and sample, either wide (a column per sample) or long (`sample` and `value` columns). Blank, `NA` and `0` mean not measured. Raw or log values both work. |
| `*_samplesheet.csv` | One row per sample: `sample`, plus conditions such as `cell`, `cmpd`, `dose`, `time`, `rep`, or your own.                                                                    |
| `*_metadata.csv`    | One row per protein: `uniqID`, plus an optional `gene` label and annotation columns.                                                                                         |

Protein groups (`Q13547;Q92769-2`), isoforms and FASTA headers are matched to the metadata as
exported. [`templates/`](templates/) has a blank template and a filled example of each file. The
User guide lists every accepted column.

## Development

```sh
npm install
npm run dev          # run the app with hot reload
npm test             # unit tests (Vitest)
npm run lint         # ESLint
npm run typecheck    # TypeScript
npm run package      # build the installer into dist/
```

On macOS you can also double-click `OmicExplorer Dev.app`, which runs `npm run dev`.

- **Code layout**: each step and plot is a module under
  [`src/renderer/src/nodes/`](src/renderer/src/nodes/README.md). The analysis engine is in
  `src/renderer/src/engine/` and runs in a Web Worker.
- **Releases**: pushing a version tag builds the macOS and Windows installers on GitHub Actions
  and attaches them to a release. Notes live in [`releases/`](releases/).
- **App identity**: the name, bundle id and build output all come from `package.json`
  (`name`, `productName`, `appConfig`).

## Contributing

Bug reports and pull requests are welcome. Please open an issue first to discuss larger changes.
In the app, **Help → Copy Diagnostics** copies recent errors with app and system details, ready to
paste into a bug report.

## Built with

[Electron](https://www.electronjs.org) · [React](https://react.dev) ·
[React Flow](https://reactflow.dev) · [Plotly](https://plotly.com/javascript/) ·
[react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) ·
[umap-js](https://github.com/PAIR-code/umap-js) · [PapaParse](https://www.papaparse.com) ·
[Zustand](https://github.com/pmndrs/zustand) · [Vite](https://vitejs.dev)

## License

[MIT](LICENSE)
