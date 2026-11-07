import { useMemo, useState } from 'react'
import type { Evidence, EngineeringModel, Space, SupportingFact } from '../../types'
import { MODULE_LABEL, PROV_CLASS_META, PROV_CLASS_ORDER, VIEW_STATUS, provClass, stripDeck, type FindingView, type ProvClass } from '../../lib/present'
import type { Review } from '../../state/useReview'
import type { Workspace } from '../../state/useWorkspace'
import { api } from '../../services/api'
import { ComplianceDetail, ResultBadge } from '../RegulatoryPanel'
import { SpaceCard } from '../SpaceCard'
import { Btn, Fold, OriginBadge, ProvChip, StatusDot, ViewStatusLabel } from '../ui'

const STATUS_NOTE = {
  issue: 'Potential issue in the extracted model. Requires engineering review; this is not a confirmed violation.',
  inconclusive: 'The submitted drawing does not contain enough information to decide. This is not a violation.',
  verified: 'Holds on the evidence available in the extracted model. This is not a regulatory compliance determination.',
  not_assessed: 'Not assessed.',
} as const

const REQ_BADGE: Record<string, { label: string; cls: string }> = {
  verified_regulatory_requirement: { label: 'Verified requirement', cls: 'text-ok border-ok/40' },
  unverified_extracted_requirement: { label: 'Unverified reference', cls: 'text-incon border-incon/40' },
  synthetic_demonstration_rule: { label: 'Synthetic demo rule', cls: 'text-pink-300 border-pink-400/40' },
}

/** Right panel: why the selected finding exists, with every fact traced to its source. */
export default function Inspector({ rv, ws, onCollapse }: { rv: Review; ws: Workspace; onCollapse: () => void }) {
  const head = <div className="flex h-8 shrink-0 items-center border-b border-navy-700 px-3">
    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">Inspector</span>
    <button onClick={onCollapse} title="Collapse panel" className="ml-auto rounded px-1 text-faint hover:bg-navy-800 hover:text-ink">›</button>
  </div>
  let body
  if (rv.mode === 'result' && rv.result) body = <ResultInspector rv={rv} ws={ws} />
  else if (rv.mode === 'space' && rv.spaceId && ws.model) body = <SpaceInspector rv={rv} model={ws.model} id={rv.spaceId} />
  else if (rv.mode === 'finding' && rv.selected && ws.model) body = <FindingInspector rv={rv} ws={ws} v={rv.selected} model={ws.model} />
  else body = <div className="p-4 text-[12px] leading-relaxed text-dim">
    <div className="mb-1 text-[13px] font-medium text-ink">Nothing selected</div>
    Select a finding in the list, or click a room on the drawing, to see the observation, the evidence behind it and what still needs engineering verification.
    <div className="mt-3 space-y-1 text-[11.5px]">
      {(['issue', 'inconclusive', 'verified'] as const).map((s) => <div key={s} className="flex gap-2"><span className="mt-1"><StatusDot s={s} /></span><span><b className="font-medium" style={{ color: VIEW_STATUS[s].hex }}>{VIEW_STATUS[s].label}</b> - {STATUS_NOTE[s]}</span></div>)}
    </div>
  </div>
  return <div className="flex h-full min-h-0 flex-col">{head}<div className="min-h-0 flex-1 overflow-y-auto">{body}</div></div>
}

