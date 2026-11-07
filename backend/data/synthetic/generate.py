"""Generate SYNTHETIC test designs with known expected outcomes.

    .venv/bin/python -m backend.data.synthetic.generate

Geometry is a simple 1 unit = 0.1 m grid so the dashboard can draw the layouts. Every
element is marked provenance=synthetic and the document data_origin=synthetic.
"""
from __future__ import annotations

import json
from pathlib import Path

from backend.engineering.hazard_classifier import classify_label
from backend.models.engineering_models import (
    Adjacency, AdjacencyRelation, BBox, Connection, ConnectionType, DataOrigin, Deck, DesignDocument, Door,
    EngineeringModel, EscapePoint, EscapePointKind, Evidence, FireSafetyDocumentation, Provenance, ScaleInfo, Space,
    SpaceKind,
)

HERE = Path(__file__).parent
SYN = Provenance.SYNTHETIC


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def build(with_escape_points: bool = True, name="synthetic_test_ship") -> EngineeringModel:
    scale = ScaleInfo(metres_per_unit=0.1, basis="synthetic grid, 1 unit = 0.1 m")
    d1 = Deck(id="DECK_1", name="DECK 1", bbox=BBox(x0=0, y0=0, x1=400, y1=120), elevation_mm=3000, scale=scale,
              frame0_x=0, centerline_y=60, units_per_frame=6)
    d2 = Deck(id="DECK_2", name="DECK 2", bbox=BBox(x0=0, y0=140, x1=400, y1=260), elevation_mm=6000, scale=scale,
              frame0_x=0, centerline_y=200, units_per_frame=6)
    spec = [
        # id, deck, label, rect, expected (documentation only)
        ("CABIN_OK", d1, "CABIN 2 PERS.", (10, 10, 60, 50)),
        ("CABIN_DISC", d1, "CABIN 1 PERS.", (70, 10, 120, 50)),
        ("STORE_X", d1, "GENERAL STORE", (70, 55, 120, 70)),
        ("CABIN_NODOOR", d1, "CABIN 1 PERS.", (130, 10, 180, 50)),
        ("COR_A", d1, None, (10, 55, 60, 70)),
        ("COR_DEAD", d1, None, (190, 55, 300, 70)),
        ("BATTERY", d1, "BATTERY ROOM", (10, 75, 60, 110)),
        ("PAINT", d1, "PAINT LOCKER", (130, 75, 180, 110)),
        ("GEN", d1, "GENERATOR ROOM", (190, 75, 300, 110)),
        ("STAIR_1", d1, None, (310, 55, 330, 70)),
        ("CABIN_S", d1, "CABIN 1 PERS.", (340, 10, 390, 50)),
        ("STAIR_2", d1, None, (340, 55, 360, 70)),
        ("OPEN_2", d1, "OPEN DECK", (10, 112, 60, 119)),
        ("OPEN_1", d2, "OPEN DECK", (300, 150, 390, 250)),
        ("MESS", d2, "MESS", (190, 150, 290, 200)),
        ("COR_END", d2, None, (10, 150, 120, 165)),
        ("CABIN_E", d2, "CABIN 1 PERS.", (10, 170, 60, 210)),
        ("STAIR_3", d2, None, (125, 150, 145, 165)),
    ]
    spaces, ev = [], []
    for sid, deck, label, r in spec:
        kind, basis, hz = classify_label(label)
        if label is None:
            kind = SpaceKind.STAIR if sid.startswith("STAIR") else SpaceKind.CORRIDOR
            basis = "synthetic definition"
        if hz:
            hz.classification_source = SYN
        e = Evidence(id=f"EV_{sid}", page=0, bbox=BBox(x0=r[0], y0=r[1], x1=r[2], y1=r[3]), source=SYN,
                     method="synthetic test geometry", text=label)
        ev.append(e)
        spaces.append(Space(id=sid, deck_id=deck.id, name=label, labels=[label] if label else [], kind=kind,
                            kind_basis=basis, polygon=rect(*r), bbox=e.bbox, hazard=hz,
                            computed_area_m2=(r[2] - r[0]) * (r[3] - r[1]) * 0.01, provenance=SYN, evidence_ids=[e.id]))
    doors_spec = [
        ("D1", "CABIN_OK", "COR_A", (30, 50, 38, 55)),
        ("D2", "CABIN_DISC", "STORE_X", (90, 50, 98, 55)),
        ("D3", "COR_A", "COR_DEAD", (60, 58, 66, 66)),     # long synthetic corridor link
        ("D4", "BATTERY", "COR_A", (30, 70, 38, 75)),
        ("D5", "GEN", "COR_DEAD", (240, 70, 248, 75)),
        ("D6", "COR_A", "OPEN_2", (20, 110, 28, 112)),
        ("D7", "COR_DEAD", "STAIR_1", (300, 58, 310, 66)),
        ("D8", "CABIN_S", "STAIR_2", (345, 50, 353, 55)),
        ("D10", "CABIN_E", "COR_END", (30, 165, 38, 170)),
        ("D11", "COR_END", "STAIR_3", (120, 152, 125, 160)),
    ]
    doors, conns = [], []
    for did, a, b, r in doors_spec:
        e = Evidence(id=f"EV_{did}", page=0, bbox=BBox(x0=r[0], y0=r[1], x1=r[2], y1=r[3]), source=SYN, method="synthetic door")
        ev.append(e)
        cw = {"D1": 850.0, "D8": 760.0}.get(did)
        doors.append(Door(id=did, deck_id="DECK_1", bbox=e.bbox, space_ids=[a, b], resolution="resolved",
                          clear_width_mm=cw, clear_width_source="synthetic door schedule" if cw else None,
                          provenance=SYN, evidence_ids=[e.id]))
        conns.append(Connection(id=f"C_{did}", source=a, target=b, type=ConnectionType.DOOR, door_id=did,
                                provenance=SYN, certainty="synthetic", evidence_ids=[e.id]))
    conns.append(Connection(id="C_V1", source="STAIR_1", target="OPEN_1", type=ConnectionType.VERTICAL_STAIR,
                            provenance=SYN, certainty="synthetic"))
    conns.append(Connection(id="C_V2", source="STAIR_3", target="COR_A", type=ConnectionType.VERTICAL_STAIR,
                            provenance=SYN, certainty="synthetic"))
    conns.append(Connection(id="C_D9", source="MESS", target="OPEN_1", type=ConnectionType.DOOR, provenance=SYN, certainty="synthetic"))
    escapes = []
    if with_escape_points:
        for sid in ("OPEN_1", "OPEN_2"):
            s = next(x for x in spaces if x.id == sid)
            escapes.append(EscapePoint(id=f"E_{sid}", deck_id=s.deck_id, kind=EscapePointKind.OPEN_DECK, space_id=sid,
                                       bbox=s.bbox, label="OPEN DECK", provenance=SYN, evidence_ids=s.evidence_ids))
            conns.append(Connection(id=f"C_E_{sid}", source=sid, target=f"E_{sid}", type=ConnectionType.ESCAPE_ACCESS,
                                    provenance=SYN, certainty="synthetic"))
    # synthetic measurements (what extraction would compute from geometry)
    for sp in spaces:
        if sp.id == "COR_END":
            sp.measurements["max_travel_from_door_m"] = {"values": {"D10": 2.0, "D11": 9.5}, "unit": "m", "provenance": "synthetic"}
        if sp.id == "COR_A":
            sp.measurements["max_travel_from_door_m"] = {"values": {"D3": 4.0, "D6": 5.0}, "unit": "m", "provenance": "synthetic"}
    adj = [
        Adjacency(id="ADJ_1", space_a="BATTERY", space_b="COR_A", relation=AdjacencyRelation.SHARED_BOUNDARY, shared_length_m=5.0, provenance=SYN, certainty="synthetic"),
        Adjacency(id="ADJ_2", space_a="BATTERY", space_b="CABIN_OK", relation=AdjacencyRelation.SHARED_BOUNDARY, shared_length_m=5.0, provenance=SYN, certainty="synthetic"),
        Adjacency(id="ADJ_3", space_a="GEN", space_b="MESS", relation=AdjacencyRelation.VERTICAL_OVERLAP, overlap_area_m2=40, provenance=SYN, certainty="synthetic"),
        Adjacency(id="ADJ_4", space_a="GEN", space_b="COR_DEAD", relation=AdjacencyRelation.SHARED_BOUNDARY, shared_length_m=11.0, provenance=SYN, certainty="synthetic"),
    ]
    return EngineeringModel(
        document=DesignDocument(design_id=name, name=f"SYNTHETIC test ship ({'with' if with_escape_points else 'without'} escape points)",
                                source_type="json", data_origin=DataOrigin.SYNTHETIC, page_sizes=[(400, 260)],
                                metadata={"vessel_profile": {"ship_type": "Research Vessel (synthetic)", "class_society": "DNV",
                                                             "persons_on_board": 30, "gross_tonnage": 1500, "special_personnel": 14,
                                                             "passengers": 0, "oil_fuel_capacity_m3": 300}}),
        decks=[d1, d2], spaces=spaces, doors=doors, escape_points=escapes, connections=conns, adjacencies=adj,
        evidence=ev,
        fire_documentation=FireSafetyDocumentation(note="Synthetic design: no fire-integrity information provided."),
        extraction_log=["Synthetic design generated by backend/data/synthetic/generate.py"],
        limitations=["SYNTHETIC test data - not a real ship."],
    )


