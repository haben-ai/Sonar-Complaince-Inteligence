import type { ReactNode } from 'react'
import type { DataOrigin, Status } from '../types'

export const STATUS_META: Record<Status, { label: string; short: string; color: string; bg: string; ring: string; hex: string }> = {
  CONNECTIVITY_VERIFIED: { label: 'Connectivity verified', short: 'VERIFIED', color: 'text-ok', bg: 'bg-ok/15', ring: 'ring-ok/40', hex: '#22c55e' },
  POTENTIAL_CONNECTIVITY_ISSUE: { label: 'Potential issue', short: 'POTENTIAL ISSUE', color: 'text-issue', bg: 'bg-issue/15', ring: 'ring-issue/40', hex: '#ef4444' },
  INCONCLUSIVE: { label: 'Inconclusive', short: 'INCONCLUSIVE', color: 'text-incon', bg: 'bg-incon/15', ring: 'ring-incon/40', hex: '#f59e0b' },
}

export function StatusBadge({ status }: { status: Status }) {
  const m = STATUS_META[status]
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ring-1 ${m.bg} ${m.color} ${m.ring}`}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.hex }} />{m.short}
  </span>
}

const ORIGIN: Record<DataOrigin, { label: string; cls: string; title: string }> = {
  actual_pdf: { label: 'ACTUAL PDF', cls: 'bg-sky-500/10 text-sky-300 ring-sky-400/30', title: 'Derived from the submitted drawing' },
  manual_annotation: { label: 'MANUAL ANNOTATION', cls: 'bg-violet-500/15 text-violet-300 ring-violet-400/40', title: 'Depends on a manual annotation (not engineer-validated)' },
  synthetic: { label: 'SYNTHETIC', cls: 'bg-pink-500/15 text-pink-300 ring-pink-400/40', title: 'Synthetic test data / synthetic modification - not the real design' },
}

export function OriginBadge({ origin }: { origin: DataOrigin }) {
  const o = ORIGIN[origin]
  return <span title={o.title} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ring-1 ${o.cls}`}>{o.label}</span>
}

const PROV: Record<string, string> = {
  pdf_text: 'PDF text', pdf_vector_geometry: 'PDF vector', derived_geometry: 'derived geometry', ocr: 'OCR',
  llm_interpretation: 'LLM interpretation', manual_annotation: 'manual annotation', synthetic: 'synthetic',
}
export function ProvChip({ p }: { p: string }) {
  const cls = p === 'manual_annotation' ? 'text-violet-300 border-violet-400/40' : p === 'synthetic' ? 'text-pink-300 border-pink-400/40'
    : p === 'llm_interpretation' ? 'text-cyan-300 border-cyan-400/40' : 'text-slate-400 border-slate-500/40'
  return <span className={`rounded border px-1 text-[10px] font-mono ${cls}`}>{PROV[p] ?? p}</span>
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return <div className="mb-4">
    <div className="mb-1.5 flex items-center justify-between">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{title}</h4>{right}
    </div>
    {children}
  </div>
}

export const ENGINE_TITLE: Record<string, string> = {
  escape_route_connectivity: 'Escape Route Connectivity',
  hazardous_space_accessibility: 'Hazardous-Space Accessibility',
  fire_risk_proximity: 'Fire-Risk Proximity',
}
export const ENGINE_SHORT: Record<string, string> = {
  escape_route_connectivity: 'Escape', hazardous_space_accessibility: 'Hazard', fire_risk_proximity: 'Fire',
}

export const KIND_COLOR: Record<string, string> = {
  accommodation: '#60a5fa', public_space: '#38bdf8', work_space: '#a78bfa', control_station: '#2dd4bf',
  service_space: '#94a3b8', machinery_space: '#fb923c', sanitary: '#64748b', corridor: '#facc15', stair: '#e879f9',
  open_deck: '#4ade80', technical: '#475569', tank_or_void: '#334155', unknown: '#64748b',
}
