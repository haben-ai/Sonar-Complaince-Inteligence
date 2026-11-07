"""Vessel profile: facts that decide which rules apply.

Read from the drawing (title block / principal particulars) where present; everything
else is 'unknown' until the user supplies it (stored per design, provenance user_input).
"""
from __future__ import annotations

import json
import re

from backend.config import settings
from backend.models.regulatory_models import ProfileFact, VesselProfile

USER_FIELDS = ["persons_on_board", "gross_tonnage", "oil_fuel_capacity_m3", "delivery_date", "flag", "special_personnel",
               "passengers", "us_passenger_vessel"]


def _user_path(design_id: str):
    return settings.output_dir / design_id / "vessel_profile_user.json"


def _from_text(text: str) -> dict[str, ProfileFact]:
    f: dict[str, ProfileFact] = {}
    flat = re.sub(r"\s+", " ", text)
    m = re.search(r"(BV|DNV|LR|ABS|BUREAU VERITAS)\s+CLASS\s*:?\s*(.{0,260}?)(?:ACCOMMODATION|$)", flat, re.I)
    if m:
        soc = {"BUREAU VERITAS": "BV"}.get(m.group(1).upper(), m.group(1).upper())
        f["class_society"] = ProfileFact(value=soc, source="drawing_text", evidence_text=m.group(0)[:120])
        notation = m.group(2).strip(" ,")
        f["class_notation"] = ProfileFact(value=notation[:200], source="drawing_text", evidence_text=notation[:200])
        st = re.search(r"(Special Service/Research Vessel[^,]*|Research Vessel[^,]*|Passenger[^,]*|Cargo[^,]*)", notation, re.I)
        if st:
            f["ship_type"] = ProfileFact(value=st.group(1).strip(), source="drawing_text", evidence_text=st.group(1).strip())
    if "ship_type" not in f:
        m = re.search(r"(\d{2,3})\s*['’]\s*-\s*(\d{1,2})\s*[\"”]?\s*(REGIONAL CLASS )?(RESEARCH VESSEL)", flat, re.I)
        m2 = m or re.search(r"\b(RESEARCH VESSEL|PASSENGER (SHIP|VESSEL)|CARGO SHIP|FERRY)\b", flat, re.I)
        if m2:
            st = "Research Vessel" if re.search("RESEARCH", m2.group(0), re.I) else m2.group(1).title()
            f["ship_type"] = ProfileFact(value=st, source="drawing_text", evidence_text=m2.group(0))
        if m:
            loa = (int(m.group(1)) + int(m.group(2)) / 12) * 0.3048
            f["length_overall_m"] = ProfileFact(value=round(loa, 2), source="drawing_text",
                                                evidence_text=f"{m.group(0)} (feet-inches in title, read by OCR; assumed LOA)")
    m = re.search(r"ACCOMMODATION FOR\s+(\d+)\s+PERSONS|(\d{1,3})\s+(?:PERSONS|BERTHS|PERSONNEL)\b", flat, re.I)
    if m:
        f["persons_on_board"] = ProfileFact(value=int(m.group(1) or m.group(2)), source="drawing_text", evidence_text=m.group(0))
    m = re.search(r"LENGTH OVER ALL\s*:?\s*(\d+[,.]\d+)\s*m", flat, re.I)
    if m:
        f["length_overall_m"] = ProfileFact(value=float(m.group(1).replace(",", ".")), source="drawing_text", evidence_text=m.group(0))
    m = re.search(r"BREADTH MLD\s*\.?\s*:?\s*(\d+[,.]\d+)\s*m", flat, re.I)
    if m:
        f["breadth_m"] = ProfileFact(value=float(m.group(1).replace(",", ".")), source="drawing_text", evidence_text=m.group(0))
    return f


def build_profile(design_id: str, drawing_text: str | None, declared: dict | None = None) -> VesselProfile:
    vp = VesselProfile(design_id=design_id)
    facts = _from_text(drawing_text) if drawing_text else {}
    for k, v in (declared or {}).items():          # JSON designs may declare a profile
        if k in VesselProfile.model_fields and k != "design_id":
            facts[k] = ProfileFact(value=v, source="user_input", evidence_text="declared in design data")
    for k, v in facts.items():
        setattr(vp, k, v)
    p = _user_path(design_id)
    if p.exists():
        for k, v in json.loads(p.read_text()).items():
            if v not in (None, ""):
                setattr(vp, k, ProfileFact(value=v, source="user_input", evidence_text="entered by user"))
    return vp


def save_user_facts(design_id: str, values: dict) -> None:
    p = _user_path(design_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    cur = json.loads(p.read_text()) if p.exists() else {}
    cur.update({k: v for k, v in values.items() if k in USER_FIELDS})
    p.write_text(json.dumps(cur, indent=1))
