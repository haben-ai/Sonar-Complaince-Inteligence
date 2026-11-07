from __future__ import annotations

import networkx as nx

from backend.models.engineering_models import (
    BBox,
    DataOrigin,
    EngineeringModel,
    Provenance,
    Space,
    SpaceKind,
)
from backend.models.finding_models import SupportingFact


class Ctx:
    """Shared lookups for the engines."""

    def __init__(self, model: EngineeringModel, G: nx.Graph, H: nx.Graph):
        self.m = model
        self.G = G
        self.H = H
        self.spaces = {s.id: s for s in model.spaces}
        self.escapes = {e.id: e for e in model.escape_points}
        self.doors = {d.id: d for d in model.doors}
        self.decks = {d.id: d for d in model.decks}
        self.conns = {c.id: c for c in model.connections}
        self.doors_of: dict[str, list] = {}
        for d in model.doors:
            for s in d.space_ids:
                self.doors_of.setdefault(s, []).append(d)

    def name(self, nid: str) -> str:
        if nid in self.spaces:
            s = self.spaces[nid]
            label = s.name or s.kind.value.replace("_", " ")
            deck = self.decks.get(s.deck_id)
            return f"{label} ({deck.name if deck else s.deck_id})"
        if nid in self.escapes:
            e = self.escapes[nid]
            return f"escape point '{e.label}' [{e.kind.value}]"
        return nid

    def origin(self, *ids: str) -> DataOrigin:
        if self.m.document.data_origin == DataOrigin.SYNTHETIC:
            return DataOrigin.SYNTHETIC
        if self.m.scenario and set(ids) & set(self.m.scenario_affected_ids):
            return DataOrigin.SYNTHETIC
        for i in ids:
            s = self.spaces.get(i)
            if s and s.provenance == Provenance.MANUAL_ANNOTATION:
                return DataOrigin.MANUAL_ANNOTATION
            e = self.escapes.get(i)
            if e and e.provenance == Provenance.MANUAL_ANNOTATION:
                return DataOrigin.MANUAL_ANNOTATION
        return self.m.document.data_origin

    def path_origin(self, path: list[str]) -> DataOrigin:
        if not path:
            return self.m.document.data_origin
        o = self.origin(*path)
        if o != DataOrigin.ACTUAL_PDF:
            return o
        for u, v in zip(path, path[1:]):
            d = self.G.get_edge_data(u, v) or {}
            if d.get("provenance") == Provenance.MANUAL_ANNOTATION.value:
                return DataOrigin.MANUAL_ANNOTATION
            if d.get("provenance") == Provenance.SYNTHETIC.value:
                return DataOrigin.SYNTHETIC
        return o

    def path_facts(self, path: list[str]) -> list[SupportingFact]:
        facts = []
        for u, v in zip(path, path[1:]):
            d = self.G.get_edge_data(u, v) or {}
            cids = d.get("connection_ids", [])
            ev = [e for cid in cids for e in self.conns[cid].evidence_ids] if cids else []
            kind = d.get("type", "?")
            txt = {
                "door": "door symbol connects",
                "vertical_stair": "stair (UP/DN markers matched across decks, inferred) connects",
                "escape_access": "escape point located in",
                "opening": "opening connects",
            }.get(kind, kind)
            cert = d.get("certainty", "")
            facts.append(SupportingFact(
                kind="relationship",
                statement=f"{self.name(u)} -> {self.name(v)}: {txt} ({cert})",
                provenance=d.get("provenance", ""),
                evidence_ids=ev,
            ))
        return facts

    def bbox_of(self, nid: str) -> BBox | None:
        if nid in self.spaces:
            return self.spaces[nid].bbox
        if nid in self.escapes:
            return self.escapes[nid].bbox
        return None

    def component_has_unlinked_stair(self, sid: str) -> bool:
        """True if the space's connected group (which has no escape point) contains a stair.

        A stair always leads somewhere; if the group still reaches no escape point, the stair's
        onward connection was not identified in the extraction, so the result is inconclusive
        rather than a potential issue."""
        comp = nx.node_connected_component(self.G, sid)
        return any(self.spaces.get(n) is not None and self.spaces[n].kind == SpaceKind.STAIR for n in comp)


def space_facts(s: Space) -> list[SupportingFact]:
    out = [SupportingFact(kind="classification",
                          statement=f"Space type '{s.kind.value}' - {s.kind_basis}",
                          provenance=s.provenance.value, evidence_ids=s.evidence_ids)]
    if s.computed_area_m2:
        msg = f"Extracted polygon area {s.computed_area_m2:.1f} m2"
        if s.labelled_area_m2:
            msg += f" (drawing label states {s.labelled_area_m2:g} m2)"
        out.append(SupportingFact(kind="measurement", statement=msg, provenance="derived_geometry", evidence_ids=s.evidence_ids[:1]))
    return out
