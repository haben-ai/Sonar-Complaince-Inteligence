import type { Band } from './types'

/** Status heat-map. Wording follows the engines: red = potential issue / potential non-compliance (never
 * "violation" - nothing is certified), amber = inconclusive / insufficient evidence / expert review,
 * green = verified connectivity / compliant on available evidence, grey = no check targets the space. */
/** 3D status colours: possible issues in YouTube red, review items in a concentrated bright yellow,
 * so both read instantly against the dark backdrop. Green and grey stay calmer. */
export const BAND: Record<Band, { color: string; label: string }> = {
  red: { color: '#ff0000', label: 'Possible issue' },
  amber: { color: '#ffc400', label: 'Needs review / more information' },
  green: { color: '#7fd1a8', label: 'Confirmed on available evidence' },
  none: { color: '#c9d3de', label: 'No check (internal compartment)' },
}

export const KIND_TINT: Record<string, string> = {
  accommodation: '#9cc0e3', public_space: '#8ecad6', work_space: '#b4b1e6', control_station: '#86c9c3',
  service_space: '#c9d1db', machinery_space: '#aaa8c6', sanitary: '#b8c4d0', corridor: '#eef2f6', stair: '#d4b4e4',
  open_deck: '#a9cfd8', technical: '#9ba7b6', tank_or_void: '#7d8a99', unknown: '#b3bfcc',
}

/** Dark "night stage" palette for the derived 3D model: deep plum backdrop with a faint cross grid,
 * pale geometry, warm key light, and a neon frame around the selected room. Status colours (BAND)
 * keep their meaning on top of it. */
export const SCENE3D = {
  backdrop: 'radial-gradient(ellipse at 50% 40%, #2a1830 0%, #1a0f1f 55%, #0f0912 100%)',
  fog: '#150c19',
  unclassified: '#a9b3c4',
  plate: '#f1edf4', plateEdge: '#8d7aa3',
  edge: '#2a1b30', edgeOpacity: 0.4,
  selected: '#38b6a0', selectedEdge: '#0e6b5e',
  gridCell: '#3a2448', gridSection: '#6e3f88',
  hemiSky: '#fff0f6', hemiGround: '#1a0f1f',
  sun: '#ffe2cc',
  neon: ['#ffd1e4', '#ff7eb6', '#ffd1e4'] as const,   // rose-pink rim, matched to the plum backdrop
  neonGlow: '#ff5fa2',
  cross: '#8b4fae',                                  // 3D floor crosses
}
export const KIND_LABEL: [string, string][] = [['accommodation', 'Cabins'], ['public_space', 'Public'], ['service_space', 'Service / stores'],
  ['machinery_space', 'Machinery'], ['control_station', 'Control'], ['corridor', 'Corridor'], ['stair', 'Stair'], ['open_deck', 'Open deck']]
