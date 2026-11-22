Desktop app for exploring proteomics and other omic data: build an analysis as a workflow of steps, then explore linked, interactive plots.

<details>
<summary><b>Highlights</b></summary>

- **Workflow editor**: chain Load data → Clean data → Compare → plots on a canvas or as a form, saved in one project file.
- **Import**: your own data, samplesheet and metadata files, or one raw export (DIA-NN, Spectronaut, MaxQuant or any matrix) set up in a guided import, with annotations fetched for you.
- **Clean data**: missing-value filter, imputation, reference-protein normalisation and batch correction.
- **Statistics**: t-tests or an ANOVA over any conditions, two comparisons side by side, and dose / time curve fits (4PL, spline detector, CurveCurator score, two-condition surfaces).
- **Plots**: volcano, MA, scatter, heatmap, PCA / UMAP / t-SNE, enrichment, STRING, dose/time response, 3-D surfaces, ANOVA variance and interaction, potency, QC and correlation, with linked hover and selection across every plot.
- **Export**: plots as SVG / PNG / PDF, tables as CSV / XLSX.
- Runs locally: no Python, server or account.

</details>

<details>
<summary><b>Install — macOS</b></summary>

1. Download the dmg for your Mac:
   - **Apple Silicon** (M1/M2/M3/M4): **OmicExplorer-{{VERSION}}-arm64.dmg**
   - **Intel**: **OmicExplorer-{{VERSION}}-x64.dmg**
2. Open it and drag **OmicExplorer** to Applications.
3. First launch (ad-hoc signed, not notarized):
   - **macOS 15 (Sequoia) or newer:** double-click OmicExplorer → a "not opened" alert → **System Settings → Privacy & Security** → **Open Anyway**.
   - **macOS 14 or older:** **right-click** OmicExplorer → **Open** → **Open**.

Terminal alternative: `xattr -dr com.apple.quarantine /Applications/OmicExplorer.app`

Later versions install from the app: **Settings → About → Updates → Update now** (with OmicExplorer in Applications).

</details>

<details>
<summary><b>Install — Windows</b></summary>

1. Download **OmicExplorer-{{VERSION}}-x64.exe** and run it (installs per-user; no admin needed).
2. First launch may be blocked by Windows security, if so: 
   - **SmartScreen** may warn "Windows protected your PC" → click **More info** → **Run anyway**.
   - Alternatively, if the file itself is blocked: **right-click** the .exe installer → Under **Properties** tab → check **Unblock** at the bottom → **OK** then run.

Later versions install from the app: **Settings → About → Updates → Update now**.

</details>

<details>
<summary><b>Build directly (no security block)</b></summary>

Requirement: git, Node.js.

Don't have them? Install once, then open a new terminal (check with `git --version` and
`node --version`):

- **macOS**: install [Homebrew](https://brew.sh) (includes git):

  ```sh
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ```

  Follow its instructions to complete the install, then install Node.js:

  ```sh
  brew install node
  ```

- **Windows** (PowerShell):

  ```powershell
  winget install Git.Git
  winget install OpenJS.NodeJS.LTS
  ```

  Or download the installers from [git-scm.com](https://git-scm.com) and [nodejs.org](https://nodejs.org).

**macOS** (installs to /Applications):

```sh
git clone https://github.com/yjzhng/OmicExplorer.git ~/OmicExplorer
cd ~/OmicExplorer
./scripts/install-from-source.sh
```

**Windows** (in PowerShell; installs per user, with a Start menu shortcut):

```powershell
git clone https://github.com/yjzhng/OmicExplorer.git $HOME\OmicExplorer
cd $HOME\OmicExplorer
powershell -ExecutionPolicy Bypass -File scripts\install-from-source.ps1
```

**Update**

The install script pulls the latest version and rebuilds. Run it again:

**macOS**:

```sh
cd ~/OmicExplorer
./scripts/install-from-source.sh
```

**Windows** (PowerShell):

```powershell
cd $HOME\OmicExplorer
powershell -ExecutionPolicy Bypass -File scripts\install-from-source.ps1
```

</details>

## Cite this software

If OmicExplorer helps your work, please cite:

```text
{{CITATION}}
```

DOI: {{DOI}}
