from backend.data.synthetic.generate import EXPECTED, build
from backend.engineering.spatial_graph import SINK, build_graph, independent_routes, shortest_escape_path, with_sink
from backend.models.finding_models import FindingStatus
from backend.services.analysis_service import analyze
from backend.tests.conftest import by_space


def test_graph_construction(synthetic_model):
    G = build_graph(synthetic_model)
    assert G.number_of_nodes() == len(synthetic_model.spaces) + len(synthetic_model.escape_points)
    assert G.has_edge("CABIN_OK", "COR_A")
    assert G.has_edge("STAIR_1", "OPEN_1")            # vertical link
    assert G["CABIN_OK"]["COR_A"]["type"] == "door"
    H = with_sink(G)
    assert all(H.has_edge(e.id, SINK) for e in synthetic_model.escape_points)


def test_pathfinding(synthetic_model):
    H = with_sink(build_graph(synthetic_model))
    assert shortest_escape_path(H, "CABIN_OK") == ["CABIN_OK", "COR_A", "OPEN_2", "E_OPEN_2"]
    assert shortest_escape_path(H, "CABIN_DISC") is None
    assert independent_routes(H, "COR_A") == 2
    assert independent_routes(H, "COR_END") == 1


def test_expected_escape_statuses(synthetic_result):
    got = by_space(synthetic_result, "escape")
    for sid, status in EXPECTED["escape"].items():
        assert got[sid].status.value == status, sid


def test_connected_room_has_path_evidence(synthetic_result):
    f = by_space(synthetic_result, "escape")["CABIN_OK"]
    assert f.highlight_path[0] == "CABIN_OK" and f.highlight_path[-1].startswith("E_")
    assert any(sf.kind == "relationship" for sf in f.supporting_facts)


def test_disconnected_room_lists_component(synthetic_result):
    f = by_space(synthetic_result, "escape")["CABIN_DISC"]
    assert f.status == FindingStatus.POTENTIAL_CONNECTIVITY_ISSUE
    assert set(f.highlight_ids) == {"CABIN_DISC", "STORE_X"}
    assert "not proof" in f.risk_explanation


def test_missing_door_is_inconclusive(synthetic_result):
    f = by_space(synthetic_result, "escape")["CABIN_NODOOR"]
    assert f.status == FindingStatus.INCONCLUSIVE
    assert f.missing_information


def test_dead_end_corridor_names_choke_point(synthetic_result):
    f = by_space(synthetic_result, "escape")["COR_END"]
    assert "dead-end" in f.title
    assert "STAIR_3" in f.highlight_ids


def test_missing_escape_points_gives_inconclusive_not_issue():
    r = analyze(build(False, "no_esc"))
    esc = [f for f in r.findings if f.engine.value == "escape_route_connectivity"]
    assert esc and all(f.status == FindingStatus.INCONCLUSIVE for f in esc)


def test_synthetic_findings_are_labelled_synthetic(synthetic_result):
    assert all(f.data_origin.value == "synthetic" for f in synthetic_result.findings)
