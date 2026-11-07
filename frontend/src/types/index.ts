export type Status = 'CONNECTIVITY_VERIFIED' | 'POTENTIAL_CONNECTIVITY_ISSUE' | 'INCONCLUSIVE'
export type EngineId = 'escape_route_connectivity' | 'hazardous_space_accessibility' | 'fire_risk_proximity'
export type DataOrigin = 'actual_pdf' | 'manual_annotation' | 'synthetic'

export interface BBox { page: number; x0: number; y0: number; x1: number; y1: number }

export interface DesignSummary {
  design_id: string
  status: 'pending' | 'extracting' | 'ready' | 'error'
  error: string | null
  source_type: 'pdf' | 'image' | 'json'
  progress: string[]
  name: string
  filename: string | null
  page_count: number | null
  page_sizes: [number, number][]
  data_origin: DataOrigin | null
  metadata: Record<string, unknown>
  counts: Record<string, number>
}

export interface ScaleInfo { metres_per_unit: number; basis: string; cross_check: string | null }
export interface Deck {
  id: string; name: string; page: number; bbox: BBox; elevation_mm: number | null; elevation_label: string | null
  centerline_y: number | null; frame0_x: number | null; units_per_frame: number | null; scale: ScaleInfo | null
}
export interface Hazard { category: string; description: string; fire_risk: boolean; classification_source: string; matched_rule: string | null }
export interface Space {
  id: string; deck_id: string; name: string | null; labels: string[]; kind: string; kind_basis: string
  labelled_area_m2: number | null; computed_area_m2: number | null; polygon: [number, number][]; bbox: BBox | null
  hazard: Hazard | null; provenance: string; evidence_ids: string[]; notes: string[]; anchor: [number, number] | null
}
export interface Door {
  id: string; deck_id: string; bbox: BBox; hinge: [number, number] | null; leaf_width_mm: number | null
  watertight: boolean; cad_layer: string | null; space_ids: string[]; resolution: string; evidence_ids: string[]
}
export interface EscapePoint {
  id: string; deck_id: string; kind: string; space_id: string | null; bbox: BBox | null; label: string | null
  provenance: string; notes: string
}
export interface Connection {
  id: string; source: string; target: string; type: string; door_id: string | null; provenance: string; certainty: string; note: string
}
export interface Adjacency {
  id: string; space_a: string; space_b: string; relation: string; shared_length_m: number | null
  overlap_area_m2: number | null; boundary_on_steel_layer_fraction: number | null; certainty: string
}
export interface EngineeringModel {
  document: { design_id: string; name: string; source_type: string; page_count: number; page_sizes: [number, number][]; data_origin: DataOrigin; metadata: Record<string, unknown>; sha256: string | null; filename: string | null }
  decks: Deck[]; spaces: Space[]; doors: Door[]; escape_points: EscapePoint[]; connections: Connection[]; adjacencies: Adjacency[]
  fire_documentation: { note: string; matches: { pattern: string; text: string; page: number }[] }
  extraction_log: string[]; limitations: string[]; scenario: string | null; scenario_description: string | null; scenario_affected_ids: string[]
}

