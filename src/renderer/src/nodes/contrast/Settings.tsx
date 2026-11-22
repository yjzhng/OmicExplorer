import { useMemo, type ReactNode } from 'react'
import { condLabel, previewContrastPair, type ConditionKey } from '../../engine'
import {
  isPairable,
  pairSides,
  selectSource,
  selectorRowsOf,
  toContrastSide
} from '../../graph/contrastPair'
import { useConfigWindowOpen } from '../../graph/dialogDock'
import { useGraph } from '../../graph/store'
import {
  isContrastConfigured,
  isStep,
  numericOfResult,
  resolveContrastSource,
  type ContrastConfig
} from '../../graph/types'
import { StatusNote } from '../../ui/StatusNote'
import { ContrastStatPanel } from '../kit/settings/contrastSections'
import { ConfigureButton, Section } from '../kit/settings/controls'
import { styles } from '../kit/settings/styles'
import { type StepSettingsProps } from '../settings'
import { contrastSummary } from './ComparisonDialog'
import { ContrastDialog } from './ContrastDialog'
import type { PairInput } from './PairContrastDialog'

export function ContrastPanel({ id, config }: { id: string; config: ContrastConfig }) {
  // Select only the *stable* store slices and derive in memos — building arrays inside the selector
  // would return a fresh reference on every call, fail Zustand's equality check and loop forever.
  const edges = useGraph((s) => s.edges)
  const results = useGraph((s) => s.results)
  const nodes = useGraph((s) => s.nodes)
  const [dialogOpen, setDialogOpen] = useConfigWindowOpen(id)

  // ── every wired input (any number), in edge order ──
  const inputs: PairInput[] = useMemo(
    () =>
      edges
        .filter((e) => e.target === id)
        .map((e) => {
          const r = results[e.source]
          const n = nodes.find((x) => x.id === e.source)
          const name =
            (n && isStep(n) ? n.data.name : undefined)?.trim() || '' || (r?.kind ?? 'input')
          return { id: e.source, name, result: r }
        }),
    [edges, results, nodes, id]
  )
  const inputIds = useMemo(() => inputs.map((i) => i.id), [inputs])
  // ── intra-dataset mode: the groups are selected from ONE input (the configured pick) ──
  const from = selectSource(config, inputIds)
  const { rows: selRows, present } = useMemo(
    () => selectorRowsOf(inputs.find((i) => i.id === from)?.result),
    [inputs, from]
  )

  // ── inter-dataset mode: the two inputs currently chosen as A/B ──
  const sides = pairSides(config, inputIds)
  const A = sides ? inputs.find((i) => i.id === sides[0]) : undefined
  const B = sides ? inputs.find((i) => i.id === sides[1]) : undefined
  const pairReady =
    !!A && !!B && isPairable(A.result) && isPairable(B.result) && A.result!.kind === B.result!.kind

  const match = useMemo(() => config.match ?? [], [config.match])
  // Status-line summaries, worded like the selector window's preview table:
  //   intra: "Ready, n contrasts on cmpd: E28 vs DMSO"      (group A vs group B)
  //   inter: "Ready, n contrasts: KO (…) vs WT (…)"          (dataset A vs dataset B)
  const intraSummary = useMemo(
    () =>
      isContrastConfigured(config) && selRows.length
        ? contrastSummary(selRows, config.num ?? {}, config.den ?? {}, match, present)
        : null,
    [config, selRows, match, present]
  )
  const interSummary = useMemo(() => {
    if (!pairReady) return null
    const p = previewContrastPair(
      toContrastSide(A!.result),
      toContrastSide(B!.result),
      match,
      { a: A!.name, b: B!.name },
      config.pairFix
    )
    if (p.warnings.length > 0) return null
    const first = p.rows[0]
    return {
      groups: p.groups,
      on: p.matched,
      nameA: first?.[0] ?? A!.name,
      nameB: first?.[2] ?? B!.name
    }
  }, [pairReady, A, B, match, config.pairFix])
  const contrastsMsg = (n: number, on: ConditionKey[], nameA: string, nameB: string): string =>
    `Ready, ${n} contrast${n === 1 ? '' : 's'}${on.length ? ` on ${on.map(condLabel).join(', ')}` : ''}: ${nameA} vs ${nameB}`
  // One input ⇒ intra-dataset only; two or more ⇒ the config's choice (inter by default).
  const source = resolveContrastSource(config, inputs.length)
  const canConfigure = inputs.some((i) => isPairable(i.result))
  const configureBlocked = 'Connect and run an upstream Compare or Clean data first'

  return (
    <Section
      title="Contrast"
      // Top-right, like the dialog's t-test / 2-way ANOVA pill: which inputs the contrast draws
      // The same inline Configure… as the Compare tile; the intra-/inter-dataset mode shows in the
      // window's header (like the comparison dialog's t-test / 2-way ANOVA pill), set by wiring.
      action={
        <ConfigureButton
          label="Configure…"
          disabled={!canConfigure}
          title={canConfigure ? undefined : configureBlocked}
          onClick={() => setDialogOpen(true)}
        />
      }
    >
      {source === 'select' ? (
        <>
          {intraSummary ? (
            <StatusNote kind="ok" style={styles.doneNote}>
              {contrastsMsg(
                intraSummary.groups,
                intraSummary.axis,
                intraSummary.nameA,
                intraSummary.nameB
              )}
            </StatusNote>
          ) : (
            <StatusNote kind="warn">Not configured — pipeline blocked</StatusNote>
          )}
        </>
      ) : (
        <>
          {interSummary ? (
            <StatusNote kind="ok" style={styles.doneNote}>
              {contrastsMsg(interSummary.groups, [], interSummary.nameA, interSummary.nameB)}
            </StatusNote>
          ) : pairReady ? (
            <StatusNote kind="warn">Not configured — pipeline blocked</StatusNote>
          ) : (
            <StatusNote kind="warn">
              The two datasets must be the same kind and run — two Compares, or two Clean data.
            </StatusNote>
          )}
        </>
      )}
      {dialogOpen && (
        <ContrastDialog
          // Keyed on the wiring: the window reads its inputs and source mode at mount, and docked in
          // the form workflow it stays open while the inputs are rewired beside it.
          key={inputIds.join(',')}
          id={id}
          rows={selRows}
          active={present}
          numeric={numericOfResult(inputs.find((i) => i.id === from)?.result)}
          initial={{
            num: config.num ?? {},
            den: config.den ?? {},
            match,
            source,
            pairA: config.pairA,
            pairB: config.pairB,
            selectFrom: from,
            pairFix: config.pairFix,
            matchSet: config.match != null
          }}
          pair={inputs}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </Section>
  )
}
/** Its settings panel (nodes/settings.ts). */
export function Settings({ id, config }: StepSettingsProps): ReactNode {
  return (
    <>
      <ContrastPanel id={id} config={config as ContrastConfig} />
      <ContrastStatPanel id={id} config={config as ContrastConfig} />
    </>
  )
}
