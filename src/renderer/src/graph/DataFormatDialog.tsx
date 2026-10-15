/** The "Manual data input" window: a section per input file (datamatrix, samplesheet,
 *  metadata) with its file-name convention, its format requirements and the bundled example as
 *  folding tables, and buttons that save the example or the blank template through the system's
 *  save window. The files themselves live in templates/ at the repo root and are bundled as text,
 *  so the window works offline and matches what's documented. */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Papa from 'papaparse'

import exampleDatamatrix from '../../../../templates/example_datamatrix.csv?raw'
import exampleSamplesheet from '../../../../templates/example_samplesheet.csv?raw'
import exampleMetadata from '../../../../templates/example_metadata.csv?raw'
import templateDatamatrix from '../../../../templates/template_datamatrix.csv?raw'
import templateSamplesheet from '../../../../templates/template_samplesheet.csv?raw'
import templateMetadata from '../../../../templates/template_metadata.csv?raw'
import { Chevron } from '../ui/Chevron'
import { InfoTip } from '../ui/InfoTip'
import { StatusNote } from '../ui/StatusNote'
import { cssVars, PALETTES, UI } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'

export type DataFormatTab = 'datamatrix' | 'samplesheet' | 'metadata'

const FILES: {
  id: DataFormatTab
  example: string
  template: string
  /** a rule worth calling out, as an (i) tip right of the file name */
  tip?: string
  /** whether the file itself is needed for a manual import */
  fileRequired: boolean
  /** whether the example's column `i` (named `name`) is required */
  required: (name: string, i: number) => boolean
  /** the column's name in the template, where the example's is a real one (a sample's) */
  typeOf?: (name: string, i: number) => string
  /** the column guide: what each column is and does, as a header row and its rows */
  columns: { head: string[]; rows: string[][] }
}[] = [
  {
    id: 'datamatrix',
    fileRequired: true,
    // Its columns are named after the data (the samples), so each is shown as the template's.
    typeOf: (_, i) => (i === 0 ? 'UniProtIDs' : `sample_${i}`),
    // The ID column and the sample columns: every column of a wide datamatrix is needed.
    required: () => true,
    example: exampleDatamatrix,
    template: templateDatamatrix,
    columns: {
      head: ['Column', 'Role', 'Notes'],
      rows: [
        [
          'UniProtIDs',
          'Feature ID, one row per protein group',
          'As your search engine exported them: “;”-joined groups, isoforms (P06733-2) and FASTA headers (sp|O14733|MP2K7_HUMAN) all work. Decoys (REV__, rev_, DECOY_) are kept but never annotated'
        ],
        [
          'sample_name*',
          'Measured values, one column per sample',
          'The header is the sample name: unique, and listed in the samplesheet. Blank, NA, NaN and 0 mean not measured; raw or logged values both work'
        ]
      ]
    }
  },
  {
    id: 'samplesheet',
    fileRequired: true,
    required: (name) => name === 'sample',
    example: exampleSamplesheet,
    template: templateSamplesheet,
    tip: 'Sample names must match the column names in the datamatrix.',
    columns: {
      head: ['Column', 'Type', 'Role', 'Notes'],
      rows: [
        [
          'sample',
          'identity',
          'Names the sample',
          'Must match a datamatrix column name; samples not listed here are dropped'
        ],
        [
          'cell',
          'categorical',
          'Groups samples: compare, contrast, facets, colours',
          'Cell line or strain (“strain” is also read)'
        ],
        [
          'cmpd',
          'categorical',
          'Groups samples: compare, contrast, facets, colours',
          'Compound or treatment'
        ],
        [
          'dose',
          'numeric',
          'Curve-fit axis (dose, or dose × time); also groups samples',
          'A number; 0 is the vehicle. Unit set on the Load tile'
        ],
        [
          'time',
          'numeric',
          'Curve-fit axis (time, or dose × time); also groups samples',
          'A number. Unit set on the Load tile'
        ],
        [
          'rep',
          'numeric',
          'Replicate number within a condition',
          'Numbered automatically when absent'
        ],
        [
          'custom*',
          'categorical',
          'Groups samples, like cell and cmpd',
          'Any other column, e.g. medium or batch. Lowercase name; a column different on every sample is ignored'
        ]
      ]
    }
  },
  {
    id: 'metadata',
    fileRequired: false,
    required: (name) => name === 'uniqID',
    example: exampleMetadata,
    template: templateMetadata,
    tip: 'UniProt IDs must be unique per row and match the UniProtIDs in the datamatrix.',
    columns: {
      head: ['Column', 'Type', 'Source', 'Annotation', 'Organisms'],
      rows: [
        ['uniqID', 'identity', 'UniProt', 'identifier', 'all'],
        ['gene', 'identity', 'UniProt', 'single term', 'all'],
        ['locus', 'identity', 'UniProt (ordered locus name, e.g. Rv0001)', 'single term', 'all'],
        ['proteinName', 'description', 'UniProt', 'single term', 'all'],
        ['taxon', 'organism', 'UniProt (NCBI taxon id)', 'identifier', 'all'],
        ['GO_BP, GO_MF, GO_CC', 'function', 'Gene Ontology', 'multiple terms', 'all'],
        ['KEGG', 'pathway', 'KEGG', 'multiple terms', 'all'],
        [
          'KEGG_cat, KEGG_grp',
          'pathway level',
          'KEGG BRITE',
          'multiple terms, one per KEGG term',
          'all'
        ],
        ['Reactome', 'pathway', 'Reactome', 'multiple terms', 'human'],
        [
          'Reactome_grp, Reactome_cat',
          'pathway level',
          'Reactome',
          'multiple terms, one per Reactome term',
          'human'
        ],
        [
          'COG, COG_cat, COG_area',
          'orthology / function',
          'COG (via eggNOG)',
          'multiple terms',
          'prokaryotes'
        ],
        [
          'KOG, KOG_cat, KOG_area',
          'orthology / function',
          'KOG (via eggNOG)',
          'multiple terms',
          'eukaryotes'
        ],
        ['MSigDB', 'gene set', 'MSigDB hallmark', 'multiple terms', 'human, mouse'],
        ['stringId', 'interaction', 'STRING', 'identifier', 'all'],
        ['DEG', 'essentiality', 'Database of Essential Genes', 'single term', 'all']
      ]
    }
  }
]

