import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SCENE3D } from './statusColors'

/**
 * Field of small "×" marks lying on the floor plane around the model. They are real 3D geometry,
 * so they take perspective, recede into the distance and fade into the fog. Decorative only.
 * One instanced mesh: a single draw call however many marks there are.
 */
export default function CrossField({ centre, y, length, breadth }: { centre: THREE.Vector3; y: number; length: number; breadth: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const spacing = Math.max(length / 26, 2.5)
  const size = spacing * 0.22

  const geo = useMemo(() => {
    const bar = (rot: number) => {
      const g = new THREE.PlaneGeometry(size, size * 0.2)
      g.rotateZ(rot)
      g.rotateX(-Math.PI / 2)        // lie flat on the floor
      return g
    }
    return mergeGeometries([bar(Math.PI / 4), bar(-Math.PI / 4)])!
  }, [size])

  const cells = useMemo(() => {
    const halfX = length * 1.6, halfZ = Math.max(breadth * 7, length * 0.9)
    const out: [number, number][] = []
    for (let x = -halfX; x <= halfX; x += spacing)
      for (let z = -halfZ; z <= halfZ; z += spacing) out.push([centre.x + x, z])
    return out
  }, [centre.x, length, breadth, spacing])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const t = new THREE.Object3D()
    cells.forEach(([x, z], i) => { t.position.set(x, y, z); t.updateMatrix(); m.setMatrixAt(i, t.matrix) })
    m.instanceMatrix.needsUpdate = true
  }, [cells, y])

  return <instancedMesh ref={mesh} args={[geo, undefined, cells.length]} raycast={() => null} frustumCulled={false}>
    <meshBasicMaterial color={SCENE3D.cross} transparent opacity={0.75} depthWrite={false} />
  </instancedMesh>
}
