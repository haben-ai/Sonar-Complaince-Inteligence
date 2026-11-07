import type { Band } from './types'

/** Status heat-map. Wording follows the engines: red = potential issue / potential non-compliance (never
 * "violation" - nothing is certified), amber = inconclusive / insufficient evidence / expert review,
 * green = verified connectivity / compliant on available evidence, grey = no check targets the space. */
export const BAND: Record<Band, { color: string; label: string }> = {
  red: { color: '#e0524d', label: 'Potential issue' },
  amber: { color: '#d6a03a', label: 'Inconclusive / review' },
  green: { color: '#4ea866', label: 'Verified on available evidence' },
  none: { color: '#6b7685', label: 'No check' },
}

export const KIND_TINT: Record<string, string> = {
  corridor: '#facc15', stair: '#e879f9', open_deck: '#4ade80', accommodation: '#60a5fa', machinery_space: '#fb923c',
  tank_or_void: '#334155', technical: '#475569', sanitary: '#64748b',
}
