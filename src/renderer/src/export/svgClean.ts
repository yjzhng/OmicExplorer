/**
 * Tidy Plotly's SVG for vector editors (Illustrator, Inkscape, PowerPoint's SVG import).
 *
 * Plotly's SVG is a snapshot of its live DOM, so it carries things only a browser needs:
 *  - invisible hit-target rects (`fill-opacity: 0`): the paper and plot-area backgrounds, the
 *    legend box and one `legendtoggle` per legend entry. An editor imports each as a blank
 *    square, layered over the artwork;
 *  - dozens of empty layer groups (`<g class="pielayer"/>`, …) and no-op paths (`d="M0,0"`);
 *  - a legend clip sized for the on-screen font;
 *  - a CSS font list (`Arial, Helvetica, sans-serif`): an editor wants one installed family,
 *    and imports text in an unresolved font as blank until a real one is set.
 * All of that is removed or replaced here; what is drawn is unchanged.
 */

/** The value of one inline-style property ('' if absent). */
function styleProp(el: Element, prop: string): string {
  return (el as SVGElement).style?.getPropertyValue(prop).trim() ?? ''
}

/** True when a rect paints nothing: zero-sized, or no visible fill and no visible stroke. */
function isInvisibleRect(el: Element): boolean {
  if (el.getAttribute('width') === '0' || el.getAttribute('height') === '0') return true
  const fill = styleProp(el, 'fill') || el.getAttribute('fill') || ''
  const fillOpacity = styleProp(el, 'fill-opacity') || el.getAttribute('fill-opacity') || '1'
  const noFill =
    fill === 'none' ||
    fill === 'transparent' ||
    /^rgba\(.*,\s*0\)$/.test(fill) ||
    Number(fillOpacity) === 0
  const stroke = styleProp(el, 'stroke') || el.getAttribute('stroke') || 'none'
  const strokeWidth = parseFloat(
    styleProp(el, 'stroke-width') || el.getAttribute('stroke-width') || '1'
  )
  const noStroke = stroke === 'none' || strokeWidth === 0
  return noFill && noStroke
}

/** Drop empty groups bottom-up, so a group holding only empty groups goes too. */
function pruneEmptyGroups(el: Element): void {
  for (const child of [...el.children]) pruneEmptyGroups(child)
  if (el.tagName === 'g' && el.children.length === 0 && !el.textContent?.trim()) el.remove()
}

/** `font` is the single family every text element is set in (the plot font's name). */
export function cleanSvgForEditors(svg: string, font: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = doc.documentElement
  if (root.tagName !== 'svg') return svg // parse error: hand back what Plotly gave us

  // Clip-path rects live in <defs> and paint nothing by design; leave those alone.
  for (const rect of [...root.querySelectorAll('rect')])
    if (!rect.closest('clipPath') && isInvisibleRect(rect)) rect.remove()
  for (const path of [...root.querySelectorAll('path')]) {
    const d = (path.getAttribute('d') ?? '').trim()
    if (!d || d === 'M0,0') path.remove()
  }

  for (const el of [...root.querySelectorAll('[style]')]) {
    const s = (el as SVGElement).style
    const family = s.getPropertyValue('font-family')
    if (family) s.setProperty('font-family', font)
    if (!el.getAttribute('style')?.trim()) el.removeAttribute('style')
  }
  for (const el of [...root.querySelectorAll('[transform=""]')]) el.removeAttribute('transform')
  for (const el of [...root.querySelectorAll('[pointer-events]')])
    el.removeAttribute('pointer-events')
  if (!root.getAttribute('style')?.trim()) root.removeAttribute('style')

  // The legend is clipped to a box sized for the on-screen font; an export never scrolls it, and
  // the clip would cut off labels set in the (wider) editor font.
  for (const box of [...root.querySelectorAll('g.scrollbox[clip-path]')]) {
    const id = /url\(#([^)]+)\)/.exec(box.getAttribute('clip-path') ?? '')?.[1]
    box.removeAttribute('clip-path')
    if (id) root.querySelector(`clipPath[id="${id}"]`)?.remove()
  }

  pruneEmptyGroups(root)
  for (const defs of [...root.querySelectorAll('defs')])
    if (!defs.querySelector('clipPath, linearGradient, radialGradient, pattern, filter, marker'))
      defs.remove()

  return new XMLSerializer().serializeToString(root)
}
