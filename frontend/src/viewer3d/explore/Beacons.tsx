import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { VIEW_STATUS } from '../../lib/present'
import type { Stop } from './world'

/** A low-poly marker above each tour stop, in its review status colour. Issues pulse; the active stop is larger. */
function Beacon({ s, active, scale, reduced, onPick }: { s: Stop; active: boolean; scale: number; reduced: boolean; onPick: () => void }) {
  const g = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const phase = useRef(Math.random() * Math.PI * 2)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase.current
    if (g.current) {
      g.current.position.y = s.beacon[1] + (reduced ? 0 : Math.sin(t * 2) * 0.25 * scale)
      g.current.rotation.y = reduced ? 0 : t * 0.8
      const k = (active ? 1.5 : 1) * scale
      g.current.scale.lerp(new THREE.Vector3(k, k, k), 0.15)
    }
    if (ring.current) {
      const p = reduced ? 0.5 : (t * 0.6) % 1
      ring.current.scale.setScalar((1 + p * 2.2) * scale)
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * (s.status === 'issue' || active ? 0.55 : 0)
    }
  })
  const col = VIEW_STATUS[s.status].hex
  return <group>
    <group ref={g} position={s.beacon} onClick={(e) => { e.stopPropagation(); onPick() }}
      onPointerOver={() => { document.body.style.cursor = 'pointer' }} onPointerOut={() => { document.body.style.cursor = 'default' }}>
      <mesh castShadow position={[0, 0.55, 0]}>
        <octahedronGeometry args={[0.55, 0]} />
        <meshToonMaterial color={col} emissive={col} emissiveIntensity={active ? 0.5 : 0.25} />
      </mesh>
      <mesh position={[0, -0.35, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 1.2, 6]} />
        <meshToonMaterial color="#ffffff" />
      </mesh>
    </group>
    <mesh ref={ring} position={[s.beacon[0], s.target[1] + 0.05, s.beacon[2]]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[0.7, 0.9, 24]} />
      <meshBasicMaterial color={col} transparent opacity={0} depthWrite={false} />
    </mesh>
  </group>
}

export default function Beacons({ stops, activeId, scale, reduced, onPick }: { stops: Stop[]; activeId: string | null; scale: number; reduced: boolean; onPick: (id: string) => void }) {
  return <group>{stops.map((s) => <Beacon key={s.id} s={s} active={s.id === activeId} scale={scale} reduced={reduced} onPick={() => onPick(s.id)} />)}</group>
}
