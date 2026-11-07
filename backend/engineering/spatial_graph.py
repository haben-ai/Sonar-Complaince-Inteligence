"""NetworkX escape-route graph built from the engineering model."""
from __future__ import annotations

import networkx as nx

from backend.models.engineering_models import ConnectionType, EngineeringModel, SpaceKind

SINK = "__ESCAPE_SINK__"

# Prefer routes built from extracted facts; inferred and manual links cost more.
CERTAINTY_WEIGHT = {"extracted": 1.0, "synthetic": 1.0, "inferred": 2.5, "manual": 6.0}


def build_graph(model: EngineeringModel) -> nx.Graph:
    G = nx.Graph()
    for s in model.spaces:
        if s.kind == SpaceKind.TANK_VOID:
            continue
        G.add_node(s.id, node_type="space", kind=s.kind.value, name=s.name, deck=s.deck_id,
                   hazard=s.hazard.category if s.hazard else None, provenance=s.provenance.value)
    for e in model.escape_points:
        G.add_node(e.id, node_type="escape_point", kind=e.kind.value, name=e.label, deck=e.deck_id,
                   provenance=e.provenance.value)
    for c in model.connections:
        if c.source in G and c.target in G:
            if G.has_edge(c.source, c.target):
                G[c.source][c.target]["connection_ids"].append(c.id)
                continue
            G.add_edge(c.source, c.target, type=c.type.value, connection_ids=[c.id], certainty=c.certainty,
                       provenance=c.provenance.value, door_id=c.door_id, weight=CERTAINTY_WEIGHT.get(c.certainty, 1.0))
    return G


def escape_ids(G: nx.Graph) -> list[str]:
    return [n for n, d in G.nodes(data=True) if d.get("node_type") == "escape_point"]


def with_sink(G: nx.Graph) -> nx.Graph:
    H = G.copy()
    H.add_node(SINK)
    for e in escape_ids(G):
        H.add_edge(e, SINK)
    return H


def shortest_escape_path(H: nx.Graph, source: str) -> list[str] | None:
    try:
        p = nx.shortest_path(H, source, SINK, weight="weight")
        return p[:-1]
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None


def independent_routes(H: nx.Graph, source: str) -> int:
    """Number of node-disjoint routes from `source` to any escape point (Menger)."""
    if source not in H or not nx.has_path(H, source, SINK):
        return 0
    if H.has_edge(source, SINK):
        return 1
    return nx.algorithms.connectivity.local_node_connectivity(H, source, SINK)


def node_link(G: nx.Graph) -> dict:
    return {
        "nodes": [{"id": n, **{k: v for k, v in d.items()}} for n, d in G.nodes(data=True)],
        "edges": [{"source": u, "target": v, **d} for u, v, d in G.edges(data=True)],
    }
