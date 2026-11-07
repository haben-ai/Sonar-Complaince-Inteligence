"""Required fire integrity of divisions for passenger ships carrying more than 36 passengers.

Tables 9.1 (bulkheads) and 9.2 (decks) of SOLAS II-2 reg. 9.2.2.3 (MSC.99(73) text), transcribed row by row
from the stored clause SOLAS-II2-MSC99-73/Regulation9/2.2.3.2. `backend/tests/test_fire_integrity.py` checks
that every transcribed row occurs verbatim in that stored text.

Used only when the design input documents the division class of a boundary (a fire-control / structural fire
protection plan). A GA drawing alone never supplies one, so for GA-only designs nothing here is evaluated.

The mapping from an extracted space to a SOLAS category is a screening interpretation (labels and space type
only, most stringent category where in doubt, as 9.2.2.3.2.2 directs). It is not engineer-validated.
"""
from __future__ import annotations

import re
from typing import Optional

from backend.models.engineering_models import AdjacencyRelation, EngineeringModel, Space, SpaceKind

SOURCE_CLAUSE = "SOLAS-II2-MSC99-73/Regulation9/2.2.3.2"

CATEGORY_NAMES = {
    1: "control station", 2: "stairway", 3: "corridor", 4: "evacuation station / external escape route",
    5: "open deck space", 6: "accommodation of minor fire risk", 7: "accommodation of moderate fire risk",
    8: "accommodation of greater fire risk", 9: "sanitary and similar", 10: "tank / void / auxiliary machinery of little fire risk",
    11: "auxiliary machinery of moderate fire risk", 12: "machinery space / main galley", 13: "store-room / workshop / pantry",
    14: "space in which flammable liquids are stowed",
}

# Table 9.1 is triangular: row i lists columns i..14. Rows (4) and (5) are incomplete in the stored text
# (dash cells lost in extraction), so they are not encoded and return no requirement.
TABLE_9_1_ROWS = {
    1: "B-0a A-0 A-0 A-0 A-0 A-60 A-60 A-60 A-0 A-0 A-60 A-60 A-60 A-60",
    2: "A-0a A-0 A-0 A-0 A-0 A-15 A-15 A-0c A-0 A-15 A-30 A-15 A-30",
    3: "B-15 A-60 A-0 B-15 B-15 B-15 B-15 A-0 A-15 A-30 A-0 A-30",
    6: "B-0 B-0 B-0 C A-0 A-0 A-30 A-0 A-30",
    7: "B-0 B-0 C A-0 A-15 A-60 A-15 A-60",
    8: "B-0 C A-0 A-30 A-60 A-15 A-60",
    9: "C A-0 A-0 A-0 A-0 A-0",
    10: "A-0a A-0 A-0 A-0 A-0",
    11: "A-0a A-0 A-0 A-15",
    12: "A-0a A-0 A-60",
    13: "A-0a A-0",
    14: "A-30",
}
# Table 9.2: full matrix, row = space below, column = space above.
TABLE_9_2_ROWS = {
    1: "A-30 A-30 A-15 A-0 A-0 A-0 A-15 A-30 A-0 A-0 A-0 A-60 A-0 A-60",
    2: "A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-30 A-0 A-30",
    3: "A-15 A-0 A-0a A-60 A-0 A-0 A-15 A-15 A-0 A-0 A-0 A-30 A-0 A-30",
    6: "A-60 A-15 A-0 A-60 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0",
    7: "A-60 A-15 A-15 A-60 A-0 A-0 A-15 A-15 A-0 A-0 A-0 A-0 A-0 A-0",
    8: "A-60 A-15 A-15 A-60 A-0 A-15 A-15 A-30 A-0 A-0 A-0 A-0 A-0 A-0",
    9: "A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0",
    10: "A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0 A-0a A-0 A-0 A-0 A-0",
    11: "A-60 A-60 A-60 A-60 A-0 A-0 A-15 A-30 A-0 A-0 A-0a A-0 A-0 A-30",
    12: "A-60 A-60 A-60 A-60 A-0 A-60 A-60 A-60 A-0 A-0 A-30 A-30a A-0 A-60",
    13: "A-60 A-30 A-15 A-60 A-0 A-15 A-30 A-30 A-0 A-0 A-0 A-0 A-0 A-0",
    14: "A-60 A-60 A-60 A-60 A-0 A-30 A-60 A-60 A-0 A-0 A-0 A-0 A-0 A-0",
}

CLASS_RANK = {"C": 0, "B-0": 1, "B-15": 2, "A-0": 3, "A-15": 4, "A-30": 5, "A-60": 6}
_CLASS = re.compile(r"^(A-60|A-30|A-15|A-0|B-15|B-0|C)")


