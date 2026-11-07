"""Safety engine 3: fire-risk proximity screening.

Lists which spaces share a boundary (or deck) with a fire-risk space and checks whether the
submitted documentation states any fire separation. For a GA drawing alone (no documented
division classes) every result is INCONCLUSIVE.

Only when the design input documents the class of a boundary (fire-control / structural fire
protection plan) AND SOLAS II-2 tables 9.1/9.2 apply (passenger ship, > 36 passengers) is the
documented class compared with the table class (see fire_integrity.py). A documented class below
the table class is a POTENTIAL issue; it is never a final non-compliance determination.
"""
from __future__ import annotations

from backend.compliance import fire_integrity as fi
from backend.compliance.common import Ctx, space_facts
from backend.models.engineering_models import OCCUPIED_KINDS, AdjacencyRelation, SpaceKind
from backend.models.finding_models import Engine, EngineSummary, Finding, FindingStatus, SupportingFact

STANDARD_MSG = ("Fire separation cannot be verified from the submitted General Arrangement drawing. "
                "Detailed fire-control plans and construction specifications are required.")


def _priority(kind: SpaceKind, hazard) -> str:
    if hazard:
        return "another fire-risk space"
    if kind in (SpaceKind.CORRIDOR, SpaceKind.STAIR):
        return "escape route"
    if kind in OCCUPIED_KINDS:
        return "occupied space"
    return "other"


