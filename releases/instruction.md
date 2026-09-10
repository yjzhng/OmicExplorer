Desktop app for exploring omic data — load sample × gene/protein matrices, build analysis pipelines in a flow-based editor, and explore live interactive visualizations and multi-condition comparisons.

## Highlights

- **Flow-based pipeline editor** — chain **Standardize → Compare / Contrast → plots** on a canvas.
- **Analysis engine** — standardization with clean-up (drop genes seen in <n% of samples), vehicle normalization, direct comparisons, two-way ANOVA, and correlated contrasts.
- **Interactive plots** — volcano, MA, heatmap, bubble, dumbbell, dose/time-response, and cluster (PCA/UMAP/t-SNE), with linked hover/selection across every panel.
- **Reconfigurable dashboard** — drag/resize tiles, shared facet context (strain / dose / time), landscape ⇄ portrait per plot.
- **Export** any panel to PNG/PDF and any table to CSV/XLSX.
- Pure-TypeScript in-memory engine — no Python or external services at runtime.

## Install — macOS

1. Download the dmg for your Mac:
   - **Apple Silicon** (M1/M2/M3/M4): **OmicExplorer-{{VERSION}}-arm64.dmg**
   - **Intel**: **OmicExplorer-{{VERSION}}-x64.dmg**
2. Open it and drag **OmicExplorer** to Applications.
3. First launch (ad-hoc signed, not notarized):
   - **macOS 15 (Sequoia) or newer:** double-click OmicExplorer → a "not opened" alert → **System Settings → Privacy & Security** → **Open Anyway**.
   - **macOS 14 or older:** **right-click** OmicExplorer → **Open** → **Open**.

Terminal alternative: `xattr -dr com.apple.quarantine /Applications/OmicExplorer.app`

## Install — Windows

1. Download **OmicExplorer-{{VERSION}}-x64.exe** and run it (installs per-user; no admin needed).
2. First launch may be blocked by Windows security, if so: 
   - **SmartScreen** may warn "Windows protected your PC" → click **More info** → **Run anyway**.
   - Alternatively, if the file itself is blocked: **right-click** the .exe installer → Under **Properties** tab → check **Unblock** at the bottom → **OK** then run.