def _cls(cell: str) -> Optional[str]:
    m = _CLASS.match(cell)
    return m.group(1) if m else None


def _row(s: str) -> list[Optional[str]]:
    return [_cls(c) for c in s.split()]


def required_bulkhead(a: int, b: int) -> Optional[str]:
    i, j = min(a, b), max(a, b)
    row = TABLE_9_1_ROWS.get(i)
    if not row:
        return None
    cells = _row(row)
    k = j - i
    return cells[k] if 0 <= k < len(cells) else None


def required_deck(below: int, above: int) -> Optional[str]:
    row = TABLE_9_2_ROWS.get(below)
    if not row:
        return None
    cells = _row(row)
    return cells[above - 1] if 1 <= above <= len(cells) else None


_HAZARD_CAT = {
    "machinery_space_combustion_engine": 12, "galley_cooking": 12, "flammable_liquid_store": 14, "chemical_store": 14,
    "compressed_gas_store": 14, "electrical_battery_hazard": 10, "electrical_power_equipment": 10,
    "machinery_space_unspecified": 11, "fuel_oil_tank_or_space": 11, "laundry": 13, "waste_store": 13, "hot_work_area": 13,
}
_KIND_CAT = {
    SpaceKind.CONTROL: 1, SpaceKind.STAIR: 2, SpaceKind.CORRIDOR: 3, SpaceKind.OPEN_DECK: 5, SpaceKind.ACCOMMODATION: 6,
    SpaceKind.SANITARY: 9, SpaceKind.TANK_VOID: 10, SpaceKind.TECHNICAL: 10, SpaceKind.MACHINERY: 11,
    SpaceKind.SERVICE: 13, SpaceKind.WORK: 13,
}


def category(s: Space) -> tuple[Optional[int], str]:
    """Screening category of a space for tables 9.1/9.2 (most stringent where in doubt)."""
    if s.hazard and s.hazard.category in _HAZARD_CAT:
        c = _HAZARD_CAT[s.hazard.category]
        return c, f"hazard '{s.hazard.category}' -> category ({c}) {CATEGORY_NAMES[c]}"
    if s.kind == SpaceKind.PUBLIC:
        area = s.computed_area_m2 or s.labelled_area_m2
        c = 8 if area is None or area >= 50 else 7     # furnishings not known: most stringent of the plausible rows
        return c, f"public space{f' of {area:.0f} m2' if area else ''}, furnishings not documented -> category ({c}) {CATEGORY_NAMES[c]}"
    c = _KIND_CAT.get(s.kind)
    if c is None:
        return None, f"space type '{s.kind.value}' has no screening category"
    return c, f"space type '{s.kind.value}' -> category ({c}) {CATEGORY_NAMES[c]}"


def tables_apply(m: EngineeringModel) -> bool:
    """Tables 9.1/9.2 apply to passenger ships carrying more than 36 passengers (reg. 9.2.2.3)."""
    vp = m.document.metadata.get("vessel_profile") or {}
    try:
        return float(vp.get("passengers") or 0) > 36
    except (TypeError, ValueError):
        return False


def has_documented_classes(m: EngineeringModel) -> bool:
    return any(a.fire_integrity for a in m.adjacencies)


def assess(m: EngineeringModel, a, spaces: dict[str, Space]) -> Optional[dict]:
    """Compare the documented class of one boundary with the table class. None when no comparison is possible."""
    sa, sb = spaces.get(a.space_a), spaces.get(a.space_b)
    if not sa or not sb:
        return None
    ca, ba = category(sa)
    cb, bb = category(sb)
    if ca is None or cb is None:
        return {"required": None, "documented": a.fire_integrity, "ok": None,
                "basis": f"{ba}; {bb}", "table": None}
    if a.relation == AdjacencyRelation.VERTICAL_OVERLAP:
        elev = {d.id: d.elevation_mm for d in m.decks}
        ea, eb = elev.get(sa.deck_id), elev.get(sb.deck_id)
        if ea is None or eb is None or ea == eb:
            return {"required": None, "documented": a.fire_integrity, "ok": None, "basis": "deck order unknown", "table": None}
        below, above = (ca, cb) if ea < eb else (cb, ca)
        req, table = required_deck(below, above), f"Table 9.2 (deck), below ({below}) / above ({above})"
    else:
        req, table = required_bulkhead(ca, cb), f"Table 9.1 (bulkhead), ({min(ca, cb)}) / ({max(ca, cb)})"
    doc = a.fire_integrity
    ok = None if (req is None or doc is None or doc not in CLASS_RANK) else CLASS_RANK[doc] >= CLASS_RANK[req]
    return {"required": req, "documented": doc, "ok": ok, "basis": f"{ba}; {bb}", "table": table}
