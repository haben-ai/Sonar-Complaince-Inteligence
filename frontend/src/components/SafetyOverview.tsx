import type { EngineSummary } from '../types'

const ICON: Record<string, string> = {
  escape_route_connectivity: 'M4 12h12m0 0-4-4m4 4-4 4M20 4v16',
  hazardous_space_accessibility: 'M12 3 2 20h20L12 3Zm0 6v5m0 3v.01',
  fire_risk_proximity: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9Z',
}

export default function SafetyOverview({ summaries, active, onSelect }: {
  summaries: EngineSummary[]; active: string | null; onSelect: (e: string | null) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {summaries.map((s) => {
        const on = active === s.engine
        return (
          <button key={s.engine} onClick={() => onSelect(on ? null : s.engine)}
            className={`rounded-lg p-2.5 text-left ring-1 transition ${on ? 'bg-navy-700 ring-sky-400/60' : 'bg-navy-850 ring-navy-700 hover:ring-navy-600'}`}>
            <div className="flex min-h-[28px] items-start gap-1.5">
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-sky-300" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={ICON[s.engine]} /></svg>
              <span className="text-[11px] font-semibold leading-tight text-slate-200">{s.title}</span>
            </div>
            <div className="mt-1.5 text-[10px] text-slate-400">{s.elements_analyzed} elements analysed</div>
            <div className="mt-1.5 flex gap-1 font-mono text-[11px]">
              <span className="rounded bg-issue/15 px-1.5 text-issue" title="Potential issues requiring review">{s.potential_issues}</span>
              <span className="rounded bg-incon/15 px-1.5 text-incon" title="Inconclusive checks">{s.inconclusive}</span>
              <span className="rounded bg-ok/15 px-1.5 text-ok" title="Connectivity verified">{s.verified}</span>
            </div>
            <div className="mt-1 text-[9px] uppercase tracking-wider text-slate-500">{s.completed ? 'analysis complete' : 'incomplete'}</div>
          </button>
        )
      })}
    </div>
  )
}
