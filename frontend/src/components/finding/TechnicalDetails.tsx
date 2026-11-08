import { useState } from 'react'
import type { Evidence, EngineeringModel, FindingDetail, Space, SupportingFact } from '../../types'
import { PROV_CLASS_META, PROV_CLASS_ORDER, VIEW_STATUS, stripDeck, type FindingView, type ProvClass } from '../../lib/present'
import { SECTION } from '../../lib/terms'
import type { Review } from '../../state/useReview'
import type { Workspace } from '../../state/useWorkspace'
import { ResultBadge } from '../RegulatoryPanel'
import { SpaceCard } from '../SpaceCard'
import { Btn, Fold } from '../ui'
import EvidenceSourceBadge from './EvidenceSourceBadge'

const REQ_BADGE: Record<string, { label: string; cls: string }> = {
  verified_regulatory_requirement: { label: 'Verified requirement', cls: 'text-ok border-ok/40' },
  unverified_extracted_requirement: { label: 'Unverified reference', cls: 'text-incon border-incon/40' },
  synthetic_demonstration_rule: { label: 'Synthetic demo rule', cls: 'text-pink-300 border-pink-400/40' },
}

/**
 * Everything behind the plain-language summary, collapsed by default: the rule-engine output exactly as
 * produced, applicable requirements and clauses, extracted values, geometry and measurements, AI-assisted
 * interpretation, evidence sources and records. Nothing here is reworded.
 */
