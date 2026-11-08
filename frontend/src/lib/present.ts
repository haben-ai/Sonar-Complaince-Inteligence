/**
 * Presentation adapter: maps backend findings onto the fields the review workspace shows.
 * It only renames and groups existing data. It never fills a missing value; absent data stays null / empty.
 */
import type { BBox, EngineId, EngineeringModel, Finding, Status, SupportingFact } from '../types'
import { MODULE_TERMS, SOURCE_CLASS_TERMS, STATUS_TERMS } from './terms'
import { stripDeck } from './names'
import { describe, firstSentence, type Described } from './describe'

// ---------------------------------------------------------------- statuses
export type ViewStatus = 'issue' | 'inconclusive' | 'verified' | 'not_assessed'
export const VIEW_STATUS: Record<ViewStatus, { label: string; short: string; hex: string; help: string; rank: number }> = {
  issue: { ...STATUS_TERMS.issue, hex: '#e56b68', rank: 0 },
  inconclusive: { ...STATUS_TERMS.inconclusive, hex: '#e7ad55', rank: 1 },
  verified: { ...STATUS_TERMS.verified, hex: '#55b98b', rank: 2 },
  not_assessed: { ...STATUS_TERMS.not_assessed, hex: '#8292a5', rank: 3 },
}
export const VIEW_STATUS_ORDER: ViewStatus[] = ['issue', 'inconclusive', 'verified', 'not_assessed']
const FROM_BACKEND: Record<Status, ViewStatus> = {
  POTENTIAL_CONNECTIVITY_ISSUE: 'issue', INCONCLUSIVE: 'inconclusive', CONNECTIVITY_VERIFIED: 'verified',
}
export const viewStatus = (s: Status | string): ViewStatus => FROM_BACKEND[s as Status] ?? 'not_assessed'

// ---------------------------------------------------------------- modules
export const MODULES: { id: EngineId; label: string; short: string }[] = [
  { id: 'escape_route_connectivity', ...MODULE_TERMS.escape_route_connectivity },
  { id: 'hazardous_space_accessibility', ...MODULE_TERMS.hazardous_space_accessibility },
  { id: 'fire_risk_proximity', ...MODULE_TERMS.fire_risk_proximity },
]
export const MODULE_LABEL = Object.fromEntries(MODULES.map((m) => [m.id, m.label])) as Record<EngineId, string>
const MODULE_PREFIX: Record<EngineId, string> = { escape_route_connectivity: 'ESC', hazardous_space_accessibility: 'HAZ', fire_risk_proximity: 'FIRE' }
export const modulePrefix = (m: EngineId) => MODULE_PREFIX[m]

// ---------------------------------------------------------------- provenance
/** Evidence classes the inspector keeps apart. `manual` is a person's annotation and is not engineer validation. */
export type ProvClass = 'source' | 'derived' | 'ai' | 'manual' | 'synthetic'
export const PROV_CLASS: Record<string, ProvClass> = {
  pdf_text: 'source', pdf_vector_geometry: 'source', ocr: 'source',
  derived_geometry: 'derived', llm_interpretation: 'ai', manual_annotation: 'manual', synthetic: 'synthetic',
}
export const PROV_CLASS_ORDER: ProvClass[] = ['source', 'derived', 'manual', 'ai', 'synthetic']
export const PROV_CLASS_META: Record<ProvClass, { label: string; hex: string; help: string }> = {
  source: { ...SOURCE_CLASS_TERMS.source, hex: '#9cc3e0' },
  derived: { ...SOURCE_CLASS_TERMS.derived, hex: '#a9b6c6' },
  manual: { ...SOURCE_CLASS_TERMS.manual, hex: '#c4a3e0' },
  ai: { ...SOURCE_CLASS_TERMS.ai, hex: '#a7b8f0' },
  synthetic: { ...SOURCE_CLASS_TERMS.synthetic, hex: '#e391b9' },
}
export const provClass = (p: string): ProvClass => PROV_CLASS[p] ?? 'derived'

// ---------------------------------------------------------------- finding view
export interface FindingView {
  id: string
  module: EngineId
  status: ViewStatus
  title: string
  element: string            // primary affected space, deck suffix removed
  elementId: string | null
  extraAffected: number      // further affected spaces
  deckId: string | null
  deckName: string
  observation: string
  evidence: SupportingFact[]
  provenance: Record<ProvClass, number>
  missing: string[]
  significance: string
  action: string
  page: number | null
  bbox: BBox | null
  raw: Finding
  search: string
  desc: Described        // plain-language wording (lib/describe.ts)
  summary: string        // one-sentence description for list rows
}

export { stripDeck } from './names'

export function toView(f: Finding, model: EngineeringModel | null): FindingView {
  const decks = model?.decks ?? []
  const deckNames = decks.map((d) => d.name)
  const deck = decks.find((d) => d.id === f.deck_id)
  const prov = { source: 0, derived: 0, ai: 0, manual: 0, synthetic: 0 } as Record<ProvClass, number>
  for (const s of f.supporting_facts) prov[provClass(s.provenance)]++
  const element = stripDeck(f.affected_names[0], deckNames) || f.affected_ids[0] || '-'
  const deckName = deck?.name ?? (f.deck_id ? f.deck_id.replace(/^DECK_/, '') : '-')
  const v: FindingView = {
    id: f.id, module: f.engine, status: viewStatus(f.status), title: f.title, element,
    elementId: f.affected_ids[0] ?? null, extraAffected: Math.max(0, f.affected_ids.length - 1),
    deckId: f.deck_id, deckName, observation: f.observation, evidence: f.supporting_facts, provenance: prov,
    missing: f.missing_information, significance: f.risk_explanation, action: f.recommended_action,
    page: f.location?.page ?? null, bbox: f.location, raw: f,
    search: '', desc: null as unknown as Described, summary: '',
  }
  v.desc = describe(v, model)
  v.summary = firstSentence(v.desc.found)
  v.search = [f.id, f.title, v.desc.headline, element, deckName, ...f.affected_names].join(' ').toLowerCase()
  return v
}

export const byPriority = (a: FindingView, b: FindingView) =>
  VIEW_STATUS[a.status].rank - VIEW_STATUS[b.status].rank || a.id.localeCompare(b.id, undefined, { numeric: true })

/** Union of bboxes on one sheet (the first box's page). */
export function unionBox(boxes: BBox[]): BBox | null {
  if (!boxes.length) return null
  const pg = boxes[0].page ?? 0
  const same = boxes.filter((b) => (b.page ?? 0) === pg)
  return same.reduce((a, b) => ({ page: pg, x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
}

/** Highest-priority escape-module status per space id, for colouring graph nodes. */
export function escapeStatusBySpace(findings: Finding[]): Map<string, ViewStatus> {
  const m = new Map<string, ViewStatus>()
  for (const f of findings) {
    if (f.engine !== 'escape_route_connectivity') continue
    const s = viewStatus(f.status)
    for (const id of f.affected_ids.slice(0, 1)) {
      const cur = m.get(id)
      if (!cur || VIEW_STATUS[s].rank < VIEW_STATUS[cur].rank) m.set(id, s)
    }
  }
  return m
}
