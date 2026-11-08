import { useEffect, useMemo, useState } from 'react'
import { api } from '../services/api'
import type { ApplicabilityVerdict, ClauseHit, ComplianceResult, ProfileFact, RegulatoryEvaluation, ResultStatus } from '../types'
import { Section } from './ui'

export const RS: Record<ResultStatus, { label: string; cls: string; hex: string }> = {
  POTENTIAL_NON_COMPLIANCE: { label: 'Potential non-compliance', cls: 'text-issue bg-issue/15 ring-issue/40', hex: '#e56b68' },
  REQUIRES_EXPERT_REVIEW: { label: 'Requires expert review', cls: 'text-incon bg-incon/15 ring-incon/40', hex: '#e7ad55' },
  INSUFFICIENT_EVIDENCE: { label: 'Insufficient evidence', cls: 'text-incon bg-incon/10 ring-incon/30', hex: '#d9a14f' },
  APPLICABILITY_UNKNOWN: { label: 'Applicability unknown', cls: 'text-dim bg-navy-800 ring-navy-600', hex: '#91a4b9' },
  NOT_ASSESSABLE_FROM_GA: { label: 'Not assessable from GA', cls: 'text-dim bg-navy-800 ring-navy-600', hex: '#8292a5' },
  COMPLIANT_ON_AVAILABLE_EVIDENCE: { label: 'Compliant on available evidence', cls: 'text-ok bg-ok/15 ring-ok/40', hex: '#55b98b' },
  NOT_APPLICABLE: { label: 'Not applicable', cls: 'text-faint bg-navy-850 ring-navy-700', hex: '#6b7c90' },
}
const ORDER: ResultStatus[] = ['POTENTIAL_NON_COMPLIANCE', 'REQUIRES_EXPERT_REVIEW', 'INSUFFICIENT_EVIDENCE', 'APPLICABILITY_UNKNOWN',
  'NOT_ASSESSABLE_FROM_GA', 'COMPLIANT_ON_AVAILABLE_EVIDENCE', 'NOT_APPLICABLE']
const AP: Record<string, string> = {
  APPLICABLE: 'text-ok', APPLICABLE_WITH_ASSUMPTIONS: 'text-accent', NOT_APPLICABLE: 'text-dim', APPLICABILITY_UNKNOWN: 'text-incon',
}
const INST: Record<string, string> = { SOLAS: 'SOLAS', SPS_CODE: 'SPS Code', MARPOL: 'MARPOL', COLREG: 'COLREG', LOAD_LINE: 'Load Line', BWM: 'Ballast Water Mgmt',
  CLASS_DNV: 'Class: DNV', CLASS_BV: 'Class: BV', PVAG: 'PVAG', ADA: 'ADA' }

export function ResultBadge({ s, small }: { s: ResultStatus; small?: boolean }) {
  return <span className={`rounded px-1.5 py-0.5 font-semibold ring-1 ${small ? 'text-[11px]' : 'text-[12px]'} ${RS[s].cls}`}>{RS[s].label.toUpperCase()}</span>
}

