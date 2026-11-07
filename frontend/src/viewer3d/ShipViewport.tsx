import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { CameraControls, GizmoHelper, GizmoViewport, Grid, Html } from '@react-three/drei'
import * as THREE from 'three'
import { defaultCuts, sceneBounds, useSectionPlanes, type Axis, type Bounds, type Cuts } from './clipping'
import SpaceMesh, { type RenderMode } from './SpaceMesh'
import { BAND } from './statusColors'
import type { Scene3D, SceneSpace } from './types'

interface Props {
  scene: Scene3D
  selectedId: string | null
  focusId: string | null            // camera flies here when it changes
  hiddenDecks: Set<string>
  onlyFlagged: boolean
  onSelect: (id: string) => void
}

export default function ShipViewport({ scene, selectedId, focusId, hiddenDecks, onlyFlagged, onSelect }: Props) {
  const bounds = useMemo(() => sceneBounds(scene.spaces), [scene])
  const [cuts, setCuts] = useState<Cuts>(() => defaultCuts(bounds))
  const [mode, setMode] = useState<RenderMode>('solid')
  const [hover, setHover] = useState<SceneSpace | null>(null)
  const controls = useRef<CameraControls>(null)
  const planes = useSectionPlanes(cuts)
  useEffect(() => setCuts(defaultCuts(bounds)), [bounds])

  const visible = scene.spaces.filter((s) => !hiddenDecks.has(s.deck_id) && s.kind !== 'tank_or_void')
  const centre = new THREE.Vector3((bounds.x[0] + bounds.x[1]) / 2, (bounds.z[0] + bounds.z[1]) / 2, 0)

  const view = (preset: 'iso' | 'side' | 'top' | 'front') => {
    const c = controls.current
    if (!c) return
    const L = bounds.x[1] - bounds.x[0]
    const pos = {
      iso: [centre.x - L * 0.55, centre.y + L * 0.55, L * 0.75],
      side: [centre.x, centre.y, L * 1.1],
      top: [centre.x, centre.y + L * 1.2, 0.01],
      front: [bounds.x[1] + L * 0.9, centre.y, 0],
    }[preset] as [number, number, number]
    c.setLookAt(...pos, centre.x, centre.y, centre.z, true)
  }

  // smooth focus on the selected space (from the 3D canvas, the zone tree or the findings list)
  useEffect(() => {
    const s = scene.spaces.find((x) => x.id === focusId)
    const c = controls.current
    if (!s || !c) return
    const box = new THREE.Box3()
    for (const [x, y] of s.polygon) {
      box.expandByPoint(new THREE.Vector3(x, s.z, -y))
      box.expandByPoint(new THREE.Vector3(x, s.z + s.height, -y))
    }
    box.expandByScalar(Math.max(2.5, box.getSize(new THREE.Vector3()).length() * 0.6))
    c.fitToBox(box, true, { paddingTop: 0.5, paddingBottom: 0.5, paddingLeft: 0.5, paddingRight: 0.5 })
  }, [focusId, scene.spaces])

  return (
    <div className="relative h-full w-full bg-[#0b1220]">
      <Canvas camera={{ position: [centre.x - 45, 35, 55], fov: 38, near: 0.1, far: 2000 }} shadows={false}
        onCreated={({ gl }) => { gl.localClippingEnabled = true }} onPointerMissed={() => setHover(null)}>
        <color attach="background" args={['#0b1220']} />
        <hemisphereLight args={['#dbeafe', '#0b1220', 0.9]} />
        <directionalLight position={[40, 80, 30]} intensity={1.4} />
        <directionalLight position={[-60, 30, -40]} intensity={0.5} />
        <CameraControls ref={controls} makeDefault smoothTime={0.35} />
        <Grid position={[centre.x, bounds.z[0] - 0.02, 0]} args={[200, 60]} cellSize={0.6} sectionSize={6} cellColor="#16253f"
          sectionColor="#24406a" fadeDistance={220} infiniteGrid={false} />
        {scene.decks.filter((d) => !hiddenDecks.has(d.id)).map((d) => (
          <Html key={d.id} position={[d.x_range[0] - 2, d.z + 0.3, 0]} center style={{ pointerEvents: 'none' }}>
            <div className="whitespace-nowrap rounded bg-navy-900/80 px-1.5 text-[10px] text-slate-300 ring-1 ring-navy-700">{d.name} · {d.z.toFixed(1)} m</div>
          </Html>
        ))}
        {visible.map((s) => (
          <SpaceMesh key={s.id} space={s} planes={planes} mode={mode} selected={s.id === selectedId}
            dimmed={onlyFlagged && s.band === 'none' && s.id !== selectedId} onSelect={onSelect} onHover={setHover} />
        ))}
        <SectionGuides cuts={cuts} bounds={bounds} />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#0b1220" />
        </GizmoHelper>
      </Canvas>

      <Toolbar mode={mode} setMode={setMode} view={view} cuts={cuts} setCuts={setCuts} bounds={bounds} />
      {hover && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-navy-900/95 px-2 py-1 text-[11px] text-slate-200 ring-1 ring-navy-600">
        <b>{hover.name ?? hover.kind.replace(/_/g, ' ')}</b> · {hover.kind.replace(/_/g, ' ')}{hover.hazard ? ` · ${hover.hazard}` : ''} · <span style={{ color: BAND[hover.band].color }}>{BAND[hover.band].label}</span>
        {!hover.geometry_resolved && <span className="text-incon"> · geometry not resolved</span>}</div>}
      <div className="pointer-events-none absolute bottom-2 left-3 max-w-[60%] rounded bg-navy-900/90 px-2 py-1 text-[10px] text-slate-400 ring-1 ring-navy-700">
        <b className="text-incon">EXTRUDED FROM 2D GA - NOT A 3D MODEL.</b> {scene.basis}
        {scene.skipped_decks?.length ? ` Not placed (no elevation): ${scene.skipped_decks.join(', ')}.` : ''}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 space-y-0.5 rounded bg-navy-900/90 px-2 py-1.5 text-[10px] text-slate-300 ring-1 ring-navy-700">
        {(['red', 'amber', 'green', 'none'] as const).map((b) => <div key={b} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: BAND[b].color }} />{BAND[b].label}</div>)}
      </div>
    </div>
  )
}