export default function TechnicalDetails({ v, d, rv, ws, model, primary, spaces, embedded }: {
  v: FindingView; d: FindingDetail | null; rv: Review; ws: Workspace; model: EngineeringModel; primary?: Space; spaces: Map<string, Space>
  embedded?: boolean     // inside the Details tab: no own toggle, sections listed directly
}) {
  const [openSelf, setOpen] = useState(false)
  const open = embedded || openSelf
  const f = d?.finding ?? v.raw
  const deckNames = model.decks.map((x) => x.name)
  const evMap = new Map((d?.evidence ?? []).map((e) => [e.id, e]))
  return <div className={embedded ? '' : 'border-t border-navy-700'}>
    {!embedded && <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-navy-850">
      <span className={`text-[11px] text-faint transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      <span className="text-[13px] font-medium text-ink">{SECTION.technical}</span>
      <span className="ml-auto text-[12px] text-faint">rule output, requirements, values, sources</span>
    </button>}
    {open && <div className={embedded ? 'pb-2 [&>div:first-child]:border-t-0' : 'bg-navy-950/40 pb-1'}>
      <Fold title="Rule-engine output" defaultOpen={!embedded}>
        <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 text-[13px]">
          <dt className="text-faint">Finding ID</dt><dd className="font-mono text-ink">{f.id}</dd>
          <dt className="text-faint">Rule</dt><dd className="text-ink">{f.title}</dd>
          <dt className="text-faint">Status (engine)</dt><dd className="font-mono text-ink">{f.status} <span className="font-sans text-faint">= {VIEW_STATUS[v.status].label}</span></dd>
          <dt className="text-faint">Observation</dt><dd className="text-ink">{f.observation}</dd>
          <dt className="text-faint">Risk note</dt><dd className="text-ink">{f.risk_explanation}</dd>
          <dt className="text-faint">Engine action</dt><dd className="text-ink">{f.recommended_action}</dd>
          <dt className="text-faint">Decided by</dt><dd className="text-ink">Deterministic rules ({f.explanation_source}). Screening result, not a compliance determination.</dd>
          <dt className="text-faint">Data origin</dt><dd className="text-ink">{f.data_origin.replace(/_/g, ' ')}</dd>
          <dt className="text-faint">Confidence</dt><dd className="text-ink">Not applicable: the rules give a status, not a probability. No confidence score is produced.</dd>
        </dl>
      </Fold>

      <Fold title={SECTION.requirements} defaultOpen={false} count={(d?.requirements.length ?? 0) + (rv.related?.results.length ?? 0)}>
        {rv.related && <>
          <div className="mb-1 text-[12px] text-faint">Encoded checks for this space (exact clause and status)</div>
          {rv.related.results.length ? <div className="mb-2 space-y-1">{rv.related.results.map((r) => (
            <button key={r.result_id} onClick={() => rv.selectResult(r)} className="block w-full rounded border border-navy-700 px-2 py-1 text-left hover:border-navy-600">
              <div className="flex items-center gap-1.5"><span className="font-mono text-[12px] text-faint">{r.spec_id}</span><span className="ml-auto"><ResultBadge s={r.status} small /></span></div>
              {r.citations[0] && <div className="text-[12px] text-accent/80">{r.citations[0].doc_title} · {r.citations[0].path.join(' › ')}</div>}
              <div className="text-[13px] text-ink">{r.reasoning[r.reasoning.length - 1]}</div>
            </button>))}</div> : <p className="mb-2 text-[12px] text-faint">No encoded check targets this space.</p>}
          {rv.related.clauses.length > 0 && <><div className="mb-0.5 text-[12px] text-faint">Retrieved clauses (search result, not a verdict)</div>
            {rv.related.clauses.map((h) => <button key={h.clause.clause_id} onClick={() => rv.setClauseId(h.clause.clause_id)}
              className="block w-full truncate text-left font-mono text-[12px] text-accent/80 hover:text-accent">{h.clause.clause_id.replace(/^[^/]+\//, '')} · {h.excerpt.slice(0, 70)}</button>)}</>}
        </>}
        {d && d.requirements.length > 0 && <div className="mt-2 space-y-1">
          <div className="text-[12px] text-faint">Requirements referenced by the rule</div>
          {d.requirements.map((r) => <details key={r.requirement_id} className="rounded border border-navy-700 px-2 py-1">
            <summary className="cursor-pointer">
              <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-[12px] text-faint">{r.requirement_id}</span>
                <span className={`rounded-sm border px-1 text-[11.5px] ${REQ_BADGE[r.validation_status].cls}`}>{REQ_BADGE[r.validation_status].label}</span></div>
              <div className="text-ink">{r.title}</div>
              <div className="text-[12px] text-faint">{r.source}{r.clause ? ` · ${r.clause}` : ' · clause not verified'}</div>
            </summary>
            <p className="mt-1 text-dim">{r.description}</p>
            {r.applicability_to_design && <p className="mt-1 text-[12px] text-incon">Applicability: {r.applicability_to_design}</p>}
            <p className="mt-1 text-[12px] text-faint">Verification: {r.verification_method}</p>
          </details>)}
        </div>}
      </Fold>

      <Fold title="Extracted values" defaultOpen={false} count={f.affected_ids.length}>
        {primary ? <SpaceCard s={primary} /> : <p className="text-faint">The affected element is not a mapped space.</p>}
        {f.affected_ids.length > 1 && <div className="mt-2">
          <div className="mb-0.5 text-[12px] text-faint">Also involved</div>
          <div className="flex flex-wrap gap-1">{f.affected_ids.slice(1, 40).map((id, i) => (
            <button key={id} onClick={() => rv.selectSpace(id, { focus: true })} className="rounded border border-navy-700 px-1.5 text-[12px] text-dim hover:border-accent hover:text-ink">
              {stripDeck(f.affected_names[i + 1], deckNames) || id}</button>))}
            {f.affected_ids.length > 41 && <span className="text-[12px] text-faint">+{f.affected_ids.length - 41} more</span>}</div>
        </div>}
      </Fold>

      <Fold title="Geometry and measurements" defaultOpen={false}>
        {v.module === 'escape_route_connectivity' && <EscapeDetail f={f} model={model} spaces={spaces} />}
        {v.module === 'hazardous_space_accessibility' && <HazardDetail f={f} model={model} spaces={spaces} primary={primary} />}
        {v.module === 'fire_risk_proximity' && <FireDetail model={model} spaces={spaces} primary={primary} onSpace={(id) => rv.selectSpace(id, { focus: true })} />}
      </Fold>

      <Fold title="AI-assisted interpretation" defaultOpen={false} tone={PROV_CLASS_META.ai.hex}>
        <p className="mb-1.5 text-[12px] text-faint">Model-generated text. It does not change the status, which is decided by deterministic rules, and is never shown as a fact read from the drawing.</p>
        {f.llm_explanation ? <p className="whitespace-pre-wrap rounded border px-2 py-1.5 text-ink" style={{ borderColor: PROV_CLASS_META.ai.hex + '55' }}>{f.llm_explanation}</p>
          : ws.status?.llm_enabled ? <Btn onClick={rv.explain} disabled={rv.loadingDetail}>{rv.loadingDetail ? 'Generating…' : 'Generate interpretation'}</Btn>
            : <p className="text-[12px] text-faint">The language model is off; no AI-assisted interpretation is available.</p>}
      </Fold>

      <Fold title={SECTION.evidenceSource} defaultOpen={false} count={f.supporting_facts.length}>
        <SourceSummary counts={v.provenance} />
        <div className="mb-1 mt-3 text-[12px] text-faint">All supporting statements, as produced</div>
        <ul className="space-y-1">{f.supporting_facts.map((s, i) => <FullFact key={i} s={s} evMap={evMap} active={rv.evidence?.id ?? null} onEvidence={rv.showEvidence} />)}</ul>
      </Fold>

      <Fold title="Evidence records" defaultOpen={false} count={d?.evidence.length ?? '…'}>
        {d ? <EvidenceList ev={d.evidence} active={rv.evidence?.id ?? null} onEvidence={rv.showEvidence} />
          : rv.detailError ? <p className="text-[12px] text-issue">Could not load evidence: {rv.detailError}</p> : <p className="text-faint">Loading…</p>}
      </Fold>
    </div>}
  </div>
}

function FullFact({ s, evMap, active, onEvidence }: { s: SupportingFact; evMap: Map<string, Evidence>; active: string | null; onEvidence: Review['showEvidence'] }) {
  return <li className="rounded border border-navy-800 bg-navy-850 px-2 py-1">
    <div className="flex items-start gap-1.5"><span className="mt-[3px] shrink-0 rounded-sm bg-navy-700 px-1 text-[11px] uppercase text-dim">{s.kind}</span><span className="text-[13px] text-ink">{s.statement}</span></div>
    <div className="mt-0.5 flex flex-wrap items-center gap-1"><EvidenceSourceBadge p={s.provenance} />
      {s.evidence_ids.slice(0, 6).map((id) => {
        const e = evMap.get(id)
        return <button key={id} disabled={!e?.bbox} onClick={() => e?.bbox && onEvidence(e.bbox, id)} title={e ? `${e.method} - show on drawing` : 'Evidence location loading'}
          className={`rounded-sm border px-1 font-mono text-[12px] disabled:opacity-40 ${active === id ? 'border-accent text-accent' : 'border-navy-600 text-dim hover:border-accent hover:text-ink'}`}>⌖ {id.replace(/^EV_/, '')}</button>
      })}</div>
  </li>
}

function SourceSummary({ counts }: { counts: Record<ProvClass, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return <div>
    {total > 0 && <div className="mb-2 flex h-1.5 overflow-hidden rounded-sm bg-navy-800">
      {PROV_CLASS_ORDER.map((c) => counts[c] > 0 && <div key={c} style={{ width: `${(counts[c] / total) * 100}%`, background: PROV_CLASS_META[c].hex }} title={`${PROV_CLASS_META[c].label}: ${counts[c]}`} />)}
    </div>}
    <table className="w-full text-[13px]"><tbody>
      {PROV_CLASS_ORDER.filter((c) => counts[c] > 0).map((c) => <tr key={c} className="align-top">
        <td className="py-0.5 pr-2"><span className="inline-flex items-center gap-1.5 whitespace-nowrap" style={{ color: PROV_CLASS_META[c].hex }}><span className="inline-block h-2 w-2 rounded-sm" style={{ background: PROV_CLASS_META[c].hex }} />{PROV_CLASS_META[c].label}</span></td>
        <td className="w-6 py-0.5 text-right font-mono text-dim">{counts[c]}</td>
        <td className="py-0.5 pl-2 text-[12px] text-faint">{PROV_CLASS_META[c].help}</td>
      </tr>)}
      <tr className="align-top"><td className="whitespace-nowrap py-0.5 pr-2 text-dim">Engineer-confirmed</td><td className="w-6 py-0.5 text-right font-mono text-dim">0</td>
        <td className="py-0.5 pl-2 text-[12px] text-faint">No statement in this finding has been confirmed by an engineer.</td></tr>
    </tbody></table>
  </div>
}

function EvidenceList({ ev, active, onEvidence }: { ev: Evidence[]; active: string | null; onEvidence: Review['showEvidence'] }) {
  const [all, setAll] = useState(false)
  return <div className="space-y-1">
    {(all ? ev : ev.slice(0, 8)).map((e) => <button key={e.id} disabled={!e.bbox} onClick={() => e.bbox && onEvidence(e.bbox, e.id)}
      className={`block w-full rounded border px-2 py-1 text-left disabled:opacity-60 ${active === e.id ? 'border-accent bg-accent/10' : 'border-navy-800 bg-navy-850 hover:border-navy-600'}`}>
      <div className="flex items-center gap-1.5"><span className="font-mono text-[12px] text-accent">{e.id}</span><EvidenceSourceBadge p={e.source} />
        {e.bbox && <span className="ml-auto font-mono text-[11.5px] text-faint">p{e.bbox.page + 1}</span>}</div>
      <div className="text-[12px] text-dim">{e.method}</div>
      {e.text && <div className="font-mono text-[12px] text-ink">“{e.text}”</div>}
    </button>)}
    {ev.length > 8 && <button className="text-[12px] text-accent hover:underline" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${ev.length}`}</button>}
  </div>
}

