/**
 * A Response plot's traces and layout (ResponseSurfaceView): the shared context
 * (responseContext.ts), drawn by the view on show.
 */
import { responseContext, type ResponsePlot, type ResponsePlotInput } from './responseContext'
import { heatmapPlot } from './responseHeatmap'
import { line2dPlot, line3dPlot } from './responseLines'
import { surface3dPlot } from './responseSurface3d'

export function buildResponsePlot(input: ResponsePlotInput): ResponsePlot {
  const ctx = responseContext(input)
  if (!ctx) return { data: [], layout: {} }
  const { show, dim } = input
  if (show === 'line' && dim === '3d') return line3dPlot(ctx)
  if (show === 'line') return line2dPlot(ctx)
  if (show === 'surface') return surface3dPlot(ctx)
  // heatmap
  return heatmapPlot(ctx)
}
