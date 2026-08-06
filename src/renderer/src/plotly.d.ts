/** Minimal typing for plotly.js-dist-min (ships without types). */
declare module 'plotly.js-dist-min' {
  export interface PlotlyHoverPoint {
    curveNumber: number
    pointNumber: number
    customdata?: unknown
    data?: unknown
  }
  export interface PlotlyMouseEvent {
    points?: PlotlyHoverPoint[]
  }
  /** A Plotly graph div gains `.on`/`.removeAllListeners` after the first render. */
  export interface PlotlyGraphDiv extends HTMLElement {
    on(event: string, handler: (e: PlotlyMouseEvent) => void): void
    removeAllListeners(event?: string): void
    data?: Array<Record<string, unknown>>
  }
  interface PlotlyStatic {
    newPlot(
      root: HTMLElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>
    ): Promise<void>
    react(
      root: HTMLElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>
    ): Promise<void>
    restyle(
      root: HTMLElement,
      update: Record<string, unknown>,
      traceIndices?: number[]
    ): Promise<void>
    addTraces(root: HTMLElement, traces: unknown | unknown[]): Promise<void>
    deleteTraces(root: HTMLElement, traceIndices: number | number[]): Promise<void>
    purge(root: HTMLElement): void
    Plots: { resize(root: HTMLElement): void }
  }
  const Plotly: PlotlyStatic
  export default Plotly
}
