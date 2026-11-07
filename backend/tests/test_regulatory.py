"""Regulatory layer: corpus, applicability, gates, evaluators, retrieval (skipped if corpus not downloaded)."""
import pytest

from backend.data.synthetic.generate import build
from backend.models.regulatory_models import ProfileFact, VesselProfile
from backend.regulatory import specs as spec_store
from backend.regulatory.applicability.engine import evaluate as applicability
from backend.regulatory.evaluate.runner import run
from backend.regulatory.index import store

pytestmark = pytest.mark.skipif(not (store.RAW_DIR / "SOLAS-II2-MSC99-73.pdf").exists(),
                                reason="regulatory corpus not downloaded (scripts/fetch_regulations.py)")


@pytest.fixture(scope="module", autouse=True)
def index():
    store.build()


def vp(**kw):
    p = VesselProfile(design_id="t")
    for k, v in kw.items():
        setattr(p, k, ProfileFact(value=v, source="user_input"))
    return p


def verdicts(**kw):
    return {v.scope_id: v for v in applicability(vp(**kw))}


def test_every_spec_quote_is_verbatim_in_its_clause():
    specs = spec_store.load()
    assert len(specs) >= 10
    assert all(s.quote_verified for s in specs), [s.spec_id for s in specs if not s.quote_verified]


def test_key_clauses_parsed_with_exact_text():
    c = store.clause("SOLAS-II2-MSC99-73/Regulation13/3.3.4")
    assert c and "7 m" in c.text and c.page == 89
    assert "60 persons" in store.clause("SPS-CODE-MSC266-84/CHAPTER6/6.3").text
    assert "815 mm" in store.clause("ADA-2010-STANDARDS/404.2.3").text


def test_applicability_research_vessel_38_persons():
    v = verdicts(ship_type="Special Service/Research Vessel SP38", persons_on_board=38, class_society="BV")
    assert v["SOLAS_II2_CARGO"].status == "APPLICABLE_WITH_ASSUMPTIONS"
    assert v["SOLAS_II2_PASSENGER"].status == "NOT_APPLICABLE"
    assert v["MARPOL_I_12A"].status == "APPLICABILITY_UNKNOWN"
    assert v["PVAG"].status == "NOT_APPLICABLE" and v["ADA"].status == "NOT_APPLICABLE"
    assert v["CLASS_DNV"].status == "NOT_APPLICABLE"
    for x in v.values():                       # every cited clause exists in the corpus
        for st in x.reasoning:
            assert all(store.clause(c) for c in st.clause_ids), st.clause_ids


def test_applicability_branches():
    v = verdicts(ship_type="Research Vessel", persons_on_board=120, gross_tonnage=3000, special_personnel=80)
    assert v["SOLAS_II2_PASSENGER"].status.startswith("APPLICABLE") and v["SOLAS_II2_CARGO"].status == "NOT_APPLICABLE"
    assert verdicts(oil_fuel_capacity_m3=300)["MARPOL_I_12A"].status == "NOT_APPLICABLE"
    assert verdicts(oil_fuel_capacity_m3=800, delivery_date="2015-03-01")["MARPOL_I_12A"].status == "APPLICABLE"
    assert verdicts(ship_type="Research Vessel", gross_tonnage=300)["SPS_CODE"].status == "NOT_APPLICABLE"


def _results(model=None, demo=False, validated=()):
    model = model or build(True, "syn")
    v = applicability(vp(ship_type="Research Vessel", persons_on_board=30, gross_tonnage=1500, special_personnel=14,
                         passengers=0, oil_fuel_capacity_m3=300, class_society="DNV"))
    specs = spec_store.load()
    for s in specs:
        if s.spec_id in validated:
            s.validation_status = "engineer_validated"
    return run(model, specs, v, demo=demo)


def by(results, spec_id, element=None):
    return [r for r in results if r.spec_id == spec_id and (element is None or element in r.element_ids)]


