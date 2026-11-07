import pytest

from backend.data.synthetic.generate import EXPECTED, build
from backend.engineering.hazard_classifier import classify_label
from backend.models.engineering_models import SpaceKind
from backend.models.finding_models import FindingStatus
from backend.services.analysis_service import analyze
from backend.tests.conftest import by_space


@pytest.mark.parametrize("label,category", [
    ("BATTERY ROOM", "electrical_battery_hazard"),
    ("GENERATOR ROOM", "machinery_space_combustion_engine"),
    ("PAINT LOCKER", "flammable_liquid_store"),
    ("OXY / GAS", "compressed_gas_store"),
    ("SCI. CHEM. LKR", "chemical_store"),
    ("WELDING WORKSHOP", "hot_work_area"),
    ("MGO", "fuel_oil_tank_or_space"),
])
def test_hazard_vocabulary(label, category):
    _, basis, hz = classify_label(label)
    assert hz is not None and hz.category == category
    assert hz.matched_rule and label in hz.matched_rule
    assert hz.confidence is None   # rules never invent a confidence number


@pytest.mark.parametrize("label", ["DRY LAB", "WET FISH LAB", "EDUCATIONAL LAB", "MESS", "1 PERS.", "LIBRARY"])
def test_labs_and_cabins_are_not_assumed_hazardous(label):
    _, _, hz = classify_label(label)
    assert hz is None


def test_unknown_label_stays_unknown():
    kind, basis, hz = classify_label("XYZ ROOM")
    assert kind == SpaceKind.UNKNOWN and hz is None


def test_expected_hazard_statuses(synthetic_result):
    got = by_space(synthetic_result, "hazardous")
    for sid, status in EXPECTED["hazard"].items():
        assert got[sid].status.value == status, sid


def test_hazard_with_connection_shows_path(synthetic_result):
    f = by_space(synthetic_result, "hazardous")["BATTERY"]
    assert f.highlight_path[-1].startswith("E_")


def test_hazard_without_connection_is_not_called_unsafe(synthetic_result):
    f = by_space(synthetic_result, "hazardous")["PAINT"]
    assert f.status == FindingStatus.INCONCLUSIVE
    assert "unsafe" not in (f.observation + f.title).lower()


def test_missing_escape_point_info():
    r = analyze(build(False, "no_esc"))
    hz = [f for f in r.findings if f.engine.value == "hazardous_space_accessibility"]
    assert hz and all(f.status == FindingStatus.INCONCLUSIVE for f in hz)
