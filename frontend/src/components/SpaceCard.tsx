import type { Space } from '../types'
import { ProvChip } from './ui'

/** Extracted facts for one space, each with where it came from. */
export function SpaceCard({ s }: { s: Space }) {
  const dev = s.labelled_area_m2 && s.computed_area_m2 ? ((s.computed_area_m2 - s.labelled_area_m2) / s.labelled_area_m2) * 100 : null
  return <div className="rounded border border-navy-700 bg-navy-850 p-2">
    <div className="flex items-center gap-1.5">
      <span className="font-medium text-strong">{s.name ?? '(unlabelled)'}</span>
      <span className="font-mono text-[10px] text-faint">{s.id}</span>
      <span className="ml-auto"><ProvChip p={s.provenance} /></span>
    </div>
    <table className="mt-1 w-full text-[11.5px]"><tbody>
      <Tr k="Type">{s.kind.replace(/_/g, ' ')} <span className="text-faint">- {s.kind_basis}</span></Tr>
      {s.hazard && <Tr k="Hazard"><span className="text-hazard">{s.hazard.category.replace(/_/g, ' ')}</span> <ProvChip p={s.hazard.classification_source} />
        {s.hazard.matched_rule && <div className="font-mono text-[10px] text-faint">{s.hazard.matched_rule}</div>}</Tr>}
      <Tr k="Area (label)">{s.labelled_area_m2 != null ? `${s.labelled_area_m2} m²` : <span className="text-faint">not labelled on drawing</span>}</Tr>
      <Tr k="Area (derived)">{s.computed_area_m2 != null ? `${s.computed_area_m2.toFixed(1)} m²` : <span className="text-faint">no scale</span>}
        {dev != null && <span className={Math.abs(dev) < 20 ? 'text-ok' : 'text-incon'}> · {dev > 0 ? '+' : ''}{dev.toFixed(0)} % vs label</span>}</Tr>
    </tbody></table>
    {s.notes.length > 0 && <ul className="mt-1 list-disc pl-4 text-[11px] text-dim">{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
  </div>
}

function Tr({ k, children }: { k: string; children: React.ReactNode }) {
  return <tr><td className="w-[92px] pr-2 align-top text-faint">{k}</td><td className="text-ink">{children}</td></tr>
}