// ------------------------------------------------------------------ module-specific geometry
type F = FindingView['raw']
const linkOf = (model: EngineeringModel, a: string, b: string) =>
  model.connections.find((c) => (c.source === a && c.target === b) || (c.source === b && c.target === a))

function EscapeDetail({ f, model, spaces }: { f: F; model: EngineeringModel; spaces: Map<string, Space> }) {
  const esc = new Map(model.escape_points.map((e) => [e.id, e]))
  const name = (id: string) => spaces.get(id)?.name ?? esc.get(id)?.label ?? (esc.has(id) ? 'escape point' : spaces.get(id)?.kind.replace(/_/g, ' ')) ?? id
  if (!f.highlight_path.length) return <p className="text-faint">No route is recorded for this result.</p>
  return <div>
    <div className="mb-1 text-[12px] text-faint">Route traced in the drawing ({f.highlight_path.length} steps)</div>
    <ol className="space-y-0.5">{f.highlight_path.map((id, i) => {
      const c = i ? linkOf(model, f.highlight_path[i - 1], id) : null
      return <li key={id + i}>
        {c && <div className="pl-3 text-[12px]" style={{ color: (c.certainty === 'extracted' || c.certainty === 'synthetic') ? VIEW_STATUS.verified.hex : VIEW_STATUS.inconclusive.hex }}>
          ↓ {c.type.replace(/_/g, ' ')}{c.door_id ? ` ${c.door_id}` : ''} · {c.certainty}</div>}
        <div className="flex items-center gap-1.5"><span className="font-mono text-[12px] text-faint">{i + 1}</span><span className={esc.has(id) ? 'font-medium text-ok' : 'text-ink'}>{name(id)}</span></div>
      </li>
    })}</ol>
    <p className="mt-1.5 text-[12px] text-faint">Links matched across decks or added by hand are shown in amber. A traced route is not proof of compliance.</p>
  </div>
}

