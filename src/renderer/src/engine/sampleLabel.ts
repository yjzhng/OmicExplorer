/** How a sample is named and told apart across the engine: by its conditions and replicate (rows
 *  carry no sample name). A leaf module, so the statistics can use it as well as the plots. */
import type { StandardRow } from './types'

/** A sample's name from its conditions and replicate — cell_cmpd_dose_time_<customs>_r<rep>, the
 *  conditions it doesn't carry left out: the heatmap's column label, and how a sample is named
 *  where its raw (file) name would mean nothing (the Subset's sample picker, a batch's samples). */
export function sampleLabel(
  r: Pick<StandardRow, 'cell' | 'cmpd' | 'dose' | 'time' | 'rep' | 'extra'>
): string {
  // Custom conditions belong in the identity, before the replicate suffix: two samples differing
  // only in one are different samples, and a shared label would pivot them into one column.
  const parts = [
    r.cell,
    r.cmpd,
    r.dose ?? '',
    r.time ?? '',
    ...Object.keys(r.extra ?? {})
      .sort()
      .map((k) => r.extra![k]),
    r.rep != null ? `r${r.rep}` : ''
  ]
  return parts.filter((p) => p !== '').join('_')
}
