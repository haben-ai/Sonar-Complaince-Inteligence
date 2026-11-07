import { useState } from 'react'
import type { BBox, ClauseHit, ComplianceResult, Evidence, FindingDetail, Space } from '../types'
import { ResultBadge } from './RegulatoryPanel'
import { ENGINE_TITLE, OriginBadge, ProvChip, Section, StatusBadge } from './ui'

const REQ_BADGE: Record<string, { label: string; cls: string }> = {
  verified_regulatory_requirement: { label: 'VERIFIED REQUIREMENT', cls: 'text-ok ring-ok/40 bg-ok/10' },
  unverified_extracted_requirement: { label: 'UNVERIFIED REFERENCE', cls: 'text-incon ring-incon/40 bg-incon/10' },
  synthetic_demonstration_rule: { label: 'SYNTHETIC DEMO RULE', cls: 'text-pink-300 ring-pink-400/40 bg-pink-500/10' },
}

export default function EvidencePanel({ detail, loading, llmEnabled, onEvidence, onExplain, activeEvidence, related, onClause }: {
  detail: FindingDetail | null; loading: boolean; llmEnabled: boolean
  onEvidence: (b: BBox) => void; onExplain: () => void; activeEvidence: string | null
  related: { results: ComplianceResult[]; clauses: ClauseHit[] } | null; onClause: (id: string) => void
}) {
  const [showAllEv, setShowAllEv] = useState(false)
  if (loading && !detail) return <div className="p-4 text-sm text-slate-400">Loading evidence…</div>
  if (!detail) return (
    <div className="p-5 text-sm leading-relaxed text-slate-400">
      <p className="mb-2 font-medium text-slate-200">Evidence viewer</p>
      <p>Select a finding to open the drawing at the affected location, highlight the spaces and route involved, and show the extracted facts and reasoning behind it.</p>
    </div>
  )
  const { finding: f, evidence, requirements, spaces } = detail
  const evMap = new Map(evidence.map((e) => [e.id, e]))
  const uniqSpaces = [...new Map(spaces.map((s) => [s.id, s])).values()]
  const primary = uniqSpaces.find((s) => s.id === f.affected_ids[0])

  const EvChip = ({ id }: { id: string }) => {
    const e = evMap.get(id)
    if (!e) return null
    return <button onClick={() => e.bbox && onEvidence(e.bbox)} title={e.method}
      className={`mr-1 mt-0.5 inline-flex items-center gap-1 rounded px-1 font-mono text-[10px] ring-1 ${activeEvidence === id ? 'bg-cyan-500/20 text-cyan-200 ring-cyan-400/60' : 'bg-navy-800 text-cyan-300/80 ring-navy-600 hover:ring-cyan-400/50'}`}>
      ⌖ {id.replace(/^EV_/, '')}
    </button>
  }

  return (
    <div className="h-full overflow-y-auto p-4 text-[12.5px] leading-relaxed">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-slate-400">{f.id}</span>
        <StatusBadge status={f.status} />
        <OriginBadge origin={f.data_origin} />
      </div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{ENGINE_TITLE[f.engine]}</div>
      <h3 className="mt-1 text-[15px] font-semibold text-white">{f.title}</h3>
      <div className="mb-3 text-slate-300">{f.affected_names[0]}</div>

      <Section title="Observation"><p className="text-slate-200">{f.observation}</p></Section>
      <Section title="Why it may matter"><p className="text-slate-300">{f.risk_explanation}</p></Section>

      <Section title="Supporting evidence & reasoning">
        <ol className="space-y-1.5">
          {f.supporting_facts.map((s, i) => (
            <li key={i} className="rounded bg-navy-850 px-2 py-1.5 ring-1 ring-navy-800">
              <div className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0 rounded bg-navy-700 px-1 text-[9px] uppercase text-slate-300">{s.kind}</span>
                <span className="text-slate-200">{s.statement}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1">{s.provenance && <ProvChip p={s.provenance} />}{s.evidence_ids.slice(0, 6).map((id) => <EvChip key={id} id={id} />)}</div>
            </li>
          ))}
        </ol>
      </Section>

      {primary && <Section title="Extracted information">
        <SpaceCard s={primary} />
      </Section>}

      <Section title="Missing information">
        <ul className="list-disc space-y-0.5 pl-4 text-incon/90">{f.missing_information.map((m, i) => <li key={i}>{m}</li>)}</ul>
      </Section>
      <Section title="Recommended engineering review"><p className="text-sky-200">{f.recommended_action}</p></Section>

      {related && <Section title="Regulatory check results for this space">
        {related.results.length ? <div className="space-y-1">{related.results.map((r) => <div key={r.result_id} className="rounded bg-navy-850 px-2 py-1 ring-1 ring-navy-800">
          <div className="flex items-center gap-1.5"><span className="font-mono text-[10px] text-slate-400">{r.spec_id}</span><span className="ml-auto"><ResultBadge s={r.status} small /></span></div>
          <div className="text-[11.5px] text-slate-200">{r.reasoning[r.reasoning.length - 1]}</div>
          {r.citations[0] && <button onClick={() => onClause(r.citations[0].clause_id)} className="text-[10.5px] text-sky-300">“{r.citations[0].excerpt.slice(0, 110)}{r.citations[0].excerpt.length > 110 ? '…' : ''}” · {r.citations[0].path.join(' › ')}</button>}
        </div>)}</div> : <p className="text-[11px] text-slate-500">No encoded check targets this space.</p>}
        <div className="mt-1.5 text-[10px] uppercase tracking-wider text-slate-500">Retrieved clauses (BM25)</div>
        {related.clauses.map((h) => <button key={h.clause.clause_id} onClick={() => onClause(h.clause.clause_id)} className="block w-full truncate text-left font-mono text-[10.5px] text-sky-300/80 hover:text-sky-200">{h.clause.clause_id.replace(/^[^/]+\//, '')} · {h.excerpt.slice(0, 70)}</button>)}
      </Section>}

      <Section title="Regulatory requirements to review">
        <div className="space-y-1.5">
          {requirements.map((r) => (
            <details key={r.requirement_id} className="rounded bg-navy-850 px-2 py-1.5 ring-1 ring-navy-800">
              <summary className="cursor-pointer list-none">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] text-slate-400">{r.requirement_id}</span>
                  <span className={`rounded px-1 text-[9px] font-semibold ring-1 ${REQ_BADGE[r.validation_status].cls}`}>{REQ_BADGE[r.validation_status].label}</span>
                </div>
                <div className="text-slate-200">{r.title}</div>
                <div className="text-[11px] text-slate-400">{r.source}{r.clause ? ` · ${r.clause}` : ' · clause not verified'}</div>
              </summary>
              <p className="mt-1 text-slate-300">{r.description}</p>
              {r.applicability_to_design && <p className="mt-1 text-[11px] text-incon/90">Applicability: {r.applicability_to_design}</p>}
              <p className="mt-1 text-[11px] text-slate-400">Verification: {r.verification_method}</p>
            </details>
          ))}
        </div>
      </Section>

      {f.llm_explanation ? <Section title="LLM explanation (llm_interpretation - not a determination)"><p className="whitespace-pre-wrap text-cyan-100/90">{f.llm_explanation}</p></Section>
        : llmEnabled && <button onClick={onExplain} className="mb-4 rounded bg-cyan-600/20 px-2 py-1 text-[11px] text-cyan-200 ring-1 ring-cyan-500/40 hover:bg-cyan-600/30">Explain with Gemini</button>}

      <Section title={`Evidence records (${evidence.length})`} right={evidence.length > 6 && <button className="text-[10px] text-sky-300" onClick={() => setShowAllEv(!showAllEv)}>{showAllEv ? 'less' : 'all'}</button>}>
        <div className="space-y-1">
          {(showAllEv ? evidence : evidence.slice(0, 6)).map((e) => <EvidenceRow key={e.id} e={e} onClick={() => e.bbox && onEvidence(e.bbox)} active={activeEvidence === e.id} />)}
        </div>
      </Section>
      <p className="border-t border-navy-700 pt-2 text-[10px] text-slate-500">Status decided by deterministic rules ({f.explanation_source}). Screening result - not a compliance determination.</p>
    </div>
  )
}

function EvidenceRow({ e, onClick, active }: { e: Evidence; onClick: () => void; active: boolean }) {
  return <button onClick={onClick} className={`block w-full rounded px-2 py-1 text-left ring-1 ${active ? 'bg-cyan-500/10 ring-cyan-400/50' : 'bg-navy-850 ring-navy-800 hover:ring-navy-600'}`}>
    <div className="flex items-center gap-1.5"><span className="font-mono text-[10px] text-cyan-300">{e.id}</span><ProvChip p={e.source} />{e.bbox && <span className="ml-auto font-mono text-[9px] text-slate-500">p{e.bbox.page + 1} [{e.bbox.x0.toFixed(0)},{e.bbox.y0.toFixed(0)}]</span>}</div>
    <div className="text-[11px] text-slate-400">{e.method}</div>
    {e.text && <div className="font-mono text-[11px] text-slate-200">“{e.text}”</div>}
  </button>
}

export function SpaceCard({ s }: { s: Space }) {
  const dev = s.labelled_area_m2 && s.computed_area_m2 ? ((s.computed_area_m2 - s.labelled_area_m2) / s.labelled_area_m2) * 100 : null
  return <div className="rounded bg-navy-850 p-2 ring-1 ring-navy-800">
    <div className="flex items-center gap-1.5"><span className="font-semibold text-white">{s.name ?? '(unlabelled)'}</span><span className="font-mono text-[10px] text-slate-500">{s.id}</span><span className="ml-auto"><ProvChip p={s.provenance} /></span></div>
    <table className="mt-1 w-full text-[11px]"><tbody>
      <tr><td className="pr-2 text-slate-500">Type</td><td className="text-slate-200">{s.kind.replace(/_/g, ' ')} <span className="text-slate-500">— {s.kind_basis}</span></td></tr>
      {s.hazard && <tr><td className="pr-2 text-slate-500">Hazard</td><td className="text-orange-300">{s.hazard.category} <span className="text-slate-500">({s.hazard.classification_source})</span></td></tr>}
      <tr><td className="pr-2 text-slate-500">Area on drawing</td><td className="text-slate-200">{s.labelled_area_m2 != null ? `${s.labelled_area_m2} m² (label)` : <span className="text-slate-500">not labelled</span>}</td></tr>
      <tr><td className="pr-2 text-slate-500">Extracted area</td><td className="text-slate-200">{s.computed_area_m2 != null ? `${s.computed_area_m2.toFixed(1)} m² (derived)` : <span className="text-slate-500">no scale</span>}{dev != null && <span className={Math.abs(dev) < 20 ? 'text-ok' : 'text-incon'}> · {dev > 0 ? '+' : ''}{dev.toFixed(0)} %</span>}</td></tr>
    </tbody></table>
    {s.notes.length > 0 && <ul className="mt-1 list-disc pl-4 text-[11px] text-slate-400">{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
  </div>
}
