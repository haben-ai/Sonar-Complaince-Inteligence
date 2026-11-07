from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from backend.api.serializers import design_summary
from backend.compliance import regulatory_engine
from backend.config import settings
from backend.extraction import drawing_interpreter, ocr_engine
from backend.services import scenarios, store

router = APIRouter(prefix="/api", tags=["analysis"])


def _entry(design_id: str):
    try:
        e = store.get(design_id)
    except KeyError:
        raise HTTPException(404, f"Unknown design '{design_id}'")
    return e


def _ready(design_id: str):
    e = _entry(design_id)
    if e.status != "ready":
        raise HTTPException(409, f"Design '{design_id}' is {e.status}")
    return e


@router.get("/status")
def status():
    from backend.regulatory.retrieve import hybrid

    return {**drawing_interpreter.status(), "ocr_available": ocr_engine.available(), "retrieval": hybrid.status(),
            "default_pdf_present": settings.default_pdf.exists()}


@router.get("/designs")
def designs():
    return [design_summary(e) for e in store.list_designs()]


@router.get("/designs/{design_id}")
def design(design_id: str):
    return design_summary(_entry(design_id))


@router.get("/scenarios")
def list_scenarios():
    return [{"id": k, **v} for k, v in scenarios.SCENARIOS.items()]


class AnalyzeRequest(BaseModel):
    design_id: str
    scenario: Optional[str] = None


@router.post("/analyze")
def analyze(req: AnalyzeRequest):
    _ready(req.design_id)
    if req.scenario and req.scenario not in scenarios.SCENARIOS:
        raise HTTPException(400, "Unknown scenario")
    r = store.analyze(req.design_id, req.scenario)
    return {"design_id": r.design_id, "scenario": r.scenario, "summaries": r.summaries, "finding_count": len(r.findings),
            "disclaimer": r.disclaimer}


@router.get("/analysis/summary")
def summary(design_id: str, scenario: Optional[str] = None):
    _ready(design_id)
    r = store.analyze(design_id, scenario)
    m = store.model_for(design_id, scenario)
    return {"design_id": design_id, "scenario": scenario,
            "scenario_info": scenarios.SCENARIOS.get(scenario) if scenario else None,
            "summaries": r.summaries, "disclaimer": r.disclaimer,
            "fire_documentation": m.fire_documentation, "limitations": m.limitations,
            "extraction_log": m.extraction_log}


def _anchor(poly):
    """A point guaranteed inside the polygon (for drawing graph nodes / paths)."""
    from shapely.geometry import Polygon

    try:
        pg = Polygon(poly)
        if not pg.is_valid:
            pg = pg.buffer(0)
        p = pg.representative_point()
        return [p.x, p.y]
    except Exception:
        return None


@router.get("/design/elements")
def elements(design_id: str, scenario: Optional[str] = None):
    _ready(design_id)
    m = store.model_for(design_id, scenario)
    out = m.model_dump(exclude={"evidence"})
    for s in out["spaces"]:
        s["anchor"] = _anchor(s["polygon"]) if len(s["polygon"]) >= 3 else (
            [(s["bbox"]["x0"] + s["bbox"]["x1"]) / 2, (s["bbox"]["y0"] + s["bbox"]["y1"]) / 2] if s["bbox"] else None)
    return out


@router.get("/design/evidence/{evidence_id}")
def evidence(evidence_id: str, design_id: str, scenario: Optional[str] = None):
    _ready(design_id)
    ev = store.model_for(design_id, scenario).evidence_by_id().get(evidence_id)
    if not ev:
        raise HTTPException(404, "Evidence not found")
    return ev


@router.get("/design/graph")
def graph(design_id: str, scenario: Optional[str] = None):
    _ready(design_id)
    return store.analyze(design_id, scenario).graph


@router.get("/findings")
def findings(design_id: str, scenario: Optional[str] = None, engine: Optional[str] = None, status: Optional[str] = None):
    _ready(design_id)
    fs = store.analyze(design_id, scenario).findings
    if engine:
        fs = [f for f in fs if f.engine.value == engine]
    if status:
        fs = [f for f in fs if f.status.value == status]
    return fs


@router.get("/findings/{finding_id}")
def finding(finding_id: str, design_id: str, scenario: Optional[str] = None, explain: bool = False):
    _ready(design_id)
    r = store.analyze(design_id, scenario)
    f = next((x for x in r.findings if x.id == finding_id), None)
    if not f:
        raise HTTPException(404, "Finding not found")
    m = store.model_for(design_id, scenario)
    ev = m.evidence_by_id()
    ids = []
    for fact in f.supporting_facts:
        ids += fact.evidence_ids
    for sid in f.affected_ids:
        s = m.space(sid)
        if s:
            ids += s.evidence_ids
    seen, evidence = set(), []
    for i in ids:
        if i in ev and i not in seen:
            seen.add(i)
            evidence.append(ev[i])
    if explain and settings.llm_enabled and not f.llm_explanation:
        f.llm_explanation = drawing_interpreter.explain_finding(f.model_dump())
        if f.llm_explanation:
            f.explanation_source = f"deterministic_rules + {drawing_interpreter.last_model_used} explanation (llm_interpretation)"
    reqs = [regulatory_engine.get(x) for x in f.requirement_refs]
    return {"finding": f, "evidence": evidence, "requirements": [x for x in reqs if x],
            "spaces": [m.space(s) for s in f.affected_ids + f.highlight_path + f.highlight_ids if m.space(s)]}


@router.get("/design/pages/{page_number}")
def page(page_number: int, design_id: str, zoom: float = Query(1.0, gt=0.05, le=8.0),
         clip: Optional[str] = Query(None, description="x0,y0,x1,y1 in page units")):
    e = _entry(design_id)
    c = tuple(float(v) for v in clip.split(",")) if clip else None
    if c and ((c[2] - c[0]) * zoom * (c[3] - c[1]) * zoom > 40e6):
        raise HTTPException(400, "Requested render too large")
    if e.source_type == "pdf" and e.pdf:
        if not 0 <= page_number < e.pdf.page_count:
            raise HTTPException(404, "No such page")
        png = e.pdf.render_png(page_number, zoom, c)
        return Response(png, media_type="image/png", headers={"Cache-Control": "max-age=3600"})
    if e.source_type == "image" and e.source_path:
        import cv2

        img = cv2.imread(str(e.source_path))
        if c:
            img = img[int(c[1]):int(c[3]), int(c[0]):int(c[2])]
        img = cv2.resize(img, None, fx=zoom, fy=zoom, interpolation=cv2.INTER_AREA if zoom < 1 else cv2.INTER_LINEAR)
        ok, buf = cv2.imencode(".png", img)
        return Response(buf.tobytes(), media_type="image/png")
    raise HTTPException(404, "This design has no drawing (structured JSON data only)")
