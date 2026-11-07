import { useState, type ReactNode } from 'react'
import type { DataOrigin, Status } from '../types'
import { PROV_CLASS, PROV_CLASS_META, VIEW_STATUS, viewStatus, type ViewStatus } from '../lib/present'

/** Backend finding status -> display. Labels follow the engines' wording: nothing is certified compliant. */
export const STATUS_META: Record<Status, { label: string; short: string; hex: string }> = {
  CONNECTIVITY_VERIFIED: { label: VIEW_STATUS.verified.label, short: 'VERIFIED', hex: VIEW_STATUS.verified.hex },
  POTENTIAL_CONNECTIVITY_ISSUE: { label: VIEW_STATUS.issue.label, short: 'POTENTIAL ISSUE', hex: VIEW_STATUS.issue.hex },
  INCONCLUSIVE: { label: VIEW_STATUS.inconclusive.label, short: 'INCONCLUSIVE', hex: VIEW_STATUS.inconclusive.hex },
}

export function StatusDot({ s, size = 7 }: { s: ViewStatus; size?: number }) {
  return <span className="status-dot inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: VIEW_STATUS[s].hex }} />
}

export function ViewStatusLabel({ s, className = '' }: { s: ViewStatus; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] ${className}`} style={{ color: VIEW_STATUS[s].hex }}>
    <StatusDot s={s} />{VIEW_STATUS[s].label}
  </span>
}

export function StatusBadge({ status }: { status: Status }) {
  return <ViewStatusLabel s={viewStatus(status)} className="font-medium" />
}

const ORIGIN: Record<DataOrigin, { label: string; cls: string; title: string }> = {
  actual_pdf: { label: 'Source PDF', cls: 'text-dim border-navy-600', title: 'Derived from the submitted drawing' },
  manual_annotation: { label: 'Manual annotation', cls: 'text-violet-300 border-violet-400/40', title: 'Depends on a manual annotation (not engineer-validated)' },
  synthetic: { label: 'Synthetic', cls: 'text-pink-300 border-pink-400/40', title: 'Synthetic test data / synthetic modification - not the real design' },
}

export function OriginBadge({ origin }: { origin: DataOrigin }) {
  const o = ORIGIN[origin]
  return <span title={o.title} className={`rounded-sm border px-1 text-[10px] ${o.cls}`}>{o.label}</span>
}

/** Provenance of one fact, shown with its class (source / derived / AI / manual / synthetic). */
export function ProvChip({ p }: { p: string }) {
  const c = PROV_CLASS_META[PROV_CLASS[p] ?? 'derived']
  return <span title={`${c.label}: ${c.help}`} className="inline-flex items-center gap-1 rounded-sm border px-1 font-mono text-[10px]"
    style={{ color: c.hex, borderColor: c.hex + '55' }}>{PROV_LABEL[p] ?? p}</span>
}
const PROV_LABEL: Record<string, string> = {
  pdf_text: 'PDF text', pdf_vector_geometry: 'PDF vector', derived_geometry: 'derived geometry', ocr: 'OCR',
  llm_interpretation: 'AI interpretation', manual_annotation: 'manual annotation', synthetic: 'synthetic',
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return <div className="mb-4">
    <div className="mb-1.5 flex items-center justify-between">
      <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{title}</h4>{right}
    </div>
    {children}
  </div>
}

/** Collapsible inspector section with a thin divider; open state is local. */
export function Fold({ title, count, defaultOpen = true, children, tone }: {
  title: string; count?: number | string; defaultOpen?: boolean; children: ReactNode; tone?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return <div className="border-t border-navy-700">
    <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-navy-850">
      <span className={`text-[9px] text-faint transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-dim" style={tone ? { color: tone } : undefined}>{title}</span>
      {count !== undefined && <span className="ml-auto font-mono text-[10px] text-faint">{count}</span>}
    </button>
    {open && <div className="px-4 pb-3">{children}</div>}
  </div>
}

export function Btn({ children, onClick, active, disabled, title, className = '', primary }: {
  children: ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean; title?: string; className?: string; primary?: boolean
}) {
  const base = primary ? 'bg-accent/90 text-white hover:bg-accent border-accent'
    : active ? 'bg-navy-700 text-white border-navy-600' : 'text-dim border-transparent hover:bg-navy-800 hover:text-ink'
  return <button type="button" title={title} disabled={disabled} onClick={onClick}
    className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 text-[11.5px] disabled:pointer-events-none disabled:opacity-35 ${base} ${className}`}>{children}</button>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="flex h-full items-center justify-center p-6">
    <div className="max-w-sm text-center">
      <div className="text-[13px] font-medium text-ink">{title}</div>
      {children && <div className="mt-1 text-[12px] leading-relaxed text-dim">{children}</div>}
    </div>
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

/** Room-type tints for the drawing overlay; muted so status colours stay dominant. */
export const KIND_COLOR: Record<string, string> = {
  accommodation: '#6d8fb8', public_space: '#5f9cb5', work_space: '#8a80b5', control_station: '#5ea39b',
  service_space: '#7f8a99', machinery_space: '#b58a62', sanitary: '#6b7685', corridor: '#b8a85c', stair: '#a77fb0',
  open_deck: '#6aa57a', technical: '#566170', tank_or_void: '#3d4654', unknown: '#6b7685',
}