def run(ctx: Ctx) -> tuple[EngineSummary, list[Finding]]:
    findings: list[Finding] = []
    fire_spaces = [s for s in ctx.m.spaces if s.hazard and s.hazard.fire_risk]
    fd = ctx.m.fire_documentation
    has_fire_info = fd.fire_control_plan_available or any(m["pattern"] != "FIRE" for m in fd.matches)
    adj_by_space: dict[str, list] = {}
    for a in ctx.m.adjacencies:
        adj_by_space.setdefault(a.space_a, []).append((a, a.space_b))
        adj_by_space.setdefault(a.space_b, []).append((a, a.space_a))
    n_pairs = 0
    compare = fi.tables_apply(ctx.m) and fi.has_documented_classes(ctx.m)
    n_below = 0
    for i, s in enumerate(fire_spaces, 1):
        name = ctx.name(s.id)
        adj = adj_by_space.get(s.id, [])
        facts = [SupportingFact(kind="classification",
                                statement=f"Fire-risk category '{s.hazard.category}': {s.hazard.description}. {s.hazard.matched_rule}",
                                provenance=s.hazard.classification_source.value, evidence_ids=s.evidence_ids)]
        facts += space_facts(s)[1:]
        neighbours, high = [], []
        below, met, undocumented = [], [], []
        for a, other in sorted(adj, key=lambda t: (t[0].relation.value, -(t[0].shared_length_m or t[0].overlap_area_m2 or 0))):
            o = ctx.spaces.get(other)
            if not o:
                continue
            pr = _priority(o.kind, o.hazard)
            if a.relation == AdjacencyRelation.SHARED_BOUNDARY:
                steel = (f"; {a.boundary_on_steel_layer_fraction*100:.0f} % of it drawn on a Steel_* CAD layer"
                         if a.boundary_on_steel_layer_fraction is not None else "")
                st = f"Shares ~{a.shared_length_m:.1f} m of boundary with {ctx.name(other)} [{pr}]{steel}."
            else:
                st = (f"Plan footprint overlaps {ctx.name(other)} on the adjacent deck by ~{a.overlap_area_m2:.0f} m2 "
                      f"[{pr}] (inferred vertical adjacency through the deck).")
            facts.append(SupportingFact(kind="relationship", statement=st, provenance=a.provenance.value, evidence_ids=a.evidence_ids))
            if compare:
                r = fi.assess(ctx.m, a, ctx.spaces)
                if r and r["ok"] is False:
                    below.append((other, r))
                    facts.append(SupportingFact(kind="measurement", statement=(
                        f"Boundary to {ctx.name(other)}: documented '{r['documented']}', {r['table']} requires '{r['required']}' "
                        f"({r['basis']}). Documented class is BELOW the table class."),
                        provenance=a.provenance.value if a.provenance.value == "synthetic" else "pdf_text", evidence_ids=a.evidence_ids))
                elif r and r["ok"] is True:
                    met.append((other, r))
                    facts.append(SupportingFact(kind="measurement", statement=(
                        f"Boundary to {ctx.name(other)}: documented '{r['documented']}' meets {r['table']} class '{r['required']}'."),
                        provenance=a.provenance.value if a.provenance.value == "synthetic" else "pdf_text", evidence_ids=a.evidence_ids))
                else:
                    undocumented.append(other)
            neighbours.append(other)
            if pr in ("escape route", "occupied space", "another fire-risk space"):
                high.append((pr, other))
            n_pairs += 1
        facts.append(SupportingFact(kind="absence", statement=fd.note, provenance="pdf_text",
                                    evidence_ids=[m["evidence_id"] for m in fd.matches]))
        status = FindingStatus.INCONCLUSIVE
        risk = None
        if compare and below:
            n_below += 1
            status = FindingStatus.POTENTIAL_CONNECTIVITY_ISSUE
            title = "Documented fire integrity below the SOLAS table class"
            obs = (f"{len(below)} boundary(ies) of this fire-risk space are documented with a lower class than SOLAS II-2 "
                   "tables 9.1/9.2 require: " + "; ".join(f"{ctx.name(o)} ({r['documented']} documented, {r['required']} required)"
                                                         for o, r in below[:6]) + ".")
            missing = ["Engineer confirmation of the space categories used for the table look-up",
                       "Approved structural fire protection plan"] + (["Fire-integrity class of the remaining boundaries"] if undocumented else [])
            risk = ("A division weaker than the table class can let fire or heat reach the neighbouring space before evacuation is complete. "
                    "Screening result from documented classes; not a final compliance determination.")
            action = "Upgrade the listed divisions to the table class (or justify the space categories) and update the fire-control plan."
        elif compare and met and not undocumented:
            status = FindingStatus.CONNECTIVITY_VERIFIED
            title = "Documented fire integrity meets the SOLAS table class"
            obs = f"All {len(met)} boundaries of this fire-risk space are documented at or above the class tables 9.1/9.2 require."
            missing = ["Engineer confirmation of the space categories used for the table look-up"]
            risk = "Documented classes meet the tables; fire-door ratings, penetrations and insulation details are not assessed."
            action = "Confirm against the approved structural fire protection plan."
        elif not adj:
            title = "Fire-risk space: boundary information missing"
            obs = "No neighbouring spaces could be established from the extracted geometry (boundaries not closed or not drawn on boundary layers)."
            missing = ["Compartment boundary drawings", "Fire-integrity classification of all boundaries"]
        else:
            kinds = sorted({p for p, _ in high})
            title = "Fire-separation verification required"
            obs = (f"{len(neighbours)} adjacent space(s) identified"
                   + (f", including {', '.join(kinds)}: " + ", ".join(ctx.name(o) for _, o in high[:6]) if high else "")
                   + ". " + (STANDARD_MSG if not has_fire_info else "Fire annotations exist in the documentation; review them against this boundary."))
            missing = ["Fire-integrity class of separating bulkheads/decks (A/B/C division)", "Fire door ratings",
                       "Structural fire protection / insulation plan", "Space category per applicable fire-protection rules"]
        if status == FindingStatus.INCONCLUSIVE:
            action = "Review fire-control plans and applicable fire-protection requirements for each listed boundary."
        findings.append(Finding(
            id=f"FIRE-{i:03d}", engine=Engine.FIRE, status=status, title=title,
            affected_ids=[s.id] + neighbours, affected_names=[name] + [ctx.name(n) for n in neighbours],
            deck_id=s.deck_id, location=s.bbox, observation=obs,
            risk_explanation=risk or ("Adjacency of a fire-risk space to " + ("escape routes / occupied spaces " if high else "other spaces ")
                              + "means the separating boundary needs a fire-integrity check. Adjacency alone is not non-compliance."),
            supporting_facts=facts, missing_information=missing,
            recommended_action=action,
            requirement_refs=["SYN-FIRE-001", "SOLAS-II2-R9-CONTAINMENT"],
            highlight_ids=[s.id] + ([o for o, _ in below] if below else neighbours),
            data_origin=ctx.origin(s.id, *neighbours),
        ))
    summary = EngineSummary(
        engine=Engine.FIRE, title="Fire-Risk Proximity", elements_analyzed=len(fire_spaces),
        verified=sum(f.status == FindingStatus.CONNECTIVITY_VERIFIED for f in findings), potential_issues=n_below,
        inconclusive=sum(f.status == FindingStatus.INCONCLUSIVE for f in findings), completed=True,
        notes=[f"{n_pairs} adjacency relations screened.", fd.note,
               ("Documented division classes compared with SOLAS II-2 tables 9.1/9.2 (passenger ship > 36 passengers). "
                "Space categories are a screening interpretation, not engineer-validated.") if compare else
               "Screening only: no fire-integrity data exists in the input, so every result is INCONCLUSIVE by design."],
    )
    return summary, findings
