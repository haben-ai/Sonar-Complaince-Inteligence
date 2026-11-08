import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { CameraControls, GizmoHelper, GizmoViewport, Grid, Html } from '@react-three/drei'
import * as THREE from 'three'
import { defaultCuts, sceneBounds, useSectionPlanes, type Axis, type Bounds, type Cuts } from './clipping'
import SpaceMesh, { type RenderMode } from './SpaceMesh'
import { BAND, KIND_LABEL, KIND_TINT, SCENE3D } from './statusColors'
import { deckPlates, type DeckPlate } from './deckPlates'
import NeonFrame from './NeonFrame'
import CrossField from './CrossField'
import type { Scene3D, SceneSpace } from './types'

interface Props {
  scene: Scene3D
  selectedId: string | null
  focusId: string | null            // camera flies here when it changes
  hiddenDecks: Set<string>
  onlyFlagged: boolean
  onSelect: (id: string) => void
  settingsExtra?: ReactNode         // extra controls shown in the collapsible settings panel (deck visibility…)
}

export default function ShipViewport({ scene, selectedId, focusId, hiddenDecks, onlyFlagged, onSelect, settingsExtra }: Props) {
  const bounds = useMemo(() => sceneBounds(scene.spaces), [scene])
  const [cuts, setCuts] = useState<Cuts>(() => defaultCuts(bounds))
  const [mode, setMode] = useState<RenderMode>('solid')
  const [hover, setHover] = useState<SceneSpace | null>(null)
  const [colorBy, setColorBy] = useState<'status' | 'type'>('status')
  const plates = useMemo(() => deckPlates(scene), [scene])
  const controls = useRef<CameraControls>(null)
  const planes = useSectionPlanes(cuts)
  useEffect(() => setCuts(defaultCuts(bounds)), [bounds])

  const visible = scene.spaces.filter((s) => !hiddenDecks.has(s.deck_id) && s.kind !== 'tank_or_void')
  const centre = new THREE.Vector3((bounds.x[0] + bounds.x[1]) / 2, (bounds.z[0] + bounds.z[1]) / 2, 0)
  const L = Math.max(bounds.x[1] - bounds.x[0], 10), B = Math.max(bounds.y[1] - bounds.y[0], 5)
  const iso: [number, number, number] = [centre.x - L * 0.55, centre.y + L * 0.42, L * 0.72]

  const shipBox = useMemo(() => new THREE.Box3(new THREE.Vector3(bounds.x[0], bounds.z[0], -bounds.y[1]),
    new THREE.Vector3(bounds.x[1], bounds.z[1], -bounds.y[0])), [bounds])
  const view = (preset: 'iso' | 'side' | 'top' | 'front', animate = true) => {
    const c = controls.current
    if (!c) return
    const pos = {
      iso,
      side: [centre.x, centre.y, L * 1.1],
      top: [centre.x, centre.y + L * 1.2, 0.01],
      front: [bounds.x[1] + L * 0.9, centre.y, 0],
    }[preset] as [number, number, number]
    // look from the preset direction, then let the camera distance fit the whole ship
    c.setLookAt(...pos, centre.x, centre.y, centre.z, false)
    const sphere = shipBox.getBoundingSphere(new THREE.Sphere())
    sphere.radius *= preset === 'iso' ? 0.95 : 0.72       // the ship is long and flat: a full sphere leaves too much margin
    c.fitToSphere(sphere, animate)
  }

  // frame the whole ship when a scene loads (camera distance follows the ship's length): done by <InitialFit>
  // inside the canvas, once the controls exist and the canvas has its real size
  const fitWhole = () => { if (!focusId || !scene.spaces.some((s) => s.id === focusId)) view('iso', false) }

  // smooth focus on the selected space (from the 3D canvas, the zone tree or the findings list):
  // a three-quarter view from above, fitted to the room with some surrounding context.
  // The controls exist only once the canvas has mounted, so wait for them.
  useEffect(() => {
    const s = scene.spaces.find((x) => x.id === focusId)
    if (!s) return
    let id = 0, n = 0
    const go = () => {
      const c = controls.current
      if (!c) { if (n++ < 120) id = requestAnimationFrame(go); return }
      const box = new THREE.Box3()
      for (const [x, y] of s.polygon) {
        box.expandByPoint(new THREE.Vector3(x, s.z, -y))
        box.expandByPoint(new THREE.Vector3(x, s.z + s.height, -y))
      }
      const sphere = box.getBoundingSphere(new THREE.Sphere())
      sphere.radius = Math.max(sphere.radius * 1.8, 7)
      const ctr = sphere.center
      const dir = new THREE.Vector3(-0.5, 0.62, 0.78).normalize().multiplyScalar(sphere.radius * 3)
      c.setLookAt(ctr.x + dir.x, ctr.y + dir.y, ctr.z + dir.z, ctr.x, ctr.y, ctr.z, true)
      c.fitToSphere(sphere, true)
    }
    id = requestAnimationFrame(go)
    return () => cancelAnimationFrame(id)
  }, [focusId, scene.spaces])

  return (
    <div className="relative h-full w-full" style={{ background: SCENE3D.backdrop }}>
      <Canvas camera={{ position: iso, fov: 36, near: 0.1, far: L * 12 }} shadows="soft" gl={{ alpha: true }}
        onCreated={({ gl }) => { gl.localClippingEnabled = true }} onPointerMissed={() => setHover(null)}>
        <fog attach="fog" args={[SCENE3D.fog, L * 2, L * 5]} />
        <hemisphereLight args={[SCENE3D.hemiSky, SCENE3D.hemiGround, 1.0]} />
        <ambientLight intensity={0.3} />
        <directionalLight position={[centre.x - L * 0.4, L * 0.8, L * 0.5]} intensity={1.15} color={SCENE3D.sun} castShadow
          shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} shadow-normalBias={0.05}
          shadow-camera-left={-L * 0.7} shadow-camera-right={L * 0.7} shadow-camera-top={L * 0.7} shadow-camera-bottom={-L * 0.7}
          shadow-camera-near={1} shadow-camera-far={L * 3}>
          <object3D attach="target" position={[centre.x, centre.y, 0]} />
        </directionalLight>
        <directionalLight position={[centre.x + L * 0.6, L * 0.3, -L * 0.4]} intensity={0.35} />
        <CameraControls ref={controls} makeDefault smoothTime={0.35} />
        <InitialFit sceneKey={scene} fit={fitWhole} />
        <Grid position={[centre.x, bounds.z[0] - 0.25, 0]} args={[L * 1.8, B * 6]} cellSize={L > 100 ? 2 : 0.6} sectionSize={L > 100 ? 20 : 6}
          cellColor={SCENE3D.gridCell} sectionColor={SCENE3D.gridSection} fadeDistance={L * 2.6} fadeStrength={1.2} infiniteGrid={false} />
        <CrossField centre={centre} y={bounds.z[0] - 0.22} length={L} breadth={B} />
        {plates.filter((p) => !hiddenDecks.has(p.id)).map((p) => <DeckPlateMesh key={p.id} plate={p} planes={planes} />)}
        {scene.decks.filter((d) => !hiddenDecks.has(d.id)).map((d) => (
          <Html key={d.id} position={[d.x_range[0] - 2, d.z + 0.3, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
            <div className="whitespace-nowrap rounded bg-navy-900/80 px-1.5 text-[12px] text-dim ring-1 ring-navy-700">{d.name} · {d.z.toFixed(1)} m</div>
          </Html>
        ))}
        {visible.map((s) => (
          <SpaceMesh key={s.id} space={s} planes={planes} mode={mode} selected={s.id === selectedId}
            tint={colorBy === 'type' ? KIND_TINT[s.kind] ?? KIND_TINT.unknown : undefined}
            dimmed={onlyFlagged && s.band === 'none' && s.id !== selectedId} onSelect={onSelect} onHover={setHover} />
        ))}
        {(() => { const sel = visible.find((s) => s.id === selectedId); return sel ? <NeonFrame key={sel.id} space={sel} /> : null })()}
        <SectionGuides cuts={cuts} bounds={bounds} />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#ffffff" />
        </GizmoHelper>
      </Canvas>

      <Toolbar mode={mode} setMode={setMode} view={view} cuts={cuts} setCuts={setCuts} bounds={bounds} colorBy={colorBy} setColorBy={setColorBy} extra={settingsExtra} />
      {hover && <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded border border-navy-700 bg-navy-900/95 px-2 py-0.5 text-[12px] text-ink">
        <b>{hover.name ?? hover.kind.replace(/_/g, ' ')}</b> · {hover.kind.replace(/_/g, ' ')}{hover.hazard ? ` · ${hover.hazard}` : ''} · <span style={{ color: BAND[hover.band].color }}>{BAND[hover.band].label}</span>
        {!hover.geometry_resolved && <span className="text-incon"> · geometry not resolved</span>}</div>}
      <div className="pointer-events-none absolute bottom-2 left-2 max-w-[60%] rounded border border-navy-700 bg-navy-900/92 px-2 py-1 text-[12px] leading-snug text-dim">
        <b className="font-semibold text-incon">Derived 3D model, extruded from the 2D GA drawing - not a 3D ship model.</b> <span className="text-faint">{scene.basis}</span>
        {scene.skipped_decks?.length ? ` Not placed (no elevation): ${scene.skipped_decks.join(', ')}.` : ''}
      </div>
      <div className="pointer-events-none absolute right-2 top-2 space-y-0.5 rounded border border-navy-700 bg-navy-900/92 px-2 py-1.5 text-[12px] text-dim">
        {colorBy === 'status'
          ? (['red', 'amber', 'green', 'none'] as const).map((b) => <div key={b} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: BAND[b].color }} />{BAND[b].label}</div>)
          : KIND_LABEL.map(([k, l]) => <div key={k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: KIND_TINT[k] }} />{l}</div>)}
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

