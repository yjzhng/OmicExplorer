#!/bin/bash
# setup.sh <repo> <work dir> — copies of the test projects (SynthData, Degrader, TPP from
# <repo>/test_examples) into <work dir>/proj, their paths rewritten to the copies, plus SynthData's
# real-protein matrix for the import test. Never point a test instance at the real projects.
REPO=$1; WORK=$2
# absolute, so the paths written into the project copies resolve from the app
mkdir -p "$WORK" && WORK=$(cd "$WORK" && pwd)
for p in SynthData:SynthData_seed01.csv Degrader:USP7.csv TPP:TPP_2d.csv; do
  n=${p%%:*}; f=${p#*:}; d="$WORK/proj/$n"
  mkdir -p "$d" && cp -R "$REPO/test_examples/$n/${n}_data" "$REPO/test_examples/$n/$f" "$d/"
  python3 -I - "$REPO/test_examples/$n/$n.omicexplorer" "$d/$n.omicexplorer" "$REPO/test_examples/$n" "$d" <<'PY'
import gzip, sys
src, dst, old, new = sys.argv[1:]
raw = open(src, 'rb').read()
gz = raw[:2] == b'\x1f\x8b'
t = (gzip.decompress(raw) if gz else raw).decode().replace(old, new)
open(dst, 'wb').write(gzip.compress(t.encode()) if gz else t.encode())
PY
done
cp "$REPO/test_examples/SynthData/SynthData_seed01_real.csv" "$WORK/proj/SynthData/"
echo "projects in $WORK/proj"
