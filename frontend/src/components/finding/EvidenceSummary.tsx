import { useState } from 'react'
import type { Evidence, SupportingFact } from '../../types'
import type { Review } from '../../state/useReview'
import EvidenceSourceBadge from './EvidenceSourceBadge'

/** Shorter wording for list display only. The full statement stays in the technical details. */
export function plainFact(s: string): string {
  return s
    .replace(/\s*-\s*R-[A-Z0-9-]+ matched label '([^']+)'/g, ' (label "$1" on the drawing)')
    .replace(/\s*R-[A-Z0-9-]+: \/.*?\/ matched drawing label '([^']+)'/g, ' (label "$1" on the drawing)')
    .replace(/node-independent/g, 'separate')
    .replace(/Extracted polygon area/g, 'Room area calculated from the drawing:')
    .replace(/\bm2\b/g, 'm²')
    .replace(/\s+/g, ' ')
    .trim()
}

// facts that explain the finding come first: shortfalls, then missing items, routes and relations;
// room areas and label-matching details last
const ORDER: Record<string, number> = { measurement: 1, absence: 2, path: 3, relationship: 4, classification: 5 }
const rank = (f: SupportingFact) =>
  /BELOW the table class|lower class/i.test(f.statement) ? 0
    : /Extracted polygon area/i.test(f.statement) ? 6
      : ORDER[f.kind] ?? 9

/** Compact, plain-language rows: source, statement, and a link to the location on the drawing. */
export default function EvidenceSummary({ facts, evidence, active, onEvidence, limit = 4 }: {
  facts: SupportingFact[]; evidence: Evidence[] | null; active: string | null; onEvidence: Review['showEvidence']; limit?: number
}) {
  const [all, setAll] = useState(false)
  if (!facts.length) return <p className="text-[13px] text-faint">No supporting facts recorded.</p>
  const evMap = new Map((evidence ?? []).map((e) => [e.id, e]))
  const sorted = [...facts].sort((a, b) => rank(a) - rank(b))
  const shown = all ? sorted : sorted.slice(0, limit)
  return <div>
    <ul className="divide-y divide-navy-800 rounded border border-navy-800">
      {shown.map((s, i) => {
        const loc = s.evidence_ids.map((id) => evMap.get(id)).find((e) => e?.bbox)
        return <li key={i} className="flex items-start gap-2 px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <div className="line-clamp-3 text-[13px] leading-snug text-ink" title={s.statement}>{plainFact(s.statement)}</div>
            <div className="mt-0.5"><EvidenceSourceBadge p={s.provenance} /></div>
          </div>
          {loc && <button onClick={() => onEvidence(loc.bbox!, loc.id)} title="Show on drawing"
            className={`mt-0.5 shrink-0 rounded border px-1.5 text-[12px] ${active === loc.id ? 'border-accent text-accent' : 'border-navy-600 text-dim hover:border-accent hover:text-ink'}`}>⌖</button>}
        </li>
      })}
    </ul>
    {facts.length > limit && <button className="mt-1 text-[13px] text-accent hover:underline" onClick={() => setAll(!all)}>
      {all ? 'Show fewer' : `Show all ${facts.length}`}</button>}
  </div>
}
