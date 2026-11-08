import { Suspense, lazy, useMemo, useState } from 'react'
import DataReport from '../components/DataReport'
import GraphView from '../components/GraphView'
import RegulatoryPanel from '../components/RegulatoryPanel'
import { Empty, ProvChip } from '../components/ui'
import { escapeStatusBySpace } from '../lib/present'
import type { Review } from '../state/useReview'
import type { Workspace } from '../state/useWorkspace'
import ZoneTree from '../viewer3d/ZoneTree'

const ShipViewport = lazy(() => import('../viewer3d/ShipViewport'))
const ExploreScene = lazy(() => import('../viewer3d/explore/ExploreScene'))

export type ExplorerTab = 'explore' | 'spaces' | 'graph' | '3d' | 'regulatory' | 'data'
const TABS: { id: ExplorerTab; label: string }[] = [
  { id: 'explore', label: 'Explore (guided tour)' }, { id: 'spaces', label: 'Spaces' }, { id: 'graph', label: 'Escape-route graph' }, { id: '3d', label: 'Derived 3D model' },
  { id: 'regulatory', label: 'Regulatory checks' }, { id: 'data', label: 'Extraction data' },
]

/** Secondary views of the extracted design. Selections here open the item in Engineering Review. */
export default function ExplorerPage({ ws, rv, tab, setTab, toReview }: { ws: Workspace; rv: Review; tab: ExplorerTab; setTab: (t: ExplorerTab) => void; toReview: () => void }) {
  const { model, summary, graph } = ws
  const escStatus = useMemo(() => escapeStatusBySpace(ws.findings), [ws.findings])
  if (!ws.ready || !model || !summary) return <Empty title={ws.analysisError ? 'Analysis could not be loaded' : 'Design not ready'}>{ws.analysisError ?? 'The explorer opens once extraction and analysis are complete.'}</Empty>

  const openSpace = (id: string) => { rv.setViewMode('2d'); rv.selectSpace(id, { focus: true }); toReview() }
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex h-8 shrink-0 items-stretch gap-1 border-b border-navy-700 bg-navy-900 px-2">
      {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)}
        className={`border-b-2 px-2.5 text-[13px] ${tab === t.id ? 'border-accent text-white' : 'border-transparent text-dim hover:text-ink'}`}>{t.label}</button>)}
    </div>
    <div className="relative min-h-0 flex-1">
      {tab === 'spaces' && <SpacesTable ws={ws} onOpen={openSpace} />}
      {tab === 'graph' && (graph ? <GraphView graph={graph} model={model} finding={rv.highlight} escStatus={escStatus} selectedId={rv.spaceId} onSelectNode={openSpace} /> : <Empty title="Loading graph…" />)}
      {tab === '3d' && <Explorer3D ws={ws} rv={rv} />}
      {tab === 'explore' && (ws.sceneError ? <Empty title="3D model could not be loaded">{ws.sceneError}</Empty>
        : !ws.scene ? <Empty title="Building the toy model…" />
        : !ws.scene.available ? <Empty title="Explore mode needs the derived 3D model">{ws.scene.reason}</Empty>
        : <Suspense fallback={<Empty title="Loading 3D engine…" />}>
            <ExploreScene scene={ws.scene} views={rv.views} hiddenDecks={rv.hiddenDecks}
              onInspect={(id) => { rv.setViewMode('2d'); rv.selectFinding(id); toReview() }} />
          </Suspense>)}
      {tab === 'regulatory' && (ws.reg ? <RegulatoryPanel ev={ws.reg} demo={ws.demo} onDemo={ws.setDemo} selected={rv.result?.result_id ?? null} designId={ws.designId!}
        onSelect={(r) => { rv.setViewMode('2d'); rv.selectResult(r); toReview() }} onChanged={ws.bumpReg} />
        : <Empty title={ws.regError ? 'Regulatory layer unavailable' : 'Loading regulatory evaluation…'}>{ws.regError ? `${ws.regError}. The corpus is installed with scripts/fetch_regulations.py.` : undefined}</Empty>)}
      {tab === 'data' && <DataReport model={model} summary={summary} />}
    </div>
  </div>
}

