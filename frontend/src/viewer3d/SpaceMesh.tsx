import { useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { BAND } from './statusColors'
import type { SceneSpace } from './types'

export type RenderMode = 'solid' | 'wireframe' | 'xray'

interface Props {
  space: SceneSpace
  planes: THREE.Plane[]
  mode: RenderMode
  selected: boolean
  dimmed: boolean
  onSelect: (id: string) => void
  onHover: (s: SceneSpace | null) => void
}

/** One extracted room: polygon (ship metres) extruded from its deck elevation to the next deck. */
export default function SpaceMesh({ space, planes, mode, selected, dimmed, onSelect, onHover }: Props) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape(space.polygon.map(([x, y]) => new THREE.Vector2(x, y)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: space.height * 0.96, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)          // extrude upwards; shape y (transverse) -> world -z
    g.translate(0, space.z, 0)
    return g
  }, [space])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, 25), [geo])

  const base = space.band === 'none' ? BAND.none.color : BAND[space.band].color
  const unresolved = !space.geometry_resolved
  const opacity = dimmed ? 0.06 : mode === 'xray' ? 0.18 : space.band === 'none' ? 0.35 : 0.85

  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(space.id) }
  return (
    <group>
      {mode !== 'wireframe' && (
        <mesh geometry={geo} onClick={click}
          onPointerOver={(e) => { e.stopPropagation(); onHover(space) }} onPointerOut={() => onHover(null)}>
          <meshStandardMaterial color={selected ? '#38bdf8' : base} emissive={selected ? '#0ea5e9' : '#000000'}
            emissiveIntensity={selected ? 0.6 : 0} metalness={0.15} roughness={0.55} transparent opacity={opacity}
            depthWrite={opacity > 0.5} side={THREE.DoubleSide} clippingPlanes={planes} clipShadows />
        </mesh>
      )}
      <lineSegments geometry={edges} onClick={mode === 'wireframe' ? click : undefined}>
        <lineBasicMaterial color={selected ? '#e0f2fe' : mode === 'wireframe' ? base : '#0b1220'}
          transparent opacity={dimmed ? 0.08 : unresolved ? 0.5 : mode === 'wireframe' ? 0.95 : 0.55} clippingPlanes={planes} />
      </lineSegments>
    </group>
  )
}
