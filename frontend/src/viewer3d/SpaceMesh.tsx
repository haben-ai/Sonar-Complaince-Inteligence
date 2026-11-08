import { useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { BAND, SCENE3D } from './statusColors'
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
  tint?: string                       // colour-by-type override; status colours are used otherwise
}

/** One extracted room: polygon (ship metres) extruded from its deck elevation to the next deck. */
export default function SpaceMesh({ space, planes, mode, selected, dimmed, onSelect, onHover, tint }: Props) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape(space.polygon.map(([x, y]) => new THREE.Vector2(x, y)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: space.height * 0.96, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)          // extrude upwards; shape y (transverse) -> world -z
    g.translate(0, space.z, 0)
    return g
  }, [space])
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, 25), [geo])

  // quiet, matte geometry: compartments without a check stay slate; unclassified geometry darker still
  const base = tint ?? (space.band === 'none' ? (space.kind === 'unknown' ? SCENE3D.unclassified : BAND.none.color) : BAND[space.band].color)
  const unresolved = !space.geometry_resolved
  const opacity = dimmed ? 0.1 : mode === 'xray' ? 0.2 : 1

  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(space.id) }
  return (
    <group>
      {mode !== 'wireframe' && (
        <mesh geometry={geo} onClick={click} castShadow receiveShadow
          onPointerOver={(e) => { e.stopPropagation(); onHover(space) }} onPointerOut={() => onHover(null)}>
          <meshStandardMaterial color={selected ? SCENE3D.selected : base} metalness={0} roughness={0.85} transparent={opacity < 1} opacity={opacity}
            depthWrite={opacity > 0.5} side={THREE.DoubleSide} clippingPlanes={planes} clipShadows />
        </mesh>
      )}
      <lineSegments geometry={edges} onClick={mode === 'wireframe' ? click : undefined}>
        <lineBasicMaterial color={selected ? SCENE3D.selectedEdge : mode === 'wireframe' ? base : SCENE3D.edge}
          transparent opacity={selected ? 1 : dimmed ? 0.08 : unresolved ? 0.25 : mode === 'wireframe' ? 0.95 : SCENE3D.edgeOpacity} clippingPlanes={planes} />
      </lineSegments>
    </group>
  )
}
