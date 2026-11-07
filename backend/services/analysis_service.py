"""Run the three safety engines on an EngineeringModel."""
from __future__ import annotations

from backend.compliance import escape_route_checker, fire_proximity_checker, hazardous_space_checker
from backend.compliance.common import Ctx
from backend.engineering.spatial_graph import build_graph, node_link, with_sink
from backend.models.engineering_models import EngineeringModel
from backend.models.finding_models import AnalysisResult


def analyze(model: EngineeringModel) -> AnalysisResult:
    G = build_graph(model)
    H = with_sink(G)
    ctx = Ctx(model, G, H)
    summaries, findings = [], []
    for engine in (escape_route_checker, hazardous_space_checker, fire_proximity_checker):
        s, f = engine.run(ctx)
        summaries.append(s)
        findings += f
    return AnalysisResult(design_id=model.document.design_id, scenario=model.scenario,
                          summaries=summaries, findings=findings, graph=node_link(G))
