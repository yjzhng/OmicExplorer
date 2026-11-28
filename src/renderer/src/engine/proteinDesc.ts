/** A protein's description — its name as a sentence ("Histone deacetylase 1") — from its annotation
 *  record: the interactive import's `proteinName`, else the first column named like one (protein
 *  name / description / product). What the gene selectors list beside a gene and search. */
export function proteinDescOf(rec: Record<string, string> | undefined): string | undefined {
  if (!rec) return undefined
  if (rec.proteinName) return rec.proteinName
  const key = Object.keys(rec).find((c) => /protein[_. ]?name|description|product/i.test(c))
  return key ? rec[key] : undefined
}

/** Every protein's description (proteinDescOf), by uniqID, from an annotation map. */
export function proteinDescs(
  annotationMap: Record<string, Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id in annotationMap) {
    const d = proteinDescOf(annotationMap[id])
    if (d) out[id] = d
  }
  return out
}
