/** Sectioned User Guide dialog: a left section list + a scrollable content pane. Content
 *  documents the real ingest contract (data folder layout, wide/long data shape, samplesheet,
 *  and the optional ID-mapping DB file), plus the workflow and export basics. */
import { useState, type CSSProperties, type ReactNode } from 'react'

import { UI } from './theme'

interface Section {
  id: string
  title: string
  body: ReactNode
}

const SECTIONS: Section[] = [
  {
    id: 'start',
    title: 'Getting started',
    body: (
      <>
        <P>
          OmicExplorer builds an analysis as a pipeline of connected tiles on the <B>Workflow</B>{' '}
          canvas, and shows the outputs on the <B>Results</B> dashboard. Switch between them with
          the toggle in the top nav.
        </P>
        <P>A typical flow reads left to right:</P>
        <Flow
          steps={['Load data', 'Standardize', 'Compare / Contrast', 'Plots', 'Run → Results']}
        />
        <UL
          items={[
            <>
              <B>Load</B> points at your data + samplesheet (+ optional ID-mapping DB).
            </>,
            <>
              <B>Standardize</B> ingests them into one tidy table (and is where you can set
              genes-of-interest).
            </>,
            <>
              <B>Compare</B> runs a comparison (e.g. treated vs vehicle); <B>Contrast</B> compares
              two comparisons.
            </>,
            <>
              <B>Plots</B> (volcano, MA, heatmap, …) hang off a Standardize/Compare/Contrast step.
            </>,
            <>
              <B>Run</B> / <B>Re-run</B> computes everything; open <B>Results</B> to see tables and
              plots grouped by analysis.
            </>
          ]}
        />
        <P>
          A project is saved as a single <Code>.omicexplorer</Code> file (workflow + results).
        </P>
      </>
    )
  },
  {
    id: 'folder',
    title: 'Data folder structure',
    body: (
      <>
        <P>
          A project points at a <B>data folder</B> on disk. Put your input CSVs there. The folder is
          scanned at its root and in the <Code>input/</Code> and <Code>data/</Code> subfolders — the
          convention is to keep inputs in <Code>input/</Code>.
        </P>
        <CodeBlock>{`my_project/
  input/
    example_long.csv       # data matrix (stem ends _long or _wide)
    example_samplesheet.csv # sample → conditions
    organism_DB.csv        # optional: feature-ID → gene mapping
  output/                  # plot/table exports land here
  temp/                    # auto-saved processed tables`}</CodeBlock>
        <UL
          items={[
            <>
              <B>output/</B> is created when you export plots or tables.
            </>,
            <>
              <B>temp/</B> holds a CSV of each computed step (a debug/scratch copy — nothing reads
              it back).
            </>,
            <>The three input files are chosen per Load tile; only the data matrix is required.</>
          ]}
        />
      </>
    )
  },
  {
    id: 'data',
    title: 'Data file (shape)',
    body: (
      <>
        <P>
          The intensity / abundance matrix. Its filename <B>stem must end in</B> <Code>_wide</Code>{' '}
          or <Code>_long</Code> — that is how the format is detected.
        </P>
        <H>Long — one row per feature × sample</H>
        <P>
          Columns: a <B>feature-ID</B> column, a <B>sample</B> column (named <Code>sample</Code>,{' '}
          <Code>well</Code>, or <Code>position</Code>), and <Code>value</Code>.
        </P>
        <CodeBlock>{`UniProtID,well,value
O05154,D1,305.15
O05154,D2,260.60
P99999,D1,1024.7`}</CodeBlock>
        <H>Wide — one row per feature</H>
        <P>
          First column is the feature ID; every remaining column is one sample (its header is the
          sample name); cells are the value.
        </P>
        <CodeBlock>{`UniProtID,A1,A2,B1,B2
O05154,305.15,260.60,298.4,271.9
P99999,1024.7,980.2,1102.5,1043.1`}</CodeBlock>
        <P>
          The feature-ID column name (e.g. <Code>UniProtID</Code>) should match a column in the DB
          file so IDs can be mapped to genes.
        </P>
      </>
    )
  },
  {
    id: 'samplesheet',
    title: 'Samplesheet',
    body: (
      <>
        <P>
          Describes each sample's experimental conditions. Headers are matched{' '}
          <B>case-insensitively</B>.
        </P>
        <H>Sample key</H>
        <P>
          One of <Code>sample</Code>, <Code>well</Code>, <Code>position</Code>, or{' '}
          <Code>plate</Code>+<Code>well</Code> (combined as <Code>plate_well</Code>). It must match
          the sample identifiers used in the data file.
        </P>
        <H>Condition columns</H>
        <UL
          items={[
            <>
              <Code>strain</Code>, <Code>cmpd</Code> (compound) — text
            </>,
            <>
              <Code>dose</Code>, <Code>time</Code>, <Code>rep</Code> (replicate) — numeric
            </>
          ]}
        />
        <CodeBlock>{`well,strain,cmpd,dose,rep
A1,WT,Amk,10,1
A2,WT,Amk,10,2
B1,clpP,Amk,5,1`}</CodeBlock>
        <P>
          Only samples listed here are kept — rows in the data file with no matching sample are
          dropped.
        </P>
      </>
    )
  },
  {
    id: 'db',
    title: 'ID mapping (DB file)',
    body: (
      <>
        <P>
          <B>Optional.</B> Maps raw feature IDs to a stable <Code>uniqID</Code> and a readable gene
          label. Without it, feature IDs pass through unchanged.
        </P>
        <UL
          items={[
            <>
              Required column: <Code>uniqID</Code>.
            </>,
            <>
              Plus one or more <B>ID columns</B> (e.g. <Code>UniProtID</Code>,{' '}
              <Code>locus_tag</Code>, <Code>GeneID</Code>) and <B>label columns</B> (
              <Code>gene</Code>, <Code>product</Code>
              ).
            </>,
            <>
              The data file's feature-ID column is auto-matched to a DB column of the{' '}
              <B>same name</B> (e.g. <Code>UniProtID</Code>), then mapped to <Code>uniqID</Code>.
            </>,
            <>
              Display label = gene name(s), joined by <Code>/</Code>; else <Code>locus_tag</Code>;
              else <Code>uniqID</Code>.
            </>
          ]}
        />
        <CodeBlock>{`uniqID,UniProtID,locus_tag,gene,product
g0001,Q2G2H5,SAOUHSC_00001,dnaA,Chromosomal replication initiator
g0002,Q2G2H4,SAOUHSC_00002,,Beta sliding clamp`}</CodeBlock>
      </>
    )
  },
  {
    id: 'export',
    title: 'Running & exporting',
    body: (
      <>
        <P>
          <B>Run</B> / <B>Re-run</B> (top nav) computes the pipeline. <B>Results</B> shows each
          analysis as a tab of tables and plots.
        </P>
        <UL
          items={[
            <>
              <B>Genes of interest:</B> set focus genes on Standardize (or per plot) to highlight
              them everywhere; each plot tile has an <B>All / GOI</B> toggle to show all genes or
              only the focus subset.
            </>,
            <>
              <B>Export</B> (nav) batch-writes plots (PNG/PDF at a chosen DPI) and tables (CSV/XLSX)
              into the project's <Code>output/</Code> folder. Faceted plots export every facet; a
              GOI-subset variant of each is written under a <Code>GOI/</Code> subfolder.
            </>,
            <>
              Each Results panel has a <B>download</B> button (top-right) to save just that plot or
              table.
            </>
          ]}
        />
      </>
    )
  }
]

