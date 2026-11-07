import { useMemo } from 'react'
import * as THREE from 'three'

export type Axis = 'x' | 'y' | 'z'
export interface Cut { enabled: boolean; value: number; flip: boolean }
export type Cuts = Record<Axis, Cut>
export interface Bounds { x: [number, number]; y: [number, number]; z: [number, number] }  // ship metres

/** Section planes in world space. Ship axes: x forward, y transverse, z up; world = (x, z, -y).
 * A plane keeps the side where normal·p + constant >= 0. Default keeps everything below / aft / to one side of the cut. */
export function useSectionPlanes(cuts: Cuts): THREE.Plane[] {
  return useMemo(() => {
    const planes: THREE.Plane[] = []
    const add = (n: THREE.Vector3, v: number, flip: boolean) => planes.push(flip ? new THREE.Plane(n.clone().negate(), -v) : new THREE.Plane(n, v))
    if (cuts.x.enabled) add(new THREE.Vector3(-1, 0, 0), cuts.x.value, cuts.x.flip)        // keep x <= value (aft part)
    if (cuts.z.enabled) add(new THREE.Vector3(0, -1, 0), cuts.z.value, cuts.z.flip)        // keep height <= value (below)
    if (cuts.y.enabled) add(new THREE.Vector3(0, 0, 1), cuts.y.value, cuts.y.flip)         // world z = -y: keep y <= value
    return planes
  }, [cuts])
}

export function sceneBounds(spaces: { polygon: [number, number][]; z: number; height: number }[]): Bounds {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const s of spaces) {
    for (const [x, y] of s.polygon) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z + s.height)
  }
  return { x: [x0, x1], y: [y0, y1], z: [z0, z1] }
}

export const defaultCuts = (b: Bounds): Cuts => ({
  x: { enabled: false, value: (b.x[0] + b.x[1]) / 2, flip: false },
  y: { enabled: false, value: 0, flip: false },
  z: { enabled: false, value: (b.z[0] + b.z[1]) / 2, flip: false },
})
