# End-to-end regression check

Runs two copies of the app side by side — a reference (e.g. the last release, in its own git
worktree) and the version under test — on the same projects, and compares everything the user sees:

- every node's status, error and note (and every plot subcard's);
- every node's (and subcard's) settings window: its text and every control's state;
- every Results tab: each visible plot's data and layout, each visible table, the page text;
- the canvas tiles' text.

Each copy runs as a **separate instance** — its own user-data folder, dev-server port and DevTools
port — on **copies** of the projects, so it never touches the app you use or your project files.

## Run

```sh
W=<a work folder>                                   # e.g. .worktrees/e2e (git-ignored)
scripts/e2e/setup.sh <repo> $W/base                 # copies of test_examples' SynthData, Degrader, TPP
scripts/e2e/setup.sh <repo> $W/new
scripts/e2e/launch.sh <reference worktree> $W/base 5698 9334 &
scripts/e2e/launch.sh <this worktree>      $W/new  5699 9335 &

cd scripts/e2e
node capture.mjs 9334 $W/base/proj/SynthData/SynthData.omicexplorer $W/base/SynthData.json --extend
node capture.mjs 9335 $W/new/proj/SynthData/SynthData.omicexplorer  $W/new/SynthData.json  --extend
node compare.mjs $W/base/SynthData.json $W/new/SynthData.json
# … the same for TPP and Degrader (without --extend)

# the import path with a metadata fetch (UniProt — network):
node import-test.mjs 9334 $W/base/proj/SynthData/SynthData.omicexplorer $W/base/import.json $W/fetch.json save
node import-test.mjs 9335 $W/new/proj/SynthData/SynthData.omicexplorer  $W/new/import.json  $W/fetch.json use
```

`--extend` adds the tiles the test projects lack to SynthData before running (Subsets, an ANOVA
with its variance / interaction plots, a Merge and a second Clean data, the curve-fit QC and metrics,
and every plot kind standalone), so every node kind is covered.

Run one capture at a time, and don't edit the app's sources while it runs (the dev server would
reload the page mid-capture).

## Reading the comparison

`compare.mjs` prints counts by area, then each difference. Known run-to-run variation (compare a
version with itself to see it): a point plot's label placement and the axis range it pads for the
labels; a settings panel caught while its data preview is still "Working…".
