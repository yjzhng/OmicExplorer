#!/bin/bash
# Path B — run the app from source in its own Electron window, live.
# Clone → run → live; `git pull` → relaunch → updated. No rebundle, HMR on.
#   Terminal:  ./scripts/launch.sh      Finder: double-click <App>.app
set -e
cd "$(cd "$(dirname "$0")/.." && pwd)" # repo root (scripts/launch.sh → ..)

# Finder-launched .apps inherit a minimal PATH (no node/npm). Recover the user's
# real login-shell PATH so the SAME node/npm as a normal terminal are used.
USER_PATH="$(/bin/zsh -lic 'printf %s "$PATH"' 2>/dev/null || true)"
export PATH="${USER_PATH:+$USER_PATH:}/opt/homebrew/bin:/usr/local/bin:$PATH"

# App name derived from package.json (single source of truth).
APP_NAME="$(node -p "require('./package.json').productName || require('./package.json').name" 2>/dev/null || echo App)"

note() {
  osascript -e "display notification \"$1\" with title \"$APP_NAME\"" >/dev/null 2>&1 || true
}

if [ ! -d node_modules ]; then
  note "First run: installing dependencies… (a few minutes)"
  npm install
fi

note "Starting $APP_NAME…"
exec npm run dev   # electron-vite dev: renderer HMR + main/preload hot-reload