function HazardDetail({ f, model, spaces, primary }: { f: F; model: EngineeringModel; spaces: Map<string, Space>; primary?: Space }) {
  const doors = primary ? model.doors.filter((d) => d.space_ids.includes(primary.id)) : []
  return <div className="space-y-2">
    <div>
      <div className="text-[12px] text-faint">Hazard classification</div>
      {primary?.hazard ? <div className="text-ink"><span className="text-hazard">{primary.hazard.category.replace(/_/g, ' ')}</span> - {primary.hazard.description}
        <div className="mt-0.5 flex items-center gap-1.5"><EvidenceSourceBadge p={primary.hazard.classification_source} />{primary.hazard.matched_rule && <span className="font-mono text-[12px] text-faint">{primary.hazard.matched_rule}</span>}</div>
        {primary.hazard.confidence != null && <div className="text-[12px] text-faint">Model confidence (AI suggestion only): {primary.hazard.confidence}</div>}</div>
        : <p className="text-faint">No hazard classification recorded on this space.</p>}
    </div>
    <div>
      <div className="text-[12px] text-faint">Doors found ({doors.length})</div>
      {doors.length ? <ul className="text-[13px] text-ink">{doors.map((d) => <li key={d.id} className="font-mono text-[12px]">{d.id} <span className="text-faint">· {d.resolution}{d.space_ids.filter((x) => x !== primary?.id).map((x) => ` → ${spaces.get(x)?.name ?? x}`).join('')}</span></li>)}</ul>
        : <p className="text-[13px] text-incon">No door symbol connects this space in the drawing.</p>}
    </div>
    <div>
      <div className="text-[12px] text-faint">Route to a marked exit</div>
      {f.highlight_path.length ? <EscapeDetail f={f} model={model} spaces={spaces} /> : <p className="text-[13px] text-dim">No route recorded.</p>}
    </div>
  </div>
}