function Toolbar({ mode, setMode, view, cuts, setCuts, bounds, colorBy, setColorBy, extra }: {
  mode: RenderMode; setMode: (m: RenderMode) => void; view: (p: 'iso' | 'side' | 'top' | 'front') => void
  cuts: Cuts; setCuts: (c: Cuts) => void; bounds: Bounds; colorBy: 'status' | 'type'; setColorBy: (c: 'status' | 'type') => void; extra?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const axisLabel: Record<Axis, string> = { x: 'X · longitudinal (frame)', y: 'Y · transverse', z: 'Z · height ABL' }
  const set = (a: Axis, patch: Partial<Cuts[Axis]>) => setCuts({ ...cuts, [a]: { ...cuts[a], ...patch } })
  const activeCuts = (['x', 'y', 'z'] as Axis[]).filter((a) => cuts[a].enabled).length
  return (
    <div className="absolute left-2 top-2 z-20 flex flex-col items-start gap-1 text-[12px]">
      <div className="flex gap-1 rounded border border-navy-700 bg-navy-900/92 p-0.5">
        {(['iso', 'side', 'top', 'front'] as const).map((p) => (
          <button key={p} onClick={() => view(p)} className="rounded px-2 py-0.5 text-dim hover:bg-navy-800 hover:text-ink">{p === 'side' ? 'Profile' : p === 'top' ? 'Plan' : p === 'front' ? 'Bow' : 'Iso'}</button>
        ))}
        <span className="mx-0.5 w-px bg-navy-700" />
        <button onClick={() => setOpen(!open)} className={`rounded px-2 py-0.5 ${open ? 'bg-navy-600 text-white' : 'text-dim hover:bg-navy-800 hover:text-ink'}`}>
          View settings{activeCuts ? ` · ${activeCuts} cut${activeCuts > 1 ? 's' : ''}` : ''} {open ? '▴' : '▾'}
        </button>
      </div>
      {open && <div className="w-64 space-y-2 rounded border border-navy-700 bg-navy-900/95 p-2">
      <div className="text-[12px] uppercase tracking-wider text-faint">Render</div>
      <div className="flex gap-1">
        {(['solid', 'xray', 'wireframe'] as RenderMode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded px-1.5 py-0.5 capitalize ${mode === m ? 'bg-navy-600 text-white' : 'text-dim hover:text-ink'}`}>{m === 'xray' ? 'X-ray' : m}</button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <span className="w-16 text-faint">Colour by</span>
        {(['status', 'type'] as const).map((c) => (
          <button key={c} onClick={() => setColorBy(c)} className={`flex-1 rounded px-1.5 py-0.5 ${colorBy === c ? 'bg-navy-600 text-white' : 'text-dim hover:text-ink'}`}>{c === 'status' ? 'Status' : 'Space type'}</button>
        ))}
      </div>
      <div className="border-t border-navy-700 pt-1.5 text-[12px] uppercase tracking-wider text-faint">Section cuts</div>
      {(['x', 'y', 'z'] as Axis[]).map((a) => {
        const [lo, hi] = bounds[a]
        return <div key={a}>
          <div className="flex items-center gap-1.5">
            <input type="checkbox" checked={cuts[a].enabled} onChange={(e) => set(a, { enabled: e.target.checked })} />
            <span className="text-dim">{axisLabel[a]}</span>
            <span className="ml-auto font-mono text-dim">{cuts[a].value.toFixed(1)} m</span>
            <button title="flip kept side" onClick={() => set(a, { flip: !cuts[a].flip })} className={`rounded px-1 ${cuts[a].flip ? 'bg-navy-600 text-white' : 'text-faint'}`}>⇄</button>
          </div>
          <input type="range" min={lo - 0.5} max={hi + 0.5} step={0.1} value={cuts[a].value} disabled={!cuts[a].enabled}
            onChange={(e) => set(a, { value: Number(e.target.value) })} className="w-full accent-[#36b6a0] disabled:opacity-30" />
        </div>
      })}
      {extra}
      </div>}
    </div>
  )
}

/** Thin plate under each deck's rooms (convex outline of the extracted rooms), so stacked decks read as one ship. */
function DeckPlateMesh({ plate, planes }: { plate: DeckPlate; planes: THREE.Plane[] }) {
  const geo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(plate.outline.map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.22, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    g.translate(0, plate.z - 0.24, 0)
    return g
  }, [plate])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, 30), [geo])
  return <group raycast={() => null}>
    <mesh geometry={geo} raycast={() => null} receiveShadow>
      <meshStandardMaterial color={SCENE3D.plate} metalness={0} roughness={0.9} clippingPlanes={planes} />
    </mesh>
    <lineSegments geometry={edges} raycast={() => null}>
      <lineBasicMaterial color={SCENE3D.plateEdge} transparent opacity={0.8} clippingPlanes={planes} />
    </lineSegments>
  </group>
}

/** Fits the camera to the whole ship once per scene, after the default controls exist and the canvas is sized. */
function InitialFit({ sceneKey, fit }: { sceneKey: unknown; fit: () => void }) {
  const ctl = useThree((s) => s.controls)
  const w = useThree((s) => s.size.width), h = useThree((s) => s.size.height)
  const done = useRef<unknown>(null)
  useEffect(() => {
    if (!ctl || w === 0 || h === 0 || done.current === sceneKey) return
    done.current = sceneKey
    fit()
  }, [ctl, w, h, sceneKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
