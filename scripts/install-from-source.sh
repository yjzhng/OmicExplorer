#!/bin/bash
# Build the app from this clone and install it — no Gatekeeper prompt, since nothing is downloaded
# through a browser (no quarantine flag). Run again to update: pulls, rebuilds, replaces.
#   ./scripts/install-from-source.sh
# Needs git and Node.js. macOS: installs into /Applications (or ~/Applications if that isn't
# writable). Linux: leaves the unpacked app in dist/linux-unpacked.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)" # repo root (scripts/… → ..)

command -v node >/dev/null || { echo "Needs Node.js — https://nodejs.org" >&2; exit 1; }

# Update the clone first, unless it has local changes (then build what's there).
if git diff --quiet && git diff --cached --quiet; then
  git pull --ff-only
else
  echo "Local changes in the clone: skipping git pull, building as is."
fi

npm ci
npm run package:dir

NAME="$(node -p "require('./package.json').productName")"

if [ "$(uname)" != "Darwin" ]; then
  echo "Built: $(pwd)/dist/linux-unpacked"
  exit 0
fi

APP="$(ls -d dist/mac*/"$NAME".app | head -n 1)"
DEST=/Applications
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"
rm -rf "${DEST:?}/$NAME.app"
ditto "$APP" "$DEST/$NAME.app"
echo "Installed: $DEST/$NAME.app"
