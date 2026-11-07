import type { Scene3D } from './types'

/** Convex outline (monotone chain) of all room outlines on one deck, in ship metres.
 * Drawn as a thin plate under the rooms so stacked decks read as one ship. It is a visual
 * envelope of the extracted rooms, not a hull surface. */
function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q) }
  const upper: [number, number][] = []
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q) }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

export interface DeckPlate { id: string; z: number; outline: [number, number][] }

export function deckPlates(scene: Scene3D): DeckPlate[] {
  return scene.decks.map((d) => {
    const pts = scene.spaces.filter((s) => s.deck_id === d.id && s.kind !== 'tank_or_void').flatMap((s) => s.polygon)
    return { id: d.id, z: d.z, outline: pts.length >= 3 ? convexHull(pts) : [] }
  }).filter((p) => p.outline.length >= 3)
}
