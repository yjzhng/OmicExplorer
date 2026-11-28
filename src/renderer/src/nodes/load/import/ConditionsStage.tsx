/**
 * The import's Conditions stage: its condition switches, and the two cards (naming and
 * samplesheet) dealt as a deck.
 */
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { InteractiveSampleCond } from '../../../engine'
import { UI } from '../../../ui/app/theme'
import { StatusNote } from '../../../ui/controls/StatusNote'
import { OnOffSwitch, ToggleSwitch } from '../../../ui/controls/ToggleSwitch'
import { UnitInput } from '../../../graph/dialogs/UnitInput'
import type { LoadedSheet } from '../../../graph/config/load'
import type { CondUnits } from '../../../graph/config/units'
import { type ColorOf, condOf, type Field, isPresetField, type RowSpans } from './fields'
import { useMoreBelow } from './measure'
import { styles } from './styles'
import { NewConditionRow } from './NamePainting'
import { unitSpec } from './units'
import { SheetMapper } from './SheetMapper'
import { Stage1 } from './Stage1'
import { Stage2 } from './Stage2'

/** The Conditions step's left panel: which conditions the samples carry — a switch each, in a
 *  vertical list, then a "custom" row to add one; below, Set unit for every condition that's on
 *  (each with its colour dot): dose / time pick theirs (a "Select unit:" tip, then "Unit
 *  selected:" in success style, before the chip), the rest are greyed — a unit doesn't apply. A condition is on once it holds values (tagged or typed) or when switched on here to be
 *  mapped; a preset holding values stays on, and switching a custom one off removes it. No
 *  condition colours yet: they come in at mapping. */
