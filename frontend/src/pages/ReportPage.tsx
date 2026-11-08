import { useState } from 'react'
import { Empty } from '../components/ui'
import { MODULES, PROV_CLASS_META, VIEW_STATUS, provClass, type FindingView, type ViewStatus } from '../lib/present'
import type { Review } from '../state/useReview'
import type { Workspace } from '../state/useWorkspace'

const PROV_TEXT: Record<string, string> = {
  pdf_text: 'PDF text', pdf_vector_geometry: 'PDF vector', ocr: 'OCR', derived_geometry: 'derived geometry',
  llm_interpretation: 'AI interpretation', manual_annotation: 'manual annotation', synthetic: 'synthetic',
}

/** Engineering screening report. Same statuses and evidence as the workspace; printed via the browser. */
export default function ReportPage({ ws, rv }: { ws: Workspace; rv: Review }) {
  const [include, setInclude] = useState<Record<ViewStatus, boolean>>({ issue: true, inconclusive: true, verified: false, not_assessed: false })
  const { model, summary, current } = ws
  if (!ws.ready || !model || !summary || !current) return <Empty title="Report not available">The report is generated once extraction and analysis are complete.</Empty>

  const doc = model.document
  const meta = doc.metadata as Record<string, unknown>
  const scale = model.decks.find((d) => d.scale)?.scale
  const rooms = model.spaces.filter((s) => s.kind !== 'tank_or_void')
  const now = new Date()
  const count = (m: string, s: ViewStatus) => rv.views.filter((v) => v.module === m && v.status === s).length

  return <div className="print-root h-full overflow-y-auto bg-navy-950">
    <div className="no-print sticky top-0 z-10 flex items-center gap-3 border-b border-navy-700 bg-navy-900 px-4 py-1.5 text-[11.5px]">
      <span className="text-dim">Full detail for:</span>
      {(['issue', 'inconclusive', 'verified'] as const).map((s) => <label key={s} className="flex items-center gap-1.5 text-ink">
        <input type="checkbox" checked={include[s]} onChange={() => setInclude({ ...include, [s]: !include[s] })} className="accent-[#4c9be0]" />{VIEW_STATUS[s].label}</label>)}
      <span className="text-faint">Findings without full detail are listed in a summary table.</span>
      <button onClick={() => window.print()} className="ml-auto h-6 rounded border border-accent bg-accent px-2.5 font-medium text-on-accent hover:bg-[#45c4ae]">Export PDF</button>
    </div>

    <article className="mx-auto my-6 max-w-[860px] bg-white px-12 py-10 text-[12px] leading-relaxed text-[#1c2430] shadow-xl shadow-black/40 print:my-0 print:max-w-none print:px-0 print:py-0 print:shadow-none">
      <header className="border-b-2 border-[#1c2430] pb-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5b6675]">Engineering screening report · General Arrangement</div>
        <h1 className="mt-1 text-[20px] font-semibold text-[#0f1620]">{current.name}</h1>
        {typeof meta.title === 'string' && <div className="text-[#3a4554]">{meta.title}</div>}
        <table className="mt-3 w-full text-[11px]"><tbody>
          <Meta k="Source document" v={`${doc.filename ?? '-'} · ${doc.page_count} sheet(s) · ${doc.source_type.toUpperCase()}`} />
          {doc.sha256 && <Meta k="SHA-256" v={<span className="font-mono">{doc.sha256}</span>} />}
          <Meta k="Data origin" v={doc.data_origin.replace(/_/g, ' ')} />
          {ws.scenario && summary.scenario_info && <Meta k="Scenario" v={<b>SYNTHETIC - {summary.scenario_info.title}: {summary.scenario_info.description}</b>} />}
          <Meta k="Generated" v={`${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)} · ${ws.status?.llm_enabled ? `deterministic rules, AI assist available (${ws.status.model}) - AI text is never used for statuses` : 'deterministic rules only'}`} />
        </tbody></table>
      </header>

      <H2 n="1">Analysis scope</H2>
      <p>Three screening modules were run on the geometry and text extracted from the submitted drawing: {MODULES.map((m) => m.label).join(', ')}. Input is a General Arrangement drawing only; fire-control plans, door schedules and structural fire-protection plans were not supplied.</p>
      <p className="mt-1 text-[#5b6675]">{summary.disclaimer}</p>

      <H2 n="2">Extraction summary</H2>
      <table className="w-full border-collapse text-[11px]"><tbody>
        <Meta k="Decks" v={`${model.decks.length} (${model.decks.map((d) => d.name).join(', ')})`} />
        <Meta k="Spaces" v={`${rooms.length} spaces, ${model.spaces.filter((s) => s.hazard).length} with a hazard classification from drawing labels`} />
        <Meta k="Doors" v={`${model.doors.length} door symbols, ${model.doors.filter((d) => d.resolution === 'resolved').length} linked to two spaces`} />
        <Meta k="Escape points" v={`${model.escape_points.length} identified on the drawing`} />
        <Meta k="Connections" v={`${model.connections.length} (${model.connections.filter((c) => c.certainty === 'extracted').length} extracted, ${model.connections.filter((c) => c.certainty !== 'extracted').length} inferred or manual)`} />
        <Meta k="Scale" v={scale ? `${scale.basis}${scale.cross_check ? ` - ${scale.cross_check}` : ''}` : 'not established; no metric values'} />
        <Meta k="Fire documentation" v={model.fire_documentation.note} />
      </tbody></table>

      <H2 n="3">Summary of findings</H2>
      <table className="w-full border-collapse text-[11px]">
        <thead><tr className="border-b border-[#1c2430] text-left"><th className="py-1 font-semibold">Module</th>
          {(['issue', 'inconclusive', 'verified'] as const).map((s) => <th key={s} className="py-1 text-right font-semibold"><Dot s={s} /> {VIEW_STATUS[s].label}</th>)}
          <th className="py-1 text-right font-semibold">Elements analysed</th></tr></thead>
        <tbody>{MODULES.map((m) => <tr key={m.id} className="border-b border-[#d5dae1]"><td className="py-1">{m.label}</td>
          {(['issue', 'inconclusive', 'verified'] as const).map((s) => <td key={s} className="py-1 text-right font-mono">{count(m.id, s)}</td>)}
          <td className="py-1 text-right font-mono">{summary.summaries.find((x) => x.engine === m.id)?.elements_analyzed ?? '-'}</td></tr>)}</tbody>
      </table>
      <p className="mt-1 text-[10.5px] text-[#5b6675]">{VIEW_STATUS.inconclusive.label}: {VIEW_STATUS.inconclusive.help} {VIEW_STATUS.verified.label}: {VIEW_STATUS.verified.help}</p>

      {MODULES.map((m, mi) => {
        const vs = rv.views.filter((v) => v.module === m.id)
        const full = vs.filter((v) => include[v.status])
        const brief = vs.filter((v) => !include[v.status])
        return <section key={m.id} className={mi === 0 ? 'print-break' : ''}>
          <H2 n={`${4 + mi}`}>{m.label} <span className="font-normal text-[#5b6675]">({vs.length} findings)</span></H2>
          {summary.summaries.find((x) => x.engine === m.id)?.notes.map((n, i) => <p key={i} className="text-[11px] text-[#3a4554]">{n}</p>)}
          {full.map((v) => <FindingBlock key={v.id} v={v} />)}
          {brief.length > 0 && <>
            <div className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#5b6675]">Further findings (summary)</div>
            <table className="mt-1 w-full border-collapse text-[10.5px]"><tbody>{brief.map((v) => <tr key={v.id} className="print-keep border-b border-[#e3e7ec] align-top">
              <td className="w-16 py-0.5 font-mono">{v.id}</td><td className="w-28 py-0.5"><Dot s={v.status} /> {VIEW_STATUS[v.status].label}</td>
              <td className="py-0.5">{v.element} <span className="text-[#5b6675]">· {v.deckName}</span></td><td className="py-0.5 text-[#3a4554]">{v.title}</td></tr>)}</tbody></table>
          </>}
          {!vs.length && <p className="text-[#5b6675]">No findings in this module.</p>}
        </section>
      })}

      <H2 n={`${4 + MODULES.length}`}>Limitations and disclaimers</H2>
      <ul className="list-disc space-y-0.5 pl-5 text-[11px]">{summary.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <p className="mt-2 text-[11px]"><b>Evidence classes.</b> {(['source', 'derived', 'manual', 'ai'] as const).map((c) => `${PROV_CLASS_META[c].label}: ${PROV_CLASS_META[c].help}`).join(' ')}</p>
      <p className="mt-2 border-t border-[#1c2430] pt-2 text-[11px] font-medium">{summary.disclaimer}</p>
    </article>
  </div>
}

function FindingBlock({ v }: { v: FindingView }) {
  const f = v.raw
  return <div className="print-keep keep-color mt-4 border-l-[3px] pl-3" style={{ borderColor: VIEW_STATUS[v.status].hex }}>
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-mono text-[11px] font-semibold">{v.id}</span>
      <span className="text-[11px] font-semibold" style={{ color: VIEW_STATUS[v.status].hex }}>{VIEW_STATUS[v.status].label}</span>
      <span className="font-semibold text-[#0f1620]">{v.title}</span>
      {f.data_origin !== 'actual_pdf' && <span className="text-[10px] font-semibold uppercase">[{f.data_origin.replace(/_/g, ' ')}]</span>}
    </div>
    <div className="text-[11px] text-[#3a4554]">Affected: {v.element} · {v.deckName}{v.extraAffected ? ` (+${v.extraAffected} related spaces)` : ''}{v.page != null ? ` · sheet ${v.page + 1}` : ''}</div>
    <Lbl>Observation</Lbl><p>{f.observation}</p>
    {f.supporting_facts.length > 0 && <><Lbl>Supporting evidence</Lbl>
      <ul className="list-disc space-y-0.5 pl-5 text-[11px]">{f.supporting_facts.map((s, i) => <li key={i}>{s.statement}
        <span className="text-[#5b6675]"> [{PROV_CLASS_META[provClass(s.provenance)].label}{PROV_CLASS_META[provClass(s.provenance)].label.toLowerCase() === (PROV_TEXT[s.provenance] ?? s.provenance).toLowerCase() ? '' : `: ${PROV_TEXT[s.provenance] ?? s.provenance}`}{s.evidence_ids.length ? `; ${s.evidence_ids.slice(0, 3).join(', ')}${s.evidence_ids.length > 3 ? '…' : ''}` : ''}]</span></li>)}</ul></>}
    {f.missing_information.length > 0 && <><Lbl>Missing information</Lbl><ul className="list-disc pl-5 text-[11px]">{f.missing_information.map((m, i) => <li key={i}>{m}</li>)}</ul></>}
    {f.risk_explanation && <><Lbl>Why it may matter</Lbl><p className="text-[11px]">{f.risk_explanation}</p></>}
    {f.recommended_action && <><Lbl>Recommended verification</Lbl><p className="text-[11px]">{f.recommended_action}</p></>}
  </div>
}

const H2 = ({ n, children }: { n: string; children: React.ReactNode }) =>
  <h2 className="mb-1.5 mt-6 border-b border-[#c9d0d8] pb-0.5 text-[13.5px] font-semibold text-[#0f1620]"><span className="mr-2 text-[#5b6675]">{n}</span>{children}</h2>
const Lbl = ({ children }: { children: React.ReactNode }) => <div className="mt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#5b6675]">{children}</div>
const Meta = ({ k, v }: { k: string; v: React.ReactNode }) => <tr className="align-top"><td className="w-36 py-0.5 pr-3 text-[#5b6675]">{k}</td><td className="py-0.5">{v}</td></tr>
const Dot = ({ s }: { s: ViewStatus }) => <span className="status-dot inline-block h-2 w-2 rounded-full align-middle" style={{ background: VIEW_STATUS[s].hex }} />