function Explorer3D({ ws, rv }: { ws: Workspace; rv: Review }) {
  const { scene, sceneError } = ws
  if (sceneError) return <Empty title="3D model could not be loaded">{sceneError}</Empty>
  if (!scene) return <Empty title="Building derived 3D model…" />
  if (!scene.available) return <Empty title="Derived 3D model not available for this design">{scene.reason}</Empty>
  const sel = rv.spaceId ?? rv.highlight?.primary ?? null
  return <div className="flex h-full">
    <aside className="w-64 shrink-0 border-r border-navy-700 bg-navy-900">
      <ZoneTree scene={scene} hidden={rv.hiddenDecks} setHidden={rv.setHiddenDecks} selectedId={sel} onSelect={rv.select3d} onlyFlagged={rv.onlyFlagged} setOnlyFlagged={rv.setOnlyFlagged} />
    </aside>
    <div className="min-w-0 flex-1"><Suspense fallback={<Empty title="Loading 3D engine…" />}>
      <ShipViewport scene={scene} selectedId={sel} focusId={rv.focus3d} hiddenDecks={rv.hiddenDecks} onlyFlagged={rv.onlyFlagged} onSelect={rv.select3d} />
    </Suspense></div>
  </div>
}

function SpacesTable({ ws, onOpen }: { ws: Workspace; onOpen: (id: string) => void }) {
  const model = ws.model!
  const [q, setQ] = useState('')
  const [deck, setDeck] = useState('')
  const [onlyHaz, setOnlyHaz] = useState(false)
  const deckName = new Map(model.decks.map((d) => [d.id, d.name]))
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of ws.findings) for (const id of f.affected_ids) m.set(id, (m.get(id) ?? 0) + 1)
    return m
  }, [ws.findings])
  const rows = model.spaces.filter((s) => (!deck || s.deck_id === deck) && (!onlyHaz || s.hazard)
    && (!q || `${s.name ?? ''} ${s.id} ${s.kind}`.toLowerCase().includes(q.toLowerCase())))
  return <div className="flex h-full flex-col">
    <div className="flex shrink-0 items-center gap-2 border-b border-navy-700 px-3 py-1.5">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, ID or type" className="h-6 w-60 rounded border border-navy-700 bg-navy-850 px-2 text-[13px] outline-none focus:border-accent" />
      <select value={deck} onChange={(e) => setDeck(e.target.value)} className="h-6 rounded border border-navy-700 bg-navy-850 px-1 text-[13px] text-dim outline-none">
        <option value="">All decks</option>{model.decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <label className="flex items-center gap-1.5 text-[13px] text-dim"><input type="checkbox" checked={onlyHaz} onChange={(e) => setOnlyHaz(e.target.checked)} className="accent-[#36b6a0]" />Hazardous only</label>
      <span className="ml-auto font-mono text-[12px] text-faint">{rows.length} / {model.spaces.length}</span>
    </div>
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-navy-900 text-left text-[12px] text-faint"><tr className="border-b border-navy-700">
          {['Space', 'ID', 'Deck', 'Type', 'Hazard', 'Area label', 'Area derived', 'Source', 'Findings'].map((h) => <th key={h} className="px-3 py-1 font-normal">{h}</th>)}</tr></thead>
        <tbody>{rows.map((s) => <tr key={s.id} onClick={() => onOpen(s.id)} className="cursor-pointer border-b border-navy-800 hover:bg-navy-850">
          <td className="px-3 py-1 text-ink">{s.name ?? <span className="text-faint">(unlabelled)</span>}</td>
          <td className="px-3 font-mono text-[12px] text-faint">{s.id}</td>
          <td className="px-3 text-dim">{deckName.get(s.deck_id) ?? s.deck_id}</td>
          <td className="px-3 text-dim">{s.kind.replace(/_/g, ' ')}</td>
          <td className="px-3 text-hazard">{s.hazard?.category.replace(/_/g, ' ') ?? ''}</td>
          <td className="px-3 text-right font-mono text-dim">{s.labelled_area_m2 ?? ''}</td>
          <td className="px-3 text-right font-mono text-dim">{s.computed_area_m2?.toFixed(1) ?? ''}</td>
          <td className="px-3"><ProvChip p={s.provenance} /></td>
          <td className="px-3 text-right font-mono text-dim">{counts.get(s.id) ?? ''}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>
}
