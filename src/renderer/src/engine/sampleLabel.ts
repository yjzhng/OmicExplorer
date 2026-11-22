/** How a sample is named and told apart across the engine: by its conditions and replicate (rows
 *  carry no sample name). A leaf module, so the statistics can use it as well as the plots. */
import type { StandardRow } from './types'

/** A sample's key from its conditions and replicate — cell_cmpd_dose_time_<customs>_r<rep>, the
 *  conditions it doesn't carry left out: how a sample is told apart where its raw (file) name would
 *  mean nothing (the heatmap's columns, a batch's saved samples). Shown as sampleName. */
export function sampleLabel(r: SampleParts): string {
  return sampleParts(r).join('_')
}

/** A sample's name on screen: the same parts as sampleLabel, joined " · " as every on-screen list
 *  of conditions is ("HeLa · dTAG · 100 · 6 · r1"). sampleLabel stays the stored key (a batch's
 *  samples are saved by it), so this is for display only. */
export function sampleName(r: SampleParts): string {
  return sampleParts(r).join(' · ')
}

type SampleParts = Pick<StandardRow, 'cell' | 'cmpd' | 'dose' | 'time' | 'rep' | 'extra'>

function sampleParts(r: SampleParts): string[] {
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
  return parts.filter((p) => p !== '').map(String)
}
