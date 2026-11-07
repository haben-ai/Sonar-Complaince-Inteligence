"""Safety engine 1: escape-route connectivity (graph connectivity, not evacuation distances)."""
from __future__ import annotations

import networkx as nx

from backend.compliance.common import Ctx, space_facts
from backend.engineering.spatial_graph import independent_routes, shortest_escape_path
from backend.models.engineering_models import OCCUPIED_KINDS, SpaceKind
from backend.models.finding_models import Engine, EngineSummary, Finding, FindingStatus, SupportingFact

REQS_SPACE = ["SYN-ESC-001", "SOLAS-II2-R13-ESCAPE"]
REQS_CORRIDOR = ["SYN-ESC-002", "SOLAS-II2-R13-ESCAPE"]


def run(ctx: Ctx) -> tuple[EngineSummary, list[Finding]]:
    findings: list[Finding] = []
    n_esc = len(ctx.escapes)
    occupied = [s for s in ctx.m.spaces if s.kind in OCCUPIED_KINDS and s.id in ctx.G]
    corridors = [s for s in ctx.m.spaces if s.kind == SpaceKind.CORRIDOR and s.id in ctx.G]
    k = 0

    def fid():
        nonlocal k
        k += 1
        return f"ESC-{k:03d}"

    for s in occupied:
        name = ctx.name(s.id)
        doors = ctx.doors_of.get(s.id, [])
        facts = space_facts(s)
        if n_esc == 0:
            findings.append(Finding(
                id=fid(), engine=Engine.ESCAPE, status=FindingStatus.INCONCLUSIVE,
                title="No escape points identified in the design", affected_ids=[s.id], affected_names=[name],
                deck_id=s.deck_id, location=s.bbox,
                observation="The extracted model contains no escape markings, exits or open-deck access, so no path can be evaluated.",
                risk_explanation="Escape-route connectivity cannot be established without identified escape points.",
                supporting_facts=facts, missing_information=["Escape-route / fire & safety plan identifying exits and escape routes"],
                recommended_action="Provide the escape-route plan or annotate exits, then re-run.",
                requirement_refs=REQS_SPACE, data_origin=ctx.origin(s.id),
            ))
            continue
        path = shortest_escape_path(ctx.H, s.id)
        if path:
            routes = independent_routes(ctx.H, s.id)
            facts += ctx.path_facts(path)
            facts.append(SupportingFact(kind="path", statement=f"{len(path)-1} graph steps to {ctx.name(path[-1])}; "
                                        f"{routes} node-independent route(s) to any identified escape point in the extracted model.",
                                        provenance="derived_geometry"))
            inferred = any(ctx.G.get_edge_data(u, v, {}).get("certainty") in ("inferred", "manual") for u, v in zip(path, path[1:]))
            findings.append(Finding(
                id=fid(), engine=Engine.ESCAPE, status=FindingStatus.CONNECTIVITY_VERIFIED,
                title="Connected to an identified escape point", affected_ids=[s.id], affected_names=[name],
                deck_id=s.deck_id, location=s.bbox,
                observation=f"Path found: " + " -> ".join(ctx.name(n) for n in path) + ".",
                risk_explanation="Connectivity only. Route width, length, stair capacity and fire integrity are not assessed from the GA."
                                 + (" The path uses inferred or manually annotated links." if inferred else ""),
                supporting_facts=facts,
                missing_information=["Escape route widths and travel distances", "Fire integrity of route boundaries"],
                recommended_action="No connectivity action. Confirm against the approved escape-route plan.",
                requirement_refs=REQS_SPACE, highlight_path=path, data_origin=ctx.path_origin(path),
            ))
            continue
        # no path
        if not doors:
            status = FindingStatus.INCONCLUSIVE
            title = "No door identified - connectivity cannot be established"
            obs = "No door symbol was detected on the boundary of this space, so it is isolated in the extracted model."
            missing = ["Door / opening positions for this space (sliding, watertight or hatch closures are not detected from GA symbols)"]
            action = "Check the space on the drawing; annotate its access if it exists."
        elif ctx.component_has_unlinked_stair(s.id):
            status = FindingStatus.INCONCLUSIVE
            title = "Route reaches a stair whose onward connection was not identified"
            obs = "The space connects (directly or via other spaces) to a stair, but the stair's onward connection to an escape point was not identified in the extraction."
            missing = ["Onward stair / door connections from the stair (not identified in the extraction)"]
            action = "Verify where the stair leads; annotate the vertical connection."
        else:
            status = FindingStatus.POTENTIAL_CONNECTIVITY_ISSUE
            title = "Potentially disconnected occupied space"
            obs = f"The space has {len(doors)} detected door(s), but its connected group of spaces contains no identified escape point."
            missing = ["Escape-route plan for this area"]
            action = "Review escape arrangements for this group of spaces; the drawing may omit doors or alternative exits."
        comp = sorted(nx.node_connected_component(ctx.G, s.id))
        facts.append(SupportingFact(kind="absence", statement=f"Connected group in the model: {', '.join(ctx.name(n) for n in comp[:12])}"
                                    + (" ..." if len(comp) > 12 else ""), provenance="derived_geometry"))
        for d in doors:
            facts.append(SupportingFact(kind="relationship", statement=f"Door {d.id}: {d.resolution}, joins {', '.join(ctx.name(x) for x in d.space_ids)}",
                                        provenance=d.provenance.value, evidence_ids=d.evidence_ids))
        findings.append(Finding(
            id=fid(), engine=Engine.ESCAPE, status=status, title=title, affected_ids=[s.id], affected_names=[name],
            deck_id=s.deck_id, location=s.bbox, observation=obs,
            risk_explanation="A missing path in the extracted drawing is not proof of an escape-route deficiency; the drawing may omit doors or alternative escapes.",
            supporting_facts=facts, missing_information=missing, recommended_action=action,
            requirement_refs=REQS_SPACE, highlight_ids=comp, data_origin=ctx.origin(s.id),
        ))

    # corridors: independent escape directions / dead ends
    for c in corridors:
        name = ctx.name(c.id)
        routes = independent_routes(ctx.H, c.id)
        path = shortest_escape_path(ctx.H, c.id)
        facts = space_facts(c)
        if n_esc and routes >= 2:
            status, title = FindingStatus.CONNECTIVITY_VERIFIED, "Corridor has two or more independent escape directions"
            obs = f"{routes} node-independent routes to identified escape points were found."
            action = "No connectivity action."
            missing = ["Corridor widths and dead-end lengths (not measurable as escape routes from the GA)"]
        elif n_esc and routes == 1:
            status, title = FindingStatus.POTENTIAL_CONNECTIVITY_ISSUE, "Corridor has a single escape direction (dead-end branch)"
            obs = "Only one independent route to an identified escape point exists; every route passes through the same space."
            action = "Review whether a second means of escape exists (e.g. a door or hatch not drawn with a swing symbol) and dead-end corridor length."
            missing = ["Second means of escape, if any", "Dead-end length"]
        else:
            status = FindingStatus.INCONCLUSIVE if (n_esc == 0 or ctx.component_has_unlinked_stair(c.id)) else FindingStatus.POTENTIAL_CONNECTIVITY_ISSUE
            title = "Corridor without an identified escape connection"
            obs = "No route from this corridor to an identified escape point exists in the extracted model."
            action = "Review the escape arrangement of this corridor."
            missing = ["Escape points / stair continuations for this area"]
        if path:
            facts += ctx.path_facts(path)
        cut = []
        if routes == 1 and path:
            # the articulation node every route passes through
            cut = [n for n in path[1:-1] if not nx.has_path(ctx.H.subgraph([x for x in ctx.H if x != n]), c.id, "__ESCAPE_SINK__")]
            if cut:
                facts.append(SupportingFact(kind="path", statement=f"All routes pass through {ctx.name(cut[0])}.", provenance="derived_geometry"))
        findings.append(Finding(
            id=fid(), engine=Engine.ESCAPE, status=status, title=title, affected_ids=[c.id], affected_names=[name],
            deck_id=c.deck_id, location=c.bbox, observation=obs,
            risk_explanation="Graph analysis of extracted connectivity; not a regulatory determination.",
            supporting_facts=facts, missing_information=missing, recommended_action=action,
            requirement_refs=REQS_CORRIDOR, highlight_path=path or [], highlight_ids=cut,
            data_origin=ctx.path_origin(path) if path else ctx.origin(c.id),
        ))

    summary = EngineSummary(
        engine=Engine.ESCAPE, title="Escape Route Connectivity",
        elements_analyzed=len(occupied) + len(corridors),
        verified=sum(f.status == FindingStatus.CONNECTIVITY_VERIFIED for f in findings),
        potential_issues=sum(f.status == FindingStatus.POTENTIAL_CONNECTIVITY_ISSUE for f in findings),
        inconclusive=sum(f.status == FindingStatus.INCONCLUSIVE for f in findings),
        completed=True,
        notes=[f"{len(occupied)} occupied spaces and {len(corridors)} corridors analysed; {n_esc} escape points; "
               f"{ctx.G.number_of_nodes()} graph nodes, {ctx.G.number_of_edges()} edges, "
               f"{nx.number_connected_components(ctx.G)} connected components."],
    )
    return summary, findings