function FireDetail({ model, spaces, primary, onSpace }: { model: EngineeringModel; spaces: Map<string, Space>; primary?: Space; onSpace: (id: string) => void }) {
  const adj = primary ? model.adjacencies.filter((a) => a.space_a === primary.id || a.space_b === primary.id) : []
  return <div className="space-y-2">
    {primary?.hazard && <div className="text-[13px]"><span className="text-faint">Fire-risk classification: </span><span className="text-hazard">{primary.hazard.category.replace(/_/g, ' ')}</span> <EvidenceSourceBadge p={primary.hazard.classification_source} /></div>}
    <div>
      <div className="mb-0.5 text-[12px] text-faint">Neighbouring spaces ({adj.length}), calculated from the drawn boundaries</div>
      {adj.length ? <table className="w-full text-[12px]"><thead><tr className="text-left text-[12px] text-faint"><th className="font-normal">Space</th><th className="font-normal">Relation</th><th className="text-right font-normal">Shared</th><th className="text-right font-normal">Rating</th></tr></thead>
        <tbody>{adj.map((a) => {
          const o = a.space_a === primary!.id ? a.space_b : a.space_a
          const s = spaces.get(o)
          return <tr key={a.id} className="border-t border-navy-800">
            <td className="py-0.5"><button onClick={() => onSpace(o)} className="text-left text-ink hover:text-accent">{s?.name ?? s?.kind.replace(/_/g, ' ') ?? o}</button>{s?.hazard?.fire_risk && <span className="ml-1 text-[11.5px] text-hazard">fire-risk</span>}</td>
            <td className="text-dim">{a.relation === 'vertical_overlap' ? 'deck above/below' : 'shared wall'}</td>
            <td className="text-right font-mono text-dim">{a.shared_length_m != null ? `${a.shared_length_m.toFixed(1)} m` : a.overlap_area_m2 != null ? `${a.overlap_area_m2.toFixed(1)} m²` : '-'}</td>
            <td className="text-right font-mono text-dim" title={a.fire_integrity_source ?? 'Not documented'}>{a.fire_integrity ?? '-'}</td>
          </tr>
        })}</tbody></table> : <p className="text-faint">No neighbouring space recorded.</p>}
    </div>
    <div>
      <div className="text-[12px] text-faint">Fire-rating documentation</div>
      <p className="text-[13px] text-incon">{model.fire_documentation.note}</p>
      <p className="mt-1 text-[12px] text-faint">A missing fire rating is a gap in the documents, not evidence of non-compliance.</p>
    </div>
  </div>
}
