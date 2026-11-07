/**
 * Explore-mode adapter: turns the derived 3D scene and the findings into "world objects".
 * Pure presentation mapping. It reads /api/design/scene3d and the existing findings and never
 * changes, infers or adds engineering data; status colours keep their review meaning.
 */
import type { FindingView, ViewStatus } from '../../lib/present'
import type { Scene3D, SceneSpace } from '../types'

export type Vec3 = [number, number, number]
/** Ship metres (x fwd, y transverse, z up) -> three.js world (x, y up, z = -transverse). */
export const toWorld = (x: number, y: number, z: number): Vec3 => [x, z, -y]

/** Cheerful toy palette per space type. Hues avoid red / amber / green, which stay reserved for status. */
export const TOY_KIND: Record<string, string> = {
  accommodation: '#9cc9e8', public_space: '#c6b4e6', work_space: '#b9c4f0', control_station: '#7fa7d9',
  service_space: '#ddd6c8', machinery_space: '#8d99ae', sanitary: '#cfd8dc', corridor: '#f6f1e4', stair: '#f2a9c6',
  open_deck: '#d9b896', technical: '#a9b2bf', unknown: '#d4d4d4',
}
export const TOY_KIND_LABEL: [string, string][] = [['accommodation', 'Cabins'], ['public_space', 'Public'], ['service_space', 'Service'],
  ['machinery_space', 'Machinery'], ['control_station', 'Control'], ['corridor', 'Corridor'], ['stair', 'Stair'], ['open_deck', 'Open deck']]

export interface Block { id: string; deckId: string; name: string | null; kind: string; color: string; polygon: [number, number][]; z: number; height: number; stopIds: string[] }
export interface Stop {
  id: string; status: ViewStatus; title: string; element: string; deckName: string; module: string
  roomId: string; deckZ: number; target: Vec3; beacon: Vec3
}
export interface World {
  blocks: Block[]; stops: Stop[]
  bounds: { min: Vec3; max: Vec3; centre: Vec3; length: number }
  decks: { id: string; name: string; z: number }[]
}

function centroid(poly: [number, number][]): [number, number] {
  const n = poly.length || 1
  return [poly.reduce((a, p) => a + p[0], 0) / n, poly.reduce((a, p) => a + p[1], 0) / n]
}

export type TourFilter = 'issues' | 'issues+inconclusive' | 'all'

export function buildWorld(scene: Scene3D, views: FindingView[], filter: TourFilter): World {
  const rooms = scene.spaces.filter((s) => s.kind !== 'tank_or_void')
  const byId = new Map<string, SceneSpace>(rooms.map((s) => [s.id, s]))
  const keep = (s: ViewStatus) => filter === 'all' || s === 'issue' || (filter === 'issues+inconclusive' && s === 'inconclusive')

  // tour stops: findings in review priority order, placed on their primary room
  const stops: Stop[] = []
  const perRoom = new Map<string, number>()
  for (const v of views) {
    if (!keep(v.status) || !v.elementId) continue
    const s = byId.get(v.elementId)
    if (!s) continue
    const [cx, cy] = centroid(s.polygon)
    const k = perRoom.get(s.id) ?? 0          // several findings on one room: fan the beacons out along the ship
    perRoom.set(s.id, k + 1)
    const dx = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.6
    stops.push({
      id: v.id, status: v.status, title: v.title, element: v.element, deckName: v.deckName, module: v.module,
      roomId: s.id, deckZ: s.z, target: toWorld(cx, cy, s.z + s.height * 0.5), beacon: toWorld(cx + dx, cy, s.z + s.height + 1.4),
    })
  }
  const stopsByRoom = new Map<string, string[]>()
  for (const st of stops) stopsByRoom.set(st.roomId, [...(stopsByRoom.get(st.roomId) ?? []), st.id])

  const blocks: Block[] = rooms.map((s) => ({
    id: s.id, deckId: s.deck_id, name: s.name, kind: s.kind, color: TOY_KIND[s.kind] ?? TOY_KIND.unknown,
    polygon: s.polygon, z: s.z, height: s.height, stopIds: stopsByRoom.get(s.id) ?? [],
  }))

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const s of rooms) {
    for (const [x, y] of s.polygon) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z + s.height)
  }
  const min = toWorld(x0, y1, z0), max = toWorld(x1, y0, z1)
  return {
    blocks, stops,
    bounds: { min, max, centre: [(x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2], length: Math.max(x1 - x0, 10) },
    decks: scene.decks.map((d) => ({ id: d.id, name: d.name, z: d.z })),
  }
}
