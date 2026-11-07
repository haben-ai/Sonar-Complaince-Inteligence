"""Checks on the real DANA V GA extraction (skipped if the PDF is not present).

These are consistency checks against facts printed on the drawing itself, not an
accuracy benchmark.
"""
import re
import statistics

from backend.models.engineering_models import Provenance, SpaceKind
from backend.models.finding_models import FindingStatus


def test_decks_and_scale_cross_checked(dana_model):
    names = {d.name for d in dana_model.decks}
    assert {"MAIN DECK", "TRAWL DECK", "SHELTER DECK", "FORECASTLE DECK", "TANKTOP"} <= names
    for d in dana_model.decks:
        assert d.scale is not None
        assert abs(d.scale.metres_per_unit - 150 * 25.4 / 72 / 1000) < 1e-6
        assert "deviation" in d.scale.cross_check


def test_polygon_areas_agree_with_labelled_areas(dana_model):
    """Rooms that carry an area label: extracted polygon area should be close to it."""
    devs = [abs(s.computed_area_m2 - s.labelled_area_m2) / s.labelled_area_m2
            for s in dana_model.spaces
            if s.labelled_area_m2 and s.computed_area_m2 and not any("Several labels" in n for n in s.notes)]
    assert len(devs) >= 30
    assert statistics.median(devs) < 0.20
    print(f"\nlabelled-area check: n={len(devs)}, median deviation {statistics.median(devs)*100:.1f} %, "
          f"within 25 %: {sum(d < 0.25 for d in devs)}/{len(devs)}")


def test_door_widths_are_derived_and_traceable(dana_model):
    assert len(dana_model.doors) > 50
    ev = dana_model.evidence_by_id()
    for d in dana_model.doors:
        assert d.evidence_ids and all(e in ev for e in d.evidence_ids)
        assert ev[d.evidence_ids[0]].source == Provenance.PDF_VECTOR
        if d.leaf_width_mm is not None:
            assert 450 <= d.leaf_width_mm <= 1700


def test_no_fabricated_fire_ratings(dana_model):
    fd = dana_model.fire_documentation
    assert not fd.fire_control_plan_available
    assert not [m for m in fd.matches if re.fullmatch(r"[ABCH]-\d+", m["text"].split()[0])]
    for a in dana_model.adjacencies:
        assert not hasattr(a, "fire_rating")


def test_evidence_references_resolve(dana_model):
    ev = dana_model.evidence_by_id()
    for s in dana_model.spaces:
        assert all(e in ev for e in s.evidence_ids)
    for c in dana_model.connections:
        assert all(e in ev for e in c.evidence_ids)
    for a in dana_model.adjacencies:
        assert all(e in ev for e in a.evidence_ids)


def test_manual_annotations_are_marked(dana_model):
    manual = [s for s in dana_model.spaces if s.provenance == Provenance.MANUAL_ANNOTATION]
    assert manual and all(any("MANUAL ANNOTATION" in n for n in s.notes) for s in manual)


def test_known_layout_facts(dana_model, dana_result):
    """Facts visible on the drawing: shelter-deck cabins open onto a corridor that reaches the open fore deck."""
    shelter_cabins = [s for s in dana_model.spaces if s.deck_id == "DECK_SHELTER" and s.kind == SpaceKind.ACCOMMODATION]
    assert len(shelter_cabins) >= 14
    esc = {f.affected_ids[0]: f for f in dana_result.findings if f.engine.value == "escape_route_connectivity"}
    verified = [c for c in shelter_cabins if esc[c.id].status == FindingStatus.CONNECTIVITY_VERIFIED]
    assert len(verified) >= 14
    labels = {s.name for s in dana_model.spaces if s.hazard}
    assert {"BATTERY ROOM", "PAINT LOCKER", "GENERATOR ROOM", "GALLEY"} <= labels


def test_no_unsupported_compliance_claims(dana_result):
    bad = re.compile(r"\b(is compliant|complies with|non-compliant|meets the requirement|certif)", re.I)
    for f in dana_result.findings:
        text = " ".join([f.title, f.observation, f.risk_explanation, f.recommended_action])
        assert not bad.search(text), (f.id, text)
