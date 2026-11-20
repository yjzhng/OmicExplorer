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

| contract     | what it is                                             | produced by                 |
| ------------ | ------------------------------------------------------ | --------------------------- |
| `import`     | a configured import, not yet cleaned                   | Load data (a Subset off it) |
| `abundance`  | samples × features with the samples' conditions        | Clean data, Merge, Subset   |
| `comparison` | per feature × comparison × context: effect, p, q, call | Compare                     |
| `curves`     | a comparison table whose rows are fitted curves        | Curve fit                   |
| `contrast`   | per feature × context: FC1, FC2, the divergence call   | Contrast                    |

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
window's Legend and Axes sections (`plot.legend` / `plot.axes`), export — follows from the spec.

## A plot's settings and text

- **Order.** A plot's `Settings` returns `<PlotSections show statistic labels marks colours />`
  (kit/settings/plotSections.tsx): what it shows → the upstream statistic → its labels → its
  points / lines → its colours. The window adds Legend and Axes after them. The order is the
  component's, so a new plot can't drift from it (architecture.test.ts checks every plot uses it).
- **Legend.** One switch, in the Legend section (`plot.legend`); a point plot's per-group entries
  stay in its Points table (`plot.legend: 'groups'`).
- **Label cap.** Every plot that labels genes offers `CapSection` in its `labels` slot.
- **Controls.** One per job, in ui/: `Section`, `Field`, `NumberInput` (with an `optional` empty
  state), `Checkbox`, `Chevron`, and `ToggleSwitch` / `ChoiceSwitch` / `SwitchBar` for choices; the
  kit re-exports them with the settings-only controls (`Select` at canvas zoom, `CapSection`,
  `QuickToggle`, `SampleOrderField`, …). The architecture test fails on a second copy.
- **Text.** Plot text comes from `PLOT_TEXT` (ui/theme.ts): 13 heading and axis titles, 11 ticks
  and legend, 10 annotations and labels, 9 only for dense row / column labels. The layout font
  (`plotBase`) is the tick size, so Plotly's axis titles come out at 13 on their own.
- **Motion.** Durations and curves come from `MOTION_MS` / `EASE` / `LOOP_MS` (ui/theme.ts; the
  `--motion-*` variables in CSS): press 90, hover / colour 120, small move or fold 160, open 180 /
  close 120, page 320 ms. Write `motion('transform', 'base')`, never a number; one rule in app.css
  makes every animation instant under the system's reduced-motion setting. ui/motion.test.ts fails
  on a hard-coded duration.

## Rules

- A kind's files import from `kit/`, the engine, `graph/` and `ui/` — not from another kind's
  folder, except where one kind is a variant of another (Curve fit uses Compare's panel and view;
  the interaction plot the variance plot's; tdr the response plot's).
- A view is a render function called inside PanelBody: no hooks. Anything that needs a hook is
  computed in `usePlotContext` (kit/views/context.tsx) and read from the ViewContext.
- Errors: a run's thrown error becomes the node's error and is logged with its node and kind
  (shared/diagnostics.ts); a settings panel or view that throws while rendering is contained by an
  error boundary naming it.
