"""The tutorial's example data: small, fully synthetic, made here — no real samples, proteins or
compounds. One drug (DrugA) against the vehicle (DMSO), at 10, 100 and 1000 nM, after 60 min and
24 h, 3 replicates, 1000 made-up proteins (SYN0001…, genes G0001…). About one in ten responds, up or
down, more with dose and time, so a comparison's volcano has clear wings.

    python3 -I scripts/build_tour_data.py

Pure standard library and seeded, so the files are the same on every run. Writes the app's three
manual-input files to src/renderer/src/ui/tutorial/data/: tour_datamatrix.csv (UniProtIDs + one
column per sample, linear intensity, 0 = not measured), tour_samplesheet.csv (sample → cmpd, dose,
time, rep) and tour_metadata.csv (uniqID → gene). Sample names follow the usual pattern,
Intensity_<cmpd>_<dose>nM_<time>min_r<rep>.
"""

import csv
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'renderer', 'src', 'ui', 'tutorial', 'data')
SEED = 20261122
N_GENES = 1000
DOSES = [10, 100, 1000]  # nM
TIMES = [60, 1440]  # min
REPS = 3
RESPONDERS = 0.10  # share of proteins that respond
# How much of a responder's full effect shows at each dose and time.
DOSE_SHARE = {10: 0.2, 100: 0.6, 1000: 1.0}
TIME_SHARE = {60: 0.35, 1440: 1.0}
NOISE_SD = 0.25  # log2, per value
SAMPLE_SD = 0.05  # log2, per sample (loading)


def main():
    rng = random.Random(SEED)
    samples = [('DMSO', 0, t, r) for t in TIMES for r in range(1, REPS + 1)]
    samples += [('DrugA', d, t, r) for t in TIMES for d in DOSES for r in range(1, REPS + 1)]
    names = [f'Intensity_{c}_{d}nM_{t}min_r{r}' for c, d, t, r in samples]
    offsets = [rng.gauss(0, SAMPLE_SD) for _ in samples]

    genes = []
    for g in range(1, N_GENES + 1):
        base = rng.gauss(24, 2)  # log2 abundance
        effect = 0.0
        if rng.random() < RESPONDERS:
            effect = rng.uniform(1.0, 3.0) * rng.choice((-1, 1))
        values = []
        for (c, d, t, _), off in zip(samples, offsets):
            mean = base + off + (effect * DOSE_SHARE[d] * TIME_SHARE[t] if c == 'DrugA' else 0)
            v = mean + rng.gauss(0, NOISE_SD)
            # Low abundance goes missing more often, as in a real run.
            missing = rng.random() < 1 / (1 + math.exp((v - 20) * 1.5))
            values.append(0 if missing else round(2**v))
        genes.append((f'SYN{g:04d}', f'G{g:04d}', values))

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'tour_datamatrix.csv'), 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['UniProtIDs'] + names)
        for pid, _, values in genes:
            w.writerow([pid] + values)
    with open(os.path.join(OUT, 'tour_samplesheet.csv'), 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['sample', 'cmpd', 'dose', 'time', 'rep'])
        for name, (c, d, t, r) in zip(names, samples):
            w.writerow([name, c, d, t, r])
    with open(os.path.join(OUT, 'tour_metadata.csv'), 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(['uniqID', 'gene'])
        for pid, gene, _ in genes:
            w.writerow([pid, gene])
    print(f'{len(samples)} samples x {N_GENES} proteins')


if __name__ == '__main__':
    main()
