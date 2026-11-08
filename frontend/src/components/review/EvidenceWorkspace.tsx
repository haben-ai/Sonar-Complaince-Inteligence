import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import DrawingViewer, { type ViewerHandle } from '../DrawingViewer'
import { escapeStatusBySpace, VIEW_STATUS } from '../../lib/present'
import { type Overlays, type Review } from '../../state/useReview'
import type { Workspace } from '../../state/useWorkspace'
import { Btn, Empty } from '../ui'

const ShipViewport = lazy(() => import('../../viewer3d/ShipViewport'))   // three.js loads only when 3D is opened

/** Centre panel: the original drawing by default, the derived 3D model on request. */
export default function EvidenceWorkspace({ rv, ws }: { rv: Review; ws: Workspace }) {
  const viewer = useRef<ViewerHandle>(null)
  const { model, current, designId } = ws
  const escStatus = useMemo(() => escapeStatusBySpace(ws.findings), [ws.findings])
  const pages = model?.document.page_count ?? 0
  const is3d = rv.viewMode === '3d'
  const deckId = rv.mode === 'space' ? model?.spaces.find((s) => s.id === rv.spaceId)?.deck_id ?? null
    : rv.mode === 'result' ? rv.result?.deck_id ?? null : rv.selected?.deckId ?? null
  const sel = rv.mode === 'result' ? rv.result && { id: rv.result.spec_id, name: rv.result.element_names[0] ?? rv.result.title }
    : rv.mode === 'space' ? rv.spaceId && { id: rv.spaceId, name: model?.spaces.find((s) => s.id === rv.spaceId)?.name ?? '(unlabelled)' }
      : rv.selected && { id: rv.selected.id, name: rv.selected.element }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-navy-700 bg-navy-900 px-2">
        <div className="flex shrink-0 whitespace-nowrap rounded border border-navy-700 p-px">
          <button onClick={() => rv.setViewMode('2d')} className={`rounded-sm px-2 py-[1px] text-[13px] ${!is3d ? 'bg-navy-700 text-white' : 'text-dim hover:text-ink'}`}>{current?.source_type === 'json' ? 'Plan view' : 'Original drawing'}</button>
          <button onClick={() => rv.setViewMode('3d')} title="Room outlines extruded from the 2D GA drawing - not a 3D ship model"
            className={`rounded-sm px-2 py-[1px] text-[13px] ${is3d ? 'bg-navy-700 text-white' : 'text-dim hover:text-ink'}`}>Derived 3D</button>
        </div>
        {!is3d && <>
          <Sep />
          <LayersMenu overlays={rv.overlays} setOverlays={rv.setOverlays} />
          <Sep />
          <Btn title="Zoom out" onClick={() => viewer.current?.zoomOut()}>−</Btn>
          <Btn title="Zoom in" onClick={() => viewer.current?.zoomIn()}>+</Btn>
          <Btn title="Show the whole sheet" onClick={() => viewer.current?.fitAll()}>Full sheet</Btn>
          {deckId && <Btn title="Show the whole deck of the selected item" onClick={() => viewer.current?.fitDeck(deckId)}>Full deck</Btn>}
          {pages > 1 && <>
            <Sep />
            <Btn disabled={rv.page <= 0} onClick={() => rv.setPage(rv.page - 1)} title="Previous sheet">‹</Btn>
            <select value={rv.page} onChange={(e) => rv.setPage(Number(e.target.value))} className="h-6 max-w-48 rounded border border-navy-700 bg-navy-850 px-1 text-[12px] text-ink outline-none">
              {Array.from({ length: pages }, (_, i) => {
                const ds = model!.decks.filter((d) => d.page === i)
                return <option key={i} value={i}>Sheet {i + 1}{ds.length ? ` · ${ds.map((d) => d.name.split(' (')[0]).join(', ').slice(0, 36)}` : ''}</option>
              })}
            </select>
            <Btn disabled={rv.page >= pages - 1} onClick={() => rv.setPage(rv.page + 1)} title="Next sheet">›</Btn>
          </>}
        </>}
        {sel && <div className="ml-auto flex min-w-0 items-center gap-1.5 pl-2 text-[12px]">
          {rv.highlight && rv.mode !== 'space' && <span className="status-dot h-2 w-2 shrink-0 rounded-full" style={{ background: VIEW_STATUS[rv.highlight.status].hex }} />}
          <span className="min-w-0 max-w-[40%] truncate font-mono text-dim">{sel.id}</span>
          <span className="truncate text-ink">{sel.name}</span>
          <Btn title="Frame selection" onClick={rv.locate}>⌖</Btn>
          <Btn title="Clear selection" onClick={rv.clearSelection}>×</Btn>
        </div>}
      </div>

      <div className="relative min-h-0 flex-1">
        {!is3d && model && designId && current && <DrawingViewer ref={viewer} page={rv.page} onPage={rv.setPage} designId={designId} sourceType={current.source_type}
          model={model} highlight={rv.highlight} focus={rv.focus} evidenceBox={rv.evidence?.box ?? null}
          selectedSpace={rv.spaceId} onSelectSpace={(id) => rv.selectSpace(id)} overlays={rv.overlays} escStatus={escStatus} />}
        {is3d && <Scene3DView rv={rv} ws={ws} />}
      </div>
    </div>
  )
}

