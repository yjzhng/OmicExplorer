/**
 * The "no colour" slash on a swatch — a diagonal from its top-right to its bottom-left corner, as a
 * CSS background. Drawn as an SVG line (stretched to the swatch), which the browser anti-aliases;
 * a hard-stop linear-gradient stripe renders as a jagged staircase at swatch sizes.
 */
export function slashBackground(color: string, ground?: string, width = 1.5): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">` +
    `<line x1="100" y1="0" x2="0" y2="100" stroke="${color}" stroke-width="${width}" ` +
    `vector-effect="non-scaling-stroke" stroke-linecap="square"/></svg>`
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / 100% 100% no-repeat`
  return ground ? `${url}, ${ground}` : url
}