export function UserGuide({ onClose }: { onClose: () => void }): ReactNode {
  const [active, setActive] = useState(SECTIONS[0].id)
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]
  return (
    <>
      <div style={styles.scrim} onClick={onClose} />
      <div style={styles.modal} role="dialog" aria-label="User guide">
        <div style={styles.head}>
          <span style={styles.headTitle}>User guide</span>
          <button style={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={styles.body}>
          <nav style={styles.nav}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                style={{
                  ...styles.navItem,
                  background: s.id === active ? UI.accent : 'transparent',
                  color: s.id === active ? UI.accentText : UI.text
                }}
              >
                {s.title}
              </button>
            ))}
          </nav>
          <div style={styles.content}>
            <h2 style={styles.contentTitle}>{section.title}</h2>
            {section.body}
          </div>
        </div>
      </div>
    </>
  )
}

// ── content helpers ───────────────────────────────────────────────────────────
function P({ children }: { children: ReactNode }): ReactNode {
  return <p style={styles.p}>{children}</p>
}
function H({ children }: { children: ReactNode }): ReactNode {
  return <h3 style={styles.h}>{children}</h3>
}
function B({ children }: { children: ReactNode }): ReactNode {
  return <strong style={{ color: UI.text }}>{children}</strong>
}
function Code({ children }: { children: ReactNode }): ReactNode {
  return <code style={styles.codeInline}>{children}</code>
}
function CodeBlock({ children }: { children: string }): ReactNode {
  return <pre style={styles.codeBlock}>{children}</pre>
}
function UL({ items }: { items: ReactNode[] }): ReactNode {
  return (
    <ul style={styles.ul}>
      {items.map((it, i) => (
        <li key={i} style={styles.li}>
          {it}
        </li>
      ))}
    </ul>
  )
}
function Flow({ steps }: { steps: string[] }): ReactNode {
  return (
    <div style={styles.flow}>
      {steps.map((s, i) => (
        <span key={s} style={styles.flowRow}>
          <span style={styles.flowStep}>{s}</span>
          {i < steps.length - 1 && <span style={styles.flowArrow}>→</span>}
        </span>
      ))}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  scrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60 },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 820,
    maxWidth: '94vw',
    height: 620,
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 61,
    overflow: 'hidden'
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    flex: '0 0 auto'
  },
  headTitle: { fontWeight: 700, fontSize: 14, color: UI.text },
  close: {
    marginLeft: 'auto',
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    fontSize: 14,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1
  },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  nav: {
    flex: '0 0 200px',
    borderRight: `1px solid ${UI.border}`,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflow: 'auto',
    background: UI.panelAlt
  },
  navItem: {
    textAlign: 'left',
    border: 'none',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  },
  content: { flex: 1, minWidth: 0, overflow: 'auto', padding: '18px 22px', color: UI.text },
  contentTitle: { margin: '0 0 12px', fontSize: 17, fontWeight: 700, color: UI.text },
  p: { margin: '0 0 12px', fontSize: 13, lineHeight: 1.6, color: UI.textMuted },
  h: { margin: '18px 0 6px', fontSize: 13, fontWeight: 700, color: UI.text },
  ul: { margin: '0 0 12px', paddingLeft: 18 },
  li: { fontSize: 13, lineHeight: 1.6, color: UI.textMuted, marginBottom: 4 },
  codeInline: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '1px 5px',
    color: UI.text,
    whiteSpace: 'nowrap'
  },
  codeBlock: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    lineHeight: 1.5,
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '10px 12px',
    margin: '0 0 12px',
    color: UI.text,
    overflowX: 'auto',
    whiteSpace: 'pre'
  },
  flow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    margin: '0 0 14px'
  },
  flowRow: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  flowStep: {
    fontSize: 12,
    fontWeight: 600,
    color: UI.text,
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 14,
    padding: '4px 11px',
    whiteSpace: 'nowrap'
  },
  flowArrow: { color: UI.textMuted, fontSize: 12 }
}
