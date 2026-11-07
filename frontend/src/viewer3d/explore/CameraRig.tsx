import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitImpl } from 'three-stdlib'
import type { Stop, World } from './world'

/**
 * Guided-tour camera. Stops are joined by a Catmull-Rom spline; moving to another stop eases the
 * curve parameter so the camera glides over the model rather than cutting. Index -1 is the overview.
 * In free mode the user orbits (OrbitControls) around the current stop. Reduced motion snaps.
 */
export default function CameraRig({ world, index, free, reduced }: { world: World; index: number; free: boolean; reduced: boolean }) {
  const { camera } = useThree()
  const orbit = useRef<OrbitImpl>(null)
  const { stops, bounds } = world
  const L = bounds.length
  const centre = useMemo(() => new THREE.Vector3(...bounds.centre), [bounds])

  // a gentle three-quarter view from aft / port / above, scaled to the ship
  const offset = useMemo(() => new THREE.Vector3(-0.17 * L, 0.27 * L, 0.33 * L).clampLength(22, 80), [L])
  const overviewPos = useMemo(() => centre.clone().add(new THREE.Vector3(-0.62 * L, 0.62 * L, 1.18 * L)), [centre, L])

  const curve = useMemo(() => stops.length >= 2
    ? new THREE.CatmullRomCurve3(stops.map((s: Stop) => new THREE.Vector3(...s.target)), false, 'centripetal')
    : null, [stops])

  const t = useRef(0)
  const look = useRef(centre.clone())
  const first = useRef(true)

  useEffect(() => { first.current = true }, [world])

  useFrame((_, dt) => {
    if (free) return
    const k = (rate: number) => (reduced || first.current ? 1 : 1 - Math.exp(-dt * rate))
    let wantPos: THREE.Vector3, wantLook: THREE.Vector3
    if (index < 0 || !stops.length) {
      wantPos = overviewPos; wantLook = centre
    } else {
      const tt = stops.length > 1 ? index / (stops.length - 1) : 0
      t.current += (tt - t.current) * k(1.8)
      const p = curve ? curve.getPoint(Math.min(Math.max(t.current, 0), 1)) : new THREE.Vector3(...stops[0].target)
      wantLook = p
      wantPos = p.clone().add(offset)
    }
    camera.position.lerp(wantPos, k(2.4))
    look.current.lerp(wantLook, k(3))
    camera.lookAt(look.current)
    first.current = false
  })

  // entering free mode: orbit around what the camera is looking at
  useEffect(() => {
    if (free && orbit.current) { orbit.current.target.copy(look.current); orbit.current.update() }
  }, [free])

  return <OrbitControls ref={orbit} enabled={free} makeDefault enableDamping dampingFactor={0.08}
    minDistance={6} maxDistance={L * 2.5} maxPolarAngle={Math.PI * 0.48} />
}
