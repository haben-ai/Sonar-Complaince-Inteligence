"""The synthetic 9-deck cruise ship: planted deficiencies are found by the normal engines and checks."""
import pytest

from backend.data.synthetic import generate_cruise as g
from backend.models.finding_models import FindingStatus
from backend.services.analysis_service import analyze

POT = FindingStatus.POTENTIAL_CONNECTIVITY_ISSUE


@pytest.fixture(scope="module")
def cruise():
    m = g.build()
    return m, analyze(m)


def flagged(result, engine):
    return {f.affected_ids[0] for f in result.findings if f.engine.value.startswith(engine) and f.status == POT}


def test_nine_decks_placeable_in_3d(cruise):
    m, _ = cruise
    assert len(m.decks) == 9
    assert all(d.scale and d.elevation_mm is not None and d.frame0_x is not None and d.centerline_y is not None for d in m.decks)
    assert m.document.data_origin.value == "synthetic" and all(s.provenance.value == "synthetic" for s in m.spaces)


def test_planted_escape_deficiencies(cruise):
    _, r = cruise
    assert set(g.PLANTED["escape"]) <= flagged(r, "escape")


def test_planted_hazard_deficiencies(cruise):
    _, r = cruise
    expected = {k for k in g.PLANTED["hazard"] if k != "D1_ECR"}     # the ECR rule is a regulatory check, not a hazard engine finding
    assert expected <= flagged(r, "hazard")


def test_planted_fire_deficiencies(cruise):
    _, r = cruise
    fire = {f.affected_ids[0]: f for f in r.findings if f.engine.value.startswith("fire")}
    assert set(g.PLANTED["fire"]) <= flagged(r, "fire")
    eng = fire["D1_ENGINE"]
    assert any("documented 'A-0'" in s.statement and "requires 'A-60'" in s.statement for s in eng.supporting_facts)
    # undocumented boundaries stay inconclusive: no class is assumed
    assert fire["D2_LAUNDRY"].status == FindingStatus.INCONCLUSIVE


def test_rest_of_design_is_mostly_sound(cruise):
    _, r = cruise
    esc = [f for f in r.findings if f.engine.value.startswith("escape")]
    assert sum(f.status == FindingStatus.CONNECTIVITY_VERIFIED for f in esc) > 0.85 * len(esc)


def test_regulatory_violations_three_laws_per_category(cruise):
    from backend.regulatory import specs as S
    from backend.regulatory.applicability import engine as ap
    from backend.regulatory.applicability import vessel_profile as vpm
    from backend.regulatory.evaluate import runner

    m, _ = cruise
    specs = S.load()
    if not all(s.quote_verified for s in specs):
        pytest.skip("regulatory corpus not installed")
    v = ap.evaluate(vpm.build_profile("pytest_cruise", None, m.document.metadata["vessel_profile"]))
    bad = {r.spec_id for r in runner.run(m, specs, v) if r.indicative_status == "POTENTIAL_NON_COMPLIANCE"}
    fire = {"SOLAS-II2-9.2.2.3.1-FIRE-INTEGRITY-PAX", "SOLAS-II2-10.6.3.1-PAINT-LOCKER-PAX", "MARPOL-I-12A.7-SIDE-PROTECTION"}
    escape = {"SOLAS-II2-13.3.1.1-READY-ESCAPE-PAX", "SOLAS-II2-13.3.1.2-ONE-ROUTE-PAX", "SOLAS-II2-13.3.2.2-TWO-MEANS-PAX"}
    hazard = {"SOLAS-II2-13.4.1.1-MACH-PAX", "SOLAS-II2-13.4.1.4-MCR-PAX"}
    assert fire <= bad and escape <= bad and hazard <= bad
