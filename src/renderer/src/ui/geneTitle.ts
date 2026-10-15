/** The single-gene plots' title: the gene on show, centred at the top of the figure. GeneSwitch
 *  provides it through GeneTitleContext; PlotlyChart reserves a band at the top of the plot,
 *  draws the gene's name there as the figure's own title (so a copy / download names the gene)
 *  and lays the live gene picker over it. On screen the title text is hidden under the picker;
 *  the export capture (plotExport's lightCapture) reveals it. */
import { createContext, type ReactNode } from 'react'

export interface GeneTitleCtx {
  /** the gene's display name — the exported title */
  text: string
  /** the pager drawn over the title on screen */
  picker: ReactNode
  /** a chart taking the picker: called on mount, returns the release. With no chart holding it
   *  (an empty state), GeneSwitch draws the picker itself, so the gene can still be changed. */
  claim: () => () => void
}

export const GeneTitleContext = createContext<GeneTitleCtx | undefined>(undefined)

/** Height (px) of the band at the top of the plot that holds the title / picker. */
export const GENE_TITLE_BAND = 32

/** The layout keys that draw `text` as the hidden title in the top band, merged over a view's
 *  layout (its top margin grows to the band if smaller). */
export function geneTitleLayout(
  text: string,
  layout: Record<string, unknown>
): Record<string, unknown> {
  const margin = (layout.margin as Record<string, number> | undefined) ?? {}
  return {
    title: {
      text,
      x: 0.5,
      xanchor: 'center',
      y: 1,
      yref: 'container',
      yanchor: 'top',
      pad: { t: 9 },
      font: { size: 13, color: 'rgba(0,0,0,0)', weight: 600 }
    },
    margin: { ...margin, t: Math.max(margin.t ?? 0, GENE_TITLE_BAND) },
    meta: { ...((layout.meta as Record<string, unknown> | undefined) ?? {}), oeGeneTitle: true }
  }
}

/** A copy of a layout with its hidden gene title (if any) drawn in `color`, for export. */
export function revealGeneTitle(
  layout: Record<string, unknown>,
  color: string
): Record<string, unknown> {
  if (!hasGeneTitle(layout)) return layout
  const title = layout.title as { font?: Record<string, unknown> }
  return { ...layout, title: { ...title, font: { ...title.font, color } } }
}

/** Whether a layout carries a hidden gene title (so its capture must re-plot to reveal it). */
export function hasGeneTitle(layout: Record<string, unknown> | undefined): boolean {
  return !!(layout?.meta as { oeGeneTitle?: boolean } | undefined)?.oeGeneTitle
}