// ------------------------------------------------------------------ finding
function FindingInspector({ rv, ws, v, model }: { rv: Review; ws: Workspace; v: FindingView; model: EngineeringModel }) {
  const d = rv.detail?.finding.id === v.id ? rv.detail : null
  const f = d?.finding ?? v.raw
  const spaces = useMemo(() => new Map(model.spaces.map((s) => [s.id, s])), [model.spaces])
  const deckNames = model.decks.map((x) => x.name)
  const primary = v.elementId ? spaces.get(v.elementId) : undefined
  const evMap = new Map((d?.evidence ?? []).map((e) => [e.id, e]))
  const grouped = PROV_CLASS_ORDER.map((c) => ({ c, facts: f.supporting_facts.filter((s) => provClass(s.provenance) === c) })).filter((g) => g.facts.length)

  return <div className="text-[12.5px] leading-relaxed">
    {/* 1 summary */}
    <div className="px-4 pb-3 pt-3">
      <div className="flex items-center gap-2 text-[10.5px] text-faint">
        <span className="font-mono text-dim">{v.id}</span><span>·</span><span>{MODULE_LABEL[v.module]}</span>
        {f.data_origin !== 'actual_pdf' && <span className="ml-auto"><OriginBadge origin={f.data_origin} /></span>}
      </div>
      <h2 className="mt-1 text-[14px] font-semibold leading-snug text-white">{v.title}</h2>
      <div className="mt-0.5 text-dim">{v.element} <span className="text-faint">· {v.deckName}</span></div>
      <div className="mt-2 rounded border px-2 py-1.5 text-[11.5px]" style={{ borderColor: VIEW_STATUS[v.status].hex + '55', background: VIEW_STATUS[v.status].hex + '12' }}>
        <ViewStatusLabel s={v.status} className="font-semibold" />
        <div className="mt-0.5 text-dim">{STATUS_NOTE[v.status]}</div>
      </div>
      <div className="mt-2 flex gap-1.5">
        <Btn primary onClick={rv.locate}>⌖ Locate in drawing</Btn>
        {rv.viewMode === '2d' && <Btn onClick={() => rv.setViewMode('3d')}>Show in 3D</Btn>}
      </div>
    </div>

    {/* 2 observation */}
    <Block title="Observation"><p className="text-ink">{f.observation || <span className="text-faint">No observation recorded.</span>}</p></Block>

    {/* 3 affected */}
    <Fold title="Affected space / component" count={f.affected_ids.length}>
      {primary ? <SpaceCard s={primary} /> : <p className="text-faint">The affected element is not a mapped space.</p>}
      {f.affected_ids.length > 1 && <div className="mt-2">
        <div className="mb-0.5 text-[10.5px] text-faint">Also involved</div>
        <div className="flex flex-wrap gap-1">{f.affected_ids.slice(1, 40).map((id, i) => (
          <button key={id} onClick={() => rv.selectSpace(id, { focus: true })} className="rounded border border-navy-700 px-1.5 text-[11px] text-dim hover:border-accent hover:text-ink">
            {stripDeck(f.affected_names[i + 1], deckNames) || id}</button>))}
          {f.affected_ids.length > 41 && <span className="text-[11px] text-faint">+{f.affected_ids.length - 41} more</span>}</div>
      </div>}
    </Fold>

    {/* 4 supporting evidence */}
    <Fold title="Supporting evidence" count={f.supporting_facts.length}>
      {!f.supporting_facts.length && <p className="text-faint">No supporting facts recorded.</p>}
      {grouped.map(({ c, facts }) => <div key={c} className="mb-2">
        <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: PROV_CLASS_META[c].hex }}>
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: PROV_CLASS_META[c].hex }} />{PROV_CLASS_META[c].label}
        </div>
        <ul className="space-y-1">{facts.map((s, i) => <Fact key={i} s={s} evMap={evMap} active={rv.evidence?.id ?? null} onEvidence={rv.showEvidence} />)}</ul>
      </div>)}
      {!d && rv.loadingDetail && <p className="text-[11px] text-faint">Loading evidence locations…</p>}
    </Fold>

    {/* 5 provenance */}
    <Fold title="Evidence provenance" defaultOpen={false}>
      <ProvenanceSummary counts={v.provenance} />
    </Fold>

    {/* 6 missing */}
    <Block title="Missing information" tone={f.missing_information.length ? VIEW_STATUS.inconclusive.hex : undefined}>
      {f.missing_information.length ? <ul className="list-disc space-y-0.5 pl-4 text-ink">{f.missing_information.map((m, i) => <li key={i}>{m}</li>)}</ul>
        : <p className="text-faint">None listed for this finding.</p>}
    </Block>

    {/* 7 significance */}
    <Block title="Why it may matter"><p className="text-ink">{f.risk_explanation || <span className="text-faint">Not stated.</span>}</p></Block>

    {/* 8 action */}
    <Block title="Recommended engineering verification"><p className="text-ink">{f.recommended_action || <span className="text-faint">Not stated.</span>}</p></Block>

    {/* module-specific */}
    {v.module === 'escape_route_connectivity' && <Fold title="Escape route" defaultOpen={false}><EscapeDetail f={f} model={model} spaces={spaces} /></Fold>}
    {v.module === 'hazardous_space_accessibility' && <Fold title="Hazard classification & reachability" defaultOpen={false}><HazardDetail f={f} model={model} spaces={spaces} primary={primary} /></Fold>}
    {v.module === 'fire_risk_proximity' && <Fold title="Adjacent spaces & fire boundaries" defaultOpen={false}><FireDetail model={model} spaces={spaces} primary={primary} onSpace={(id) => rv.selectSpace(id, { focus: true })} /></Fold>}

    {/* regulatory */}
    <Fold title="Regulatory references" defaultOpen={false} count={(d?.requirements.length ?? 0) + (rv.related?.results.length ?? 0)}>
      {rv.related && <>
        <div className="mb-1 text-[10.5px] text-faint">Encoded checks targeting this space</div>
        {rv.related.results.length ? <div className="mb-2 space-y-1">{rv.related.results.map((r) => (
          <button key={r.result_id} onClick={() => rv.selectResult(r)} className="block w-full rounded border border-navy-700 px-2 py-1 text-left hover:border-navy-600">
            <div className="flex items-center gap-1.5"><span className="font-mono text-[10px] text-faint">{r.spec_id}</span><span className="ml-auto"><ResultBadge s={r.status} small /></span></div>
            <div className="text-[11.5px] text-ink">{r.reasoning[r.reasoning.length - 1]}</div>
          </button>))}</div> : <p className="mb-2 text-[11px] text-faint">No encoded check targets this space.</p>}
        {rv.related.clauses.length > 0 && <><div className="mb-0.5 text-[10.5px] text-faint">Retrieved clauses (search result, not a verdict)</div>
          {rv.related.clauses.map((h) => <button key={h.clause.clause_id} onClick={() => rv.setClauseId(h.clause.clause_id)}
            className="block w-full truncate text-left font-mono text-[10.5px] text-accent/80 hover:text-accent">{h.clause.clause_id.replace(/^[^/]+\//, '')} · {h.excerpt.slice(0, 70)}</button>)}</>}
      </>}
      {d && d.requirements.length > 0 && <div className="mt-2 space-y-1">
        <div className="text-[10.5px] text-faint">Requirements to review</div>
        {d.requirements.map((r) => <details key={r.requirement_id} className="rounded border border-navy-700 px-2 py-1">
          <summary className="cursor-pointer">
            <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-[10px] text-faint">{r.requirement_id}</span>
              <span className={`rounded-sm border px-1 text-[9.5px] ${REQ_BADGE[r.validation_status].cls}`}>{REQ_BADGE[r.validation_status].label}</span></div>
            <div className="text-ink">{r.title}</div>
            <div className="text-[11px] text-faint">{r.source}{r.clause ? ` · ${r.clause}` : ' · clause not verified'}</div>
          </summary>
          <p className="mt-1 text-dim">{r.description}</p>
          {r.applicability_to_design && <p className="mt-1 text-[11px] text-incon">Applicability: {r.applicability_to_design}</p>}
          <p className="mt-1 text-[11px] text-faint">Verification: {r.verification_method}</p>
        </details>)}
      </div>}
    </Fold>

    {/* evidence records */}
    <Fold title="Evidence records" defaultOpen={false} count={d?.evidence.length ?? '…'}>
      {d ? <EvidenceList ev={d.evidence} active={rv.evidence?.id ?? null} onEvidence={rv.showEvidence} />
        : rv.detailError ? <p className="text-[11px] text-issue">Could not load evidence: {rv.detailError}</p> : <p className="text-faint">Loading…</p>}
    </Fold>

    {/* AI */}
    <Fold title="AI explanation" defaultOpen={!!f.llm_explanation} tone={PROV_CLASS_META.ai.hex}>
      <p className="mb-1.5 text-[11px] text-faint">Model-generated text. It does not change the status, which is decided by deterministic rules.</p>
      {f.llm_explanation ? <p className="whitespace-pre-wrap rounded border px-2 py-1.5 text-ink" style={{ borderColor: PROV_CLASS_META.ai.hex + '55' }}>{f.llm_explanation}</p>
        : ws.status?.llm_enabled ? <Btn onClick={rv.explain} disabled={rv.loadingDetail}>{rv.loadingDetail ? 'Generating…' : 'Generate explanation'}</Btn>
          : <p className="text-[11px] text-faint">Language model is off; no AI interpretation is available.</p>}
    </Fold>

    <p className="border-t border-navy-700 px-4 py-2 text-[10.5px] text-faint">Status decided by deterministic rules ({f.explanation_source}). Screening result - not a compliance determination.</p>
  </div>
}

function Block({ title, children, tone }: { title: string; children: React.ReactNode; tone?: string }) {
  return <div className="border-t border-navy-700 px-4 py-2.5">
    <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-dim" style={tone ? { color: tone } : undefined}>{title}</div>
    {children}
  </div>
}

function Fact({ s, evMap, active, onEvidence }: { s: SupportingFact; evMap: Map<string, Evidence>; active: string | null; onEvidence: Review['showEvidence'] }) {
  return <li className="rounded border border-navy-800 bg-navy-850 px-2 py-1">
    <div className="flex items-start gap-1.5"><span className="mt-[3px] shrink-0 rounded-sm bg-navy-700 px-1 text-[9px] uppercase text-dim">{s.kind}</span><span className="text-ink">{s.statement}</span></div>
    <div className="mt-0.5 flex flex-wrap items-center gap-1"><ProvChip p={s.provenance} />
      {s.evidence_ids.slice(0, 6).map((id) => {
        const e = evMap.get(id)
        return <button key={id} disabled={!e?.bbox} onClick={() => e?.bbox && onEvidence(e.bbox, id)} title={e ? `${e.method} - show on drawing` : 'Evidence location loading'}
          className={`rounded-sm border px-1 font-mono text-[10px] disabled:opacity-40 ${active === id ? 'border-accent text-accent' : 'border-navy-600 text-dim hover:border-accent hover:text-ink'}`}>⌖ {id.replace(/^EV_/, '')}</button>
      })}</div>
  </li>
}

function ProvenanceSummary({ counts }: { counts: Record<ProvClass, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return <div>
    {total > 0 && <div className="mb-2 flex h-1.5 overflow-hidden rounded-sm bg-navy-800">
      {PROV_CLASS_ORDER.map((c) => counts[c] > 0 && <div key={c} style={{ width: `${(counts[c] / total) * 100}%`, background: PROV_CLASS_META[c].hex }} title={`${PROV_CLASS_META[c].label}: ${counts[c]}`} />)}
    </div>}
    <table className="w-full text-[11.5px]"><tbody>
      {PROV_CLASS_ORDER.map((c) => <tr key={c} className="align-top">
        <td className="py-0.5 pr-2"><span className="inline-flex items-center gap-1.5 whitespace-nowrap" style={{ color: PROV_CLASS_META[c].hex }}><span className="inline-block h-2 w-2 rounded-sm" style={{ background: PROV_CLASS_META[c].hex }} />{PROV_CLASS_META[c].label}</span></td>
        <td className="w-6 py-0.5 text-right font-mono text-dim">{counts[c]}</td>
        <td className="py-0.5 pl-2 text-[11px] text-faint">{PROV_CLASS_META[c].help}</td>
      </tr>)}
      <tr className="align-top"><td className="py-0.5 pr-2 whitespace-nowrap text-ok">Engineering verification</td><td className="w-6 py-0.5 text-right font-mono text-dim">0</td>
        <td className="py-0.5 pl-2 text-[11px] text-faint">No fact in this finding has been confirmed by an engineer. Rule encodings can be validated under Design Explorer › Regulatory checks.</td></tr>
    </tbody></table>
  </div>
}

function EvidenceList({ ev, active, onEvidence }: { ev: Evidence[]; active: string | null; onEvidence: Review['showEvidence'] }) {
  const [all, setAll] = useState(false)
  return <div className="space-y-1">
    {(all ? ev : ev.slice(0, 8)).map((e) => <button key={e.id} disabled={!e.bbox} onClick={() => e.bbox && onEvidence(e.bbox, e.id)}
      className={`block w-full rounded border px-2 py-1 text-left disabled:opacity-60 ${active === e.id ? 'border-accent bg-accent/10' : 'border-navy-800 bg-navy-850 hover:border-navy-600'}`}>
      <div className="flex items-center gap-1.5"><span className="font-mono text-[10px] text-accent">{e.id}</span><ProvChip p={e.source} />
        {e.bbox && <span className="ml-auto font-mono text-[9.5px] text-faint">p{e.bbox.page + 1}</span>}</div>
      <div className="text-[11px] text-dim">{e.method}</div>
      {e.text && <div className="font-mono text-[11px] text-ink">“{e.text}”</div>}
    </button>)}
    {ev.length > 8 && <button className="text-[11px] text-accent hover:underline" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${ev.length}`}</button>}
  </div>
}

// ------------------------------------------------------------------ module-specific detail
type F = FindingView['raw']
const certaintyOf = (model: EngineeringModel, a: string, b: string) =>
  model.connections.find((c) => (c.source === a && c.target === b) || (c.source === b && c.target === a))

function EscapeDetail({ f, model, spaces }: { f: F; model: EngineeringModel; spaces: Map<string, Space> }) {
  const esc = new Map(model.escape_points.map((e) => [e.id, e]))
  const name = (id: string) => spaces.get(id)?.name ?? esc.get(id)?.label ?? (esc.has(id) ? 'escape point' : spaces.get(id)?.kind.replace(/_/g, ' ')) ?? id
  if (!f.highlight_path.length) return <p className="text-faint">No route path is recorded for this finding. The observation and missing information above explain why.</p>
  return <div>
    <div className="mb-1 text-[10.5px] text-faint">Route traced in the extracted model ({f.highlight_path.length} nodes)</div>
    <ol className="space-y-0.5">{f.highlight_path.map((id, i) => {
      const c = i ? certaintyOf(model, f.highlight_path[i - 1], id) : null
      return <li key={id + i}>
        {c && <div className="pl-3 text-[10.5px]" style={{ color: c.certainty === 'extracted' ? VIEW_STATUS.verified.hex : VIEW_STATUS.inconclusive.hex }}>
          ↓ {c.type.replace(/_/g, ' ')}{c.door_id ? ` ${c.door_id}` : ''} · {c.certainty}</div>}
        <div className="flex items-center gap-1.5"><span className="font-mono text-[10px] text-faint">{i + 1}</span><span className={esc.has(id) ? 'font-medium text-ok' : 'text-ink'}>{name(id)}</span></div>
      </li>
    })}</ol>
    <p className="mt-1.5 text-[10.5px] text-faint">Inferred links (stair matching) and manual links are shown in amber. A traced route is not proof of compliance.</p>
  </div>
}

function HazardDetail({ f, model, spaces, primary }: { f: F; model: EngineeringModel; spaces: Map<string, Space>; primary?: Space }) {
  const doors = primary ? model.doors.filter((d) => d.space_ids.includes(primary.id)) : []
  return <div className="space-y-2">
    <div>
      <div className="text-[10.5px] text-faint">Classification</div>
      {primary?.hazard ? <div className="text-ink"><span className="text-hazard">{primary.hazard.category.replace(/_/g, ' ')}</span> - {primary.hazard.description}
        <div className="mt-0.5 flex items-center gap-1.5"><ProvChip p={primary.hazard.classification_source} />{primary.hazard.matched_rule && <span className="font-mono text-[10px] text-faint">{primary.hazard.matched_rule}</span>}</div></div>
        : <p className="text-faint">No hazard classification recorded on this space.</p>}
    </div>
    <div>
      <div className="text-[10.5px] text-faint">Identified door connections ({doors.length})</div>
      {doors.length ? <ul className="text-[11.5px] text-ink">{doors.map((d) => <li key={d.id} className="font-mono text-[11px]">{d.id} <span className="text-faint">· {d.resolution}{d.space_ids.filter((x) => x !== primary?.id).map((x) => ` → ${spaces.get(x)?.name ?? x}`).join('')}</span></li>)}</ul>
        : <p className="text-[11.5px] text-incon">No door symbol connects this space in the extracted model.</p>}
    </div>
    <div>
      <div className="text-[10.5px] text-faint">Reachability to an identified escape point</div>
      {f.highlight_path.length ? <EscapeDetail f={f} model={model} spaces={spaces} /> : <p className="text-[11.5px] text-dim">No route recorded. See missing information above.</p>}
    </div>
  </div>
}

function FireDetail({ model, spaces, primary, onSpace }: { model: EngineeringModel; spaces: Map<string, Space>; primary?: Space; onSpace: (id: string) => void }) {
  const adj = primary ? model.adjacencies.filter((a) => a.space_a === primary.id || a.space_b === primary.id) : []
  return <div className="space-y-2">
    {primary?.hazard && <div className="text-[11.5px]"><span className="text-faint">Fire-risk classification: </span><span className="text-hazard">{primary.hazard.category.replace(/_/g, ' ')}</span> <ProvChip p={primary.hazard.classification_source} /></div>}
    <div>
      <div className="mb-0.5 text-[10.5px] text-faint">Geometric adjacency ({adj.length}) - derived from drawn boundaries</div>
      {adj.length ? <table className="w-full text-[11px]"><thead><tr className="text-left text-[10px] text-faint"><th className="font-normal">Space</th><th className="font-normal">Relation</th><th className="text-right font-normal">Shared</th><th className="text-right font-normal" title="Share of the common boundary drawn on a Steel_* CAD layer. A drawn steel line is not a fire rating.">Steel layer</th></tr></thead>
        <tbody>{adj.map((a) => {
          const o = a.space_a === primary!.id ? a.space_b : a.space_a
          const s = spaces.get(o)
          return <tr key={a.id} className="border-t border-navy-800">
            <td className="py-0.5"><button onClick={() => onSpace(o)} className="text-left text-ink hover:text-accent">{s?.name ?? s?.kind.replace(/_/g, ' ') ?? o}</button>{s?.hazard?.fire_risk && <span className="ml-1 text-[9.5px] text-hazard">fire-risk</span>}</td>
            <td className="text-dim">{a.relation === 'vertical_overlap' ? 'deck above/below' : 'shared wall'}{a.certainty !== 'extracted' && <span className="text-incon"> · {a.certainty}</span>}</td>
            <td className="text-right font-mono text-dim">{a.shared_length_m != null ? `${a.shared_length_m.toFixed(1)} m` : a.overlap_area_m2 != null ? `${a.overlap_area_m2.toFixed(1)} m²` : '-'}</td>
            <td className="text-right font-mono text-dim">{a.boundary_on_steel_layer_fraction != null ? `${Math.round(a.boundary_on_steel_layer_fraction * 100)} %` : '-'}</td>
          </tr>
        })}</tbody></table> : <p className="text-faint">No adjacency recorded for this space.</p>}
    </div>
    <div>
      <div className="text-[10.5px] text-faint">Fire-rating documentation</div>
      <p className="text-[11.5px] text-incon">{model.fire_documentation.note}</p>
      <p className="mt-1 text-[10.5px] text-faint">Missing fire-separation documentation is a gap in the submission, not evidence of non-compliance. Boundary ratings must be verified against the fire-control plan.</p>
    </div>
  </div>
}

// ------------------------------------------------------------------ space
function SpaceInspector({ rv, model, id }: { rv: Review; model: EngineeringModel; id: string }) {
  const s = model.spaces.find((x) => x.id === id)
  const related = rv.views.filter((v) => v.raw.affected_ids.includes(id))
  const doors = model.doors.filter((d) => d.space_ids.includes(id))
  const back = rv.findingId ?? null
  if (!s) return <div className="p-4 text-dim">Element {id} is not a mapped space.</div>
  return <div className="text-[12.5px]">
    <div className="px-4 pb-3 pt-3">
      {back && <button onClick={() => rv.selectFinding(back)} className="mb-1 text-[11px] text-accent hover:underline">‹ Back to {back}</button>}
      <div className="text-[10.5px] text-faint">Space · {model.decks.find((d) => d.id === s.deck_id)?.name ?? s.deck_id}</div>
      <h2 className="text-[14px] font-semibold text-white">{s.name ?? '(unlabelled space)'}</h2>
      <div className="mt-2"><Btn primary onClick={rv.locate}>⌖ Locate in drawing</Btn></div>
    </div>
    <Block title="Extracted information"><SpaceCard s={s} /></Block>
    <Block title={`Findings involving this space (${related.length})`}>
      {related.length ? <div className="space-y-px">{related.map((v) => <button key={v.id} onClick={() => rv.selectFinding(v.id, { keepSpace: true })}
        className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-navy-850">
        <StatusDot s={v.status} /><span className="font-mono text-[10.5px] text-dim">{v.id}</span><span className="truncate text-ink">{v.title}</span></button>)}</div>
        : <p className="text-faint">No finding involves this space. It was not assessed by any of the three modules.</p>}
    </Block>
    <Block title={`Doors (${doors.length})`}>
      {doors.length ? <ul className="space-y-0.5 text-[11.5px]">{doors.map((d) => <li key={d.id}><span className="font-mono text-dim">{d.id}</span> <span className="text-faint">· {d.resolution}{d.leaf_width_mm ? ` · leaf ≈${d.leaf_width_mm} mm (derived from symbol, not clear opening)` : ''}</span></li>)}</ul>
        : <p className="text-faint">No door symbol detected.</p>}
    </Block>
  </div>
}

// ------------------------------------------------------------------ regulatory result
function ResultInspector({ rv, ws }: { rv: Review; ws: Workspace }) {
  const r = rv.result!
  return <div>
    <div className="flex gap-1.5 px-4 pt-3"><Btn primary onClick={rv.locate} disabled={!r.element_ids.length}>⌖ Locate in drawing</Btn>
      <span className="self-center text-[10.5px] text-faint">Regulatory check · {r.instrument}</span></div>
    <ComplianceDetail r={r} spec={ws.reg?.specs.find((s) => s.spec_id === r.spec_id)} onClause={rv.setClauseId}
      onValidate={async () => {
        const who = prompt('Validate this rule encoding as a qualified engineer.\nThis records your name; the result becomes a final status.\n\nName / role:')
        if (who && who.trim()) { await api.regValidate(r.spec_id, who.trim()); ws.bumpReg() }
      }} />
  </div>
}
