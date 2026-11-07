"""Safety engine 2: escape accessibility of hazardous spaces."""
from __future__ import annotations

from backend.compliance.common import Ctx, space_facts
from backend.engineering.spatial_graph import independent_routes, shortest_escape_path
from backend.models.engineering_models import SpaceKind
from backend.models.finding_models import Engine, EngineSummary, Finding, FindingStatus, SupportingFact

TWO_MEANS_CATEGORIES = {"machinery_space_combustion_engine"}


def run(ctx: Ctx) -> tuple[EngineSummary, list[Finding]]:
    findings: list[Finding] = []
    # tanks are not entered in normal operation: they are screened by the fire engine only
    hazards = [s for s in ctx.m.spaces if s.hazard and s.kind != SpaceKind.TANK_VOID and s.id in ctx.G]
    n_esc = len(ctx.escapes)
    for i, s in enumerate(hazards, 1):
        name = ctx.name(s.id)
        facts = space_facts(s)
        facts.insert(0, SupportingFact(kind="classification",
                                       statement=f"Hazard category '{s.hazard.category}': {s.hazard.description}. {s.hazard.matched_rule}",
                                       provenance=s.hazard.classification_source.value, evidence_ids=s.evidence_ids))
        doors = ctx.doors_of.get(s.id, [])
        for d in doors:
            facts.append(SupportingFact(kind="relationship",
                                        statement=f"Door {d.id} ({d.resolution}) joins {', '.join(ctx.name(x) for x in d.space_ids)}",
                                        provenance=d.provenance.value, evidence_ids=d.evidence_ids))
        in_room_esc = [e for e in ctx.escapes.values() if e.space_id == s.id]
        for e in in_room_esc:
            facts.append(SupportingFact(kind="relationship", statement=f"Escape marking '{e.label}' inside the space ({e.notes})",
                                        provenance=e.provenance.value, evidence_ids=e.evidence_ids))
        refs = ["SYN-HAZ-001"] + (["SOLAS-II2-R13-MACHINERY"] if s.kind == SpaceKind.MACHINERY else ["SOLAS-II2-R13-ESCAPE"])
        path = shortest_escape_path(ctx.H, s.id) if n_esc else None
        routes = independent_routes(ctx.H, s.id) if path else 0
        missing = ["Detailed escape-route and compartment drawings for this space"]
        if path:
            facts += ctx.path_facts(path)
            if s.hazard.category in TWO_MEANS_CATEGORIES and routes < 2:
                status = FindingStatus.POTENTIAL_CONNECTIVITY_ISSUE
                title = "Hazardous machinery space: only one independent escape route identified"
                obs = (f"One route to an identified escape point was found ({' -> '.join(ctx.name(n) for n in path)}), "
                       "but no second independent route exists in the extracted model.")
                action = "Review the means of escape from this machinery space (e.g. escape trunk destination, second exit)."
                missing.append("Second means of escape and the destination of any escape trunk")
            else:
                status = FindingStatus.CONNECTIVITY_VERIFIED
                title = "Hazardous space connected to an identified escape point"
                obs = f"Path: {' -> '.join(ctx.name(n) for n in path)}. {routes} independent route(s) in the extracted model."
                action = "Confirm the route against the approved escape-route plan."
            hl_path, hl = path, []
        else:
            if n_esc == 0:
                status, title = FindingStatus.INCONCLUSIVE, "Escape-point information missing"
                obs = "No escape points are identified in the design, so accessibility cannot be evaluated."
                missing.append("Exits / escape markings")
            elif not doors and not in_room_esc:
                status, title = FindingStatus.INCONCLUSIVE, "Hazardous-space escape accessibility requires review"
                obs = "No door symbol or escape marking was identified for this space; its access is not shown in a form the extraction can read."
                missing.append("Door / hatch positions for this space")
            elif ctx.component_has_unlinked_stair(s.id):
                status, title = FindingStatus.INCONCLUSIVE, "Hazardous-space escape accessibility requires review"
                obs = "The space connects to a stair whose continuation to another deck could not be matched."
                missing.append("Stair continuation between decks")
            else:
                status, title = FindingStatus.POTENTIAL_CONNECTIVITY_ISSUE, "Hazardous space without identified escape connection"
                obs = f"The space has {len(doors)} detected door(s), but no route to an identified escape point exists in the extracted model."
            action = "Review detailed compartment and escape-route drawings."
            hl_path, hl = [], [s.id]
        findings.append(Finding(
            id=f"HAZ-{i:03d}", engine=Engine.HAZARD, status=status, title=title, affected_ids=[s.id],
            affected_names=[name], deck_id=s.deck_id, location=s.bbox, observation=obs,
            risk_explanation=("Escape accessibility from this space cannot be established from the available drawing."
                              if status == FindingStatus.INCONCLUSIVE else
                              "Occupants of a hazardous space need a reliable escape; this is a connectivity screening only."),
            supporting_facts=facts, missing_information=missing, recommended_action=action,
            requirement_refs=refs, highlight_path=hl_path, highlight_ids=hl,
            data_origin=ctx.path_origin(hl_path) if hl_path else ctx.origin(s.id),
        ))
    summary = EngineSummary(
        engine=Engine.HAZARD, title="Hazardous-Space Accessibility", elements_analyzed=len(hazards),
        verified=sum(f.status == FindingStatus.CONNECTIVITY_VERIFIED for f in findings),
        potential_issues=sum(f.status == FindingStatus.POTENTIAL_CONNECTIVITY_ISSUE for f in findings),
        inconclusive=sum(f.status == FindingStatus.INCONCLUSIVE for f in findings), completed=True,
        notes=["Hazard classification uses drawing labels only (controlled vocabulary). Tanks are excluded here and screened by the fire engine."],
    )
    return summary, findings
