# Release workflow

The steps for each release, in order. This file is for maintainers. It is not part of any
release's notes: the release build reads only `instruction.md` and `v<version>.md` from this
folder.

## 1. Version

- Set `"version"` in `package.json` to the new release (e.g. `0.3.7`). This is the version the
  app reports, writes into every project it saves (`appVersion`, and `createdWith` for a new
  project), and compares project files against.

## 2. Project file compatibility

Check whether this release changes what a project file holds: a renamed or moved setting, a new
or replaced tile type, a dashboard layout change, a new field older files won't have.

If it does:

- **Add an upgrade step** at the END of `UPGRADES` in `src/renderer/src/graph/upgrades.ts`, with
  `since` set to this release. Every project file is read through that list, so the step brings
  files from any earlier release up to date when they're opened, and Fix on the home page writes
  them back in the new form.
  - Never edit or remove an earlier step: files from before it still need it. Correct a step
    that turns out wrong with a new step after it.
  - Make the step idempotent: files saved before 0.3.5 don't record which app wrote them, so
    every step runs on every file and must leave an already-upgraded one unchanged.
- **If the file's overall layout changed** (something an older app can't read at all), also
  raise `PROJECT_VERSION` in `src/renderer/src/graph/project.ts`.
- **If a computation changed** (a fit, a statistic, a default that alters results), an upgrade
  can't recompute old results. Consider a step that marks the affected steps for re-run, and say
  so under *Behaviour changes* in the notes.

Then check it in the built app:

- A project saved by the previous release shows an amber version tag on the home page, opens
  correctly, and turns grey after **Fix** (its old file kept beside it as
  `<name>.v<old>.omicexplorer.bak`).
- A project saved by this release shows a grey tag and no Fix.

If nothing in the file changed, there's nothing to add. Files saved by the previous release
stay grey.

## 3. Release notes

- Write `releases/v<version>.md`: the main changes only, under *Features*, *Fixes* and
  *Behaviour changes*.
- The release page puts `releases/instruction.md` (intro, install, cite) on top, with
  `{{VERSION}}` filled in, and this version's notes underneath in a collapsed block.
- Citation: a `## Cite this software` section is written once, in the notes of the version that
  first has a citation. Later releases reuse the newest one. Until one exists, the cite section
  is left off.
- Without a `v<version>.md`, the tag still ships, with GitHub's notes generated from the commits.

## 4. Review and commit

- The maintainer reviews every change going into the release (code, upgrade steps, notes)
  and applies the commit themselves. Assistants and contributors prepare changes in the
  working tree. They never commit, tag or push.

## 5. Tag and build

- The maintainer tags `v<version>` on the reviewed commit and pushes the tag.
- `.github/workflows/release.yml` then creates (or updates) the GitHub release from the notes
  and builds and attaches the installers: macOS arm64 + x64 `.dmg`, Windows x64 `.exe`.
- To build an existing tag again, run the *Release build* workflow by hand with that tag.
  The release page is rewritten from the repo's notes each time, so edits made on GitHub are
  overwritten.
