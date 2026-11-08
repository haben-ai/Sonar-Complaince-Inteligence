import { useState, type ReactNode } from 'react'

export interface InspectorTab { id: string; label: string; count?: number | string; body: ReactNode }

/**
 * Shared inspector layout: a compact header that stays in place, a tab bar, and one scrolling body.
 * The first tab is the short summary; longer material sits behind the other tabs, never removed.
 * Mount with a `key` per selection so every new selection opens on the summary.
 */
export default function InspectorShell({ header, tabs }: { header: ReactNode; tabs: InspectorTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id)
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 px-4 pb-2 pt-3">{header}</div>
    <div role="tablist" className="flex shrink-0 gap-1 border-b border-navy-700 px-3">
      {tabs.map((t) => <button key={t.id} role="tab" aria-selected={t.id === tab?.id} onClick={() => setActive(t.id)}
        className={`-mb-px border-b-2 px-2 py-1.5 text-[13px] ${t.id === tab?.id ? 'border-accent text-ink' : 'border-transparent text-dim hover:text-ink'}`}>
        {t.label}{t.count !== undefined && <span className="ml-1 font-mono text-[12px] text-faint">{t.count}</span>}
      </button>)}
    </div>
    <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">{tab?.body}</div>
  </div>
}

/** Square icon button with a tooltip; used for the header actions. */
export function IconButton({ title, onClick, disabled, active, children }: {
  title: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode
}) {
  return <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border text-[14px] disabled:opacity-35 ${active ? 'border-accent bg-accent/15 text-accent' : 'border-navy-600 text-dim hover:border-accent hover:text-ink'}`}>
    {children}
  </button>
}

export const LocateIcon = () => <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6}><circle cx="8" cy="8" r="4.5" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" /></svg>
export const CubeIcon = () => <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round"><path d="M8 1.5 14 4.5v7L8 14.5 2 11.5v-7z" /><path d="M2 4.5 8 7.5l6-3M8 7.5v7" /></svg>
export const SheetIcon = () => <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}><rect x="2.5" y="1.5" width="11" height="13" rx="1" /><path d="M5 5h6M5 8h6M5 11h4" /></svg>

/** Short labelled paragraph used inside the summary tabs. */
export function Para({ label, children }: { label: string; children: ReactNode }) {
  return <div className="mt-3 first:mt-0">
    <div className="mb-0.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-faint">{label}</div>
    <div className="text-[14px] leading-relaxed text-ink">{children}</div>
  </div>
}

/** One-line disclosure: a short label that opens a paragraph. */
export function MoreLine({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <div className="mt-3 border-t border-navy-700 pt-2">
    <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 text-left text-[13px] text-dim hover:text-ink">
      <span className={`text-[9px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>{label}
    </button>
    {open && <div className="mt-1 text-[14px] leading-relaxed text-ink">{children}</div>}
  </div>
}
