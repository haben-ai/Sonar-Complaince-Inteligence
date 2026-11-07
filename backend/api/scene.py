"""3D scene data: extracted deck-plan spaces extruded at their deck elevations.

This is NOT a 3D model of the ship. Every prism is a room outline extracted from the 2D GA
(provenance derived_geometry / ocr / manual), placed at the deck height read from the drawing
and extruded to the next deck. Decks are only placed in 3D when they share a common frame /
centreline reference (frame-number rows); otherwise the scene reports why it is unavailable.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException

from backend.services import store

router = APIRouter(prefix="/api", tags=["scene"])

RED = {"POTENTIAL_CONNECTIVITY_ISSUE", "POTENTIAL_NON_COMPLIANCE"}
AMBER = {"INCONCLUSIVE", "INSUFFICIENT_EVIDENCE", "REQUIRES_EXPERT_REVIEW", "APPLICABILITY_UNKNOWN"}
GREEN = {"CONNECTIVITY_VERIFIED", "COMPLIANT_ON_AVAILABLE_EVIDENCE"}
RANK = {"red": 3, "amber": 2, "green": 1, "none": 0}


def _band(status: str) -> str:
    return "red" if status in RED else "amber" if status in AMBER else "green" if status in GREEN else "none"


@router.get("/design/scene3d")
def scene3d(design_id: str, scenario: Optional[str] = None, demo: bool = False):
    try:
        e = store.get(design_id)
    except KeyError:
        raise HTTPException(404, "Unknown design")
    if e.status != "ready":
        raise HTTPException(409, f"Design is {e.status}")
    m = store.model_for(design_id, scenario)
    res = store.analyze(design_id, scenario)

    # worst status per space from engine findings (primary element) and regulatory results
    status: dict[str, dict] = {}

    def note(sid, st, ref, kind):
        b = _band(st)
        cur = status.setdefault(sid, {"band": "none", "refs": []})
        cur["refs"].append({"id": ref, "kind": kind, "status": st, "band": b})
        if RANK[b] > RANK[cur["band"]]:
            cur["band"] = b

    for f in res.findings:
        if f.affected_ids:
            note(f.affected_ids[0], f.status.value, f.id, "finding")
    try:
        from backend.regulatory import service

        for r in service.evaluate(design_id, scenario, demo)["results"]:
            if r.element_ids and r.status != "NOT_APPLICABLE":
                note(r.element_ids[0], r.status, r.result_id, "regulatory")
    except Exception:
        pass  # regulatory corpus not available: engine findings only

    placeable = [d for d in m.decks if d.scale and d.frame0_x is not None and d.centerline_y is not None and d.elevation_mm is not None]
    if not placeable:
        return {"available": False, "design_id": design_id,
                "reason": ("The decks in this drawing are separate views without a shared frame-number / centreline reference, "
                           "so they cannot be placed in 3D without guessing their alignment. Use the 2D sheet viewer."),
                "decks": [], "spaces": []}
    placeable.sort(key=lambda d: d.elevation_mm)
    decks_out, spaces_out = [], []
    for i, d in enumerate(placeable):
        z0 = d.elevation_mm / 1000
        nxt = placeable[i + 1].elevation_mm / 1000 if i + 1 < len(placeable) else None
        h = round(min(max((nxt - z0) - 0.15, 1.8), 4.5), 2) if nxt else 2.6
        mpu = d.scale.metres_per_unit

        def to_ship(x, y, d=d, mpu=mpu):
            # x: metres from frame 0 (forward positive); y: metres from centreline (drawing 'down' = negative)
            return (round((x - d.frame0_x) * mpu, 3), round(-(y - d.centerline_y) * mpu, 3))

        xs = [to_ship(d.bbox.x0, d.centerline_y)[0], to_ship(d.bbox.x1, d.centerline_y)[0]]
        decks_out.append({"id": d.id, "name": d.name, "z": z0, "height": h, "x_range": sorted(xs),
                          "elevation_label": d.elevation_label, "height_basis": "to next deck elevation (drawing)" if nxt else "assumed 2.6 m (top deck)"})
        for s in m.spaces:
            if s.deck_id != d.id or len(s.polygon) < 3:
                continue
            st = status.get(s.id, {"band": "none", "refs": []})
            spaces_out.append({
                "id": s.id, "deck_id": d.id, "name": s.name, "kind": s.kind.value,
                "hazard": s.hazard.category if s.hazard else None,
                "polygon": [to_ship(x, y) for x, y in s.polygon], "z": z0, "height": h,
                "band": st["band"], "refs": st["refs"][:12], "provenance": s.provenance.value,
                "geometry_resolved": not any("GEOMETRY NOT RESOLVED" in n for n in s.notes),
            })
    return {
        "available": True, "design_id": design_id, "units": "m",
        "axes": "x = forward from frame 0, y = transverse from centreline, z = height above baseline",
        "basis": ("Extruded from room outlines extracted from the 2D General Arrangement. Deck heights from drawing labels; "
                  "prism height = distance to the next deck. Not a 3D model: no hull surface, structure, piping or HVAC."),
        "decks": decks_out, "spaces": spaces_out,
        "skipped_decks": [d.name for d in m.decks if d not in placeable],
    }
