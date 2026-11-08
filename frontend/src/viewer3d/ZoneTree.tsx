import { useMemo, useState } from 'react'
import { BAND } from './statusColors'
import type { Band, Scene3D } from './types'

const RANK: Record<Band, number> = { red: 3, amber: 2, green: 1, none: 0 }
const worst = (bs: Band[]): Band => bs.reduce<Band>((a, b) => (RANK[b] > RANK[a] ? b : a), 'none')

/** Deck > space type > space hierarchy with visibility toggles. Construction blocks and systems are listed as
 * unavailable: a General Arrangement does not carry block divisions, piping or HVAC routing. */
export default function ZoneTree({ scene, hidden, setHidden, selectedId, onSelect, onlyFlagged, setOnlyFlagged }: {
  scene: Scene3D; hidden: Set<string>; setHidden: (s: Set<string>) => void; selectedId: string | null
  onSelect: (id: string) => void; onlyFlagged: boolean; setOnlyFlagged: (b: boolean) => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const tree = useMemo(() => [...scene.decks].sort((a, b) => b.z - a.z).map((d) => {
    const sp = scene.spaces.filter((s) => s.deck_id === d.id && s.kind !== 'tank_or_void'
      && (!q || (s.name ?? s.kind).toLowerCase().includes(q.toLowerCase())))
    const kinds: Record<string, typeof sp> = {}
    for (const s of sp) (kinds[s.kind] ??= []).push(s)
    return { d, sp, kinds }
  }), [scene, q])
  const toggle = (k: string) => setOpen({ ...open, [k]: !open[k] })

  return (
    <div className="flex h-full flex-col text-[13px]">
      <div className="space-y-1.5 border-b border-navy-700 p-2">
        <div className="text-[12px] uppercase tracking-wider text-dim">Zone inspector</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter spaces…" className="w-full rounded bg-navy-850 px-2 py-0.5 ring-1 ring-navy-700 outline-none focus:ring-accent" />
        <label className="flex items-center gap-1.5 text-dim"><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />Fade spaces without checks</label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        <div className="px-1 pb-1 text-[12px] uppercase tracking-wider text-faint">Deck levels</div>
        {tree.map(({ d, sp, kinds }) => {
          const b = worst(sp.map((s) => s.band))
          const hid = hidden.has(d.id)
          return <div key={d.id}>
            <div className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-navy-800">
              <button onClick={() => toggle(d.id)} className="w-3 text-faint">{open[d.id] ? '▾' : '▸'}</button>
              <span className="h-2 w-2 rounded-full" style={{ background: BAND[b].color }} />
              <button onClick={() => toggle(d.id)} className={`flex-1 truncate text-left ${hid ? 'text-faint line-through' : 'text-ink'}`}>{d.name}</button>
              <span className="font-mono text-[12px] text-faint">{d.z.toFixed(1)} m · {sp.length}</span>
              <button title={hid ? 'show deck' : 'hide deck'} onClick={() => { const n = new Set(hidden); if (hid) n.delete(d.id); else n.add(d.id); setHidden(n) }}
                className="px-1 text-dim hover:text-white">{hid ? '◌' : '●'}</button>
            </div>
            {open[d.id] && Object.entries(kinds).sort().map(([k, ss]) => {
              const key = d.id + k
              return <div key={key} className="ml-4">
                <button onClick={() => toggle(key)} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-dim hover:bg-navy-800">
                  <span className="w-3 text-faint">{open[key] ? '▾' : '▸'}</span>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: BAND[worst(ss.map((s) => s.band))].color }} />
                  <span className="flex-1 capitalize">{k.replace(/_/g, ' ')}</span><span className="text-[12px] text-faint">{ss.length}</span>
                </button>
                {open[key] && ss.map((s) => (
                  <button key={s.id} onClick={() => onSelect(s.id)}
                    className={`ml-4 flex w-[calc(100%-1rem)] items-center gap-1.5 truncate rounded px-1 py-0.5 text-left ${s.id === selectedId ? 'bg-navy-700 text-white' : 'text-dim hover:bg-navy-800 hover:text-ink'}`}>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: BAND[s.band].color }} />
                    <span className="truncate">{s.name ?? s.kind.replace(/_/g, ' ')}</span>
                    {s.refs.length > 0 && <span className="ml-auto text-[11.5px] text-faint">{s.refs.length}</span>}
                  </button>
                ))}
              </div>
            })}
          </div>
        })}
        <div className="mt-3 px-1 text-[12px] uppercase tracking-wider text-faint">Construction blocks</div>
        <div className="px-1 text-[12px] text-faint">Not available - a GA drawing has no block division. Import a block plan to enable.</div>
        <div className="mt-2 px-1 text-[12px] uppercase tracking-wider text-faint">Systems (structural · piping · HVAC)</div>
        <div className="px-1 text-[12px] text-faint">Not available - piping/HVAC routing is not drawn on a GA. Only spaces labelled for these systems (e.g. A/C rooms) appear under their deck.</div>
      </div>
    </div>
  )
}
