from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class RequirementStatus(str, Enum):
    VERIFIED = "verified_regulatory_requirement"        # clause text checked by an engineer against the official source
    UNVERIFIED = "unverified_extracted_requirement"     # extracted from a document, not yet checked
    SYNTHETIC = "synthetic_demonstration_rule"          # written for this demo; not a legal requirement


class Requirement(BaseModel):
    requirement_id: str
    title: str
    source: str = Field(description="Document or instrument, e.g. 'SOLAS Chapter II-2, Regulation 13'")
    clause: Optional[str] = Field(
        None, description="Exact verified clause reference. Left empty rather than guessed."
    )
    description: str
    applicability: str
    applicability_to_design: str = Field(
        "", description="Why this may or may not apply to the analysed design"
    )
    verification_method: str
    engines: list[str] = Field(default_factory=list)
    validation_status: RequirementStatus
    source_page: Optional[int] = None
    source_excerpt: Optional[str] = Field(None, description="Only for text imported from a supplied document")
    extracted_by: str = "manual"
