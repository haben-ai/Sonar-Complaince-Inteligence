import type { EngineId } from '../types'
import { MODULES, VIEW_STATUS, type ViewStatus } from '../lib/present'
import type { Review } from '../state/useReview'
import type { Workspace } from '../state/useWorkspace'
import { Empty, OriginBadge, StatusDot } from '../components/ui'

/** Compact design summary. Findings and analysis coverage are reported separately. */
export default function OverviewPage({ ws, rv, open }: { ws: Workspace; rv: Review; open: (opts: { finding?: string; module?: EngineId | null; status?: ViewStatus | null }) => void }) {
  const { current, model, summary } = ws
  if (!current) return <Empty title={ws.err ? 'Backend not reachable' : 'No design loaded'}>{ws.err ?? 'Upload a General Arrangement drawing (PDF, image or JSON) to begin.'}</Empty>
  if (current.status === 'error') return <Empty title="Extraction failed">{current.error}</Empty>
  if (current.status !== 'ready') return <div className="mx-auto max-w-2xl p-8">
    <div className="text-[13px] font-medium text-white">Extracting {current.name}…</div>
    <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded border border-navy-700 bg-navy-900 p-3 font-mono text-[11px] text-dim">{current.progress.join('\n') || 'Waiting for the extraction pipeline…'}</pre>
  </div>
  if (ws.analysisError) return <Empty title="Analysis could not be loaded">{ws.analysisError}</Empty>
  if (!model || !summary) return <Empty title="Loading analysis…" />

  const doc = model.document
  const meta = doc.metadata as Record<string, unknown>
  const scale = model.decks.find((d) => d.scale)?.scale
  const issues = rv.views.filter((v) => v.status === 'issue')
  const inconclusive = rv.views.filter((v) => v.status === 'inconclusive')
  const rooms = model.spaces.filter((s) => s.kind !== 'tank_or_void')
  const covered = new Set(rv.views.flatMap((v) => v.raw.affected_ids))
  const coveredRooms = rooms.filter((s) => covered.has(s.id)).length
  const doorsResolved = model.doors.filter((d) => d.resolution === 'resolved').length

  return <div className="h-full overflow-y-auto">
    <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-4 p-5 lg:grid-cols-[1fr_1fr]">
      {/* design */}
      <Panel title="Design" className="lg:col-span-2">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="text-[15px] font-semibold text-white">{current.name}</span>{doc.data_origin && <OriginBadge origin={doc.data_origin} />}</div>
            {typeof meta.title === 'string' && <div className="mt-0.5 text-dim">{meta.title} <span className="text-faint">(document title; revision as stated there)</span></div>}
            <div className="mt-1 font-mono text-[11px] text-faint">{doc.filename ?? '-'} · {doc.page_count} sheet(s) · {doc.source_type.toUpperCase()}{doc.sha256 ? ` · sha256 ${doc.sha256.slice(0, 12)}…` : ''}</div>
          </div>
          <KV k="Extraction" v={<span className="text-ok">Complete</span>} sub={meta.pdf_mode ? String(meta.pdf_mode).replace(/_/g, ' ') : undefined} />
          <KV k="Analysis" v={summary.summaries.every((s) => s.completed) ? <span className="text-ok">3 / 3 modules complete</span> : <span className="text-incon">{summary.summaries.filter((s) => s.completed).length} / 3 modules complete</span>} />
          <KV k="Scale" v={scale ? scale.basis.split('(')[0].trim() : <span className="text-incon">not established</span>} sub={scale?.cross_check ?? undefined} />
        </div>
        {ws.scenario && summary.scenario_info && <div className="mt-3 rounded border border-pink-400/40 bg-pink-950/30 px-2 py-1.5 text-[11.5px] text-pink-200">
          <b>Synthetic scenario active</b> - {summary.scenario_info.description} Findings touching modified elements are labelled synthetic.</div>}
      </Panel>

      {/* extracted */}
      <Panel title="Extracted from the drawing">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded border border-navy-700 bg-navy-700">
          {[['Decks', model.decks.length], ['Spaces', rooms.length], ['Doors', `${model.doors.length}`, `${doorsResolved} linked to two spaces`],
            ['Escape points', model.escape_points.length, 'identified on drawing'], ['Connections', model.connections.length, `${model.connections.filter((c) => c.certainty !== 'extracted').length} inferred / manual`],
            ['Evidence records', current.counts.evidence ?? '-']].map(([k, v, sub]) => (
            <div key={k as string} className="bg-navy-900 px-3 py-2"><div className="text-[10.5px] text-faint">{k}</div><div className="font-mono text-[15px] text-white">{v}</div>{sub && <div className="text-[10px] text-faint">{sub}</div>}</div>
          ))}
        </div>
      </Panel>

      {/* coverage */}
      <Panel title="Analysis coverage">
        <table className="w-full text-[12px]"><tbody>
          {summary.summaries.map((s) => <tr key={s.engine} className="border-b border-navy-800 align-top">
            <td className="py-1.5 pr-2 text-ink">{s.title}</td>
            <td className="py-1.5 text-right font-mono text-ink">{s.elements_analyzed}</td>
            <td className="py-1.5 pl-2 text-[11px] text-faint">elements analysed{s.notes[0] ? ` - ${s.notes[0]}` : ''}</td>
          </tr>)}
          <tr className="align-top"><td className="py-1.5 pr-2 text-ink">Spaces with at least one check</td>
            <td className="py-1.5 text-right font-mono text-ink">{coveredRooms}/{rooms.length}</td>
            <td className="py-1.5 pl-2 text-[11px] text-faint">{rooms.length - coveredRooms} spaces (stores, tanks, sanitary, technical…) are not assessed by any module. That is a scope boundary, not a finding.</td></tr>
        </tbody></table>
      </Panel>

      {/* findings */}
      <Panel title="Findings by module" className="lg:col-span-2">
        <table className="w-full text-[12px]">
          <thead><tr className="text-left text-[10.5px] text-faint">
            <th className="pb-1 font-normal">Module</th>
            {(['issue', 'inconclusive', 'verified'] as const).map((s) => <th key={s} className="w-36 pb-1 text-right font-normal" title={VIEW_STATUS[s].help}><span className="inline-flex items-center gap-1.5"><StatusDot s={s} />{VIEW_STATUS[s].label}</span></th>)}
            <th className="w-20 pb-1 text-right font-normal">Total</th></tr></thead>
          <tbody>{MODULES.map((m) => {
            const vs = rv.views.filter((v) => v.module === m.id)
            const n = (s: ViewStatus) => vs.filter((v) => v.status === s).length
            return <tr key={m.id} className="border-t border-navy-800">
              <td className="py-1.5"><button onClick={() => open({ module: m.id })} className="text-ink hover:text-accent">{m.label}</button></td>
              {(['issue', 'inconclusive', 'verified'] as const).map((s) => <td key={s} className="py-1.5 text-right">
                <button disabled={!n(s)} onClick={() => open({ module: m.id, status: s })} className="font-mono hover:underline disabled:no-underline" style={{ color: n(s) ? VIEW_STATUS[s].hex : 'var(--color-faint)' }}>{n(s)}</button></td>)}
              <td className="py-1.5 text-right font-mono text-dim">{vs.length}</td>
            </tr>
          })}</tbody>
        </table>
        <p className="mt-2 text-[11px] text-faint">Inconclusive means the drawing lacks the information to decide; it is not a violation. Verified holds on available evidence only and is not a compliance determination.</p>
      </Panel>

      {/* priority */}
      <Panel title={`Requires engineering attention (${issues.length})`} className="lg:col-span-2">
        {issues.length ? <div className="divide-y divide-navy-800 rounded border border-navy-700">
          {issues.map((v) => <button key={v.id} onClick={() => open({ finding: v.id })} className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-navy-850">
            <StatusDot s="issue" /><span className="w-20 shrink-0 font-mono text-[11px] text-dim">{v.id}</span>
            <span className="w-56 shrink-0 truncate text-ink">{v.element}</span><span className="w-28 shrink-0 text-[11px] text-faint">{v.deckName}</span>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-dim">{v.title}</span><span className="text-[11px] text-accent">Review ›</span>
          </button>)}
        </div> : <p className="text-dim">No potential issues were found in the extracted model.</p>}
        {inconclusive.length > 0 && <div className="mt-2 text-[11.5px] text-dim">
          In addition, <button onClick={() => open({ status: 'inconclusive', module: null })} className="text-incon hover:underline">{inconclusive.length} inconclusive findings</button> need documents
          the General Arrangement does not contain ({MODULES.map((m) => `${inconclusive.filter((v) => v.module === m.id).length} ${m.short.toLowerCase()}`).join(', ')}).
        </div>}
      </Panel>

      <Panel title="Limitations" className="lg:col-span-2">
        <ul className="list-disc space-y-0.5 pl-4 text-[11.5px] text-dim">{summary.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <p className="mt-2 border-t border-navy-700 pt-2 text-[11px] text-faint">{summary.disclaimer}</p>
      </Panel>
    </div>
  </div>
}

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded border border-navy-700 bg-navy-900 ${className}`}>
    <h3 className="border-b border-navy-700 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-dim">{title}</h3>
    <div className="p-3">{children}</div>
  </section>
}

function KV({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return <div className="min-w-[150px] max-w-[280px]"><div className="text-[10.5px] text-faint">{k}</div><div className="text-[12px] text-ink">{v}</div>{sub && <div className="text-[10.5px] text-faint">{sub}</div>}</div>
}
