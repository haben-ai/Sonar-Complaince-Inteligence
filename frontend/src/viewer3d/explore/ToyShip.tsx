import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type { Scene3D } from '../types'
import { deckPlates } from '../deckPlates'
import type { Block, World } from './world'

/** Three-step gradient for toon shading (soft, toy-like light bands). */
function useToonRamp() {
  return useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 210, 210, 210, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat)
    t.minFilter = t.magFilter = THREE.NearestFilter
    t.needsUpdate = true
    return t
  }, [])
}

/** One room as a softly bevelled block, a little shorter than the deck height so decks read as stacked layers. */
function BlockMesh({ b, ramp, active, onPick }: { b: Block; ramp: THREE.Texture; active: boolean; onPick: (b: Block) => void }) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape(b.polygon.map(([x, y]) => new THREE.Vector2(x, y)))
    const bevel = 0.12
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(b.height * 0.86 - 2 * bevel, 0.4), bevelEnabled: true,
      bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 })
    g.rotateX(-Math.PI / 2)
    g.translate(0, b.z + bevel, 0)
    g.computeVertexNormals()
    return g
  }, [b])
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onPick(b) }
  return <mesh geometry={geo} castShadow receiveShadow onClick={click}
    onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = b.stopIds.length ? 'pointer' : 'default' }}
    onPointerOut={() => { document.body.style.cursor = 'default' }}>
    <meshToonMaterial color={b.color} gradientMap={ramp} emissive={active ? '#ffffff' : '#000000'} emissiveIntensity={active ? 0.18 : 0} />
  </mesh>
}

function Plate({ outline, z, ramp }: { outline: [number, number][]; z: number; ramp: THREE.Texture }) {
  const geo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))),
      { depth: 0.22, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.25, bevelSegments: 2 })
    g.rotateX(-Math.PI / 2)
    g.translate(0, z - 0.3, 0)
    return g
  }, [outline, z])
  return <mesh geometry={geo} receiveShadow castShadow raycast={() => null}>
    <meshToonMaterial color="#fbf7ef" gradientMap={ramp} />
  </mesh>
}

/** One deck's plate and rooms. A lifted deck rises and fades out (dollhouse cutaway) so the deck below can be seen. */
function DeckLayer({ lifted, lift, reduced, children }: { lifted: boolean; lift: number; reduced: boolean; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null)
  const k = useRef(0)
  useFrame((_, dt) => {
    const grp = g.current
    if (!grp) return
    const target = lifted ? 1 : 0
    k.current = reduced ? target : k.current + (target - k.current) * (1 - Math.exp(-dt * 5))
    const v = k.current
    grp.position.y = v * lift
    grp.visible = v < 0.97
    grp.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined
      if (!m) return
      m.transparent = v > 0.01
      m.opacity = 1 - v
      m.depthWrite = v < 0.5
    })
  })
  return <group ref={g}>{children}</group>
}

export default function ToyShip({ world, scene, activeRoom, hiddenDecks, cutAboveZ, reduced, onPick }: {
  world: World; scene: Scene3D; activeRoom: string | null; hiddenDecks: Set<string>; cutAboveZ: number | null; reduced: boolean
  onPick: (b: Block) => void
}) {
  const ramp = useToonRamp()
  const plates = useMemo(() => deckPlates(scene), [scene])
  const { min, max, centre, length } = world.bounds
  const width = max[2] - min[2]
  return <group>
    {world.decks.filter((d) => !hiddenDecks.has(d.id)).map((d) => {
      const plate = plates.find((p) => p.id === d.id)
      return <DeckLayer key={d.id} lifted={cutAboveZ != null && d.z > cutAboveZ + 0.01} lift={length * 0.06} reduced={reduced}>
        {plate && <Plate outline={plate.outline} z={plate.z} ramp={ramp} />}
        {world.blocks.filter((b) => b.deckId === d.id).map((b) => <BlockMesh key={b.id} b={b} ramp={ramp} active={b.id === activeRoom} onPick={onPick} />)}
      </DeckLayer>
    })}
    {/* display plinth: the model stands on a table, it is not floating at a (unknown) waterline */}
    <RoundedBox args={[length * 1.12, 1.6, width * 1.9]} radius={0.6} smoothness={4} position={[centre[0], min[1] - 1.5, centre[2]]} receiveShadow raycast={() => null}>
      <meshToonMaterial color="#e9e1d1" gradientMap={ramp} />
    </RoundedBox>
    <RoundedBox args={[length * 1.18, 0.5, width * 2.1]} radius={0.2} smoothness={3} position={[centre[0], min[1] - 2.5, centre[2]]} receiveShadow raycast={() => null}>
      <meshToonMaterial color="#cdbfa6" gradientMap={ramp} />
    </RoundedBox>
  </group>
}
