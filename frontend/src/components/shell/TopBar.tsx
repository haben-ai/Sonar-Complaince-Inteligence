import { useEffect, useRef, useState } from 'react'
import type { Workspace } from '../../state/useWorkspace'
import { OriginBadge } from '../ui'

export type Page = 'overview' | 'review' | 'explorer' | 'report'
const NAV: { id: Page; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'review', label: 'Engineering Review' },
  { id: 'explorer', label: 'Design Explorer' }, { id: 'report', label: 'Report' },
]

/** Single 40 px bar: product, navigation, design context, import. */
export default function TopBar({ page, setPage, ws }: { page: Page; setPage: (p: Page) => void; ws: Workspace }) {
  const { designs, designId, setDesignId, current, scenarios, scenario, setScenario, status } = ws
  return (
    <header className="no-print flex h-10 shrink-0 items-center gap-3 border-b border-navy-700 bg-navy-900 px-3">
      <div className="flex items-center gap-2 pr-1">
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth={1.7}><path d="M3 15h18l-3 5H6z" /><path d="M7 15V9h7v6M14 11h3v4M10 9V5" /></svg>
        <span className="hidden whitespace-nowrap text-[12px] font-semibold tracking-wide text-white xl:inline">Maritime Safety Intelligence</span>
        <span className="whitespace-nowrap text-[12px] font-semibold tracking-wide text-white xl:hidden">MSI</span>
      </div>
      <nav className="flex h-full shrink-0 items-stretch">
        {NAV.map((n) => <button key={n.id} onClick={() => setPage(n.id)}
          className={`whitespace-nowrap border-b-2 px-2.5 text-[12px] ${page === n.id ? 'border-accent text-white' : 'border-transparent text-dim hover:text-ink'}`}>{n.label}</button>)}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <StatusPip ws={ws} />
        <select value={designId ?? ''} onChange={(e) => setDesignId(e.target.value)} title="Design"
          className="h-6 w-40 min-w-[120px] shrink xl:w-[220px] rounded border border-navy-700 bg-navy-850 px-1.5 text-[11.5px] text-ink outline-none">
          {!designs.length && <option value="">No designs</option>}
          {designs.map((d) => <option key={d.design_id} value={d.design_id}>{d.name}{d.status !== 'ready' ? ` (${d.status})` : ''}</option>)}
        </select>
        {current?.data_origin && current.data_origin !== 'actual_pdf' && <OriginBadge origin={current.data_origin} />}
        {current?.source_type === 'pdf' && current.design_id === 'dana_v' && scenarios.length > 0 && (
          <select value={scenario ?? ''} onChange={(e) => setScenario(e.target.value || null)} title="Synthetic scenario (test modification of the design)"
            className={`h-6 w-32 rounded border px-1.5 xl:w-52 text-[11.5px] outline-none ${scenario ? 'border-pink-400/50 bg-pink-950/40 text-pink-200' : 'border-navy-700 bg-navy-850 text-dim'}`}>
            <option value="">As extracted</option>
            {scenarios.map((s) => <option key={s.id} value={s.id}>Synthetic: {s.title}</option>)}
          </select>
        )}
        <span title={status?.mode} className={`hidden whitespace-nowrap text-[10.5px] 2xl:inline ${status?.llm_enabled ? 'text-[#5fb3c4]' : 'text-faint'}`}>
          {status ? status.llm_enabled ? `AI assist: ${status.model}` : 'Deterministic mode' : ''}</span>
        <ImportMenu ws={ws} />
      </div>
    </header>
  )
}

function StatusPip({ ws }: { ws: Workspace }) {
  const c = ws.current
  if (!c) return null
  const s = c.status === 'ready' ? (ws.loadingAnalysis ? ['Loading analysis', '#d6a03a'] : ws.analysisError ? ['Analysis error', '#e0524d'] : ['Analysis complete', '#4ea866'])
    : c.status === 'error' ? ['Extraction failed', '#e0524d'] : ['Extracting…', '#d6a03a']
  return <span className="hidden items-center gap-1.5 whitespace-nowrap text-[11px] text-dim xl:flex" title={c.error ?? undefined}>
    <span className={`h-1.5 w-1.5 rounded-full ${c.status !== 'ready' && c.status !== 'error' ? 'animate-pulse' : ''}`} style={{ background: s[1] }} />{s[0]}
  </span>
}

function ImportMenu({ ws }: { ws: Workspace }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return <div ref={box} className="relative">
    <button disabled={!!ws.busy} onClick={() => setOpen(!open)}
      className="h-6 whitespace-nowrap rounded border border-accent bg-accent/90 px-2.5 text-[11.5px] font-medium text-white hover:bg-accent disabled:opacity-60">{ws.busy ?? 'Upload design'} ▾</button>
    {open && <div className="absolute right-0 top-7 z-40 w-80 rounded border border-navy-600 bg-navy-900 p-2 shadow-xl shadow-black/40">
      <button onClick={() => fileRef.current?.click()} className="block w-full rounded px-2 py-1.5 text-left hover:bg-navy-800">
        <div className="text-[12px] text-ink">Upload file…</div><div className="text-[10.5px] text-faint">PDF general arrangement, image, or structured JSON</div></button>
      <form onSubmit={(e) => { e.preventDefault(); if (url.trim()) { ws.importUrl(url); setUrl(''); setOpen(false) } }} className="mt-1 border-t border-navy-700 px-2 pt-2">
        <div className="mb-1 text-[12px] text-ink">Import from URL</div>
        <div className="flex gap-1">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… PDF / image / Box link"
            className="h-6 min-w-0 flex-1 rounded border border-navy-700 bg-navy-850 px-2 text-[11.5px] outline-none focus:border-accent" />
          <button className="h-6 rounded border border-navy-600 px-2 text-[11px] text-ink hover:bg-navy-800">Import</button>
        </div>
      </form>
      {!ws.status?.default_pdf_present && <button onClick={() => { ws.fetchDana(); setOpen(false) }} className="mt-1 block w-full rounded px-2 py-1.5 text-left text-[12px] text-ink hover:bg-navy-800">Fetch DANA V reference GA</button>}
    </div>}
    <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.json" className="hidden"
      onChange={(e) => { const f = e.target.files?.[0]; if (f) { ws.upload(f); setOpen(false) } e.target.value = '' }} />
  </div>
}