export default function RegulatoryPanel({ ev, demo, onDemo, onSelect, selected, designId, onChanged }: {
  ev: RegulatoryEvaluation; demo: boolean; onDemo: (d: boolean) => void; onSelect: (r: ComplianceResult) => void
  selected: string | null; designId: string; onChanged: () => void
}) {
  const [inst, setInst] = useState<string | null>(null)
  const [st, setSt] = useState<ResultStatus | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ClauseHit[] | null>(null)
  const [openClause, setOpenClause] = useState<string | null>(null)
  const results = useMemo(() => ev.results.filter((r) => (!inst || r.instrument === inst) && (!st || r.status === st))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status)), [ev, inst, st])
  const profile = ev.profile as Record<string, ProfileFact>

  return (
    <div className="grid h-full grid-cols-[1.15fr_1fr] gap-4 overflow-hidden p-4 text-[14px]">
      <div className="min-h-0 overflow-y-auto pr-1">
        <div className="mb-3 flex items-center gap-3">
          <h3 className="text-[14px] font-semibold text-white">Compliance matrix</h3>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-pink-200">
            <input type="checkbox" checked={demo} onChange={(e) => onDemo(e.target.checked)} />
            Evaluate PVAG / ADA / DNV <i>as if applicable</i> (DEMO)
          </label>
        </div>
        <table className="w-full border-separate border-spacing-y-1 text-[13px]">
          <thead><tr className="text-left text-[12px] uppercase tracking-wider text-faint">
            <th className="px-2">Instrument</th><th>Applicability</th>
            {ORDER.map((s) => <th key={s} className="px-1 text-center" title={RS[s].label}><span className="inline-block h-2 w-2 rounded-full" style={{ background: RS[s].hex }} /></th>)}
            <th className="px-2">Corpus</th></tr></thead>
          <tbody>
            {ev.matrix.map((row) => (
              <tr key={row.instrument} onClick={() => setInst(inst === row.instrument ? null : row.instrument)}
                className={`cursor-pointer ${inst === row.instrument ? 'bg-navy-700' : 'bg-navy-850 hover:bg-navy-800'}`}>
                <td className="rounded-l px-2 py-1.5 font-semibold text-ink">{INST[row.instrument] ?? row.instrument}</td>
                <td className="py-1.5">{row.applicability.map((a) => <div key={a.scope_id} className={`text-[12px] ${AP[a.status]}`}>{a.title.replace(/^.*? - /, '')}: {a.status.replace(/_/g, ' ').toLowerCase()}</div>)}</td>
                {ORDER.map((s) => <td key={s} className="px-1 text-center font-mono">{row.final[s] ? <span style={{ color: RS[s].hex }}>{row.final[s]}</span> : <span className="text-navy-600">·</span>}</td>)}
                <td className="rounded-r px-2 text-[12px] text-dim">{row.corpus.map((c) => <div key={c.doc_id}>{c.completeness.replace(/_/g, ' ')} ({c.clauses})</div>)}{!row.corpus.length && <span className="text-incon">no text</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 mb-1.5 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[12px] uppercase tracking-wider text-dim">Results {inst ? `· ${INST[inst] ?? inst}` : ''}</span>
          {ORDER.map((s) => <button key={s} onClick={() => setSt(st === s ? null : s)} className={`rounded px-1.5 text-[12px] ring-1 ${st === s ? RS[s].cls : 'text-dim ring-navy-700'}`}>{RS[s].label}</button>)}
        </div>
        <div className="space-y-1">
          {results.slice(0, 200).map((r) => (
            <button key={r.result_id} onClick={() => onSelect(r)} className={`block w-full rounded border-l-2 px-2 py-1.5 text-left ring-1 ${selected === r.result_id ? 'bg-navy-700 ring-accent/50' : 'bg-navy-850 ring-navy-800 hover:bg-navy-800'}`} style={{ borderLeftColor: RS[r.status].hex }}>
              <div className="flex items-center gap-1.5"><span className="font-mono text-[12px] text-faint">{r.spec_id}</span>
                <span className="ml-auto flex gap-1">{r.demo_as_if_applicable && <span className="rounded bg-pink-500/15 px-1 text-[11px] text-pink-300 ring-1 ring-pink-400/40">DEMO</span>}
                  {r.data_origin === 'synthetic' && <span className="rounded bg-pink-500/15 px-1 text-[11px] text-pink-300 ring-1 ring-pink-400/40">SYNTHETIC</span>}
                  <ResultBadge s={r.status} small /></span></div>
              <div className="truncate text-ink">{r.element_names[0] ?? r.title}</div>
              <div className="truncate text-[12px] text-dim">{r.title}{r.indicative_status !== r.status && <> · indicative: <span style={{ color: RS[r.indicative_status].hex }}>{RS[r.indicative_status].label}</span></>}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
        <Section title="Vessel profile (decides applicability)">
          <ProfileCard profile={profile} designId={designId} onSaved={onChanged} />
        </Section>
        <Section title="Applicability reasoning">
          <div className="space-y-1">{ev.applicability.map((v) => <VerdictRow key={v.scope_id} v={v} onClause={setOpenClause} />)}</div>
        </Section>
        <Section title={`Search the regulatory corpus (${hits?.some((h) => h.rank_vector) ? 'hybrid: keyword + Gemini meaning, RRF' : 'keyword BM25'} - returns clauses, never verdicts)`}>
          <form onSubmit={async (e) => { e.preventDefault(); if (q.trim()) setHits(await api.regSearch(q)) }} className="flex gap-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. means of escape machinery space" className="flex-1 rounded bg-navy-850 px-2 py-1 text-[13px] ring-1 ring-navy-700 outline-none focus:ring-accent" />
            <button className="rounded bg-navy-700 px-2 text-[12px]">Search</button>
          </form>
          {hits && <div className="mt-1 space-y-1">{hits.map((h) => <button key={h.clause.clause_id} onClick={() => setOpenClause(h.clause.clause_id)} className="block w-full rounded bg-navy-850 px-2 py-1 text-left ring-1 ring-navy-800 hover:ring-navy-600">
            <div className="font-mono text-[12px] text-accent">{h.clause.clause_id} <span className="text-faint">p{h.clause.page}</span>
              <span className="ml-2 text-faint">keyword #{h.rank_bm25 ?? '–'} · meaning #{h.rank_vector ?? '–'}</span></div><div className="text-[12px] text-dim">{h.excerpt}</div></button>)}
            {!hits.length && <div className="text-[12px] text-faint">No clauses found.</div>}</div>}
        </Section>
        {openClause && <ClauseModal id={openClause} onClose={() => setOpenClause(null)} />}
      </div>
    </div>
  )
}

function VerdictRow({ v, onClause }: { v: ApplicabilityVerdict; onClause: (id: string) => void }) {
  return <details className="rounded bg-navy-850 px-2 py-1 ring-1 ring-navy-800">
    <summary className="cursor-pointer list-none"><span className={`font-semibold ${AP[v.status]}`}>{v.status.replace(/_/g, ' ')}</span> <span className="text-dim">· {v.title}</span></summary>
    <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[12px] text-dim">{v.reasoning.map((s, i) => <li key={i}>{s.statement} {s.clause_ids.map((c) => <button key={c} onClick={() => onClause(c)} className="ml-1 rounded bg-navy-700 px-1 font-mono text-[11.5px] text-accent">{c.split('/').slice(-2).join('/')}</button>)}</li>)}</ol>
    {v.assumptions.length > 0 && <div className="mt-1 text-[12px] text-accent">Assumptions: {v.assumptions.join(' ')}</div>}
    {v.missing_facts.length > 0 && <div className="text-[12px] text-incon">Missing: {v.missing_facts.join('; ')}</div>}
  </details>
}

function ProfileCard({ profile, designId, onSaved }: { profile: Record<string, ProfileFact>; designId: string; onSaved: () => void }) {
  const [edit, setEdit] = useState<Record<string, string>>({})
  const fields = Object.entries(profile).filter(([k]) => k !== 'design_id')
  const editable = ['persons_on_board', 'gross_tonnage', 'special_personnel', 'oil_fuel_capacity_m3', 'delivery_date', 'flag']
  return <div className="rounded bg-navy-850 p-2 ring-1 ring-navy-800">
    <table className="w-full text-[12px]"><tbody>{fields.map(([k, f]) => (
      <tr key={k}><td className="pr-2 align-top text-faint">{k.replace(/_/g, ' ')}</td>
        <td className="text-ink">{f.value !== null && f.value !== '' ? <>{String(f.value).slice(0, 90)} <span className={`text-[11.5px] ${f.source === 'drawing_text' ? 'text-accent' : 'text-violet-300'}`}>({f.source.replace('_', ' ')})</span></>
          : editable.includes(k) ? <input value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} placeholder="unknown - enter" className="w-40 rounded bg-navy-950 px-1 text-[12px] ring-1 ring-navy-700" />
            : <span className="text-faint">unknown</span>}</td></tr>))}</tbody></table>
    {Object.keys(edit).length > 0 && <button className="mt-1 rounded bg-accent text-on-accent px-2 py-0.5 text-[12px]" onClick={async () => {
      const vals: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(edit)) if (v.trim()) vals[k] = /^[\d.]+$/.test(v) ? Number(v) : v
      await api.regPutProfile(designId, vals); setEdit({}); onSaved()
    }}>Save & re-evaluate (user input)</button>}
  </div>
}

export function ClauseModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.regClause>> | null>(null)
  useEffect(() => { setD(null); api.regClause(id).then(setD).catch(() => setD(null)) }, [id])
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
    <div className="max-h-[70vh] w-[640px] overflow-y-auto rounded-lg bg-navy-900 p-4 ring-1 ring-navy-600" onClick={(e) => e.stopPropagation()}>
      {!d ? 'Loading…' : <>
        <div className="font-mono text-[12px] text-accent">{d.clause.clause_id}</div>
        <div className="text-[14px] font-semibold text-white">{d.document.title}</div>
        <div className="mb-2 text-[12px] text-dim">{d.clause.path.join(' › ')} · page {d.clause.page || '-'} · {d.document.edition} · <span className="text-incon">{d.document.completeness.replace(/_/g, ' ')}</span></div>
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{d.clause.text}</p>
        <div className="mt-2 text-[12px] text-faint">{d.document.licence} · <a className="text-accent" href={d.document.url} target="_blank" rel="noreferrer">source</a></div>
      </>}
    </div>
  </div>
}

/** Regulatory check detail, split so the inspector can show it in tabs:
 * summary = status note, required vs measured, delta; evidence = cited clauses; details = reasoning, caveats, rule encoding. */
export function ComplianceDetail({ r, spec, onValidate, onClause, part }: {
  r: ComplianceResult; spec?: { validation_status: string; validated_by: string | null; quote_verified: boolean }
  onValidate: () => void; onClause: (id: string) => void; part: 'summary' | 'evidence' | 'details'
}) {
  const fmt = (o: Record<string, unknown> | null) => o ? `${o.operator ?? ''} ${o.value ?? '—'} ${o.unit ?? ''}`.trim() : '—'
  if (part === 'summary') return <div className="px-4 py-3 text-[14px] leading-relaxed">
    {r.indicative_status !== r.status && <div className="mb-3 rounded bg-navy-850 p-2 text-[13px] ring-1 ring-navy-700">Evaluator result: <ResultBadge s={r.indicative_status} small /> → final <ResultBadge s={r.status} small /><div className="mt-1 text-dim">{r.caveats[0]}</div></div>}
    {(r.required || r.measured) && <div className="grid grid-cols-2 gap-2">
      <div className="rounded bg-navy-850 p-2 ring-1 ring-navy-800"><div className="text-[12px] uppercase text-faint">Required</div><div className="font-mono text-white">{fmt(r.required)}</div>{typeof r.required?.basis === 'string' && <div className="text-[12px] text-dim">{r.required.basis}</div>}</div>
      <div className="rounded bg-navy-850 p-2 ring-1 ring-navy-800"><div className="text-[12px] uppercase text-faint">Measured</div><div className="font-mono text-white">{r.measured ? `${r.measured.value ?? '—'} ${r.measured.unit ?? ''}` : '—'}</div>
        {r.measured && <div className="text-[12px] text-dim">{String(r.measured.status ?? '')}{r.measured.basis ? ` · ${String(r.measured.basis)}` : ''}</div>}</div>
    </div>}
    <div className="mt-3"><Delta r={r} /></div>
    {r.reasoning.length > 0 && <p className="text-ink">{r.reasoning[r.reasoning.length - 1]}</p>}
  </div>
  if (part === 'evidence') return <div className="px-4 py-3 text-[14px] leading-relaxed">
    {r.citations.map((c, i) => <div key={c.clause_id} className="mb-1.5 rounded bg-navy-850 p-2 ring-1 ring-navy-800">
      <div className="text-[12px] text-dim">{c.doc_title}</div>
      <div className="font-mono text-[12px] text-accent">{c.path.join(' › ')} · p{c.page || '-'} <span className="text-incon">· {c.completeness.replace(/_/g, ' ')}</span></div>
      <blockquote className={`mt-1 border-l-2 pl-2 ${i === 0 ? 'border-accent text-ink' : 'border-navy-600 text-dim'}`}>“{c.excerpt}”</blockquote>
      <button className="mt-1 text-[12px] text-accent" onClick={() => onClause(c.clause_id)}>Open clause</button>
    </div>)}
    {!r.citations.length && <p className="text-faint">No clause is cited for this result.</p>}
  </div>
  return <div className="px-4 py-3 text-[14px] leading-relaxed">
    <Section title="Deterministic reasoning"><ol className="list-decimal space-y-0.5 pl-4 text-ink">{r.reasoning.map((x, i) => <li key={i}>{x}</li>)}</ol></Section>
    {r.caveats.length > 0 && <Section title="Caveats & interpretation"><ul className="list-disc space-y-0.5 pl-4 text-incon/90">{r.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul></Section>}
    <Section title="Rule encoding">
      <div className="rounded bg-navy-850 p-2 text-[13px] ring-1 ring-navy-800">
        Check ID: <span className="font-mono">{r.spec_id}</span><br />
        Quote verified against stored text: <b className={spec?.quote_verified ? 'text-ok' : 'text-issue'}>{spec?.quote_verified ? 'yes' : 'no'}</b><br />
        Engineer validation: <b className={spec?.validation_status === 'engineer_validated' ? 'text-ok' : 'text-incon'}>{spec?.validation_status ?? '?'}</b>{spec?.validated_by ? ` by ${spec.validated_by}` : ''}
        {spec?.validation_status !== 'engineer_validated' && <div><button onClick={onValidate} className="mt-1 rounded bg-navy-700 px-2 py-0.5 text-[12px] text-ink hover:bg-navy-600">Validate rule encoding (engineer)…</button></div>}
      </div>
    </Section>
  </div>
}

/** Failed delta + remediation target for numeric checks. Text only: the tool states the target the rule sets,
 * it does not propose a design change. */
function Delta({ r }: { r: ComplianceResult }) {
  const mv = typeof r.measured?.value === 'number' ? (r.measured!.value as number) : null
  const rv = typeof r.required?.value === 'number' ? (r.required!.value as number) : null
  const op = r.required?.operator as string | undefined
  if (mv === null || rv === null || !op) return null
  const unit = String(r.required?.unit ?? r.measured?.unit ?? '')
  const ok = op === '<=' ? mv <= rv : op === '>=' ? mv >= rv : mv === rv
  const d = mv - rv
  const derived = r.measured?.status === 'derived'
  return <div className={`mb-3 rounded p-2 text-[13px] ring-1 ${ok ? 'bg-ok/10 ring-ok/30' : 'bg-issue/10 ring-issue/30'}`}>
    <div className="text-[12px] uppercase tracking-wider text-dim">Delta</div>
    <div className="font-mono text-white">{d > 0 ? '+' : ''}{d.toFixed(2)} {unit} <span className="text-dim">({mv} {op === '<=' ? 'vs max' : op === '>=' ? 'vs min' : 'vs'} {rv})</span></div>
    {!ok && <div className="mt-1 text-ink">Remediation target: {op === '<=' ? `reduce to ${rv} ${unit} or less` : op === '>=' ? `increase to at least ${rv} ${unit}` : `make equal to ${rv} ${unit}`}
      {r.title.toLowerCase().includes('dead-end') ? ' (or add a second exit so the corridor is no longer a dead end)' : ''}{r.title.toLowerCase().includes('escape') && unit === 'routes' ? ' (add an independent means of escape)' : ''}.</div>}
    {derived && <div className="mt-1 text-[12px] text-incon">Measured value is derived from drawing geometry, not a design dimension - confirm before acting.</div>}
  </div>
}
