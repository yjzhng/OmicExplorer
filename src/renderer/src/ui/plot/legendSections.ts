/** Condition legends in sections: each condition's entries under its own heading (Plotly's legend
 *  groups, one per condition, titled with it) — cmpd and its values, then dose and its shades —
 *  rather than one title naming every condition. */

/** A legend-only entry under section `section`. `group` is what clicking or hovering it selects
 *  (`cond=value`, the marks' own group; '' = nothing — a key with no marks of its own), kept apart
 *  from the section in `meta.oeGroup` (see traceFocus.groupOf). Draws nothing on the plot. */
export function sectionKey(o: {
  name: string
  section: string
  group: string
  marker: Record<string, unknown>
}): Record<string, unknown> {
  return {
    type: 'scatter',
    mode: 'markers',
    name: o.name,
    legendgroup: `\u0000${o.section}`,
    legendgrouptitle: { text: o.section },
    meta: { oeGroup: o.group },
    x: [null],
    y: [null],
    marker: o.marker,
    hoverinfo: 'skip',
    showlegend: true
  }
}

/** The legend layout for sectioned keys: sections in trace order, a gap between them, and a click
 *  on an entry acting on that entry alone (PlotlyChart turns it into a selection). */
export const SECTIONED_LEGEND = {
  traceorder: 'grouped',
  groupclick: 'toggleitem',
  tracegroupgap: 10
} as const
