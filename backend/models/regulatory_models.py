"""Regulatory layer data contracts (see docs/HYBRID_RAG_PLAN.md)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Instrument = Literal["SOLAS", "SPS_CODE", "MARPOL", "COLREG", "LOAD_LINE", "BWM", "CLASS_DNV", "CLASS_BV", "PVAG", "ADA"]


class RegulatoryDocument(BaseModel):
    doc_id: str
    instrument: str
    title: str
    edition: str
    url: str
    format: str
    licence: str
    completeness: str          # full_text | full_text_historic | full_text_proposed | partial | summary_only
    parser: str
    sha256: Optional[str] = None
    clause_count: int = 0


class Clause(BaseModel):
    clause_id: str             # e.g. "SOLAS-II2-MSC99-73/R13/3.3.4"
    doc_id: str
    instrument: str
    path: list[str]            # ["Regulation 13 - Means of escape", "3.3.4"]
    number: Optional[str] = None
    heading: Optional[str] = None
    text: str
    page: int                  # 1-based page in the source PDF (0 for HTML)
    cross_refs: list[str] = Field(default_factory=list)


class SearchHit(BaseModel):
    clause: Clause
    score: float
    rank_bm25: Optional[int] = None
    rank_vector: Optional[int] = None
    excerpt: str


# ---------------------------------------------------------------- vessel profile / applicability

class ProfileFact(BaseModel):
    value: Optional[str | float | int] = None
    source: Literal["drawing_text", "user_input", "unknown"] = "unknown"
    evidence_text: Optional[str] = None
    evidence_ids: list[str] = Field(default_factory=list)


class VesselProfile(BaseModel):
    design_id: str
    ship_type: ProfileFact = Field(default_factory=ProfileFact)
    class_notation: ProfileFact = Field(default_factory=ProfileFact)
    class_society: ProfileFact = Field(default_factory=ProfileFact)
    persons_on_board: ProfileFact = Field(default_factory=ProfileFact)
    special_personnel: ProfileFact = Field(default_factory=ProfileFact)
    passengers: ProfileFact = Field(default_factory=ProfileFact)
    length_overall_m: ProfileFact = Field(default_factory=ProfileFact)
    breadth_m: ProfileFact = Field(default_factory=ProfileFact)
    gross_tonnage: ProfileFact = Field(default_factory=ProfileFact)
    oil_fuel_capacity_m3: ProfileFact = Field(default_factory=ProfileFact)
    delivery_date: ProfileFact = Field(default_factory=ProfileFact)
    flag: ProfileFact = Field(default_factory=ProfileFact)
    us_passenger_vessel: ProfileFact = Field(default_factory=ProfileFact)


ApplicabilityStatus = Literal["APPLICABLE", "APPLICABLE_WITH_ASSUMPTIONS", "NOT_APPLICABLE", "APPLICABILITY_UNKNOWN"]


class ApplicabilityStep(BaseModel):
    statement: str
    clause_ids: list[str] = Field(default_factory=list)
    profile_facts: list[str] = Field(default_factory=list)


class ApplicabilityVerdict(BaseModel):
    scope_id: str              # e.g. "SOLAS_II2_CARGO", "SOLAS_II2_PASSENGER", "MARPOL_I_12A", "PVAG", "ADA"
    instrument: str
    title: str
    status: ApplicabilityStatus
    reasoning: list[ApplicabilityStep]
    assumptions: list[str] = Field(default_factory=list)
    missing_facts: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------- check specs / results

class CheckSpec(BaseModel):
    spec_id: str
    instrument: str
    title: str
    scope_id: str                       # applicability scope this spec belongs to
    clause_ids: list[str]
    quote: str                          # verbatim sentence from the clause carrying the requirement
    target: dict                        # selector, e.g. {"space_kind": ["corridor"]} or {"hazard": [...]}
    evaluator: Literal["graph_reach", "graph_independent_routes", "numeric_threshold", "presence",
                       "adjacency_documentation", "documented_system", "not_assessable_from_ga"]
    property: Optional[str] = None
    operator: Optional[Literal[">=", "<=", "=="]] = None
    threshold: Optional[float] = None
    unit: Optional[str] = None
    required_evidence: list[str] = Field(default_factory=list)
    interpretation_notes: list[str] = Field(default_factory=list)
    extracted_by: Literal["manual", "llm"] = "manual"
    quote_verified: bool = False        # set at load time: quote found verbatim in the stored clause
    validation_status: Literal["draft", "engineer_validated", "rejected"] = "draft"
    validated_by: Optional[str] = None
    validated_at: Optional[str] = None


ResultStatus = Literal["POTENTIAL_NON_COMPLIANCE", "COMPLIANT_ON_AVAILABLE_EVIDENCE", "INSUFFICIENT_EVIDENCE",
                       "NOT_APPLICABLE", "APPLICABILITY_UNKNOWN", "NOT_ASSESSABLE_FROM_GA", "REQUIRES_EXPERT_REVIEW"]


class Citation(BaseModel):
    clause_id: str
    doc_title: str
    path: list[str]
    page: int
    excerpt: str
    completeness: str
    url: str


class ComplianceResult(BaseModel):
    result_id: str
    spec_id: str
    instrument: str
    title: str
    element_ids: list[str] = Field(default_factory=list)
    element_names: list[str] = Field(default_factory=list)
    deck_id: Optional[str] = None
    indicative_status: ResultStatus     # what the evaluator found
    status: ResultStatus                # final, after the validation gate
    measured: Optional[dict] = None
    required: Optional[dict] = None
    reasoning: list[str] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    design_evidence_ids: list[str] = Field(default_factory=list)
    highlight_path: list[str] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    demo_as_if_applicable: bool = False
    data_origin: str = "actual_pdf"
