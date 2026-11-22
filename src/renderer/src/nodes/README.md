# nodes/ — one folder per kind of step or plot

Every kind (Load data, Clean data, Compare, Volcano, …) lives in its own folder. The shared code
(canvas, settings window, Results page, store, worker) finds a kind's behaviour through the
registries here; it doesn't branch on the kind itself.

```
nodes/
  contract.ts     the node contract (NodeSpec) and the data contracts
  specs.ts        SPECS     — every kind's spec.ts            (graph/registry.ts: NODE_SPECS)
  settings.ts     SETTINGS  — every kind's Settings.tsx       (graph/NodeConfigPanel.tsx)
  views.ts        VIEWS     — every kind's View.tsx           (dashboard/PanelBody.tsx)
  tiles.ts        TILES     — the steps' canvas Tile.tsx      (graph/GraphNode.tsx)
  runs.ts         STEP_RUNS / PLOT_RUNS — run.ts              (graph/store runNode, graph/plotRun.ts)
  runContext.ts   what a run is handed
  kit/            what several kinds share: settings sections and controls, view and table
                  helpers, requirement helpers, the Response plots' variants
  <kind>/
    spec.ts       label, category, input / output data contracts, default config, staleness,
                  requirement, plot facts (legend, axes, quick-access defaults, tile hint …)
    Settings.tsx  its settings panel (exports `Settings`)
    View.tsx      its Results body (exports `<kind>View`, a render function over ViewContext)
    Tile.tsx      a step's canvas summary (exports `tile`)
    run.ts        its run, if it computes something (exports `run`)
    *View.tsx, *Tile.tsx, *Dialog.tsx — its own components
```

## Data contracts

A kind declares the data it takes (`input.accepts`) and gives (`output`), not which kinds it can
follow. An edge is allowed when the source's output is among the target's accepted contracts.

| contract     | what it is                                                                                                                     | produced by                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `import`     | a configured import, not yet cleaned                                                                                           | Load data (a Subset off it) |
| `quantity`   | samples × features with the samples' conditions; each value an abundance, or a fraction of a reference protein (`valueUnitOf`) | Clean data, Merge, Subset   |
| `comparison` | per feature × comparison × context: effect, p, q, call                                                                         | Compare                     |
| `curves`     | a comparison table whose rows are fitted curves                                                                                | Curve fit                   |
| `contrast`   | per feature × context: FC1, FC2, the divergence call                                                                           | Contrast                    |

