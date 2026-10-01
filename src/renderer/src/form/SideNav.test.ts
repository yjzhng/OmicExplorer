/** The shared nav column. Rendered directly — it has no store or chart dependencies, so unlike the
 *  views that use it, it can be server-rendered and inspected. */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SideNav, type SideNavItem } from './SideNav'

const render = (props: Partial<Parameters<typeof SideNav>[0]> & { items: SideNavItem[] }): string =>
  renderToStaticMarkup(
    createElement(SideNav, {
      ariaLabel: 'Things',
      activeKey: null,
      onPick: () => {},
      width: 200,
      ...props
    })
  )

const items: SideNavItem[] = [
  { key: 'a', label: 'Alpha' },
  { key: 'b', label: 'Beta' }
]

describe('SideNav', () => {
  it('shows a panel heading when given one', () => {
    expect(render({ items, heading: 'Data source' })).toContain('Data source')
  })

  it('shows no heading when none is given', () => {
    const html = render({ items })
    expect(html).toContain('Alpha')
    // Only the two rows — nothing standing in for a title.
    expect(html).not.toContain('Data source')
  })

  it('keeps the heading even when the list is empty', () => {
    // It names the column, so it isn't conditional on the column having contents — that's what
    // separates it from an item's `group`.
    expect(render({ items: [], heading: 'Plot types' })).toContain('Plot types')
  })

  it('heads a run of items sharing a group, and leaves a flat list bare', () => {
    const grouped: SideNavItem[] = [
      { key: 'a', label: 'Alpha', group: 'First' },
      { key: 'b', label: 'Beta', group: 'First' },
      { key: 'c', label: 'Gamma', group: 'Second' }
    ]
    const html = render({ items: grouped })
    expect((html.match(/First/g) ?? []).length).toBe(1) // once, not per item
    expect(html).toContain('Second')
    // A flat list carries no group headings at all.
    expect(render({ items })).not.toMatch(/First|Second/)
  })

  it('marks the active item, and only that one', () => {
    const html = render({ items, activeKey: 'b' })
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1)
  })
})