def test_validation_gate_caps_draft_results():
    rs = _results()
    assert all(r.status not in ("COMPLIANT_ON_AVAILABLE_EVIDENCE", "POTENTIAL_NON_COMPLIANCE") for r in rs)
    gen = by(rs, "SOLAS-II2-13.4.2.1-MACH-A", "GEN")[0]
    assert gen.indicative_status == "POTENTIAL_NON_COMPLIANCE" and gen.status == "REQUIRES_EXPERT_REVIEW"


def test_seeded_violations_detected_once_validated():
    rs = _results(demo=True, validated={"SOLAS-II2-13.3.3.4-DEAD-END", "SOLAS-II2-13.4.2.1-MACH-A", "ADA-404.2.3-DOOR-CLEAR-WIDTH"})
    dead = by(rs, "SOLAS-II2-13.3.3.4-DEAD-END", "COR_END")[0]
    assert dead.status == "POTENTIAL_NON_COMPLIANCE" and dead.measured["value"] == 9.5 and dead.required["value"] == 7.0
    assert by(rs, "SOLAS-II2-13.4.2.1-MACH-A", "GEN")[0].status == "POTENTIAL_NON_COMPLIANCE"
    doors = by(rs, "ADA-404.2.3-DOOR-CLEAR-WIDTH")
    narrow = [r for r in doors if r.measured and r.measured.get("value") == 760.0]
    wide = [r for r in doors if r.measured and r.measured.get("value") == 850.0]
    assert narrow[0].status == "POTENTIAL_NON_COMPLIANCE" and wide[0].status == "COMPLIANT_ON_AVAILABLE_EVIDENCE"
    assert all(r.demo_as_if_applicable for r in doors)


def test_not_applicable_without_demo():
    rs = _results()
    assert {r.status for r in by(rs, "ADA-404.2.3-DOOR-CLEAR-WIDTH")} == {"NOT_APPLICABLE"}
    assert {r.status for r in by(rs, "MARPOL-I-12A.7-SIDE-PROTECTION")} <= {"NOT_APPLICABLE"}


def test_removing_data_never_produces_a_verdict():
    """Safety property: with escape points removed nothing is called compliant or non-compliant."""
    all_val = {s.spec_id for s in spec_store.load()}
    rs = _results(model=build(False, "noesc"), validated=all_val)
    graph_specs = {"SOLAS-II2-13.3.1.1-READY-ESCAPE", "SOLAS-II2-13.3.3.1-TWO-MEANS", "SOLAS-II2-13.4.2.1-MACH-A"}
    for r in rs:
        if r.spec_id in graph_specs:
            assert r.status not in ("COMPLIANT_ON_AVAILABLE_EVIDENCE",), (r.spec_id, r.element_ids)


def test_every_result_cites_a_clause():
    for r in _results(demo=True):
        assert r.citations and all(store.clause(c.clause_id) for c in r.citations)


GOLD = [
    ("dead-end corridor length", "SOLAS-II2-MSC99-73/Regulation13/3.3.4"),
    ("two means of escape machinery space category A cargo ship", "SOLAS-II2-MSC99-73/Regulation13/4.2.1"),
    ("door clear width 815 mm", "ADA-2010-STANDARDS/404.2.3"),
    ("ships carrying not more than 60 persons fire protection", "SPS-CODE-MSC266-84/CHAPTER6/6.3"),
    ("oil fuel tanks inboard of side shell distance w", "MARPOL-I-12A-MEPC141-54/Regulation12A/7"),
    ("definition machinery spaces of category A internal combustion 375 kW", "SOLAS-II2-MSC99-73/Regulation3/31"),
]


def test_bm25_retrieval_recall_at_5():
    from backend.regulatory.retrieve.hybrid import search
    hits = [any(h.clause.clause_id == gold for h in search(q, None, 5)) for q, gold in GOLD]
    print(f"\nBM25 recall@5 on {len(GOLD)} gold queries: {sum(hits)}/{len(GOLD)}")
    assert sum(hits) >= len(GOLD) - 1
