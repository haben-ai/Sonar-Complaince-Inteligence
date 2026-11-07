import type { Band } from './types'

/** Status heat-map. Wording follows the engines: red = potential issue / potential non-compliance (never
 * "violation" - nothing is certified), amber = inconclusive / insufficient evidence / expert review,
 * green = verified connectivity / compliant on available evidence, grey = no check targets the space. */
export const BAND: Record<Band, { color: string; label: string }> = {
  red: { color: '#d92d20', label: 'Potential issue' },
  amber: { color: '#d39b2a', label: 'Inconclusive / review' },
  green: { color: '#3a9a63', label: 'Verified on available evidence' },
  none: { color: '#b4c4c4', label: 'No check' },
}

export const KIND_TINT: Record<string, string> = {
  accommodation: '#7c9cc4', public_space: '#5fa7b8', work_space: '#8f86bf', control_station: '#5eb3a6',
  service_space: '#8a94a3', machinery_space: '#c08a5c', sanitary: '#6b7685', corridor: '#c4b26a', stair: '#b087bd',
  open_deck: '#6fae84', technical: '#566170', tank_or_void: '#3d4654', unknown: '#6b7685',
}
export const KIND_LABEL: [string, string][] = [['accommodation', 'Cabins'], ['public_space', 'Public'], ['service_space', 'Service / stores'],
  ['machinery_space', 'Machinery'], ['control_station', 'Control'], ['corridor', 'Corridor'], ['stair', 'Stair'], ['open_deck', 'Open deck']]
