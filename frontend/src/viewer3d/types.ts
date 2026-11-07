export type Band = 'red' | 'amber' | 'green' | 'none'

export interface SceneRef { id: string; kind: 'finding' | 'regulatory'; status: string; band: Band }

export interface SceneSpace {
  id: string; deck_id: string; name: string | null; kind: string; hazard: string | null
  polygon: [number, number][]            // ship metres: x forward from frame 0, y transverse from centreline
  z: number; height: number; band: Band; refs: SceneRef[]; provenance: string; geometry_resolved: boolean
}

export interface SceneDeck { id: string; name: string; z: number; height: number; x_range: [number, number]; elevation_label: string | null; height_basis: string }

export interface Scene3D {
  available: boolean; design_id: string; reason?: string; units?: string; axes?: string; basis?: string
  decks: SceneDeck[]; spaces: SceneSpace[]; skipped_decks?: string[]
}

/** Ship coordinates (x fwd, y transverse, z up) -> three.js world (x, y up, z = -transverse). */
export const toWorld = (x: number, y: number, z: number): [number, number, number] => [x, z, -y]
