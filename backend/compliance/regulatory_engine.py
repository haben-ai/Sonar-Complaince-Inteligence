"""Lightweight regulatory knowledge module.

* Loads curated requirements (sample_requirements.json).
* Imports a user-supplied regulatory PDF: candidate requirement sentences (containing
  'shall' / 'is to be' / 'must') are extracted with their page number and stored as
  UNVERIFIED. With a Gemini key, the LLM may summarise each candidate, but the original
  text is always kept and nothing is promoted to 'verified' automatically.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pymupdf

from backend.config import settings
from backend.extraction import drawing_interpreter
from backend.models.requirement_models import Requirement, RequirementStatus

_store: dict[str, Requirement] = {}


def load_defaults() -> None:
    data = json.loads((settings.data_dir / "sample_requirements.json").read_text())
    for r in data["requirements"]:
        req = Requirement.model_validate(r)
        _store[req.requirement_id] = req


def all_requirements() -> list[Requirement]:
    if not _store:
        load_defaults()
    return list(_store.values())


def get(rid: str) -> Requirement | None:
    if not _store:
        load_defaults()
    return _store.get(rid)


CANDIDATE_RX = re.compile(r"[^.;\n]*\b(shall|is to be|are to be|must)\b[^.;]*[.;]", re.I)


def import_document(path: Path, source_name: str, max_items: int = 200) -> list[Requirement]:
    doc = pymupdf.open(str(path))
    out: list[Requirement] = []
    n = 0
    for pno, page in enumerate(doc):
        text = re.sub(r"\s+", " ", page.get_text())
        for m in CANDIDATE_RX.finditer(text):
            sent = m.group(0).strip()
            if len(sent) < 40:
                continue
            n += 1
            rid = f"IMP-{re.sub(r'[^A-Z0-9]', '', source_name.upper())[:10]}-{n:04d}"
            summary = drawing_interpreter.summarise_requirement(sent) if settings.llm_enabled else None
            req = Requirement(
                requirement_id=rid,
                title=(summary or sent)[:90],
                source=source_name,
                clause=None,
                description=summary or sent,
                applicability="Not determined - requires engineer validation",
                verification_method="Engineer validation against the official source",
                engines=[],
                validation_status=RequirementStatus.UNVERIFIED,
                source_page=pno + 1,
                source_excerpt=sent[:1200],
                extracted_by="llm_summary+regex" if summary else "regex (modal-verb sentence detection)",
            )
            _store[rid] = req
            out.append(req)
            if len(out) >= max_items:
                return out
    return out