EXPECTED = {
    "escape": {
        "CABIN_OK": "CONNECTIVITY_VERIFIED",
        "CABIN_DISC": "POTENTIAL_CONNECTIVITY_ISSUE",     # door only into a store with no exit
        "STORE_X": "POTENTIAL_CONNECTIVITY_ISSUE",
        "CABIN_NODOOR": "INCONCLUSIVE",                   # missing door information
        "CABIN_S": "INCONCLUSIVE",                        # stair without known continuation
        "MESS": "CONNECTIVITY_VERIFIED",
        "COR_A": "CONNECTIVITY_VERIFIED",                 # two independent directions (OPEN_2 and via COR_DEAD/stair)
        "COR_DEAD": "CONNECTIVITY_VERIFIED",
        "CABIN_E": "CONNECTIVITY_VERIFIED",
        "COR_END": "POTENTIAL_CONNECTIVITY_ISSUE",       # dead-end: all routes pass through STAIR_3
    },
    "hazard": {
        "BATTERY": "CONNECTIVITY_VERIFIED",
        "PAINT": "INCONCLUSIVE",
        "GEN": "POTENTIAL_CONNECTIVITY_ISSUE",           # single independent route (via COR_DEAD)
    },
}


if __name__ == "__main__":
    for with_e, n in ((True, "synthetic_test_ship"), (False, "synthetic_no_escape_points")):
        m = build(with_e, n)
        (HERE / f"{n}.json").write_text(m.model_dump_json(indent=1))
        print("wrote", n)
