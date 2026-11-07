from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from backend.models.engineering_models import BBox, DataOrigin


class FindingStatus(str, Enum):
    CONNECTIVITY_VERIFIED = "CONNECTIVITY_VERIFIED"
    POTENTIAL_CONNECTIVITY_ISSUE = "POTENTIAL_CONNECTIVITY_ISSUE"
    INCONCLUSIVE = "INCONCLUSIVE"


class Engine(str, Enum):
    ESCAPE = "escape_route_connectivity"
    HAZARD = "hazardous_space_accessibility"
    FIRE = "fire_risk_proximity"


class SupportingFact(BaseModel):
    kind: str = Field(description="relationship | measurement | absence | path | classification")
    statement: str
    provenance: str
    evidence_ids: list[str] = Field(default_factory=list)


class Finding(BaseModel):
    id: str
    engine: Engine
    status: FindingStatus
    title: str
    affected_ids: list[str]
    affected_names: list[str] = Field(default_factory=list)
    deck_id: Optional[str] = None
    location: Optional[BBox] = None
    observation: str
    risk_explanation: str
    supporting_facts: list[SupportingFact] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    recommended_action: str
    requirement_refs: list[str] = Field(default_factory=list)
    highlight_path: list[str] = Field(default_factory=list, description="Node ids of a path to draw")
    highlight_ids: list[str] = Field(default_factory=list, description="Extra element ids to highlight")
    data_origin: DataOrigin = DataOrigin.ACTUAL_PDF
    explanation_source: str = "deterministic_rules"
    llm_explanation: Optional[str] = None


class EngineSummary(BaseModel):
    engine: Engine
    title: str
    elements_analyzed: int
    verified: int
    potential_issues: int
    inconclusive: int
    completed: bool
    notes: list[str] = Field(default_factory=list)


class AnalysisResult(BaseModel):
    design_id: str
    scenario: Optional[str] = None
    summaries: list[EngineSummary]
    findings: list[Finding]
    graph: dict = Field(default_factory=dict, description="node-link graph for display")
    disclaimer: str = (
        "Engineering screening only. Connectivity in the extracted model is not proof of regulatory "
        "compliance, and missing information is not proof of non-compliance. Formal approval rests with "
        "naval architects, the classification society and the flag administration."
    )
