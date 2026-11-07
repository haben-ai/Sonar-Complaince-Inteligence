from backend.compliance.fire_proximity_checker import STANDARD_MSG
from backend.models.finding_models import FindingStatus
from backend.tests.conftest import by_space


def test_adjacent_hazardous_spaces_identified(synthetic_result):
    f = by_space(synthetic_result, "fire")["BATTERY"]
    assert {"CABIN_OK", "COR_A"} <= set(f.affected_ids)
    assert f.status == FindingStatus.INCONCLUSIVE
    assert STANDARD_MSG in f.observation


def test_non_adjacent_spaces_not_listed(synthetic_result):
    f = by_space(synthetic_result, "fire")["BATTERY"]
    assert "MESS" not in f.affected_ids and "PAINT" not in f.affected_ids


def test_vertical_adjacency_reported(synthetic_result):
    f = by_space(synthetic_result, "fire")["GEN"]
    assert "MESS" in f.affected_ids
    assert any("adjacent deck" in sf.statement for sf in f.supporting_facts)


def test_missing_boundary_information(synthetic_result):
    f = by_space(synthetic_result, "fire")["PAINT"]
    assert "boundary information missing" in f.title


def test_fire_engine_never_concludes(synthetic_result):
    fire = [f for f in synthetic_result.findings if f.engine.value == "fire_risk_proximity"]
    assert fire and all(f.status == FindingStatus.INCONCLUSIVE for f in fire)
    assert all(any("Fire-integrity" in m or "Compartment" in m for m in f.missing_information) for f in fire)
