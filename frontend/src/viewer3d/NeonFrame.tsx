import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import type { Line2, LineMaterial } from 'three-stdlib'
import { SCENE3D } from './statusColors'
import type { SceneSpace } from './types'

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Gentle rose gradient along the loop (pale pink to rose and back). */
function loopColors(n: number): [number, number, number][] {
  const stops = [...SCENE3D.neon, SCENE3D.neon[1], SCENE3D.neon[0]].map((c) => new THREE.Color(c))
  return Array.from({ length: n }, (_, i) => {
    const t = (i / Math.max(n - 1, 1)) * (stops.length - 1)
    const k = Math.min(Math.floor(t), stops.length - 2)
    const c = stops[k].clone().lerp(stops[k + 1], t - k)
    return [c.r, c.g, c.b]
  })
}

/**
 * Drawn on top of the model (no depth test) so the frame stays visible even for rooms inside the ship.
 * Neon outline around the selected room: top and bottom loops plus the vertical edges,
 * over a soft, slowly pulsing rose glow.
 * Purely visual; it does not change what is selected or how statuses are coloured.
 */
export default function NeonFrame({ space }: { space: SceneSpace }) {
  const still = reducedMotion()
  const glow = useRef<Line2>(null)

  const { loop, colors, verticals } = useMemo(() => {
    const z0 = space.z + 0.02, z1 = space.z + space.height * 0.96 + 0.02
    const ring = [...space.polygon, space.polygon[0]]
    const at = (z: number) => ring.map(([x, y]) => new THREE.Vector3(x, z, -y))
    const bottom = at(z0), top = at(z1)
    // one continuous path: around the bottom, up, around the top, so the light runs over the whole frame
    const path = [...bottom, ...top]
    const v: THREE.Vector3[] = []
    for (const [x, y] of space.polygon) v.push(new THREE.Vector3(x, z0, -y), new THREE.Vector3(x, z1, -y))
    return { loop: path, colors: loopColors(path.length), verticals: v }
  }, [space])

  useFrame(({ clock }) => {
    if (still) return
    const g = glow.current?.material as LineMaterial | undefined
    if (g) g.opacity = 0.22 + 0.12 * Math.sin(clock.elapsedTime * 3)
  })

  return <group renderOrder={10}>
    {/* soft glow underneath */}
    <Line ref={glow} points={loop} color={SCENE3D.neonGlow} lineWidth={16} transparent opacity={0.3} depthWrite={false} depthTest={false} toneMapped={false} renderOrder={20} />
    {/* solid neon outline */}
    <Line points={loop} vertexColors={colors} lineWidth={4} depthTest={false} transparent toneMapped={false} renderOrder={21} />
    {/* vertical edges */}
    <Line points={verticals} segments color={SCENE3D.neon[1]} lineWidth={3} depthTest={false} transparent toneMapped={false} renderOrder={21} />
  </group>
}