export interface SupportingFact { kind: string; statement: string; provenance: string; evidence_ids: string[] }
export interface Finding {
  id: string; engine: EngineId; status: Status; title: string; affected_ids: string[]; affected_names: string[]
  deck_id: string | null; location: BBox | null; observation: string; risk_explanation: string
  supporting_facts: SupportingFact[]; missing_information: string[]; recommended_action: string
  requirement_refs: string[]; highlight_path: string[]; highlight_ids: string[]; data_origin: DataOrigin
  explanation_source: string; llm_explanation: string | null
}
export interface EngineSummary {
  engine: EngineId; title: string; elements_analyzed: number; verified: number; potential_issues: number
  inconclusive: number; completed: boolean; notes: string[]
}
export interface AnalysisSummary {
  design_id: string; scenario: string | null; scenario_info: { title: string; description: string } | null
  summaries: EngineSummary[]; disclaimer: string
  fire_documentation: EngineeringModel['fire_documentation']; limitations: string[]; extraction_log: string[]
}
export interface Evidence {
  id: string; page: number; bbox: BBox | null; source: string; method: string; text: string | null; detail: Record<string, unknown>
}
export interface Requirement {
  requirement_id: string; title: string; source: string; clause: string | null; description: string
  applicability: string; applicability_to_design: string; verification_method: string; engines: string[]
  validation_status: 'verified_regulatory_requirement' | 'unverified_extracted_requirement' | 'synthetic_demonstration_rule'
  source_page: number | null; source_excerpt: string | null
}
export interface FindingDetail { finding: Finding; evidence: Evidence[]; requirements: Requirement[]; spaces: Space[] }
export interface Scenario { id: string; title: string; description: string }
export interface SystemStatus { llm_enabled: boolean; model: string | null; mode: string; ocr_available: boolean; default_pdf_present: boolean }
export interface GraphData { nodes: { id: string; node_type: string; kind: string; name: string | null; deck: string }[]; edges: { source: string; target: string; type: string; certainty: string }[] }

// ---------------- regulatory layer
export type ResultStatus = 'POTENTIAL_NON_COMPLIANCE' | 'COMPLIANT_ON_AVAILABLE_EVIDENCE' | 'INSUFFICIENT_EVIDENCE' | 'NOT_APPLICABLE'
  | 'APPLICABILITY_UNKNOWN' | 'NOT_ASSESSABLE_FROM_GA' | 'REQUIRES_EXPERT_REVIEW'
export interface ProfileFact { value: string | number | boolean | null; source: string; evidence_text: string | null }
export type VesselProfile = Record<string, ProfileFact | string>
export interface ApplicabilityVerdict {
  scope_id: string; instrument: string; title: string
  status: 'APPLICABLE' | 'APPLICABLE_WITH_ASSUMPTIONS' | 'NOT_APPLICABLE' | 'APPLICABILITY_UNKNOWN'
  reasoning: { statement: string; clause_ids: string[]; profile_facts: string[] }[]; assumptions: string[]; missing_facts: string[]
}
export interface Citation { clause_id: string; doc_title: string; path: string[]; page: number; excerpt: string; completeness: string; url: string }
export interface ComplianceResult {
  result_id: string; spec_id: string; instrument: string; title: string; element_ids: string[]; element_names: string[]
  deck_id: string | null; indicative_status: ResultStatus; status: ResultStatus
  measured: Record<string, unknown> | null; required: Record<string, unknown> | null; reasoning: string[]; citations: Citation[]
  design_evidence_ids: string[]; highlight_path: string[]; caveats: string[]; demo_as_if_applicable: boolean; data_origin: DataOrigin
}
export interface CheckSpec {
  spec_id: string; instrument: string; title: string; scope_id: string; clause_ids: string[]; quote: string; evaluator: string
  property: string | null; operator: string | null; threshold: number | null; unit: string | null; interpretation_notes: string[]
  quote_verified: boolean; validation_status: 'draft' | 'engineer_validated' | 'rejected'; validated_by: string | null; validated_at: string | null
}
export interface MatrixRow {
  instrument: string; applicability: { scope_id: string; title: string; status: string }[]
  final: Record<string, number>; indicative: Record<string, number>; corpus: { doc_id: string; completeness: string; clauses: number }[]
}
export interface RegulatoryEvaluation {
  profile: VesselProfile; applicability: ApplicabilityVerdict[]; matrix: MatrixRow[]; results: ComplianceResult[]; specs: CheckSpec[]
}
export interface Clause { clause_id: string; doc_id: string; instrument: string; path: string[]; number: string | null; heading: string | null; text: string; page: number }
export interface ClauseHit { clause: Clause; score: number; rank_bm25: number | null; rank_vector: number | null; excerpt: string }
