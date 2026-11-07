"""Synthetic modifications of a real extracted design, for demonstrating detection.

Every scenario output is marked: model.scenario is set, and every element whose result can
change because of the modification is listed in scenario_affected_ids, so the UI labels
those findings SYNTHETIC.
"""
from __future__ import annotations

import networkx as nx

from backend.engineering.spatial_graph import build_graph
from backend.models.engineering_models import ConnectionType, EngineeringModel, SpaceKind

SCENARIOS = {
    "blocked_accommodation_exits": {
        "title": "SYNTHETIC: Shelter-deck accommodation corridor with its exits removed",
        "description": "Removes the extracted door connections between the main Shelter-deck accommodation corridor and "
                       "(a) the open fore deck and (b) the stairwell. The cabins around the corridor should then be "
                       "flagged as potentially disconnected.",
    },
    "no_escape_information": {
        "title": "SYNTHETIC: Escape-point information withheld",
        "description": "Removes every identified escape point (ESC markings and open-deck access). Demonstrates that "
                       "missing information yields INCONCLUSIVE results, not a compliance or non-compliance claim.",
    },
}


def apply(model: EngineeringModel, scenario: str) -> EngineeringModel:
    if scenario not in SCENARIOS:
        raise KeyError(scenario)
    m = model.model_copy(deep=True)
    m.scenario = scenario
    m.scenario_description = SCENARIOS[scenario]["description"]
    if scenario == "blocked_accommodation_exits":
        corridors = [s for s in m.spaces if s.deck_id == "DECK_SHELTER" and s.kind == SpaceKind.CORRIDOR]
        if not corridors:
            return m
        cor = max(corridors, key=lambda s: s.computed_area_m2 or 0)
        kinds = {s.id: s.kind for s in m.spaces}
        removed = []
        keep = []
        for c in m.connections:
            other = c.target if c.source == cor.id else c.source if c.target == cor.id else None
            if other and c.type == ConnectionType.DOOR and kinds.get(other) in (SpaceKind.OPEN_DECK, SpaceKind.STAIR):
                removed.append(c.id)
                continue
            keep.append(c)
        m.connections = keep
        G = build_graph(m)
        comp = nx.node_connected_component(G, cor.id) if cor.id in G else {cor.id}
        m.scenario_affected_ids = sorted(comp)
        m.extraction_log.append(f"SCENARIO {scenario}: removed connections {removed} from {cor.id}")
    elif scenario == "no_escape_information":
        ids = {e.id for e in m.escape_points}
        m.escape_points = []
        m.connections = [c for c in m.connections if c.target not in ids and c.source not in ids]
        m.scenario_affected_ids = [s.id for s in m.spaces]
        m.extraction_log.append(f"SCENARIO {scenario}: removed {len(ids)} escape points")
    return m
