import type { ReactNode } from 'react'
import { presentStd, tableScaleOf } from '../../engine'
import {
  type CompareConfig,
  type TableConfig,
  TABLE_GENE_MAX,
  curveDoseUnit,
  effectLabelsOf,
  plotResultKey
} from '../../graph/types'
import { toPaletteRef } from '../../ui/palettes'
import { Empty } from '../kit/views/common'
import { type ViewContext, cmpOfKind } from '../kit/views/context'
import { contrastTableData } from '../kit/views/tableData'
import { CompareTable, ContrastTable, StdTable, type TableColour } from '../kit/views/tables'

/** The table result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function tableView(v: ViewContext): ReactNode {
  const { cfgSource, patchConfig, upstream, units, node, child, upStep, facetSel, numeric } = v
  // The configured view seeds each table's own View switch; keying on it means a change from the
  // settings gear takes effect immediately instead of only on the next mount. Clean data's
  // switch writes it (its QC view is Clean data's only).
  const view = (cfgSource as TableConfig).view
  const startView = view === 'qc' ? 'matrix' : view
  // The uniqID and gene columns' display caps (cut with "…", whole on hover — display only).
  const tableCfg = cfgSource as TableConfig
  const maxChars = {
    uniqID: tableCfg.idMaxLen ?? TABLE_GENE_MAX,
    gene: tableCfg.geneMaxLen ?? TABLE_GENE_MAX
  }
  // Cell colouring: the tile's own (its settings and the in-tile switch write the same field).
  const colour: TableColour = {
    on: tableCfg.colored ?? true,
    set: (on) => patchConfig({ colored: on }),
    palette: toPaletteRef(tableCfg.palette)
  }
  if (!upstream) return <Empty text="Connect a Clean data, Compare, or Contrast tile." />
  if (upstream.kind === 'standardize')
    return (
      <StdTable
        std={presentStd(upstream.std, tableScaleOf(upstream.std))}
        units={units}
        showKey={plotResultKey(node.id, child?.id)}
        view={view ?? 'matrix'}
        setView={(v) => patchConfig({ view: v })}
        maxChars={maxChars}
        colour={colour}
      />
    )
  if (upstream.kind === 'compare') {
    const upCfg = upStep?.data.config as CompareConfig | undefined
    return (
      <CompareTable
        key={view}
        showKey={plotResultKey(node.id, child?.id)}
        units={units}
        // a two-way ANOVA: the group's `show` pick — its overall 2×2 rows or its factors
        cmp={facetSel ? cmpOfKind(upstream.cmp, facetSel.show) : upstream.cmp}
        analysis={upCfg?.analysis ?? 'compare'}
        effectLabels={effectLabelsOf(upCfg)}
        displayMap={upstream.displayMap}
        comparisons={upstream.cmp.comparisons}
        statType={(upstream.cmp.threshold ?? upCfg?.threshold)?.statType ?? 'pQ'}
        threshold={upstream.cmp.threshold ?? upCfg?.threshold}
        dose={curveDoseUnit(upCfg, units)}
        numeric={numeric}
        initialView={startView}
        maxChars={maxChars}
        colour={colour}
      />
    )
  }
  if (upstream.kind === 'contrast') {
    return (
      <ContrastTable
        key={view}
        showKey={plotResultKey(node.id, child?.id)}
        units={units}
        // the feature on the switcher (a table isn't faceted, but it shows one feature)
        data={contrastTableData(upstream.ctr, facetSel?.feature)}
        displayMap={upstream.displayMap}
        comparisons={upstream.ctr.comparisons}
        numeric={numeric}
        initialView={startView}
        maxChars={maxChars}
        colour={colour}
      />
    )
  }
  return <Empty text="Run the upstream step to produce its table." />

  return <Empty text="No output." />
}
