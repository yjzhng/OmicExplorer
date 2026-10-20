/**
 * The Contrast window: one row per condition — contrasted (group A at one value, group B at one value:
 * two different ones, or the same one) or matched (one contrast per value both sides have; click a
 * value to leave it out). Genes pair by ID; nothing is pooled. Intra-dataset picks the two groups from
 * one input, inter-dataset contrasts two inputs. The model lives in contrastModel; the inter-dataset
 * check is the engine's own preview (previewContrastPair) on the config it compiles.
 */
import { useMemo, useState, type ReactNode } from 'react'

import {
  condLabel,
  condsIn,
  numericConds,
  orderConds,
  previewContrastPair,
  type CondSelector,
  type ConditionKey,
  type NumericConds,
  type PairFix,
  type StandardRow
} from '../engine'
import { StatusNote } from '../ui/StatusNote'
import { OnOffSwitch, ToggleSwitch } from '../ui/ToggleSwitch'
import { UI } from '../ui/theme'
import { sampleRows } from './compareModel'
import {
  CondRow,
  NodeTable,
  Section,
  SelectorShell,
  SideCell,
  SidesBox,
  Tag,
  ValChip
} from './condRows'
import { useCondUnits } from './useUpstreamFacts'
import { pairSides, selectorRowsOf, toContrastSide } from './contrastPair'
import {
  compileInter,
  compileIntra,
  contrastLine,
  contrastModel,
  readInter,
  readIntra,
  type ContrastModel,
  type ContrastState,
  type SliceInfo
} from './contrastModel'
import { DatasetPick, type PairInput } from './PairContrastDialog'
import { useGraph } from './store'
import { numericOfResult, numericUnion, type ContrastConfig } from './types'

type Source = 'select' | 'pair'

// A side row carries the condition fields a sample row does: read it as one.
const asRows = (s: ReturnType<typeof toContrastSide>): StandardRow[] =>
  s as unknown as StandardRow[]

const LEGEND: Array<[string, string]> = [
  [
    'contrasted',
    'group A at one value and group B at one value: two different ones (what is contrasted), or the same one (where both sit).'
  ],
  [
    'matched',
    'one contrast per value: group A and group B at the same value are paired. Click a value to leave it out; a value on one side only is dropped.'
  ]
]