function SectionGuides({ cuts, bounds }: { cuts: Cuts; bounds: Bounds }) {
  const L = bounds.x[1] - bounds.x[0], B = bounds.y[1] - bounds.y[0], H = bounds.z[1] - bounds.z[0]
  const cx = (bounds.x[0] + bounds.x[1]) / 2, cy = (bounds.y[0] + bounds.y[1]) / 2, cz = (bounds.z[0] + bounds.z[1]) / 2
  const mat = (c: string) => <meshBasicMaterial color={c} transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
  return <>
    {cuts.x.enabled && <mesh position={[cuts.x.value, cz, -cy]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[B + 4, H + 2]} />{mat('#ef4444')}</mesh>}
    {cuts.z.enabled && <mesh position={[cx, cuts.z.value, -cy]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[L + 6, B + 4]} />{mat('#3b82f6')}</mesh>}
    {cuts.y.enabled && <mesh position={[cx, cz, -cuts.y.value]}><planeGeometry args={[L + 6, H + 2]} />{mat('#22c55e')}</mesh>}
  </>
}

function Toolbar({ mode, setMode, view, cuts, setCuts, bounds }: {
  mode: RenderMode; setMode: (m: RenderMode) => void; view: (p: 'iso' | 'side' | 'top' | 'front') => void
  cuts: Cuts; setCuts: (c: Cuts) => void; bounds: Bounds
}) {
  const axisLabel: Record<Axis, string> = { x: 'X · longitudinal (frame)', y: 'Y · transverse', z: 'Z · height ABL' }
  const set = (a: Axis, patch: Partial<Cuts[Axis]>) => setCuts({ ...cuts, [a]: { ...cuts[a], ...patch } })
  return (
    <div className="absolute left-3 top-3 w-64 space-y-2 rounded-md bg-navy-900/92 p-2 text-[11px] ring-1 ring-navy-700 backdrop-blur">
      <div className="flex gap-1">
        {(['solid', 'xray', 'wireframe'] as RenderMode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded px-1.5 py-0.5 capitalize ${mode === m ? 'bg-navy-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{m === 'xray' ? 'X-ray' : m}</button>
        ))}
      </div>
      <div className="flex gap-1">
        {(['iso', 'side', 'top', 'front'] as const).map((p) => (
          <button key={p} onClick={() => view(p)} className="flex-1 rounded bg-navy-800 px-1 py-0.5 capitalize text-slate-300 hover:bg-navy-700">{p === 'side' ? 'Profile' : p === 'top' ? 'Plan' : p === 'front' ? 'Bow' : 'Iso'}</button>
        ))}
      </div>
      <div className="border-t border-navy-700 pt-1.5 text-[10px] uppercase tracking-wider text-slate-500">Section cuts</div>
      {(['x', 'y', 'z'] as Axis[]).map((a) => {
        const [lo, hi] = bounds[a]
        return <div key={a}>
          <div className="flex items-center gap-1.5">
            <input type="checkbox" checked={cuts[a].enabled} onChange={(e) => set(a, { enabled: e.target.checked })} />
            <span className="text-slate-300">{axisLabel[a]}</span>
            <span className="ml-auto font-mono text-slate-400">{cuts[a].value.toFixed(1)} m</span>
            <button title="flip kept side" onClick={() => set(a, { flip: !cuts[a].flip })} className={`rounded px-1 ${cuts[a].flip ? 'bg-navy-600 text-white' : 'text-slate-500'}`}>⇄</button>
          </div>
          <input type="range" min={lo - 0.5} max={hi + 0.5} step={0.1} value={cuts[a].value} disabled={!cuts[a].enabled}
            onChange={(e) => set(a, { value: Number(e.target.value) })} className="w-full accent-sky-500 disabled:opacity-30" />
        </div>
      })}
    </div>
  )
}
