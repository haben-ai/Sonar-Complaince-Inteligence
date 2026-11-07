import { useMemo, useState } from 'react'
import type { Finding, Status } from '../types'
import { ENGINE_SHORT, OriginBadge, STATUS_META, StatusBadge } from './ui'

const ORDER: Record<Status, number> = { POTENTIAL_CONNECTIVITY_ISSUE: 0, INCONCLUSIVE: 1, CONNECTIVITY_VERIFIED: 2 }

export default function FindingsPanel({ findings, engine, selected, onSelect }: {
  findings: Finding[]; engine: string | null; selected: string | null; onSelect: (f: Finding) => void
}) {
  const [status, setStatus] = useState<Status | 'all'>('all')
  const [text, setText] = useState('')
  const list = useMemo(() => findings
    .filter((f) => !engine || f.engine === engine)
    .filter((f) => status === 'all' || f.status === status)
    .filter((f) => !text || (f.id + f.title + f.affected_names.join(' ')).toLowerCase().includes(text.toLowerCase()))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.id.localeCompare(b.id)), [findings, engine, status, text])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 pb-2">
        {(['all', 'POTENTIAL_CONNECTIVITY_ISSUE', 'INCONCLUSIVE', 'CONNECTIVITY_VERIFIED'] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${status === s ? 'bg-navy-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            {s === 'all' ? 'ALL' : STATUS_META[s].short}
          </button>
        ))}
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter…"
          className="ml-auto w-24 rounded bg-navy-850 px-2 py-0.5 text-[11px] text-slate-200 ring-1 ring-navy-700 outline-none focus:ring-sky-500" />
      </div>
      <div className="mb-1 text-[10px] text-slate-500">{list.length} findings</div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {list.map((f) => (
          <button key={f.id} onClick={() => onSelect(f)}
            className={`block w-full rounded-md border-l-2 px-2 py-1.5 text-left ring-1 transition ${selected === f.id ? 'bg-navy-700 ring-sky-400/50' : 'bg-navy-850 ring-navy-800 hover:bg-navy-800'}`}
            style={{ borderLeftColor: STATUS_META[f.status].hex }}>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-slate-400">{f.id}</span>
              <span className="text-[10px] text-slate-500">{ENGINE_SHORT[f.engine]}</span>
              <span className="ml-auto flex gap-1">{f.data_origin !== 'actual_pdf' && <OriginBadge origin={f.data_origin} />}<StatusBadge status={f.status} /></span>
            </div>
            <div className="mt-0.5 truncate text-[12px] font-medium text-slate-100">{f.affected_names[0]}</div>
            <div className="truncate text-[11px] text-slate-400">{f.title}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
