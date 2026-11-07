from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.regulatory import service, specs
from backend.regulatory.applicability.vessel_profile import USER_FIELDS, save_user_facts
from backend.regulatory.index import store as reg_store
from backend.regulatory.retrieve.hybrid import search as hybrid_search
from backend.services import store

router = APIRouter(prefix="/api/regulatory", tags=["regulatory"])


def _ready(design_id: str):
    try:
        e = store.get(design_id)
    except KeyError:
        raise HTTPException(404, f"Unknown design '{design_id}'")
    if e.status != "ready":
        raise HTTPException(409, f"Design '{design_id}' is {e.status}")
    return e


@router.get("/documents")
def documents():
    return reg_store.documents()


@router.get("/clauses/{clause_id:path}")
def clause(clause_id: str):
    c = reg_store.clause(clause_id)
    if not c:
        raise HTTPException(404, "Clause not found")
    return {"clause": c, "document": reg_store.document(c.doc_id)}


@router.get("/search")
def search(q: str, instrument: Optional[str] = None, limit: int = 10):
    return hybrid_search(q, [instrument] if instrument else None, limit)


@router.get("/specs")
def list_specs():
    return specs.load()


class ValidateReq(BaseModel):
    validated_by: str
    status: str = "engineer_validated"


@router.put("/specs/{spec_id}/validate")
def validate(spec_id: str, req: ValidateReq):
    if spec_id not in {s.spec_id for s in specs.load()}:
        raise HTTPException(404, "Unknown spec")
    if not req.validated_by.strip():
        raise HTTPException(400, "validated_by is required")
    try:
        rec = specs.validate(spec_id, req.validated_by.strip(), req.status)
    except ValueError as e:
        raise HTTPException(400, str(e))
    service.invalidate()
    return rec


@router.get("/vessel-profile")
def get_profile(design_id: str):
    _ready(design_id)
    return {"profile": service.profile(design_id), "editable_fields": USER_FIELDS}


@router.put("/vessel-profile")
def put_profile(design_id: str, values: dict):
    _ready(design_id)
    save_user_facts(design_id, values)
    service.invalidate(design_id)
    return service.profile(design_id)


@router.get("/evaluate")
def evaluate(design_id: str, scenario: Optional[str] = None, demo: bool = False):
    _ready(design_id)
    r = service.evaluate(design_id, scenario, demo)
    return {"profile": r["profile"], "applicability": r["applicability"], "matrix": r["matrix"],
            "results": r["results"], "specs": r["specs"]}


@router.get("/related")
def related(design_id: str, finding_id: str, scenario: Optional[str] = None, demo: bool = False):
    """Compliance results and retrieved clauses related to an engine finding."""
    _ready(design_id)
    res = store.analyze(design_id, scenario)
    f = next((x for x in res.findings if x.id == finding_id), None)
    if not f:
        raise HTTPException(404, "Finding not found")
    ev = service.evaluate(design_id, scenario, demo)
    primary = f.affected_ids[0] if f.affected_ids else None
    results = [r for r in ev["results"] if r.element_ids and r.element_ids[0] == primary]
    q = {"escape_route_connectivity": "means of escape corridor stairway accommodation dead-end",
         "hazardous_space_accessibility": "means of escape from machinery spaces two escape routes",
         "fire_risk_proximity": "fire integrity of bulkheads and decks adjacent spaces"}[f.engine.value]
    m = store.model_for(design_id, scenario)
    sp = m.space(f.affected_ids[0])
    if sp and sp.hazard:
        q += " " + sp.hazard.category.replace("_", " ")
    instruments = ["SOLAS", "SPS_CODE"]
    return {"results": results, "clauses": hybrid_search(q, instruments, 5), "query": q}