What the data must ALSO carry (a numeric axis, an ANOVA's terms, annotations, a species) is the
kind's `requirement`: it returns null when met, else the reason — shown on the canvas status dot,
in the plot pickers (unmet entries are hidden) and in the Results tile.

## Adding a kind

1. Add it to `NodeKind` and its config type to `NodeConfigMap` (graph/types.ts).
2. Create `nodes/<kind>/spec.ts` with `defineSpec`, and add it to `SPECS` (nodes/specs.ts).
3. Add its `Settings`, its view, and (for a step) its tile and run to `SETTINGS`, `VIEWS`,
   `TILES`, `STEP_RUNS` — `null` where it has none. Each registry is a `Record<NodeKind, …>`, so
   the type check lists every one you missed.
4. A plot: add it to `ALL_OPS` and a section of `PLOT_SECTIONS` (graph/registry.ts) — the order the
   pickers offer it in. A plot that computes something of its own: `plot.computes` in its spec and
   an entry in `PLOT_RUNS`.
5. New engine computation: a function in engine/, and an entry in the worker's `OPS` table
   (engine/worker.ts) with its request type.

Everything else — wiring, the pickers, the status dot, staleness, save / load, undo, the settings
window's legend switch and Axes and lines section (`plot.legend` / `plot.axes`), export — follows from the spec.

## A plot's settings and text

- **Order — upstream before downstream, whole plot before its parts.** A plot's `Settings`
  returns `<PlotSections statistic general colours genes marks axes />`
  (kit/settings/plotSections.tsx), which lays out every plot's settings in one order:
  1. **Statistic** — what's computed before it's drawn: the upstream step's (written to that
     step), or the plot's own analysis (a PCA's Data, a heatmap's Clustering);
  2. **General** — one section for the whole plot, built by PlotSections from rows: what it shows
     (view, metric, ordering) and its **Label limit** (`general`); how many genes — terms,
     residuals — it draws (`genes`: a `CapRow`, Max genes); the window's **show legend** switch
     (`plot.legend`); and last its colours (palettes, what colours by: `ColourRows` /
     `CategoricalRows`) — plot-wide settings, each too small for a section. A row's explanation is
     its (i) tip (a cap's tip restates its rule for the N chosen), not text under it;
  3. **Points / Lines / Bars** — each group's look;
  4. **Axes and lines** — the window's (`plot.axes`): per axis, then a Whole plot group with the
     plot's own `axes` rows (an axis scale, a 3-D projection, a reference line) and the threshold
     lines of a plot whose spec sets `guides`.
     The order is the component's, so a new plot can't drift from it (architecture.test.ts checks
     every plot uses it). The `general`, `genes` and `colours` slots take rows, not sections.
- **One level per setting.** A setting sits once, at the level it applies to: the whole plot, a
  group, or a group in one state. In a group table (Points), the rows that hold in every state —
  name, colour, in legend — come first; the Plain / Selected / Not selected blocks hold only what
  changes with state (size, opacity, outline, labels).
- **Legend.** One switch, General's "show legend"; a point plot's per-group entries are the "in
  legend" row of its Points table (`plot.legend: 'groups'`).
- **Colours and opacity.** Every colour is a colour square (`ColorChip`); Automatic shows the
  colour it resolves to (`autoColor` — a palette band where it's one per gene / level) with a
  corner mark. Every opacity is the `OpacitySlider` (0–100%, stored 0–1).
- **Controls.** One per job, in ui/: `Section`, `Field`, `NumberInput` (with an `optional` empty
  state), `Checkbox`, `Chevron`, and `ToggleSwitch` / `ChoiceSwitch` / `SwitchBar` for choices; the
  kit re-exports them with the settings-only controls (`Select` at canvas zoom, `CapRow`,
  `QuickToggle`, `SampleOrderField`, …). The architecture test fails on a second copy.
- **Text.** Plot text comes from `PLOT_TEXT` (ui/theme.ts): 13 heading and axis titles, 11 ticks
  and legend, 10 annotations and labels, 9 only for dense row / column labels. The layout font
  (`plotBase`) is the tick size, so Plotly's axis titles come out at 13 on their own.
- **Motion.** Durations and curves come from `MOTION_MS` / `EASE` / `LOOP_MS` (ui/theme.ts; the
  `--motion-*` variables in CSS): press 90, hover / colour 120, small move or fold 160, open 180 /
  close 120, page 320 ms. Write `motion('transform', 'base')`, never a number; one rule in app.css
  makes every animation instant under the system's reduced-motion setting. ui/motion.test.ts fails
  on a hard-coded duration.
- **Long content.** Any list, table or tree whose length grows with the data (genes, matrix rows,
  a column's values, pathways, group members, comparisons, files…) renders through ui/VirtualRows:
  `VirtualList` for a flat list, `VirtualTbody` for a table body (with `ProbeRow` + `longestText`
  to keep auto-sized columns steady), `useVirtualRows` to drive one yourself (a tree flattened to
  its shown rows). Only the rows in view are drawn; every row is reachable by scrolling, so no
  caps, no "+N more — refine search", no "Show more" — a source that pages in loads its next chunk
  from `onEnd`. Lists of 100 or fewer render whole. Keep rows one line (ellipsis, not wrap); they
  are measured as drawn. The architecture test fails on a capped list.

## Rules

- A kind's files import from `kit/`, the engine, `graph/` and `ui/` — not from another kind's
  folder, except where one kind is a variant of another (Curve fit uses Compare's panel and view;
  the interaction plot the variance plot's; tdr the response plot's).
- A view is a render function called inside PanelBody: no hooks. Anything that needs a hook is
  computed in `usePlotContext` (kit/views/context.tsx) and read from the ViewContext.
- Errors: a run's thrown error becomes the node's error and is logged with its node and kind
  (shared/diagnostics.ts); a settings panel or view that throws while rendering is contained by an
  error boundary naming it.