export function ContrastDialog({
  id,
  rows: rowsProp,
  active: activeProp,
  numeric: numericProp,
  initial,
  pair,
  onClose
}: {
  id: string
  /** the input's rows (intra-dataset, one input wired) */
  rows: StandardRow[]
  active: ConditionKey[]
  /** that input's numeric conditions (its schema: numericOfResult) */
  numeric: NumericConds
  initial: {
    num: CondSelector
    den: CondSelector
    match: ConditionKey[]
    source?: Source
    pairA?: string
    pairB?: string
    selectFrom?: string
    pairFix?: PairFix
    /** whether `match` was ever set (unset: every condition matched) */
    matchSet?: boolean
  }
  /** every wired input, in edge order */
  pair?: PairInput[]
  onClose: () => void
}): ReactNode {
  const units = useCondUnits(id)
  const update = useGraph((s) => s.updateConfig)
  const inputCount = pair?.length ?? 0
  // each condition's value box: open unless folded
  const [fold, setFold] = useState<Partial<Record<ConditionKey, boolean>>>({})
  const [source, setSource] = useState<Source>(
    initial.source === 'pair' && inputCount >= 2 ? 'pair' : 'select'
  )

  // ── intra-dataset: the two groups from one input ──
  const [selectPick, setSelectPick] = useState<string | undefined>(initial.selectFrom)
  const selectInput = pair?.find((i) => i.id === selectPick)
  const { rows, active } = useMemo(() => {
    if (!pair || pair.length < 2) return { rows: rowsProp, active: activeProp }
    const r = selectorRowsOf(selectInput?.result)
    return { rows: r.rows, active: r.present }
  }, [pair, selectInput, rowsProp, activeProp])
  const samples = useMemo(() => sampleRows(rows, active), [rows, active])
  // the picked input's numeric conditions (its schema)
  const intraNumeric = useMemo(
    () => (pair && pair.length >= 2 ? numericOfResult(selectInput?.result) : numericProp),
    [pair, selectInput, numericProp]
  )
  const [intra, setIntra] = useState<ContrastState>(() =>
    readIntra(initial, samples, active, intraNumeric)
  )

  // ── inter-dataset: two inputs ──
  const [pairPick, setPairPick] = useState<{ a?: string; b?: string }>(() => {
    const s = pairSides(
      { pairA: initial.pairA, pairB: initial.pairB } as ContrastConfig,
      (pair ?? []).map((i) => i.id)
    )
    return s ? { a: s[0], b: s[1] } : {}
  })
  const resA = pair?.find((i) => i.id === pairPick.a)?.result
  const resB = pair?.find((i) => i.id === pairPick.b)?.result
  const sideA = useMemo(() => toContrastSide(resA), [resA])
  const sideB = useMemo(() => toContrastSide(resB), [resB])
  const interConds = useMemo(
    () => orderConds(condsIn([...asRows(sideA), ...asRows(sideB)])),
    [sideA, sideB]
  )
  // both datasets' numeric conditions (a condition numeric in either)
  const interNumeric = useMemo(() => numericConds(numericUnion([resA, resB])), [resA, resB])
  const sA = useMemo(() => sampleRows(asRows(sideA), interConds), [sideA, interConds])
  const sB = useMemo(() => sampleRows(asRows(sideB), interConds), [sideB, interConds])
  const [inter, setInter] = useState<ContrastState>(() =>
    readInter(
      { match: initial.matchSet ? initial.match : undefined, pairFix: initial.pairFix },
      sA,
      sB,
      interConds,
      interNumeric
    )
  )
  const pairOk =
    !!resA &&
    !!resB &&
    (resA.kind === 'compare' || resA.kind === 'standardize') &&
    resB.kind === resA.kind

  const isPair = source === 'pair'
  const m: ContrastModel = useMemo(
    () =>
      isPair
        ? contrastModel(inter, sA, sB, interConds, interNumeric)
        : contrastModel(intra, samples, samples, active, intraNumeric),
    [isPair, inter, sA, sB, interConds, interNumeric, intra, samples, active, intraNumeric]
  )
  const setState = isPair ? setInter : setIntra
  const labels = isPair
    ? { a: 'dataset A', b: 'dataset B' }
    : { a: 'group A (y-axis)', b: 'group B (x-axis)' }

  // The engine's own check of what inter-dataset runs: nothing left unpinned, something to pair.
  const interCfg = useMemo(() => compileInter(m), [m])
  const interPreview = useMemo(
    () =>
      isPair && pairOk
        ? previewContrastPair(sideA, sideB, interCfg.match, { a: 'A', b: 'B' }, interCfg.pairFix)
        : null,
    [isPair, pairOk, sideA, sideB, interCfg]
  )
  const warnings: string[] = []
  if (isPair) {
    if (!pairOk)
      warnings.push(
        'The two datasets must be the same kind and run: two Compares, or two Clean data.'
      )
    else if (interPreview?.unpinned.length) warnings.push(...interPreview.warnings)
    else if (!m.keys.length) warnings.push('Nothing pairs across the two datasets.')
  } else if (m.differs && !m.keys.length) warnings.push('No genes pair across the two groups.')
  const canApply = isPair
    ? pairOk && warnings.length === 0 && m.keys.length > 0
    : m.differs && m.keys.length > 0

  const apply = (): void => {
    if (isPair) {
      update(id, {
        source: 'pair',
        match: interCfg.match,
        pairA: pairPick.a,
        pairB: pairPick.b,
        pairFix: interCfg.pairFix
      })
    } else {
      const c = compileIntra(m)
      update(id, {
        source: 'select',
        num: c.num,
        den: c.den,
        match: c.match,
        selectFrom: selectPick
      })
    }
    onClose()
  }

  const edit = (f: (s: ContrastState) => void): void =>
    setState((s) => {
      const n: ContrastState = { cmode: { ...s.cmode }, sl: { ...s.sl }, drop: { ...s.drop } }
      f(n)
      return n
    })

  const rowOf = (x: SliceInfo, i: number): ReactNode => {
    const { c, va, vb, sl } = x
    if (x.m === 'single')
      return (
        <CondRow
          key={c}
          first={i === 0}
          name={condLabel(c)}
          toggle={
            <OnOffSwitch
              on={false}
              disabled
              label={`Contrast on ${condLabel(c)}`}
              title={`One ${condLabel(c)} only: nothing to contrast`}
              onChange={() => {}}
            />
          }
          badge={<Tag kind="ctx">matched condition</Tag>}
          line={<span style={{ fontSize: 12, color: UI.textMuted }}>{va[0] ?? vb[0]}</span>}
        />
      )
    const both = va.filter((v) => vb.includes(v))
    const folded = !!fold[c]
    const col = (side: 'a' | 'b', vals: string[], other: string[]): ReactNode[] =>
      vals.map((v) =>
        x.m === 'slice' ? (
          <ValChip
            key={v}
            label={v}
            radio
            look={sl[side] === v ? 'on' : 'plain'}
            onClick={() => edit((s) => void (s.sl[c] = { ...sl, [side]: v }))}
          />
        ) : !other.includes(v) ? (
          <ValChip
            key={v}
            label={v}
            look="out"
            title={`Only in ${side === 'a' ? labels.a : labels.b}: dropped`}
          />
        ) : (
          <ValChip
            key={v}
            label={v}
            look={x.drop.has(v) ? 'out' : 'matched'}
            title={x.drop.has(v) ? 'Left out. Click to include' : 'Matched. Click to leave out'}
            onClick={() =>
              edit((s) => {
                const d = new Set(s.drop[c] ?? [])
                if (d.has(v)) d.delete(v)
                else d.add(v)
                s.drop[c] = [...d]
              })
            }
          />
        )
      )
    return (
      <CondRow
        key={c}
        first={i === 0}
        name={condLabel(c)}
        folded={folded}
        onFold={() => setFold((f) => ({ ...f, [c]: !folded }))}
        box={<SidesBox left={[labels.a, col('a', va, vb)]} right={[labels.b, col('b', vb, va)]} />}
        swapKey={x.m}
        // contrasted: on / off, right of the name; off, the condition is matched (when both sides share a value)
        toggle={
          <OnOffSwitch
            on={x.m === 'slice'}
            disabled={x.m === 'slice' && !both.length}
            label={`Contrast on ${condLabel(c)}`}
            title={
              !both.length
                ? `No ${condLabel(c)} value is on both sides: it can only be contrasted`
                : x.m === 'slice'
                  ? `${condLabel(c)} is contrasted. Switch off to match it`
                  : `Contrast on ${condLabel(c)}`
            }
            onChange={(on) => edit((s) => void (s.cmode[c] = on ? 'slice' : 'match'))}
          />
        }
        badge={
          x.m === 'slice' ? (
            <Tag kind="cmp">contrasted condition</Tag>
          ) : (
            <Tag kind="ctx">matched condition</Tag>
          )
        }
      />
    )
  }

  const noInput = !isPair && rows.length === 0
  return (
    <SelectorShell
      title="Configure contrast"
      canApply={canApply}
      onApply={apply}
      onClose={onClose}
      mode={
        <ToggleSwitch
          label="Contrast source"
          value={source}
          options={(['select', 'pair'] as Source[]).map((v) => ({
            value: v,
            label: v === 'select' ? 'intra-dataset' : 'inter-dataset',
            disabled: v === 'pair' && inputCount < 2,
            title:
              v === 'pair' && inputCount < 2
                ? 'Wire a second input into the tile to contrast two datasets'
                : undefined
          }))}
          onChange={setSource}
        />
      }
    >
      {isPair && pair && (
        <Section
          title="Datasets"
          hint="The two wired inputs: dataset A on the y-axis, dataset B on the x-axis."
          grid={false}
        >
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <DatasetPick
              label="dataset A (y)"
              inputs={pair}
              value={pairPick.a}
              exclude={pairPick.b}
              onPick={(v) => setPairPick((p) => ({ ...p, a: v }))}
            />
            <DatasetPick
              label="dataset B (x)"
              inputs={pair}
              value={pairPick.b}
              exclude={pairPick.a}
              onPick={(v) => setPairPick((p) => ({ ...p, b: v }))}
            />
          </div>
        </Section>
      )}
      {!isPair && pair && pair.length >= 2 && (
        <Section title="Dataset" hint="The input the two groups are picked from." grid={false}>
          <DatasetPick label="dataset" inputs={pair} value={selectPick} onPick={setSelectPick} />
        </Section>
      )}
      {noInput ? (
        <StatusNote kind="warn" style={{ margin: 14 }}>
          Connect and run an upstream Compare or Clean data first.
        </StatusNote>
      ) : (
        <>
          <Section
            title="Contrast"
            hint={
              isPair
                ? 'Dataset A against dataset B, genes paired by ID. Matched gives one contrast per value both datasets have; contrasted takes one value from each.'
                : 'Group A against group B, genes paired by ID. Contrasted picks one value per side; matched gives one contrast per value.'
            }
            legend={LEGEND}
          >
            {m.rows.map(rowOf)}
            <div style={{ gridColumn: '1 / -1', paddingTop: 6 }}>
              <StatusNote kind={isPair || m.differs ? 'info' : 'warn'}>
                <b>Contrast:</b>{' '}
                {contrastLine(m, isPair ? { a: 'dataset A', b: 'dataset B' } : undefined)}
              </StatusNote>
            </div>
          </Section>
          <Section
            title={`Preview (${m.keys.length} contrast${m.keys.length === 1 ? '' : 's'})`}
            hint="What will run: one row per contrast."
            grid={false}
            shade
          >
            {m.keys.length > 0 && (
              <NodeTable
                columns={[isPair ? 'dataset A' : 'group A', '', isPair ? 'dataset B' : 'group B']}
                rows={m.keys
                  .slice(0, 50)
                  .map((k) => [
                    <SideCell
                      key="a"
                      rows={m.ga.get(k) ?? []}
                      conds={isPair ? interConds : active}
                      units={units}
                      numeric={isPair ? interNumeric : intraNumeric}
                    />,
                    'vs',
                    <SideCell
                      key="b"
                      rows={m.gb.get(k) ?? []}
                      conds={isPair ? interConds : active}
                      units={units}
                      numeric={isPair ? interNumeric : intraNumeric}
                    />
                  ])}
                more={m.keys.length - 50}
              />
            )}
            {warnings.map((w) => (
              <StatusNote key={w} kind="warn">
                {w}
              </StatusNote>
            ))}
          </Section>
        </>
      )}
    </SelectorShell>
  )
}
