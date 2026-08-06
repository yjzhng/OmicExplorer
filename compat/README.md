# Compat harness

Cross-platform visual testing. Captures the app at every configured aspect-ratio
preset (`appConfig.platforms.aspectRatios`) and diffs against committed baselines.

```
compat/
  baselines/<os>/<preset>.png   committed — the "known good" per OS
  screenshots/<os>/<preset>.png generated (git-ignored) — the latest capture
  diffs/<os>/<preset>.png        generated (git-ignored) — highlighted differences
```

## Commands

```bash
npm run compat            # capture + diff vs baselines; exits 1 on drift (>1% pixels)
npm run compat -- --update  # capture + (re)write baselines (accept current as good)
```

Desktop capture uses Electron's `webContents.capturePage()` in a headless "shoot
mode" (`src/main/screenshot.ts`) — no external screenshot tooling.

## Baselines are environment-specific

Font rendering and display scaling differ per OS, so a baseline captured on macOS
won't match a Linux CI runner. **Generate and commit baselines from the same
environment that runs the check** — usually CI. First run in a fresh environment
creates the baselines (and passes); commit them to start gating regressions.

CI runs `npm run compat` per-OS (Linux via `xvfb-run`) and uploads screenshots +
diffs as artifacts — see `.github/workflows/ci.yml`.

## Mobile

`npm run compat:mobile` boots the iOS Simulator / Android emulator (via Capacitor)
and screenshots each device in `appConfig.platforms.devices`. Requires the mobile
project to be set up (`npm run mobile:setup`) plus Xcode / Android SDK.