export function DataFormatDialog({
  initialTab,
  onClose
}: {
  /** the file whose section starts expanded */
  initialTab: DataFormatTab
  onClose: () => void
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    // Re-establish the theme CSS variables inside the portal (document.body is outside the app
    // root where they're defined).
    <div style={cssVars(PALETTES[mode])}>
      <div style={styles.scrim} onClick={onClose} />
      <div style={styles.modal} role="dialog" aria-label="Manual data input">
        <div style={styles.head}>
          <span style={styles.title}>Manual data input</span>
          <button style={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={styles.body}>
          {FILES.map((f) => (
            <FileSection key={f.id} file={f} startOpen={f.id === initialTab} />
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

/** One input file: its name and the downloads, its file-name convention (with its tip), its
 *  format requirements, and the example as a folding tile (folded at first). The whole section
 *  folds under its name; only the one the window was opened at starts open — the datamatrix, from
 *  the panel's link. */
function FileSection({
  file,
  startOpen
}: {
  file: (typeof FILES)[number]
  startOpen: boolean
}): ReactNode {
  const { id, example, template, tip, fileRequired, required, typeOf, columns } = file
  // The example starts folded: the format requirements above it are what to read first.
  const [open, setOpen] = useState(false)
  const [sectionOpen, setSectionOpen] = useState(startOpen)
  const onToggle = (): void => setOpen((v) => !v)
  const [saved, setSaved] = useState<{ ok: boolean; text: string } | null>(null)
  const [head, ...rows] = useMemo(() => Papa.parse<string[]>(example.trim()).data, [example])

  // Save the example or the blank template through the system's save window.
  const download = async (which: 'example' | 'template'): Promise<void> => {
    setSaved(null)
    try {
      const path = await window.api.pickSavePath({
        defaultPath: `${which}_${id}.csv`,
        ext: 'csv',
        typeName: 'CSV table'
      })
      if (!path) return
      await window.api.writeWorkflow(path, which === 'example' ? example : template)
      setSaved({ ok: true, text: `Saved ${path.split(/[/\\]/).pop()}` })
    } catch (e) {
      setSaved({ ok: false, text: e instanceof Error ? e.message : `Could not save the ${which}` })
    }
  }

  return (
    <div style={styles.file}>
      {/* The file's row: its name, and the downloads on the right. */}
      <div style={styles.fileHead}>
        <button
          style={styles.fileToggle}
          onClick={() => setSectionOpen((v) => !v)}
          aria-expanded={sectionOpen}
        >
          <Chevron size={10} deg={sectionOpen ? 90 : 0} />
          <span style={styles.fileName}>{id.toUpperCase()}</span>
        </button>
        <span style={fileRequired ? styles.chipRequired : styles.chipOptional}>
          {fileRequired ? 'required' : 'optional'}
        </span>
        <span style={styles.actions}>
          {saved && (
            <StatusNote kind={saved.ok ? 'ok' : 'error'} inline>
              {saved.text}
            </StatusNote>
          )}
          <button style={styles.btn} onClick={() => void download('example')}>
            Download example
          </button>
          <button style={styles.btnPrimary} onClick={() => void download('template')}>
            Download template
          </button>
        </span>
      </div>
      {/* Everything about the file, indented under its name; folds with the chevron. */}
      {sectionOpen && (
        <div style={styles.fileBody}>
          {/* The file-name convention: any project name, then the file's own suffix. */}
          <div style={styles.fileConvention}>
            <span style={styles.fileConventionLabel}>File name: </span>
            <span style={styles.fileConventionStem}>project_</span>
            {id}.csv
            {tip && (
              <span style={styles.fileTip}>
                <InfoTip label={`About ${id}`}>{tip}</InfoTip>
              </span>
            )}
          </div>
          {/* The format requirements: what each column is and what the app does with it, always
            shown, under a label like the filename's. */}
          <div style={styles.fileConventionLabel}>Format requirements:</div>
          <div style={{ ...styles.tableWrap, maxHeight: 'none' }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {columns.head.map((h) => (
                    <th key={h} style={{ ...styles.guideTh, ...styles.thLast }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {columns.rows.map((r) => (
                  <tr key={r[0]}>
                    {r.map((c, j) => (
                      <td key={j} style={j === 0 ? styles.guideName : styles.guideTd}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* The table is an EXAMPLE, not the user's data: its badge says so. Only the table
              folds; the file's name row and downloads stay in view. */}
          <div style={styles.exampleFrame}>
            <button style={styles.exampleHead} onClick={onToggle} aria-expanded={open}>
              <Chevron size={10} deg={open ? 90 : 0} />
              <span style={styles.exampleBadge}>EXAMPLE</span>
              <span style={styles.exampleName}>example_{id}.csv</span>
            </button>
            {open && (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  {/* Three sticky header rows: required/optional, the column's name, and — where
                  the example's names are real ones — the template's name. The last carries the
                  rule under the header. */}
                  <thead>
                    <tr>
                      {head.map((h, i) => (
                        <th key={i} style={styles.thTag}>
                          <span style={required(h, i) ? styles.chipRequired : styles.chipOptional}>
                            {required(h, i) ? 'required' : 'optional'}
                          </span>
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {head.map((h, i) => (
                        <th
                          key={i}
                          style={typeOf ? styles.th : { ...styles.th, ...styles.thLast }}
                          title={h}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                    {typeOf && (
                      <tr>
                        {head.map((h, i) => (
                          <th key={i} style={{ ...styles.thType, ...styles.thLast }}>
                            {typeOf(h, i)}
                          </th>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        {head.map((_, j) => (
                          <td key={j} style={styles.td} title={r[j] ?? ''}>
                            {r[j] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  scrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 70 },
  modal: {
    // Centred by auto margins, not translate(−50%), which blurs text on odd window sizes.
    position: 'fixed',
    inset: 0,
    margin: 'auto',
    // A fixed size: folding a table open scrolls the body instead of resizing the window.
    height: 'min(88vh, 820px)',
    width: 'min(760px, 94vw)',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 71,
    overflow: 'hidden'
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt
  },
  title: { fontWeight: 700, fontSize: 14, color: UI.text },
  close: {
    marginLeft: 'auto',
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    fontSize: 14,
    cursor: 'pointer'
  },
  body: {
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 22,
    flex: 1,
    overflow: 'auto',
    // Room for the scrollbar is kept on the right whether or not it shows, so opening a table
    // (which makes the body scroll) never shifts the content sideways.
    scrollbarGutter: 'stable',
    minHeight: 0
  },
  // One file: no box of its own — its name row, then its content indented below.
  // minWidth 0 down the column: a wide table scrolls inside its tile instead of widening the page.
  file: { display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 auto', minWidth: 0 },
  fileHead: { display: 'flex', alignItems: 'center', gap: 10, color: UI.text },
  fileName: { fontWeight: 700, fontSize: 13, letterSpacing: 0.6, flex: '0 0 auto' },
  // Required / optional chips: the file's, and each table column's.
  chipRequired: {
    display: 'inline-block',
    whiteSpace: 'nowrap',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: UI.warn,
    border: `1px solid ${UI.warn}`,
    borderRadius: 999,
    padding: '1px 7px'
  },
  chipOptional: {
    display: 'inline-block',
    whiteSpace: 'nowrap',
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 999,
    padding: '1px 7px'
  },
  // The file's fold toggle: a chevron and its name, as one bare button.
  fileToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: UI.text,
    cursor: 'pointer'
  },
  fileBody: { display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 16, minWidth: 0 },
  fileConvention: { fontSize: 12, color: UI.text, fontFamily: 'ui-monospace, monospace' },
  fileTip: { marginLeft: 6, verticalAlign: 'middle', fontFamily: 'inherit' },
  // The section's labels ("File name:", "Format requirements:"): bold, in the paragraph font.
  fileConventionLabel: {
    fontSize: 12,
    color: UI.text,
    fontFamily: 'system-ui, sans-serif',
    fontWeight: 700
  },
  fileConventionStem: { color: UI.textMuted, opacity: 0.6 },
  guideTh: {
    position: 'sticky',
    top: 0,
    background: UI.panelAlt,
    textAlign: 'left',
    fontWeight: 600,
    padding: '5px 8px',
    whiteSpace: 'nowrap'
  },
  // The guide's cells wrap (its notes are sentences); the column name stays on one line.
  guideName: {
    padding: '5px 8px',
    borderBottom: `1px solid ${UI.border}`,
    verticalAlign: 'top',
    whiteSpace: 'nowrap',
    fontFamily: 'ui-monospace, monospace'
  },
  guideTd: {
    padding: '5px 8px',
    borderBottom: `1px solid ${UI.border}`,
    verticalAlign: 'top',
    lineHeight: 1.4
  },
  // The example: no frame of its own — its EXAMPLE badge marks it as a sample, the table under it.
  exampleFrame: {
    minWidth: 0,
    marginTop: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minHeight: 0
  },
  // The fold toggle for the table: a bare button across the section's width.
  exampleHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: 0,
    background: 'transparent',
    border: 'none',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 11,
    color: UI.text
  },
  exampleBadge: {
    background: UI.info,
    color: UI.panel,
    borderRadius: 4,
    padding: '1px 6px',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.6
  },
  exampleName: { color: UI.text, fontFamily: 'ui-monospace, monospace' },
  tableWrap: {
    maxWidth: '100%',
    overflow: 'auto',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panel,
    maxHeight: '40vh'
  },
  table: { borderCollapse: 'collapse', fontSize: 11, color: UI.text },
  // The name row: sticky under the required/optional row; fixed heights keep the offsets exact.
  th: {
    position: 'sticky',
    top: 22,
    height: 22,
    boxSizing: 'border-box',
    background: UI.panelAlt,
    textAlign: 'left',
    fontWeight: 600,
    padding: '4px 8px 2px',
    whiteSpace: 'nowrap',
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  // The template-name row: sticky under the names, grey, in the template's own (monospace) form.
  thType: {
    position: 'sticky',
    top: 44,
    height: 18,
    boxSizing: 'border-box',
    background: UI.panelAlt,
    textAlign: 'left',
    padding: '0 8px',
    fontWeight: 400,
    fontSize: 10,
    color: UI.textMuted,
    fontFamily: 'ui-monospace, monospace',
    whiteSpace: 'nowrap'
  },
  // The required/optional row, first and pinned at the top.
  thTag: {
    position: 'sticky',
    top: 0,
    height: 22,
    boxSizing: 'border-box',
    background: UI.panelAlt,
    textAlign: 'left',
    padding: '4px 8px 0'
  },
  // The rule under the header, on whichever row is its last.
  thLast: { borderBottom: `1px solid ${UI.border}` },
  td: {
    padding: '4px 8px',
    borderBottom: `1px solid ${UI.border}`,
    whiteSpace: 'nowrap',
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontFamily: 'ui-monospace, monospace'
  },
  actions: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  btn: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: UI.accent,
    color: UI.accentText,
    border: 'none',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  }
}
