import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { AdaptiveDpr } from '@react-three/drei'
import { MODULE_LABEL, VIEW_STATUS, type FindingView } from '../../lib/present'
import type { EngineId } from '../../types'
import type { Scene3D } from '../types'
import Beacons from './Beacons'
import CameraRig from './CameraRig'
import ToyShip from './ToyShip'
import { buildWorld, TOY_KIND, TOY_KIND_LABEL, type Block, type TourFilter } from './world'

const BG = '#f3ede2'

function useReducedMotion() {
  const [r, setR] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!m) return
    const f = () => setR(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return r
}

/** Explore mode: the derived deck model as a toy on a plinth, with a guided tour over the findings. */
export default function ExploreScene({ scene, views, hiddenDecks, onInspect }: {
  scene: Scene3D; views: FindingView[]; hiddenDecks: Set<string>; onInspect: (findingId: string) => void
}) {
  const [filter, setFilter] = useState<TourFilter>('issues')
  const [index, setIndex] = useState(-1)
  const [free, setFree] = useState(false)
  const systemReduced = useReducedMotion()
  const [calm, setCalm] = useState(false)
  const reduced = systemReduced || calm
  const world = useMemo(() => buildWorld(scene, views, filter), [scene, views, filter])
  const { stops } = world
  const stop = index >= 0 ? stops[index] : null
  useEffect(() => { setIndex(-1); setFree(false) }, [filter, scene])

  const go = (i: number) => { setFree(false); setIndex(Math.max(-1, Math.min(stops.length - 1, i))) }
  const pickStop = (id: string) => go(stops.findIndex((s) => s.id === id))
  const pickBlock = (b: Block) => { if (b.stopIds.length) pickStop(b.stopIds[0]) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return
      if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1) }
      else if (e.key === 'Escape') go(-1)
      else if (e.key.toLowerCase() === 'f') setFree((x) => !x)
      else if (e.key === 'Enter' && stop) onInspect(stop.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // re-bound each render so it sees the current index

  const L = world.bounds.length
  const [cx, cy, cz] = world.bounds.centre
  const beaconScale = Math.min(Math.max(L / 90, 0.8), 1.8)

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: `radial-gradient(ellipse at 50% 35%, #fbf8f2 0%, ${BG} 55%, #e6dccb 100%)` }}>
      <Canvas shadows="soft" dpr={[1, 2]} camera={{ fov: 32, near: 0.5, far: L * 14, position: [cx - L * 0.55, cy + L * 0.45, cz + L * 0.75] }}
        onPointerMissed={() => { document.body.style.cursor = 'default' }}>
        <AdaptiveDpr pixelated={false} />
        <fog attach="fog" args={[BG, L * 1.4, L * 4]} />
        <hemisphereLight args={['#fff7ea', '#c8b597', 0.95]} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[cx - L * 0.35, cy + L * 0.7, cz + L * 0.45]} intensity={1.7} color="#fff0d8" castShadow
          shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.04}
          shadow-camera-left={-L * 0.75} shadow-camera-right={L * 0.75} shadow-camera-top={L * 0.75} shadow-camera-bottom={-L * 0.75}
          shadow-camera-near={1} shadow-camera-far={L * 3}>
          <object3D attach="target" position={[cx, cy, cz]} />
        </directionalLight>
        <ToyShip world={world} scene={scene} activeRoom={stop?.roomId ?? null} hiddenDecks={hiddenDecks}
          cutAboveZ={stop ? stop.deckZ : null} reduced={reduced} onPick={pickBlock} />
        <Beacons stops={stops.filter((s) => !hiddenDecks.has(world.blocks.find((b) => b.id === s.roomId)?.deckId ?? '')
          && (!stop || s.deckZ <= stop.deckZ + 0.01))}
          activeId={stop?.id ?? null} scale={beaconScale} reduced={reduced} onPick={pickStop} />
        <CameraRig world={world} index={index} free={free} reduced={reduced} />
      </Canvas>

      {/* top-left: tour filter */}
      <div className="absolute left-3 top-3 flex items-center gap-2">
        <span className="rounded-full bg-white/85 px-3 py-1 text-[12px] font-semibold text-[#2b3442] shadow-sm ring-1 ring-black/5">Explore · guided tour</span>
        <div className="flex rounded-full bg-white/85 p-0.5 text-[11.5px] shadow-sm ring-1 ring-black/5">
          {([['issues', 'Potential issues'], ['issues+inconclusive', '+ Inconclusive'], ['all', 'All findings']] as [TourFilter, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-2.5 py-0.5 ${filter === k ? 'bg-[#2b3442] text-white' : 'text-[#4a5566] hover:text-[#1d2430]'}`}>{l}</button>
          ))}
        </div>
      </div>

      {/* top-right: legend */}
      <div className="absolute right-3 top-3 w-44 rounded-xl bg-white/85 p-2.5 text-[11px] text-[#3a4454] shadow-sm ring-1 ring-black/5">
        <div className="mb-1 font-semibold text-[#2b3442]">Markers = review status</div>
        {(['issue', 'inconclusive', 'verified'] as const).map((s) => <div key={s} className="flex items-center gap-1.5"><span className="h-2 w-2 rotate-45" style={{ background: VIEW_STATUS[s].hex }} />{VIEW_STATUS[s].label}</div>)}
        <div className="mb-1 mt-2 font-semibold text-[#2b3442]">Blocks = space type</div>
        <div className="grid grid-cols-2 gap-x-2">{TOY_KIND_LABEL.map(([k, l]) => <div key={k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm ring-1 ring-black/10" style={{ background: TOY_KIND[k] }} />{l}</div>)}</div>
      </div>

      {/* bottom: tour card */}
      <div className="absolute bottom-4 left-1/2 w-[min(640px,calc(100%-24px))] -translate-x-1/2">
        <div className="rounded-2xl bg-white/92 p-3 text-[#2b3442] shadow-lg ring-1 ring-black/5 backdrop-blur">
          {!stops.length ? <div className="py-1 text-center text-[12.5px] text-[#5a6576]">No findings match this tour filter.</div> : <>
            <div className="flex items-center gap-3">
              <button aria-label="Previous stop" onClick={() => go(index - 1)} disabled={index < 0}
                className="h-9 w-9 shrink-0 rounded-full bg-[#eef1f5] text-[16px] text-[#2b3442] hover:bg-[#e2e7ee] disabled:opacity-35">‹</button>
              <div className="min-w-0 flex-1">
                {stop ? <>
                  <div className="flex items-center gap-2 text-[11px] text-[#6a7586]">
                    <span className="h-2 w-2 shrink-0 rotate-45" style={{ background: VIEW_STATUS[stop.status].hex }} />
                    <span className="font-semibold" style={{ color: VIEW_STATUS[stop.status].hex }}>{VIEW_STATUS[stop.status].label}</span>
                    <span className="font-mono">{stop.id}</span><span>·</span><span className="truncate">{MODULE_LABEL[stop.module as EngineId]}</span>
                  </div>
                  <div className="truncate text-[14px] font-semibold">{stop.title}</div>
                  <div className="truncate text-[12px] text-[#5a6576]">{stop.element} · {stop.deckName}</div>
                </> : <>
                  <div className="text-[14px] font-semibold">{stops.length} stop{stops.length > 1 ? 's' : ''} on this tour</div>
                  <div className="text-[12px] text-[#5a6576]">Press › or → to fly to the first finding. Click a marker or a flagged room to jump.</div>
                </>}
              </div>
              <button aria-label="Next stop" onClick={() => go(index + 1)} disabled={index >= stops.length - 1}
                className="h-9 w-9 shrink-0 rounded-full bg-[#2b3442] text-[16px] text-white hover:bg-[#1d2430] disabled:opacity-35">›</button>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5">
              <div className="flex min-w-0 flex-1 gap-[3px]">{stops.map((s, i) => (
                <button key={s.id} title={`${s.id} · ${s.element}`} onClick={() => go(i)} className="h-1.5 min-w-[4px] flex-1 rounded-full transition-opacity"
                  style={{ background: VIEW_STATUS[s.status].hex, opacity: i === index ? 1 : i < index ? 0.55 : 0.22 }} />
              ))}</div>
              <span className="ml-1 font-mono text-[11px] text-[#6a7586]">{index + 1}/{stops.length}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <button onClick={() => go(-1)} className={`rounded-full px-2.5 py-1 ${index < 0 && !free ? 'bg-[#2b3442] text-white' : 'bg-[#eef1f5] hover:bg-[#e2e7ee]'}`}>Overview</button>
              <button onClick={() => setFree(!free)} className={`rounded-full px-2.5 py-1 ${free ? 'bg-[#2b3442] text-white' : 'bg-[#eef1f5] hover:bg-[#e2e7ee]'}`}>Free look (F)</button>
              <label className="flex items-center gap-1 rounded-full bg-[#eef1f5] px-2.5 py-1"><input type="checkbox" checked={reduced} disabled={systemReduced} onChange={(e) => setCalm(e.target.checked)} />Reduce motion</label>
              {stop && <button onClick={() => onInspect(stop.id)} className="ml-auto rounded-full bg-[#4c9be0] px-3 py-1 font-semibold text-white hover:bg-[#3d8bd0]">Inspect evidence ›</button>}
            </div>
          </>}
        </div>
      </div>

      {/* honesty label */}
      <div className="pointer-events-none absolute bottom-3 left-3 max-w-[260px] rounded-lg bg-white/75 px-2 py-1 text-[10.5px] leading-snug text-[#5a6576] ring-1 ring-black/5">
        <b className="text-[#2b3442]">Derived 3D model, toy view.</b> Room outlines extruded from the 2D GA drawing; not a 3D ship model. Plinth and colours are decorative.
      </div>
    </div>
  )
}
