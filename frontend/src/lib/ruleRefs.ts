/**
 * The rule behind each result, as a short tag next to its title.
 *
 * A regulation clause is shown only when an encoded regulatory check actually tested the same room
 * for the same kind of rule (a result exists for that element). Otherwise the tag names the screening
 * rule the engine used and says it is a screening rule, not a regulation. Nothing is inferred.
 */
import type { ComplianceResult, RegulatoryEvaluation } from '../types'
import type { FindingView } from './present'

/** Engine rule (backend title) -> regulatory check families that test the same thing, in priority order. */
const FAMILY: Record<string, string[]> = {
  'Connected to an identified escape point': ['READY-ESCAPE'],
  'Potentially disconnected occupied space': ['READY-ESCAPE'],
  'No door identified - connectivity cannot be established': ['READY-ESCAPE'],
  'Route reaches a stair whose onward connection was not identified': ['READY-ESCAPE'],
  'No escape points identified in the design': ['READY-ESCAPE'],
  'Corridor has a single escape direction (dead-end branch)': ['ONE-ROUTE', 'DEAD-END', 'TWO-MEANS'],
  'Corridor has two or more independent escape directions': ['ONE-ROUTE', 'DEAD-END', 'TWO-MEANS'],
  'Corridor without an identified escape connection': ['ONE-ROUTE', 'DEAD-END', 'TWO-MEANS'],
  'Hazardous machinery space: only one independent escape route identified': ['MACH-PAX', 'MACH-A'],
  'Hazardous space connected to an identified escape point': ['MACH-PAX', 'MACH-A', 'MACH-OTHER', 'READY-ESCAPE'],
  'Hazardous space without identified escape connection': ['READY-ESCAPE', 'MACH-OTHER'],
  'Hazardous-space escape accessibility requires review': ['MACH-PAX', 'MACH-A', 'MACH-OTHER', 'READY-ESCAPE'],
  'Escape-point information missing': ['READY-ESCAPE'],
  'Documented fire integrity below the SOLAS table class': ['FIRE-INTEGRITY'],
  'Documented fire integrity meets the SOLAS table class': ['FIRE-INTEGRITY'],
  'Fire-separation verification required': ['FIRE-INTEGRITY'],
  'Fire-risk space: boundary information missing': ['FIRE-INTEGRITY'],
}

export interface RuleRef {
  kind: 'clause' | 'screening'
  code: string            // short tag, e.g. "SOLAS II-2 13.3.1.2" or "SYN-ESC-001"
  more: number            // further clauses testing the same room
  title: string           // tooltip
  result?: ComplianceResult
}

/** "SOLAS-II2-13.3.1.2-ONE-ROUTE-PAX" -> "SOLAS II-2 13.3.1.2"; "MARPOL-I-12A.7-SIDE-PROTECTION" -> "MARPOL I 12A.7". */
export function clauseCode(specId: string): string {
  const solas = specId.match(/^SOLAS-II2-([\d.]+)-/)
  if (solas) return `SOLAS II-2 ${solas[1]}`
  const marpol = specId.match(/^MARPOL-I-([\w.]+?)-/)
  if (marpol) return `MARPOL I ${marpol[1]}`
  return specId.replace(/-/g, ' ')
}

const familyOf = (specId: string, fam: string) => specId.includes(`-${fam}`)

export function buildRuleRefs(views: FindingView[], reg: RegulatoryEvaluation | null): Map<string, RuleRef> {
  const out = new Map<string, RuleRef>()
  const byElement = new Map<string, ComplianceResult[]>()
  for (const r of reg?.results ?? []) {
    if (r.status === 'NOT_APPLICABLE' || !r.element_ids[0]) continue
    const k = r.element_ids[0]
    byElement.set(k, [...(byElement.get(k) ?? []), r])
  }
  const specs = new Map((reg?.specs ?? []).map((s) => [s.spec_id, s]))
  for (const v of views) {
    const fams = FAMILY[v.raw.title] ?? []
    const candidates = (v.elementId ? byElement.get(v.elementId) ?? [] : [])
    const hits: ComplianceResult[] = []
    for (const fam of fams) for (const r of candidates) if (familyOf(r.spec_id, fam) && !hits.includes(r)) hits.push(r)
    if (hits.length) {
      const r = hits[0]
      const spec = specs.get(r.spec_id)
      const state = [spec?.quote_verified ? 'quote verified against the stored regulation text' : 'quote not verified',
        spec?.validation_status === 'engineer_validated' ? `engineer-validated${spec.validated_by ? ` by ${spec.validated_by}` : ''}` : 'rule encoding not yet engineer-validated'].join('; ')
      out.set(v.id, {
        kind: 'clause', code: clauseCode(r.spec_id), more: hits.length - 1, result: r,
        title: `Tested against ${clauseCode(r.spec_id)} (${r.title}): ${state}.`
          + (hits.length > 1 ? ` Also tested: ${hits.slice(1).map((h) => clauseCode(h.spec_id)).join(', ')}.` : ''),
      })
      continue
    }
    const screening = v.raw.requirement_refs.find((x) => x.startsWith('SYN-'))
    if (screening) out.set(v.id, {
      kind: 'screening', code: screening, more: 0,
      title: `Screening rule ${screening}: a project rule used to flag the drawing for review. No regulation clause was tested for this room${reg ? '' : ' (regulatory corpus not loaded)'}.`,
    })
  }
  return out
}
