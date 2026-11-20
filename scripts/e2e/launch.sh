#!/bin/bash
# launch.sh <app worktree> <work dir> <dev port> <cdp port> — a SEPARATE test instance of the app:
# its own userData (<work dir>/ud), dev-server port and DevTools port, so it never touches the copy
# you run; backgrounding off so a covered window still paints.
WT=$1; WORK=$2; DEV=$3; CDP=$4
mkdir -p "$WORK/ud"
cd "$WT" || exit 1
exec env -u ELECTRON_RUN_AS_NODE ONEPROD_DEV_PORT=$DEV npx electron-vite dev -- \
  --user-data-dir="$WORK/ud" --remote-debugging-port=$CDP \
  --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
  --disable-background-timer-throttling
