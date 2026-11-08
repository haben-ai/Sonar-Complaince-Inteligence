import { useEffect, useMemo, useRef } from 'react'
import { MODULES, VIEW_STATUS, VIEW_STATUS_ORDER, type FindingView, type ViewStatus } from '../../lib/present'
import type { Review } from '../../state/useReview'
import { StatusDot } from '../ui'
import FindingListItem from '../finding/FindingListItem'
import { SECTION } from '../../lib/terms'

/** Left panel: filter, group and pick findings. Rows are compact; the inspector carries the detail. */
export default function FindingsExplorer({ rv, onCollapse }: { rv: Review; onCollapse: () => void }) {
  const { views, filtered, module, setModule, statuses, setStatuses, search, setSearch, groupBy, setGroupBy, findingId, selectFinding } = rv
  const listRef = useRef<HTMLDivElement>(null)

  const inModule = useMemo(() => views.filter((v) => !module || v.module === module), [views, module])
  const statusCount = (s: ViewStatus) => inModule.filter((v) => v.status === s).length
  const moduleCount = (id: string) => {
    const vs = views.filter((v) => v.module === id)
    return { total: vs.length, issue: vs.filter((v) => v.status === 'issue').length, incon: vs.filter((v) => v.status === 'inconclusive').length }
  }

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: '', items: filtered }]
    const m = new Map<string, { key: string; label: string; items: FindingView[] }>()
    for (const v of filtered) {
      const key = groupBy === 'module' ? v.module : v.deckId ?? '-'
      const label = groupBy === 'module' ? MODULES.find((x) => x.id === v.module)!.label : v.deckName
      if (!m.has(key)) m.set(key, { key, label, items: [] })
      m.get(key)!.items.push(v)
    }
    const order = groupBy === 'module' ? MODULES.map((x) => x.id as string) : []
    return [...m.values()].sort((a, b) => groupBy === 'module' ? order.indexOf(a.key) - order.indexOf(b.key) : a.label.localeCompare(b.label))
  }, [filtered, groupBy])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  // keep the selected row in view (also when selected from the drawing or 3D)
  useEffect(() => {
    if (!findingId) return
    listRef.current?.querySelector(`[data-fid="${CSS.escape(findingId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [findingId])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = flat.findIndex((v) => v.id === findingId)
    const next = flat[e.key === 'ArrowDown' ? Math.min(flat.length - 1, i + 1) : Math.max(0, i - 1)]
    if (next) selectFinding(next.id)
  }

  const toggleStatus = (s: ViewStatus) => {
    const n = new Set(statuses)
    if (n.has(s)) n.delete(s); else n.add(s)
    setStatuses(n)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center border-b border-navy-700 px-3">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-dim">{SECTION.checkResults}</span>
        <span className="ml-2 font-mono text-[12px] text-faint">{filtered.length}/{views.length}</span>
        <button onClick={onCollapse} title="Collapse panel" className="ml-auto rounded px-1 text-faint hover:bg-navy-800 hover:text-ink">‹</button>
      </div>

      {/* module filter */}
      <div className="shrink-0 border-b border-navy-700 py-1">
        {MODULES.map((m) => {
          const c = moduleCount(m.id)
          const on = module === m.id
          return <button key={m.id} onClick={() => setModule(on ? null : m.id)}
            className={`flex w-full items-center gap-2 px-3 py-1 text-left ${on ? 'bg-navy-800 text-white' : 'text-dim hover:bg-navy-850 hover:text-ink'}`}>
            <span className={`h-3 w-0.5 rounded ${on ? 'bg-accent' : 'bg-transparent'}`} />
            <span className="flex-1 truncate text-[13px]">{m.label}</span>
            {c.issue > 0 && <span className="font-mono text-[12px]" style={{ color: VIEW_STATUS.issue.hex }} title={VIEW_STATUS.issue.label}>{c.issue}</span>}
            <span className="font-mono text-[12px]" style={{ color: VIEW_STATUS.inconclusive.hex }} title={VIEW_STATUS.inconclusive.label}>{c.incon}</span>
            <span className="w-7 text-right font-mono text-[12px] text-faint" title="All check results">{c.total}</span>
          </button>
        })}
      </div>

      {/* status filter + search */}
      <div className="shrink-0 space-y-1.5 border-b border-navy-700 px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {VIEW_STATUS_ORDER.map((s) => {
            const n = statusCount(s)
            const on = statuses.has(s)
            return <button key={s} disabled={n === 0 && !on} onClick={() => toggleStatus(s)}
              title={n === 0 && s === 'not_assessed' ? 'No check result has this status. Rooms outside the checks are counted under coverage in Overview.' : VIEW_STATUS[s].help}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-[1px] text-[12px] disabled:opacity-35 ${on ? 'border-navy-600 bg-navy-700 text-white' : 'border-navy-700 text-dim hover:text-ink'}`}>
              <StatusDot s={s} size={6} />{VIEW_STATUS[s].short}<span className="font-mono text-faint">{n}</span>
            </button>
          })}
        </div>
        <div className="flex gap-1.5">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search room, finding or deck"
            className="h-6 min-w-0 flex-1 rounded border border-navy-700 bg-navy-850 px-2 text-[13px] text-ink outline-none placeholder:text-faint focus:border-accent" />
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} title="Group results"
            className="h-6 rounded border border-navy-700 bg-navy-850 px-1 text-[12px] text-dim outline-none">
            <option value="module">By module</option><option value="deck">By deck</option><option value="none">No grouping</option>
          </select>
        </div>
      </div>

      {/* list */}
      <div ref={listRef} tabIndex={0} onKeyDown={onKey} className="min-h-0 flex-1 overflow-y-auto outline-none">
        {!views.length && <div className="p-4 text-[13px] text-dim">No check results for this design.</div>}
        {views.length > 0 && !filtered.length && <div className="p-4 text-[13px] text-dim">No results match the current filters.
          <button className="ml-1 text-accent hover:underline" onClick={() => { setStatuses(new Set()); setSearch(''); setModule(null) }}>Clear filters</button></div>}
        {groups.map((g) => <div key={g.key}>
          {g.label && <div className="sticky top-0 z-10 flex items-center border-b border-navy-700 bg-navy-900/95 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-faint backdrop-blur">
            {g.label}<span className="ml-auto font-mono font-normal">{g.items.length}</span></div>}
          {g.items.map((v) => <FindingListItem key={v.id} v={v} rule={rv.ruleRefs.get(v.id)} on={v.id === findingId} onClick={() => selectFinding(v.id)} />)}
        </div>)}
      </div>
    </div>
  )
}
