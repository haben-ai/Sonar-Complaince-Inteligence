"""Evaluate validated-or-draft CheckSpecs against an EngineeringModel.

Gates, in order:
1. applicability verdict of the spec's scope (NOT_APPLICABLE / APPLICABILITY_UNKNOWN short-circuit,
   except PVAG/ADA/DNV in explicit demo mode);
2. quote verification (spec quote must exist verbatim in the stored clause);
3. deterministic evaluator -> indicative status;
4. validation gate: a draft spec can never yield a final COMPLIANT / NON-COMPLIANCE status
   (-> REQUIRES_EXPERT_REVIEW, indicative status still shown).
"""
from __future__ import annotations

import re

import networkx as nx

from backend.engineering.spatial_graph import build_graph, independent_routes, shortest_escape_path, with_sink
from backend.models.engineering_models import EngineeringModel, SpaceKind
from backend.models.regulatory_models import ApplicabilityVerdict, CheckSpec, Citation, ComplianceResult
from backend.regulatory.index import store

DEMO_INSTRUMENTS = {"ADA", "PVAG", "CLASS_DNV"}
DECIDING = {"COMPLIANT_ON_AVAILABLE_EVIDENCE", "POTENTIAL_NON_COMPLIANCE"}


class Ctx:
    def __init__(self, model: EngineeringModel):
        self.m = model
        self.G = build_graph(model)
        self.H = with_sink(self.G)
        self.spaces = {s.id: s for s in model.spaces}
        self.decks = {d.id: d for d in model.decks}
        self.doors_of: dict[str, list] = {}
        for d in model.doors:
            for s in d.space_ids:
                self.doors_of.setdefault(s, []).append(d)

    def name(self, sid: str) -> str:
        s = self.spaces.get(sid)
        if not s:
            e = next((x for x in self.m.escape_points if x.id == sid), None)
            return f"escape point '{e.label}' ({e.kind.value.replace('_', ' ')})" if e else sid
        deck = self.decks.get(s.deck_id)
        return f"{s.name or s.kind.value.replace('_', ' ')} ({deck.name if deck else s.deck_id})"

    def has_stair(self, sid: str) -> bool:
        if sid not in self.G:
            return False
        return any(self.spaces.get(n) is not None and self.spaces[n].kind == SpaceKind.STAIR for n in nx.node_connected_component(self.G, sid))

    def doors_between(self, a: str, b: str) -> list[str]:
        return [d.id for d in self.m.doors if set(d.space_ids) == {a, b}]


def _citations(spec: CheckSpec) -> list[Citation]:
    out = []
    for i, cid in enumerate(spec.clause_ids):
        cl = store.clause(cid)
        if not cl:
            continue
        doc = store.document(cl.doc_id)
        ex = spec.quote if i == 0 else " ".join(cl.text.split()[:30]) + (" …" if len(cl.text.split()) > 30 else "")
        out.append(Citation(clause_id=cid, doc_title=doc.title if doc else cl.doc_id, path=cl.path, page=cl.page, excerpt=ex,
                            completeness=doc.completeness if doc else "", url=doc.url if doc else ""))
    return out


def _select(ctx: Ctx, target: dict) -> list:
    sp = ctx.m.spaces
    if target.get("object") == "door":
        return list(ctx.m.doors)
    out = []
    for s in sp:
        if "space_kind" in target and s.kind.value not in target["space_kind"]:
            continue
        if "hazard" in target and not (s.hazard and s.hazard.category in target["hazard"]):
            continue
        if "exclude_hazard" in target and s.hazard and s.hazard.category in target["exclude_hazard"]:
            continue
        if target.get("fire_risk") and not (s.hazard and s.hazard.fire_risk):
            continue
        if "label_regex" in target and not (s.name and re.search(target["label_regex"], s.name.upper())):
            continue
        if "serves_kind" in target:
            nbrs = [n for n in (ctx.G[s.id] if s.id in ctx.G else [])]
            if not any(ctx.spaces.get(n) and ctx.spaces[n].kind.value in target["serves_kind"] for n in nbrs):
                continue
        out.append(s)
    return out


