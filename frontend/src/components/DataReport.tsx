import { useEffect, useState } from 'react'
import { api } from '../services/api'
import type { AnalysisSummary, EngineeringModel, Requirement } from '../types'
import { Section } from './ui'

const REQ_LABEL: Record<string, string> = {
  verified_regulatory_requirement: 'Verified', unverified_extracted_requirement: 'Unverified', synthetic_demonstration_rule: 'Synthetic demo rule',
}

export default function DataReport({ model, summary }: { model: EngineeringModel; summary: AnalysisSummary }) {
  const [reqs, setReqs] = useState<Requirement[]>([])
  const [imp, setImp] = useState<string>('')
  useEffect(() => { api.requirements().then(setReqs).catch(() => setReqs([])) }, [imp])
  const kinds = model.spaces.reduce<Record<string, number>>((a, s) => { a[s.kind] = (a[s.kind] ?? 0) + 1; return a }, {})
  const hazards = model.spaces.filter((s) => s.hazard)
  const doorsResolved = model.doors.filter((d) => d.resolution === 'resolved').length
  const areaChecks = model.spaces.filter((s) => s.labelled_area_m2 && s.computed_area_m2 && !s.notes.some((n) => n.startsWith('Several labels')))
  const devs = areaChecks.map((s) => Math.abs(s.computed_area_m2! - s.labelled_area_m2!) / s.labelled_area_m2!).sort((a, b) => a - b)
  const median = devs.length ? devs[Math.floor(devs.length / 2)] : null
  const manual = model.spaces.filter((s) => s.provenance === 'manual_annotation')

  return (
    <div className="grid h-full grid-cols-2 gap-5 overflow-y-auto p-5 text-[14px]">
      <div>
        <Section title="Document">
          <div className="rounded bg-navy-850 p-3 ring-1 ring-navy-800">
            <div className="font-semibold text-white">{model.document.name}</div>
            <div className="text-dim">{model.document.filename} · {model.document.page_count} page(s) · {model.document.source_type.toUpperCase()}</div>
            {model.document.sha256 && <div className="font-mono text-[12px] text-faint">sha256 {model.document.sha256.slice(0, 24)}…</div>}
            {model.decks[0]?.scale && <div className="mt-1 text-[12px] text-dim">Scale: {model.decks[0].scale.basis}. <span className="text-ok">{model.decks[0].scale.cross_check}</span></div>}
          </div>
        </Section>
        <Section title="Extracted elements">
          <div className="grid grid-cols-3 gap-2">
            {[['Decks', model.decks.length], ['Spaces', model.spaces.length], ['Door symbols', `${model.doors.length} (${doorsResolved} resolved)`],
              ['Escape points', model.escape_points.length], ['Connections', model.connections.length], ['Adjacencies', model.adjacencies.length]].map(([k, v]) => (
              <div key={k as string} className="rounded bg-navy-850 p-2 ring-1 ring-navy-800"><div className="text-[12px] text-faint">{k}</div><div className="font-mono text-ink">{v}</div></div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">{Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k} className="rounded bg-navy-800 px-1.5 text-[12px] text-dim">{k.replace(/_/g, ' ')}: {v}</span>)}</div>
        </Section>
        <Section title="Self-consistency check (drawing labels vs extracted geometry)">
          <p className="text-dim">{areaChecks.length ? <>For {areaChecks.length} rooms with an area written on the drawing, the extracted polygon area differs by a median of <b className="text-white">{(median! * 100).toFixed(1)} %</b>; {devs.filter((d) => d < 0.25).length}/{devs.length} are within 25 %. This checks geometry extraction against the drawing itself; it is not an accuracy benchmark for the safety findings.</> : 'No area labels available.'}</p>
        </Section>
        <Section title={`Hazard classifications (${hazards.length}, from drawing labels)`}>
          <div className="max-h-48 overflow-y-auto rounded ring-1 ring-navy-800">
            <table className="w-full text-[12px]"><tbody>{hazards.map((s) => <tr key={s.id} className="odd:bg-navy-850"><td className="px-2 py-0.5 text-ink">{s.name}</td><td className="px-2 text-orange-300">{s.hazard!.category}</td><td className="px-2 font-mono text-faint">{s.deck_id.replace('DECK_', '')}</td></tr>)}</tbody></table>
          </div>
        </Section>
        <Section title="Fire-safety documentation in the submission"><p className="text-incon/90">{model.fire_documentation.note}</p></Section>
        {manual.length > 0 && <Section title="Manual annotations used"><ul className="list-disc pl-4 text-violet-300">{manual.map((s) => <li key={s.id}>{s.id}: {s.kind_basis}</li>)}</ul></Section>}
      </div>
      <div>
        <Section title="Extraction limitations"><ul className="list-disc space-y-0.5 pl-4 text-dim">{model.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></Section>
        <Section title="Regulatory knowledge base" right={<label className="cursor-pointer text-[12px] text-accent">Import regulatory PDF<input type="file" accept=".pdf" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return
          const name = prompt('Source name (e.g. "SOLAS consolidated 2020, Ch II-2")') ?? f.name
          try { const r = await api.importRequirements(f, name); setImp(`${r.imported} candidate requirements imported as UNVERIFIED`) } catch (err) { setImp(String(err)) }
        }} /></label>}>
          {imp && <div className="mb-1 text-[12px] text-incon">{imp}</div>}
          <div className="mb-1 text-[12px] text-dim">{reqs.filter((r) => r.validation_status === 'verified_regulatory_requirement').length} verified · {reqs.filter((r) => r.validation_status === 'unverified_extracted_requirement').length} unverified · {reqs.filter((r) => r.validation_status === 'synthetic_demonstration_rule').length} synthetic. No legal clause is shown unless verified.</div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {reqs.map((r) => <div key={r.requirement_id} className="rounded bg-navy-850 px-2 py-1 ring-1 ring-navy-800">
              <div className="flex items-center gap-1.5"><span className="font-mono text-[12px] text-dim">{r.requirement_id}</span><span className="text-[12px] text-incon">{REQ_LABEL[r.validation_status]}</span></div>
              <div className="text-ink">{r.title}</div><div className="text-[12px] text-faint">{r.source}</div>
            </div>)}
          </div>
        </Section>
        <Section title="Extraction log"><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-navy-950 p-2 font-mono text-[12px] text-dim ring-1 ring-navy-800">{summary.extraction_log.join('\n')}</pre></Section>
      </div>
    </div>
  )
}
