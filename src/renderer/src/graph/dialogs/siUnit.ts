/**
 * The SI (or conventional) spelling of a unit typed by hand — what the unit boxes prompt for: "uM"
 * → "µM", "hrs" → "h", "ug/ml" → "µg/mL". A unit is free text (CondUnits); this only offers the
 * standard form, and the user can keep their own.
 */

/** Lower-cased spellings → their standard form. Micro is written with the micro sign (µ, U+00B5)
 *  whether typed as u, the Greek mu (μ, U+03BC) or µ. */
const FORMS: Record<string, string> = {
  // molar
  molar: 'M',
  'mol/l': 'M',
  mm: 'mM',
  'mmol/l': 'mM',
  um: 'µM',
  'umol/l': 'µM',
  nm: 'nM',
  'nmol/l': 'nM',
  pm: 'pM',
  'pmol/l': 'pM',
  fm: 'fM',
  // mass concentration
  'g/l': 'g/L',
  'mg/ml': 'mg/mL',
  'mg/l': 'mg/L',
  'ug/ml': 'µg/mL',
  'ug/l': 'µg/L',
  'ng/ml': 'ng/mL',
  'pg/ml': 'pg/mL',
  // time
  sec: 's',
  secs: 's',
  second: 's',
  seconds: 's',
  mins: 'min',
  minute: 'min',
  minutes: 'min',
  hr: 'h',
  hrs: 'h',
  hour: 'h',
  hours: 'h',
  day: 'd',
  days: 'd',
  week: 'wk',
  weeks: 'wk',
  wks: 'wk',
  // temperature
  c: '°C',
  degc: '°C',
  '°c': '°C',
  'deg c': '°C',
  celsius: '°C',
  kelvin: 'K',
  // other
  percent: '%',
  pct: '%',
  fold: 'X',
  x: 'X',
  au: 'a.u.',
  'a.u': 'a.u.',
  arbitrary: 'a.u.'
}

/** The standard spelling of `raw` when it differs from what was typed (null: already standard, or
 *  not one this knows). */
export function siUnit(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  const key = t.toLowerCase().replace(/[μµ]/g, 'u')
  const std = FORMS[key]
  return std != null && std !== t ? std : null
}