const Sep = () => <span className="mx-1 h-4 w-px bg-navy-700" />

/** Plain-language layer groups; each maps onto one or more display overlays. */
const LAYER_GROUPS: { label: string; help: string; keys: (keyof Overlays)[] }[] = [
  { label: 'Selected result', help: 'Highlight the room and route of the selected result', keys: ['selection'] },
  { label: 'Rooms', help: 'Room outlines read from the drawing', keys: ['rooms'] },
  { label: 'Room names', help: 'Labels at each room', keys: ['labels'] },
  { label: 'Doors and exits', help: 'Door symbols and marked escape points', keys: ['doors', 'exits'] },
  { label: 'Escape routes', help: 'How rooms connect towards the exits', keys: ['routes'] },
  { label: 'Hazards and fire boundaries', help: 'Hazardous spaces and their neighbours', keys: ['hazards', 'fire'] },
]

function LayersMenu({ overlays, setOverlays }: { overlays: Overlays; setOverlays: (o: Overlays) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const on = LAYER_GROUPS.filter((g) => g.keys.every((k) => overlays[k])).length
  const toggle = (keys: (keyof Overlays)[]) => {
    const next = !keys.every((k) => overlays[k])
    setOverlays({ ...overlays, ...Object.fromEntries(keys.map((k) => [k, next])) })
  }
  return <div ref={ref} className="relative">
    <Btn active={open} onClick={() => setOpen(!open)}>Show <span className="font-mono text-faint">{on}/{LAYER_GROUPS.length}</span> ▾</Btn>
    {open && <div className="absolute left-0 top-7 z-30 w-60 rounded border border-navy-600 bg-navy-900 py-1 shadow-xl shadow-black/40">
      {LAYER_GROUPS.map((g) => <label key={g.label} className="flex cursor-pointer items-start gap-2 px-3 py-1 text-[13px] text-ink hover:bg-navy-800">
        <input type="checkbox" checked={g.keys.every((k) => overlays[k])} onChange={() => toggle(g.keys)} className="mt-[3px] accent-[#36b6a0]" />
        <span>{g.label}<span className="block text-[12px] text-faint">{g.help}</span></span>
      </label>)}
      <div className="mt-1 border-t border-navy-700 px-3 pt-1 text-[12px] text-faint">Layers change the display only, never the analysis results.</div>
    </div>}
  </div>
}

function Scene3DView({ rv, ws }: { rv: Review; ws: Workspace }) {
  const { scene, sceneError } = ws
  if (sceneError) return <Empty title="3D model could not be loaded">{sceneError}</Empty>
  if (!scene) return <Empty title="Building derived 3D model…" />
  if (!scene.available) return <Empty title="Derived 3D model not available for this design">{scene.reason}</Empty>
  const selectedId = rv.spaceId ?? rv.highlight?.primary ?? null
  const decks = [...scene.decks].sort((a, b) => b.z - a.z)
  const extra = <div className="border-t border-navy-700 pt-1.5">
    <div className="mb-1 text-[12px] uppercase tracking-wider text-faint">Decks</div>
    {decks.map((d) => {
      const hid = rv.hiddenDecks.has(d.id)
      return <label key={d.id} className="flex cursor-pointer items-center gap-1.5 text-dim hover:text-ink">
        <input type="checkbox" checked={!hid} className="accent-[#36b6a0]" onChange={() => { const n = new Set(rv.hiddenDecks); if (hid) n.delete(d.id); else n.add(d.id); rv.setHiddenDecks(n) }} />
        <span className="flex-1 truncate">{d.name}</span><span className="font-mono text-[12px] text-faint">{d.z.toFixed(1)} m</span>
      </label>
    })}
    <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-dim"><input type="checkbox" className="accent-[#36b6a0]" checked={rv.onlyFlagged} onChange={(e) => rv.setOnlyFlagged(e.target.checked)} />Fade spaces without checks</label>
  </div>
  return <Suspense fallback={<Empty title="Loading 3D engine…" />}>
    <ShipViewport scene={scene} selectedId={selectedId} focusId={rv.focus3d} hiddenDecks={rv.hiddenDecks} onlyFlagged={rv.onlyFlagged} onSelect={rv.select3d} settingsExtra={extra} />
  </Suspense>
}
