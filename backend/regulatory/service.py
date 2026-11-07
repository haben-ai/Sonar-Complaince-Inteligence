"""Glue between the design store and the regulatory layer (profile, applicability, results, matrix)."""
from __future__ import annotations

import threading
from collections import Counter, defaultdict

from backend.models.regulatory_models import ComplianceResult
from backend.regulatory import specs as spec_store
from backend.regulatory.applicability.engine import evaluate as applicability
from backend.regulatory.applicability.vessel_profile import build_profile
from backend.regulatory.evaluate.runner import run
from backend.regulatory.index import store as reg_store
from backend.services import store

_cache: dict[tuple, dict] = {}
_lock = threading.Lock()


def invalidate(design_id: str | None = None):
    with _lock:
        for k in list(_cache):
            if design_id is None or k[0] == design_id:
                del _cache[k]


def profile(design_id: str):
    e = store.get(design_id)
    text = e.pdf.doc[0].get_text() if e.source_type == "pdf" and e.pdf else None
    if not (text and text.strip()) and e.model:
        text = e.model.document.metadata.get("drawing_text")       # OCR text of outlined-text PDFs
    declared = e.model.document.metadata.get("vessel_profile") if e.model else None
    return build_profile(design_id, text, declared)


def evaluate(design_id: str, scenario: str | None = None, demo: bool = False) -> dict:
    key = (design_id, scenario, demo)
    with _lock:
        if key in _cache:
            return _cache[key]
    vp = profile(design_id)
    verdicts = applicability(vp)
    specs = spec_store.load()
    results = run(store.model_for(design_id, scenario), specs, verdicts, demo=demo)
    out = {"profile": vp, "applicability": verdicts, "specs": specs, "results": results, "matrix": matrix(verdicts, results)}
    with _lock:
        _cache[key] = out
    return out


STATUS_ORDER = ["POTENTIAL_NON_COMPLIANCE", "REQUIRES_EXPERT_REVIEW", "INSUFFICIENT_EVIDENCE", "APPLICABILITY_UNKNOWN",
                "NOT_ASSESSABLE_FROM_GA", "COMPLIANT_ON_AVAILABLE_EVIDENCE", "NOT_APPLICABLE"]
INSTRUMENTS = ["SOLAS", "SPS_CODE", "MARPOL", "COLREG", "LOAD_LINE", "BWM", "CLASS_DNV", "CLASS_BV", "PVAG", "ADA"]


def matrix(verdicts, results: list[ComplianceResult]) -> list[dict]:
    by_inst: dict[str, Counter] = defaultdict(Counter)
    ind: dict[str, Counter] = defaultdict(Counter)
    for r in results:
        by_inst[r.instrument][r.status] += 1
        ind[r.instrument][r.indicative_status] += 1
    rows = []
    docs = reg_store.documents()
    for inst in INSTRUMENTS:
        vs = [v for v in verdicts if v.instrument == inst]
        if not vs and inst not in by_inst:
            continue
        rows.append({
            "instrument": inst,
            "applicability": [{"scope_id": v.scope_id, "title": v.title, "status": v.status} for v in vs],
            "final": dict(by_inst[inst]), "indicative": dict(ind[inst]),
            "corpus": [{"doc_id": d.doc_id, "completeness": d.completeness, "clauses": d.clause_count} for d in docs if d.instrument == inst],
        })
    return rows