function ConditionSwitches({
  fields,
  colorOf,
  cond,
  armed,
  setArmed,
  setActivated,
  onRemoveCustom,
  units,
  onUnits,
  numeric,
  onNumeric
}: {
  fields: Field[]
  /** each condition's colour — the Set unit rows' dots (the switches have none yet) */
  colorOf: ColorOf
  cond: ConditionState
  armed: Field | null
  setArmed: (f: Field | null) => void
  setActivated: Dispatch<SetStateAction<Set<Field>>>
  onRemoveCustom: (name: string) => void
  units: CondUnits
  onUnits: (units: CondUnits) => void
  /** the custom conditions declared numeric, and switching one */
  numeric: string[]
  onNumeric: (name: string, on: boolean) => void
}): ReactNode {
  const { isActive, hasValues, setOn, addCondition } = cond
  // Every condition that's on, in the list's order; only dose / time take a unit.
  const unitRows = fields.filter(isActive)
  // A condition just added lands at the end of both lists — below the fold once the switches fill
  // their part of the column — so it's scrolled into view in each, once it's there.
  const switchRef = useRef<HTMLDivElement>(null)
  const unitRef = useRef<HTMLDivElement>(null)
  const added = useRef<string | null>(null)
  const onAdd = (name: string): string | null => {
    const problem = addCondition(name)
    if (!problem) added.current = name
    return problem
  }
  // A short fade at the panel's bottom while the list runs on past it (none once scrolled to the end)
  const moreBelow = useMoreBelow(switchRef)
  useEffect(() => {
    const name = added.current
    if (!name || !fields.includes(name)) return
    added.current = null
    for (const box of [switchRef.current, unitRef.current])
      box?.querySelector(`[data-cond="${name}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [fields, unitRows.length])
  return (
    <>
      {/* oe-scroll: a scrollbar that stays shown (not macOS's overlay one) while the list runs past
          the panel */}
      <div
        ref={switchRef}
        className="oe-scroll"
        style={{ ...styles.switchSec, ...(moreBelow ? styles.listFadeBottom : null) }}
      >
        <div style={styles.panelHead}>Active conditions</div>
        <div style={styles.condList}>
          {fields.map((f) => {
            const active = isActive(f)
            const custom = !isPresetField(f)
            return (
              <span
                key={f}
                data-cond={f}
                style={styles.condToggle}
                title={
                  custom
                    ? `Switch off to delete the “${f}” condition (and its values)`
                    : active
                      ? hasValues(f)
                        ? `Switch ${f} off — its values are kept, and come back when it's on`
                        : `Switch ${f} off`
                      : `Switch ${f} on to map it`
                }
              >
                {/* Neutral (the accent), no condition colour yet: colours come in at mapping. */}
                <OnOffSwitch
                  size="lg"
                  on={active}
                  label={f}
                  title=""
                  onChange={(on) => {
                    if (!on && armed === f) setArmed(null)
                    if (custom && !on) {
                      setActivated((prev) => {
                        const next = new Set(prev)
                        next.delete(f)
                        return next
                      })
                      onRemoveCustom(f)
                    } else setOn(f, on)
                  }}
                />
                <span style={{ color: active ? UI.text : UI.textMuted }}>{f}</span>
                {/* its variable type, once it's on: numeric or categorical (the replicate is
                    neither). A custom condition's switches on a click; the presets' are fixed. */}
                {active &&
                  f !== 'rep' &&
                  (() => {
                    const num = f === 'dose' || f === 'time' || numeric.includes(f)
                    const what = num
                      ? 'Numeric: its values are numbers on a scale, with a unit'
                      : 'Categorical: its values are labels'
                    return custom ? (
                      <button
                        type="button"
                        style={{ ...styles.typeChip, ...styles.typeChipBtn }}
                        title={`${what}. Click to make it ${num ? 'categorical' : 'numeric'}.`}
                        onClick={() => onNumeric(f, !num)}
                      >
                        {num ? 'num' : 'cat'}
                      </button>
                    ) : (
                      <span style={styles.typeChip} title={`${what} (fixed for ${f}).`}>
                        {num ? 'num' : 'cat'}
                      </span>
                    )
                  })()}
              </span>
            )
          })}
          <NewConditionRow taken={fields} onAdd={onAdd} />
        </div>
      </div>
      {/* Set units: dose / time, each while it's on — the import needs one before it goes on. The
          bottom 45% of the column, there even when empty so it never moves. */}
      <div ref={unitRef} style={styles.unitSec}>
        {unitRows.length > 0 && (
          <div style={styles.unitBlock}>
            <div style={styles.panelHead}>Set unit</div>
            {unitRows.map((f) => {
              const spec = unitSpec(f, units, onUnits, numeric)
              // A condition a unit doesn't apply to (anything but dose / time): listed, greyed.
              if (!spec)
                return (
                  <span
                    key={f}
                    data-cond={f}
                    style={{ ...styles.unitRow, ...styles.unitRowNA }}
                    title={`${f} takes no unit`}
                  >
                    <span style={{ ...styles.chipDot, background: colorOf(f) }} />
                    <span style={styles.unitName}>{f}</span>
                    <span style={styles.unitNA}>unit not applicable</span>
                  </span>
                )
              return (
                <span key={f} data-cond={f} style={styles.unitRow}>
                  <span style={{ ...styles.chipDot, background: colorOf(f) }} />
                  <span style={styles.unitName}>{f}</span>
                  {/* A note right against the box: a tip asking for a unit (the import needs one),
                    then — once typed — a success note saying it's set. Any text is a unit; the
                    common ones are listed, and an SI spelling is offered for what was typed. */}
                  <span style={styles.unitPick}>
                    <StatusNote kind={spec.value ? 'ok' : 'info'} inline style={{ fontSize: 12 }}>
                      {spec.value ? 'Unit:' : 'Type a unit:'}
                    </StatusNote>
                    <UnitInput
                      value={spec.value}
                      onChange={spec.onChange}
                      suggestions={spec.options}
                    />
                  </span>
                </span>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

/** Conditions on/off, shared by the Conditions step's panels: a condition is on once it carries a
 *  value (tagged or typed), or when switched on (`activated`, kept by the dialog) with none yet —
 *  unless switched off (`hidden`, saved with the import), which keeps its values but sets it aside. */
interface ConditionState {
  hasValues: (f: Field) => boolean
  isActive: (f: Field) => boolean
  activeFields: Field[]
  /** switch a condition on or off; off keeps its values */
  setOn: (f: Field, on: boolean) => void
  /** add a custom condition, switched on; an error message when the name isn't usable */
  addCondition: (name: string) => string | null
}
function conditionState(
  samples: InteractiveSampleCond[],
  fields: Field[],
  activated: Set<Field>,
  setActivated: Dispatch<SetStateAction<Set<Field>>>,
  hidden: Set<Field>,
  onHide: (f: Field, off: boolean) => void,
  onAddCustom: (name: string) => string | null
): ConditionState {
  const hasValues = (f: Field): boolean => samples.some((s) => condOf(s, f).trim() !== '')
  const isActive = (f: Field): boolean => !hidden.has(f) && (hasValues(f) || activated.has(f))
  return {
    hasValues,
    isActive,
    activeFields: fields.filter(isActive),
    setOn: (f, on) => {
      setActivated((prev) => {
        const next = new Set(prev)
        if (on) next.add(f)
        else next.delete(f)
        return next
      })
      // Off with values sets them aside; on brings them back.
      onHide(f, !on && hasValues(f))
    },
    addCondition: (name) => {
      const problem = onAddCustom(name)
      if (!problem) setActivated((prev) => new Set(prev).add(name))
      return problem
    }
  }
}

/** The Conditions step's cards, left to right: 0 · conditions (switch on + map), 1 · Refine & edit. */
export type CondCard = 0 | 1
/** A card's pose in the Conditions step's deck: flat when in use, else parked at that side —
 *  turned on its outer edge (as a translate · rotate · translate about the centre, so a card going
 *  from one side to the other turns smoothly through flat) to angle back into the screen. */
const PARK_ANGLE = 62
function deckPose(i: CondCard, focus: CondCard): string {
  const side = Math.sign(i - focus) // -1: parked left, hinged on its left edge; 1: right
  return `perspective(1600px) translateX(${side * 50}%) rotateY(${-side * PARK_ANGLE}deg) translateX(${-side * 50}%)`
}
/** The gap between one card starting to swing and the next (rippling out from the old one). */
const CARD_RIPPLE = 70

/** The Conditions step: two cards — which conditions are on beside mapping them onto the sample
 *  names' tokens (with the separator); then the samplesheet to refine (rename values) and edit by
 *  hand. The one in use lies flat on top, the other parked at its side at an angle, swung flat
 *  when picked. */
export function ConditionsStage(props: {
  samples: InteractiveSampleCond[]
  spans: Record<string, RowSpans>
  fields: Field[]
  colorOf: ColorOf
  armed: Field | null
  setArmed: (f: Field | null) => void
  activated: Set<Field>
  setActivated: Dispatch<SetStateAction<Set<Field>>>
  /** conditions switched off that keep their values */
  hidden: Set<Field>
  onHide: (f: Field, off: boolean) => void
  onAddCustom: (name: string) => string | null
  onRemoveCustom: (name: string) => void
  onAnnotate: (refName: string, tokStart: number, tokEnd: number, activeSamples: string[]) => void
  delims: string[]
  separator: string
  onSeparator: (sep: string) => void
  units: CondUnits
  onUnits: (units: CondUnits) => void
  /** the custom conditions declared numeric, and switching one */
  numeric: string[]
  onNumeric: (name: string, on: boolean) => void
  setCell: (i: number, field: Field, value: string) => void
  setInclude: (i: number, on: boolean) => void
  onRenameValue: (field: Field, map: Record<string, string>) => void
  /** where the conditions come from: the sample names, or a samplesheet */
  condSource: 'names' | 'sheet'
  onCondSource: (v: 'names' | 'sheet') => void
  /** the samplesheet loaded (samplesheet mode), the sample columns, and changing the sheet */
  sheet: LoadedSheet | undefined
  sampleCols: string[]
  onLoadSheet: () => void
  onSheet: (next: LoadedSheet) => void
  /** the card in front — kept by the dialog, whose Next / Back turn the cards too */
  card: CondCard
  onCard: (card: CondCard) => void
}): ReactNode {
  const cond = conditionState(
    props.samples,
    props.fields,
    props.activated,
    props.setActivated,
    props.hidden,
    props.onHide,
    props.onAddCustom
  )
  // The painted names show only the conditions that are on; a switched-off one's spans are kept.
  const shownSpans: Record<string, RowSpans> = props.hidden.size
    ? Object.fromEntries(
        Object.entries(props.spans).map(([sc, rs]) => [
          sc,
          Object.fromEntries(Object.entries(rs).filter(([f]) => !props.hidden.has(f)))
        ])
      )
    : props.spans
  // Two cards, each 90% of the width (so nothing reflows), card i at i × 10%: the one in use lies
  // flat on top; the other is parked at its side, turned on its outer edge to angle back into the
  // screen, its outer 10% showing — 0 · Active conditions + Map conditions, 1 · Refine & edit. The
  // parked card is a button to pick it: its content is inert (one card in use at a time), and
  // picking it swings it flat as the one in use swings aside.
  const focus = props.card
  const pick = props.onCard
  // Where the last turn came from: the cards swing one after another, rippling out from it.
  const [shown, setShown] = useState(focus)
  const [from, setFrom] = useState(focus)
  if (shown !== focus) {
    setFrom(shown)
    setShown(focus)
  }
  // The map's connectors are measured from the screen, so redraw them once a card has settled
  // (measured mid-swing, they'd be foreshortened): any re-render redraws them.
  const [, setSettled] = useState(0)
  const reduceMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  )
  const card = (i: CondCard, name: string, body: ReactNode): ReactNode => {
    const on = focus === i
    return (
      <div
        style={{
          ...styles.deckCard,
          left: `${i * 10}%`,
          ...(on ? null : styles.deckCardAway),
          transform: deckPose(i, focus),
          transitionDelay: `${CARD_RIPPLE * Math.abs(i - from)}ms`,
          ...(reduceMotion ? { transition: 'none' } : null),
          zIndex: 10 - Math.abs(i - focus)
        }}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === 'transform')
            setSettled((n) => n + 1)
        }}
      >
        <section
          style={{
            ...styles.condPanel,
            ...styles.deckFace,
            ...(on ? null : styles.deckFaceAway)
          }}
          inert={!on}
          aria-label={name}
        >
          <div style={{ ...styles.panelHead, ...styles.cardHead }}>
            <span style={{ ...styles.condNum, ...(on ? styles.condNumOn : null) }}>{i + 1}</span>
            {name}
          </div>
          {body}
        </section>
        {!on && (
          <button
            style={styles.deckPick}
            onClick={() => pick(i)}
            title={`Show ${name}`}
            aria-label={`Show ${name}`}
          />
        )}
      </div>
    )
  }
  return (
    <>
      <div style={styles.condPanels}>
        {card(
          0,
          'Map conditions',
          <div style={styles.condSplit}>
            <div style={styles.condSplitLeft}>
              <ConditionSwitches
                fields={props.fields}
                colorOf={props.colorOf}
                cond={cond}
                armed={props.armed}
                setArmed={props.setArmed}
                setActivated={props.setActivated}
                onRemoveCustom={props.onRemoveCustom}
                units={props.units}
                onUnits={props.onUnits}
                numeric={props.numeric}
                onNumeric={props.onNumeric}
              />
            </div>
            <div style={styles.condSplitRight}>
              <div style={styles.mapHead}>
                <div style={styles.panelHead}>Map conditions to samples</div>
                <ToggleSwitch
                  size="sm"
                  label="Conditions from"
                  value={props.condSource}
                  onChange={props.onCondSource}
                  options={[
                    {
                      value: 'names',
                      label: 'Sample names',
                      title: 'Extract the conditions from the sample names'
                    },
                    {
                      value: 'sheet',
                      label: 'Samplesheet',
                      title: "Map the conditions from a samplesheet's columns"
                    }
                  ]}
                />
              </div>
              {props.condSource === 'sheet' ? (
                <SheetMapper
                  sheet={props.sheet}
                  sampleCols={props.sampleCols}
                  activeFields={cond.activeFields}
                  colorOf={props.colorOf}
                  armed={props.armed}
                  setArmed={props.setArmed}
                  onLoad={props.onLoadSheet}
                  onSheet={props.onSheet}
                />
              ) : (
                <Stage1
                  samples={props.samples}
                  spans={shownSpans}
                  colorOf={props.colorOf}
                  armed={props.armed}
                  setArmed={props.setArmed}
                  activeFields={cond.activeFields}
                  onAnnotate={props.onAnnotate}
                  delims={props.delims}
                  separator={props.separator}
                  onSeparator={props.onSeparator}
                />
              )}
            </div>
          </div>
        )}
        {card(
          1,
          'Refine & edit',
          <Stage2
            samples={props.samples}
            spans={shownSpans}
            colorOf={props.colorOf}
            delims={props.delims}
            setCell={props.setCell}
            setInclude={props.setInclude}
            onRenameValue={props.onRenameValue}
            units={props.units}
            onUnits={props.onUnits}
            numeric={props.numeric}
            onNumeric={props.onNumeric}
            onAddCondition={cond.addCondition}
            activeFields={cond.activeFields}
          />
        )}
        {/* Over the parked card's strip: a chevron to turn to it — forward on the first card,
            back on the second. Keyed by the card, so it fades in afresh after each turn. */}
        <div
          key={focus}
          style={{ ...styles.deckNextWrap, ...(focus === 0 ? { right: 0 } : { left: 0 }) }}
        >
          <button
            className={focus === 0 ? 'oe-deck-next' : 'oe-deck-next oe-deck-back'}
            style={styles.deckNext}
            onClick={() => pick(focus === 0 ? 1 : 0)}
            title={focus === 0 ? 'Next: Refine & edit' : 'Back: map conditions'}
            aria-label={focus === 0 ? 'Next: Refine & edit' : 'Back: map conditions'}
          >
            <svg width="28" height="56" viewBox="0 0 28 56" fill="none" aria-hidden>
              <path
                d={focus === 0 ? 'M6 4l16 24-16 24' : 'M22 4L6 28l16 24'}
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </>
  )
}