def _no_route_status(ctx: Ctx, sid: str) -> tuple[str, str]:
    if not ctx.doors_of.get(sid):
        return "INSUFFICIENT_EVIDENCE", "No door symbol detected for this space; its access is not readable from the GA."
    if ctx.has_stair(sid):
        return "INSUFFICIENT_EVIDENCE", "The space's group reaches a stair whose onward connection was not identified."
    return "POTENTIAL_NON_COMPLIANCE", "Doors exist but no route to an identified escape point exists in the extracted model."


def evaluate_spec(ctx: Ctx, spec: CheckSpec) -> list[dict]:
    """Returns partial result dicts (indicative status, measured, reasoning, elements)."""
    ev = spec.evaluator
    res: list[dict] = []
    if ev == "not_assessable_from_ga":
        return [dict(status="NOT_ASSESSABLE_FROM_GA", elements=[], reasoning=["The General Arrangement does not contain the information this requirement needs: "
                                                                              + "; ".join(spec.required_evidence) + "."])]
    targets = _select(ctx, spec.target)
    if ev == "documented_system":
        key = (spec.property or "").split(".", 1)[-1]
        for s in targets:
            m = s.measurements.get(key)
            if not m:
                res.append(dict(status="INSUFFICIENT_EVIDENCE", elements=[s.id],
                                reasoning=["No fire-fighting arrangement information for this space in the design input (not shown on a GA)."]))
            elif m.get("value"):
                res.append(dict(status="COMPLIANT_ON_AVAILABLE_EVIDENCE", elements=[s.id],
                                measured={"value": m["value"], "unit": "", "status": "documented", "basis": m.get("basis", "")},
                                reasoning=[f"Documented protection: {m['value']}."]))
            else:
                res.append(dict(status="POTENTIAL_NON_COMPLIANCE", elements=[s.id],
                                measured={"value": "none documented", "unit": "", "status": "documented", "basis": m.get("basis", "")},
                                required={"operator": "=", "value": "fixed system", "unit": "",
                                          "basis": "CO2 / dry powder / water spray or equivalent"},
                                reasoning=["The fire-fighting arrangement documents no fixed extinguishing system for this space."]))
        return res

    if ev == "presence":
        ids = [t.id for t in targets]
        if ids:
            return [dict(status="INSUFFICIENT_EVIDENCE", elements=ids, measured={"value": len(ids), "unit": "tanks", "status": "extracted",
                                                                                 "basis": "spaces labelled WB on the drawing"},
                         reasoning=[f"{len(ids)} ballast (WB) tanks identified from drawing labels, so the requirement is relevant.",
                                    "The ballast water management plan and any treatment system are not shown on a GA."])]
        return [dict(status="INSUFFICIENT_EVIDENCE", elements=[], reasoning=["No ballast tanks identified from labels."])]

    if ev == "graph_reach":
        for s in targets:
            if s.id not in ctx.G:
                continue
            path = shortest_escape_path(ctx.H, s.id)
            if path:
                res.append(dict(status="COMPLIANT_ON_AVAILABLE_EVIDENCE", elements=[s.id], path=path,
                                measured={"value": "route found", "status": "derived", "basis": " -> ".join(ctx.name(n) for n in path)},
                                reasoning=[f"Route to an identified escape point: {' -> '.join(ctx.name(n) for n in path)}."]))
            else:
                st, why = _no_route_status(ctx, s.id)
                res.append(dict(status=st, elements=[s.id], reasoning=[why]))
        return res

    if ev == "graph_independent_routes":
        for s in targets:
            if s.id not in ctx.G:
                continue
            routes = independent_routes(ctx.H, s.id)
            path = shortest_escape_path(ctx.H, s.id) or []
            meas = {"value": routes, "unit": "independent routes", "status": "derived",
                    "basis": "node-independent paths to identified escape points (Menger)"}
            req = {"operator": ">=", "value": spec.threshold, "unit": "routes"}
            if routes >= (spec.threshold or 2):
                res.append(dict(status="COMPLIANT_ON_AVAILABLE_EVIDENCE", elements=[s.id], path=path, measured=meas, required=req,
                                reasoning=[f"{routes} independent routes found in the extracted model."]))
            elif routes == 1:
                travel = s.measurements.get("max_travel_from_door_m", {}).get("values") if spec.property == "space.max_travel_to_door_m" else None
                if travel:
                    t = min(travel.values())
                    st = "COMPLIANT_ON_AVAILABLE_EVIDENCE" if t <= 5.0 else "POTENTIAL_NON_COMPLIANCE"
                    res.append(dict(status=st, elements=[s.id], path=path,
                                    measured={"value": t, "unit": "m", "status": "derived", "basis": "max travel distance to the door (geodesic)",
                                              "routes": 1},
                                    required={"operator": "<=", "value": 5.0, "unit": "m", "basis": "single-route exception"},
                                    reasoning=["Only one independent route found.",
                                               f"Maximum travel distance to the door is {t:.2f} m (derived); single-route exception requires 5 m or less."]))
                else:
                    res.append(dict(status="POTENTIAL_NON_COMPLIANCE", elements=[s.id], path=path, measured=meas, required=req,
                                    reasoning=["Only one independent route to an identified escape point found; every route passes through "
                                               + (ctx.name(path[1]) if len(path) > 1 else "the same element") + "."]))
            else:
                st, why = _no_route_status(ctx, s.id)
                res.append(dict(status=st if st != "POTENTIAL_NON_COMPLIANCE" else "POTENTIAL_NON_COMPLIANCE", elements=[s.id],
                                measured=meas, required=req, reasoning=["No route found.", why]))
        return res

    if ev == "numeric_threshold" and spec.property == "corridor.dead_end_length_m":
        for c in targets:
            if c.id not in ctx.G:
                continue
            routes = independent_routes(ctx.H, c.id)
            path = shortest_escape_path(ctx.H, c.id) or []
            if routes >= 2:
                res.append(dict(status="COMPLIANT_ON_AVAILABLE_EVIDENCE", elements=[c.id], path=path,
                                measured={"value": 0, "unit": "m", "status": "derived", "basis": f"{routes} independent routes - corridor is not a dead end"},
                                required={"operator": "<=", "value": 7.0, "unit": "m"},
                                reasoning=[f"{routes} independent routes: the corridor as a whole is not a dead end."]))
                continue
            if routes == 0 or len(path) < 2:
                res.append(dict(status="INSUFFICIENT_EVIDENCE", elements=[c.id], reasoning=["No escape route identified; dead-end length undefined."]))
                continue
            exit_node = path[1]
            doors = ctx.doors_between(c.id, exit_node)
            vals = c.measurements.get("max_travel_from_door_m", {}).get("values", {})
            lens = [vals[d] for d in doors if d in vals]
            if not lens:
                res.append(dict(status="INSUFFICIENT_EVIDENCE", elements=[c.id], path=path,
                                reasoning=[f"Single exit via {ctx.name(exit_node)}, but no measurable door opening for the length."]))
                continue
            L = min(lens)
            res.append(dict(status="COMPLIANT_ON_AVAILABLE_EVIDENCE" if L <= 7.0 else "POTENTIAL_NON_COMPLIANCE", elements=[c.id], path=path,
                            measured={"value": L, "unit": "m", "status": "derived", "basis": f"walking distance from the only exit ({ctx.name(exit_node)}) to the farthest corridor point"},
                            required={"operator": "<=", "value": 7.0, "unit": "m"},
                            reasoning=[f"Every escape route passes through {ctx.name(exit_node)}: the corridor is a dead end.",
                                       f"Dead-end length {L:.1f} m (derived from geometry, scale cross-checked).",
                                       "A second exit may exist but not be drawn with a door-swing symbol."]))
        return res

    if ev == "numeric_threshold" and spec.property == "tank.min_distance_to_side_shell_m":
        for t in targets:
            m = t.measurements.get("min_distance_to_side_shell_m")
            if not m:
                res.append(dict(status="INSUFFICIENT_EVIDENCE", elements=[t.id], reasoning=["Distance to side shell not measurable."]))
                continue
            v = m["value"]
            res.append(dict(status="COMPLIANT_ON_AVAILABLE_EVIDENCE" if v >= spec.threshold else "POTENTIAL_NON_COMPLIANCE", elements=[t.id],
                            measured={"value": v, "unit": "m", "status": "derived", "basis": "plan-view distance to hull outline"},
                            required={"operator": ">=", "value": spec.threshold, "unit": "m", "basis": "w minimum (C unknown)"},
                            reasoning=[f"Tank boundary is {v:.2f} m from the drawn side shell in plan (derived)."]))
        return res

    if ev == "numeric_threshold" and spec.property == "door.clear_width_mm":
        with_cw = [d for d in targets if d.clear_width_mm is not None]
        for d in with_cw:
            ok = d.clear_width_mm >= spec.threshold
            res.append(dict(status="COMPLIANT_ON_AVAILABLE_EVIDENCE" if ok else "POTENTIAL_NON_COMPLIANCE", elements=d.space_ids, door=d.id,
                            measured={"value": d.clear_width_mm, "unit": "mm", "status": "extracted", "basis": d.clear_width_source or "design data"},
                            required={"operator": ">=", "value": spec.threshold, "unit": "mm"},
                            reasoning=[f"Door {d.id} clear width {d.clear_width_mm:.0f} mm vs required {spec.threshold:.0f} mm."]))
        without = [d for d in targets if d.clear_width_mm is None]
        if without:
            leaves = [d.leaf_width_mm for d in without if d.leaf_width_mm]
            res.append(dict(status="INSUFFICIENT_EVIDENCE", elements=sorted({s for d in without for s in d.space_ids})[:40],
                            measured={"value": None, "unit": "mm", "status": "unknown",
                                      "basis": f"{len(without)} doors without clear width" + (f"; derived LEAF widths {min(leaves):.0f}-{max(leaves):.0f} mm (not usable)" if leaves else "")},
                            required={"operator": ">=", "value": spec.threshold, "unit": "mm"},
                            reasoning=[f"{len(without)} doors have no clear-width value. A GA swing symbol gives the leaf width, not the clear opening "
                                       "between door face and stop, so no comparison is made."]))
        return res

    if ev == "adjacency_documentation":
        fd = ctx.m.fire_documentation
        has = any(m["pattern"] != "FIRE" for m in fd.matches)
        adj: dict[str, list] = {}
        for a in ctx.m.adjacencies:
            adj.setdefault(a.space_a, []).append(a.space_b)
            adj.setdefault(a.space_b, []).append(a.space_a)
        from backend.compliance import fire_integrity as fi

        if spec.property == "boundary.fire_integrity_class" and fi.tables_apply(ctx.m) and fi.has_documented_classes(ctx.m):
            by_space: dict[str, list] = {}
            for a in ctx.m.adjacencies:
                by_space.setdefault(a.space_a, []).append(a)
                by_space.setdefault(a.space_b, []).append(a)
            for s in targets:
                rows = [(a, fi.assess(ctx.m, a, ctx.spaces)) for a in by_space.get(s.id, [])]
                bad = [(a, r) for a, r in rows if r and r["ok"] is False]
                good = [(a, r) for a, r in rows if r and r["ok"] is True]
                unknown = [a for a, r in rows if not r or r["ok"] is None]
                other = lambda a: a.space_b if a.space_a == s.id else a.space_a  # noqa: E731
                if bad:
                    a, r = min(bad, key=lambda t: fi.CLASS_RANK[t[1]["documented"]] - fi.CLASS_RANK[t[1]["required"]])
                    res.append(dict(status="POTENTIAL_NON_COMPLIANCE", elements=[s.id] + [other(x) for x, _ in bad],
                                    measured={"value": r["documented"], "unit": "", "status": "documented",
                                              "basis": f"division to {ctx.name(other(a))} ({a.fire_integrity_source or 'fire-control plan'})"},
                                    required={"operator": ">=", "value": r["required"], "unit": "", "basis": r["table"]},
                                    reasoning=[f"{len(bad)} boundary(ies) documented below the table class: "
                                               + "; ".join(f"{ctx.name(other(x))}: {q['documented']} < {q['required']} ({q['table']})" for x, q in bad) + ".",
                                               f"Space categories: {r['basis']}."]))
                elif good and not unknown:
                    res.append(dict(status="COMPLIANT_ON_AVAILABLE_EVIDENCE", elements=[s.id] + [other(x) for x, _ in good],
                                    measured={"value": len(good), "unit": "boundaries at or above table class", "status": "documented"},
                                    reasoning=[f"All {len(good)} documented boundaries meet tables 9.1/9.2."]))
                else:
                    res.append(dict(status="INSUFFICIENT_EVIDENCE", elements=[s.id] + [other(a) for a in unknown],
                                    reasoning=[f"{len(unknown)} boundary(ies) have no documented class or no table category; "
                                               f"{len(good)} documented boundaries meet the tables."]))
            return res
        for s in targets:
            nb = adj.get(s.id, [])
            res.append(dict(status="REQUIRES_EXPERT_REVIEW" if has else "INSUFFICIENT_EVIDENCE", elements=[s.id] + nb,
                            measured={"value": len(nb), "unit": "adjacent spaces", "status": "derived", "basis": "shared boundaries / deck overlaps"},
                            reasoning=[f"{len(nb)} adjacent spaces identified.", fd.note]))
        return res
    return [dict(status="REQUIRES_EXPERT_REVIEW", elements=[], reasoning=[f"Evaluator '{ev}' not implemented for property {spec.property}."])]


