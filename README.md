# OmicExplorer

Desktop app for exploring omic data — load sample × gene/protein matrices, build
analysis pipelines in a flow-based editor, and explore live interactive
visualizations and multi-condition comparisons. Runs as a macOS desktop app or
from source in the browser.

Features:

- Flow-based pipeline editor ([React Flow](https://reactflow.dev)) — chain
  **Standardize → Compare / Contrast → plots** on a canvas
- Standardization with clean-up (drop genes seen in <n% of samples), vehicle
  normalization, direct comparisons, two-way ANOVA, and correlated contrasts
- Live interactive plots ([Plotly](https://plotly.com/javascript/)) — volcano,
  MA, heatmap, bubble, dumbbell, dose/time-response, cluster (PCA/UMAP/t-SNE),
  and more, with linked hover/selection across every panel
- Reconfigurable results dashboard — drag/resize tiles, shared facet context
  (strain / dose / time), landscape ⇄ portrait per plot
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
**long-format data** table (sample, gene, value), a **samplesheet** describing
each sample's conditions (e.g. strain, compound, dose, time), and a **gene
database** for annotation. Open a `.omicexplorer` project file, or point the app
at a new data folder to start one. An included demo and example project show the
expected layout.

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