def run(model: EngineeringModel, specs: list[CheckSpec], verdicts: list[ApplicabilityVerdict], demo: bool = False) -> list[ComplianceResult]:
    ctx = Ctx(model)
    vmap = {v.scope_id: v for v in verdicts}
    out: list[ComplianceResult] = []
    for spec in specs:
        v = vmap.get(spec.scope_id)
        cites = _citations(spec)
        base_caveats = list(spec.interpretation_notes)
        is_demo = False
        if v is None or v.status == "NOT_APPLICABLE":
            if demo and spec.instrument in DEMO_INSTRUMENTS:
                is_demo = True
                base_caveats.insert(0, "DEMO: evaluated as if applicable. The instrument does not apply to this vessel.")
            else:
                out.append(ComplianceResult(result_id=f"{spec.spec_id}#NA", spec_id=spec.spec_id, instrument=spec.instrument, title=spec.title,
                                            indicative_status="NOT_APPLICABLE", status="NOT_APPLICABLE",
                                            reasoning=[st.statement for st in (v.reasoning if v else [])] or ["No applicability verdict."],
                                            citations=cites, caveats=base_caveats, data_origin=model.document.data_origin.value))
                continue
        if not spec.quote_verified:
            out.append(ComplianceResult(result_id=f"{spec.spec_id}#Q", spec_id=spec.spec_id, instrument=spec.instrument, title=spec.title,
                                        indicative_status="REQUIRES_EXPERT_REVIEW", status="REQUIRES_EXPERT_REVIEW",
                                        reasoning=["Spec quote not found verbatim in the stored clause text - encoding cannot be trusted."],
                                        citations=cites, caveats=base_caveats))
            continue
        if v and v.status in ("APPLICABLE_WITH_ASSUMPTIONS",) and not is_demo:
            base_caveats = [f"Applicability assumption: {a}" for a in v.assumptions] + base_caveats
        for i, r in enumerate(evaluate_spec(ctx, spec), 1):
            ind = r["status"]
            final = ind
            if v and v.status == "APPLICABILITY_UNKNOWN" and not is_demo:
                final = "APPLICABILITY_UNKNOWN"
            elif ind in DECIDING and spec.validation_status != "engineer_validated":
                final = "REQUIRES_EXPERT_REVIEW"
            caveats = list(base_caveats)
            if final == "APPLICABILITY_UNKNOWN":
                caveats.insert(0, "Applicability unknown - missing: " + "; ".join(v.missing_facts))
            if ind in DECIDING and spec.validation_status != "engineer_validated":
                caveats.insert(0, "Rule encoding not yet engineer-validated: indicative result only.")
            els = r.get("elements", [])
            first = ctx.spaces.get(els[0]) if els else None
            out.append(ComplianceResult(
                result_id=f"{spec.spec_id}#{i:03d}", spec_id=spec.spec_id, instrument=spec.instrument, title=spec.title,
                element_ids=els, element_names=[ctx.name(e) for e in els[:12]], deck_id=first.deck_id if first else None,
                indicative_status=ind, status=final, measured=r.get("measured"), required=r.get("required"),
                reasoning=r.get("reasoning", []), citations=cites,
                design_evidence_ids=[e for sid in els[:5] for e in (ctx.spaces[sid].evidence_ids if sid in ctx.spaces else [])][:12],
                highlight_path=r.get("path", []), caveats=caveats, demo_as_if_applicable=is_demo,
                data_origin=model.document.data_origin.value,
            ))
    return out
