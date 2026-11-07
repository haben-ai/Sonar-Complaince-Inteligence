"""Turn one deck view into spaces, doors, escape points and connections."""
from __future__ import annotations

import math
import statistics
import re
from dataclasses import dataclass, field

import cv2
import numpy as np

from backend.extraction.pdf_parser import ParsedPage, Word
from backend.engineering.door_detection import find_door_arcs, resolve_door
from backend.engineering.hazard_classifier import OPEN_DECK_PATTERN, classify_label
from backend.engineering.room_extraction import (
    MARKER_TOKENS,
    DeckSource,
    DeckRaster,
    is_frame_label,
    parse_area,
    rasterize_deck,
)
from backend.models.engineering_models import (
    BBox,
    Connection,
    ConnectionType,
    Deck,
    Door,
    EscapePoint,
    EscapePointKind,
    Evidence,
    Provenance,
    Space,
    SpaceKind,
)

IGNORE_WORDS_RX = re.compile(r"^(\d{3,5}|ABL|OBL|\+\d+|R\d+|\d+\s?KG\.?|KG\.?|Floor)$", re.I)


@dataclass
class DeckExtraction:
    deck: Deck
    raster: DeckRaster
    region_to_space: dict[int, str] = field(default_factory=dict)
    spaces: list[Space] = field(default_factory=list)
    doors: list[Door] = field(default_factory=list)
    escape_points: list[EscapePoint] = field(default_factory=list)
    connections: list[Connection] = field(default_factory=list)
    markers: list[tuple[str, Word, int]] = field(default_factory=list)  # (token, word, region)
    dropped_regions: int = 0


def _cluster_lines(words: list[Word]) -> list[list[Word]]:
    """Group words into label blocks: same text block from the PDF, or vertically stacked lines."""
    ws = sorted(words, key=lambda w: (w.cy, w.x0))
    groups: list[list[Word]] = []
    for w in ws:
        placed = False
        for g in groups:
            gx0 = min(v.x0 for v in g); gx1 = max(v.x1 for v in g); gy1 = max(v.y1 for v in g)
            h = max(v.y1 - v.y0 for v in g)
            if w.y0 - gy1 < 1.2 * h and w.x0 < gx1 + 6 and w.x1 > gx0 - 6:
                g.append(w); placed = True; break
        if not placed:
            groups.append([w])
    return groups


def _ordered(g: list[Word]) -> list[Word]:
    """Reading order: by visual line (tolerant to superscripts), then x."""
    ws = sorted(g, key=lambda w: w.cy)
    lines: list[list[Word]] = []
    for w in ws:
        h = w.y1 - w.y0
        if lines and abs(w.cy - sum(v.cy for v in lines[-1]) / len(lines[-1])) < 0.45 * h:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [w for ln in lines for w in sorted(ln, key=lambda v: v.x0)]


def _group_text(g: list[Word]) -> str:
    return " ".join(w.text for w in _ordered(g))


def _polygon(raster: DeckRaster, reg: int) -> list[tuple[float, float]]:
    x, y, w, h, _ = raster.stats[reg]
    crop = (raster.labels[y : y + h, x : x + w] == reg).astype(np.uint8)
    # include the half wall thickness so neighbouring polygons meet
    crop = cv2.copyMakeBorder(crop, 2, 2, 2, 2, cv2.BORDER_CONSTANT, 0)
    crop = cv2.dilate(crop, np.ones((3, 3), np.uint8))
    cs, _ = cv2.findContours(crop, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs:
        return []
    c = max(cs, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, 2.0, True)
    return [raster.to_pt(float(p[0][0] + x - 2), float(p[0][1] + y - 2)) for p in c]


def extract_deck(page: ParsedPage, deck: Deck, evidence: list[Evidence], log: list[str],
                 source: DeckSource | None = None) -> DeckExtraction:
    source = source or DeckSource()
    pre_arcs = None
    extra = None
    if source.wall_filter is not None:
        # no CAD layers: door swing symbols are thin strokes outside the wall filter; draw each detected
        # swing (arc + both radii) into the boundary raster so doorways close like in a layered drawing
        pre_arcs = find_door_arcs(page, deck, path_filter=source.door_filter)
        extra = []
        for a in pre_arcs:
            ang0 = math.atan2(a.e1[1] - a.hinge[1], a.e1[0] - a.hinge[0])
            ang1 = math.atan2(a.e2[1] - a.hinge[1], a.e2[0] - a.hinge[0])
            d = (ang1 - ang0 + math.pi) % (2 * math.pi) - math.pi
            extra.append([(a.hinge[0] + a.radius * math.cos(ang0 + d * t), a.hinge[1] + a.radius * math.sin(ang0 + d * t)) for t in np.linspace(0, 1, 12)])
            extra.append([a.hinge, a.e1])
            extra.append([a.hinge, a.e2])
    R = rasterize_deck(page, deck, extra_lines=extra, source=source)
    text_prov = source.text_provenance
    mpu = deck.scale.metres_per_unit if deck.scale else None
    px_m2 = (mpu / R.zoom) ** 2 if mpu else None
    min_labelled = int(0.3 / px_m2) if px_m2 else 400
    min_unlabelled = int(1.5 / px_m2) if px_m2 else 4000
    ex = DeckExtraction(deck, R)
    dkey = deck.id.replace("DECK_", "")

    # ---------------- words -> regions
    b = deck.bbox
    title_words = {deck.name.split()[0], "DECK"}
    region_words: dict[int, list[Word]] = {}
    margin = 60 if source.leader_labels else 0          # outside labels sit around the plan
    if source.words is None:
        view_words = page.words_in(b.x0, b.y0, b.x1, b.y1)
    else:
        view_words = [w for w in source.words if b.x0 - margin <= w.cx <= b.x1 + margin and b.y0 - margin <= w.cy <= b.y1 + margin
                      and w.conf >= 60 and (re.search(r"[A-Za-z]{2,}", w.text) or w.text.count("-") >= 2 or w.text.upper() in MARKER_TOKENS)]
    label_words = []
    for w in view_words:
        if is_frame_label(w, deck) or IGNORE_WORDS_RX.match(w.text):
            continue
        if w.text in title_words and (w.y1 - w.y0) >= 9:
            continue
        up = w.text.upper().strip(".")
        if up in MARKER_TOKENS:
            reg = R.region_at(w.cx, w.cy, search_px=8)
            if reg > 0 and reg not in R.exterior_ids:
                ex.markers.append((up, w, reg))
            continue
        label_words.append(w)
    leader_info: dict[int, list] = {}
    anchors: list[dict] = []
    if source.leader_labels:
        from backend.engineering.leaders import SegmentIndex, leader_target

        idx = SegmentIndex(page, (b.x0, b.y0, b.x1, b.y1))
        for g in _cluster_lines(label_words):
            txt = _group_text(g)
            # OCR noise filter: a real label has a word of >= 3 letters and decent confidence
            if not re.search(r"[A-Za-z]{3,}", txt) or statistics.mean(w.conf for w in g) < 70 \
                    or re.fullmatch(r"(PLAN|LEVEL|DECK|LOCATION|BOARDING)( \S+)?", txt.upper()):
                continue
            box = (min(w.x0 for w in g), min(w.y0 for w in g), max(w.x1 for w in g), max(w.y1 for w in g))
            h = statistics.median(w.y1 - w.y0 for w in g)
            tgt = leader_target(idx, box, h)
            pt = tgt or ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
            if not (b.x0 <= pt[0] <= b.x1 and b.y0 <= pt[1] <= b.y1):
                continue
            reg = R.region_at(pt[0], pt[1], search_px=12)
            ok = reg > 0 and reg not in R.exterior_ids and not R.is_thin(reg)
            anchors.append({"words": g, "text": txt, "point": pt, "leader": tgt is not None, "region": reg if ok else 0})
            if not ok:
                continue
            region_words.setdefault(reg, []).extend(g)
            leader_info.setdefault(reg, []).append({"label": txt, "leader_end": [round(pt[0], 1), round(pt[1], 1)] if tgt else None})
    else:
        for w in label_words:
            reg = R.region_at(w.cx, w.cy, search_px=8)
            if reg <= 0 or reg in R.exterior_ids:
                continue
            region_words.setdefault(reg, []).append(w)

    marker_regions: dict[int, set[str]] = {}
    for tok, w, reg in ex.markers:
        marker_regions.setdefault(reg, set()).add(tok)

    # ---------------- regions -> spaces
    counter = 0
    for reg in range(1, R.n):
        if reg in R.exterior_ids:
            continue
        area_px = int(R.stats[reg][4])
        words = region_words.get(reg, [])
        has_label = bool(words)
        if area_px < (min_labelled if has_label else min_unlabelled):
            if not has_label and reg not in marker_regions:
                ex.dropped_regions += 1
                continue
            if not has_label and area_px < min_labelled:
                ex.dropped_regions += 1
                continue
        if not has_label and reg not in marker_regions and R.is_thin(reg):
            ex.dropped_regions += 1   # cavity between double boundary lines, not a space
            continue
        groups = _cluster_lines(words)
        label_texts, area_labelled = [], None
        for g in groups:
            a, rest = parse_area([w.text for w in _ordered(g)])
            if a is not None and area_labelled is None:
                area_labelled = a
            t = " ".join(rest).strip()
            if t:
                label_texts.append(t)
        # primary name: the label block that carried the area, else the longest non-WC label
        name = None
        if label_texts:
            non_wc = [t for t in label_texts if t.upper() != "WC"]
            name = (non_wc or label_texts)[0] if len(non_wc) <= 1 else max(non_wc, key=len)
        kind, basis, hazard = classify_label(name)
        if hazard:
            hazard.classification_source = text_prov
        if kind in (SpaceKind.UNKNOWN, SpaceKind.TECHNICAL, SpaceKind.TANK_VOID) and not hazard:
            open_lbl = next((t for t in label_texts if re.search(OPEN_DECK_PATTERN, t.upper())), None)
            if open_lbl:
                kind, basis = SpaceKind.OPEN_DECK, f"R-OPEN matched label '{open_lbl}' inside the region"
        markers = marker_regions.get(reg, set())
        area_m2 = area_px * px_m2 if px_m2 else None
        notes = []
        if name is None and ({"UP", "DN"} & markers) and area_m2 is not None and area_m2 < 30:
            kind, basis = SpaceKind.STAIR, f"unlabelled region containing stair marker(s) {sorted(markers & {'UP','DN'})}"
        elif ({"UP", "DN"} & markers) and kind in (SpaceKind.UNKNOWN, SpaceKind.TECHNICAL) and area_m2 and area_m2 < 30:
            kind, basis = SpaceKind.STAIR, f"region with stair marker(s) {sorted(markers & {'UP','DN'})}; label '{name}'"
        if len([t for t in label_texts if t.upper() != "WC"]) > 1:
            notes.append(
                "Several labels fall in one extracted region: "
                + "; ".join(label_texts)
                + ". Boundary between them may not be drawn on wall layers (possible merged spaces)."
            )
        counter += 1
        sid = f"{dkey}_S{counter:03d}"
        x, y, w, h, _ = R.stats[reg]
        x0, y0 = R.to_pt(x, y); x1, y1 = R.to_pt(x + w, y + h)
        bb = BBox(page=deck.page, x0=x0, y0=y0, x1=x1, y1=y1)
        ev_geom = Evidence(
            id=f"EV_{sid}_GEOM",
            page=deck.page,
            bbox=bb,
            source=Provenance.DERIVED_GEOMETRY,
            method=f"Enclosed free-space region between boundary lines ({source.method_note}; connected components)",
            detail={"area_m2": round(area_m2, 2) if area_m2 else None, "region_px": area_px},
        )
        evidence.append(ev_geom)
        ev_ids = [ev_geom.id]
        if words:
            lb = BBox(page=deck.page, x0=min(w.x0 for w in words), y0=min(w.y0 for w in words),
                      x1=max(w.x1 for w in words), y1=max(w.y1 for w in words))
            ev_txt = Evidence(
                id=f"EV_{sid}_LABEL", page=deck.page, bbox=lb, source=text_prov,
                method=("OCR label linked to the region by its leader line" if source.leader_labels else
                        "OCR text located inside the region" if text_prov == Provenance.OCR else "Text objects located inside the region"),
                text=" | ".join(_group_text(g) for g in groups),
                detail={"leaders": leader_info.get(reg, []), "min_ocr_conf": min(w.conf for w in words)} if text_prov == Provenance.OCR else {},
            )
            evidence.append(ev_txt)
            ev_ids.append(ev_txt.id)
        if area_labelled and area_m2:
            dev = (area_m2 - area_labelled) / area_labelled
            notes.append(f"Labelled area {area_labelled} m2 vs extracted polygon {area_m2:.1f} m2 ({dev*100:+.0f} %).")
        sp = Space(
            id=sid, deck_id=deck.id, name=name, labels=label_texts, kind=kind, kind_basis=basis,
            labelled_area_m2=area_labelled, computed_area_m2=round(area_m2, 2) if area_m2 else None,
            polygon=_polygon(R, reg), bbox=bb, hazard=hazard,
            provenance=Provenance.DERIVED_GEOMETRY, evidence_ids=ev_ids, notes=notes,
        )
        ex.spaces.append(sp)
        ex.region_to_space[reg] = sid

    # ---------------- leader mode: regions holding several room labels are merged spaces -> one
    # label-anchored space per label (geometry not resolved), never a guessed boundary
    if source.leader_labels:
        reg_of = {sid: r for r, sid in ex.region_to_space.items()}
        per_region: dict[int, list] = {}
        for a in anchors:
            per_region.setdefault(a["region"], []).append(a)
        mpu_ = mpu or 0.05
        half = 0.6 / mpu_
        k = 0
        for reg, items in per_region.items():
            merged = reg > 0 and len(items) > 1
            if reg > 0 and not merged:
                continue                          # single label in a clean region: handled above
            if merged:
                sp0 = next((s_ for s_ in ex.spaces if reg_of.get(s_.id) == reg), None)
                if sp0:
                    sp0.notes.append(f"MERGED REGION: {len(items)} room labels resolve into this region "
                                     "(partitions not closed in the drawing); each label is listed as its own label-anchored space.")
                    sp0.kind, sp0.kind_basis, sp0.hazard = SpaceKind.UNKNOWN, "merged region holding several room labels", None
                    sp0.name = f"merged region ({len(items)} labels)"
            for a in items:
                k += 1
                sid = f"{dkey}_L{k:03d}"
                x, y = a["point"]
                kind, basis, hazard = classify_label(a["text"])
                if hazard:
                    hazard.classification_source = text_prov
                g = a["words"]
                ev = Evidence(id=f"EV_{sid}_LABEL", page=deck.page,
                              bbox=BBox(page=deck.page, x0=min(w.x0 for w in g), y0=min(w.y0 for w in g), x1=max(w.x1 for w in g), y1=max(w.y1 for w in g)),
                              source=text_prov, method="OCR label" + (" + leader line to the marked point" if a["leader"] else " (no leader found)"),
                              text=a["text"], detail={"anchor_point": [round(x, 1), round(y, 1)], "min_ocr_conf": min(w.conf for w in g)})
                evidence.append(ev)
                why = (f"label resolves into a merged region shared with: " + "; ".join(o["text"] for o in items if o is not a)) if merged \
                    else "label point is not inside an enclosed region of the extracted geometry"
                ex.spaces.append(Space(
                    id=sid, deck_id=deck.id, name=a["text"], labels=[a["text"]], kind=kind, kind_basis=basis, hazard=hazard,
                    polygon=[(x - half, y - half), (x + half, y - half), (x + half, y + half), (x - half, y + half)],
                    bbox=BBox(page=deck.page, x0=x - half, y0=y - half, x1=x + half, y1=y + half),
                    provenance=text_prov, evidence_ids=[ev.id],
                    notes=[f"GEOMETRY NOT RESOLVED: {why}. Position shown is the label's leader end-point, not the room outline."],
                ))

    # ---------------- doors
    arcs = pre_arcs if pre_arcs is not None else find_door_arcs(page, deck, path_filter=source.door_filter)
    pairs_seen = set()
    for i, a in enumerate(arcs, 1):
        did = f"{dkey}_D{i:03d}"
        res = resolve_door(a, R, min_labelled)
        side_ids = [ex.region_to_space.get(r) for r in (res.swing_side, res.other_side) if r]
        side_ids = [s for s in side_ids if s]
        bx = a.bbox
        bb = BBox(page=deck.page, x0=bx[0], y0=bx[1], x1=bx[2], y1=bx[3])
        ev = Evidence(
            id=f"EV_{did}", page=deck.page, bbox=bb, source=Provenance.PDF_VECTOR,
            method=f"Quarter-circle door swing (circle fit to vector polyline) on CAD layer '{a.layer}'",
            detail={"hinge": [round(a.hinge[0], 2), round(a.hinge[1], 2)], "radius_pt": round(a.radius, 2),
                    "side_samples": res.samples},
        )
        evidence.append(ev)
        status = "resolved" if len(side_ids) == 2 and side_ids[0] != side_ids[1] else ("one_side_only" if side_ids else "unresolved")
        door = Door(
            id=did, deck_id=deck.id, bbox=bb, hinge=a.hinge,
            leaf_width_mm=round(a.radius * mpu * 1000 / 10) * 10 if mpu else None,
            watertight=a.layer == "Door_WT", cad_layer=a.layer, space_ids=side_ids, resolution=status,
            evidence_ids=[ev.id],
        )
        ex.doors.append(door)
        if status == "resolved":
            key = tuple(sorted(side_ids))
            ex.connections.append(Connection(
                id=f"C_{did}", source=side_ids[0], target=side_ids[1], type=ConnectionType.DOOR, door_id=did,
                provenance=Provenance.DERIVED_GEOMETRY, certainty="extracted", evidence_ids=[ev.id],
                note=("parallel door between the same spaces" if key in pairs_seen else ""),
            ))
            pairs_seen.add(key)

    # ---------------- corridors: unlabelled, elongated, with >= 2 doors
    door_count: dict[str, int] = {}
    for d in ex.doors:
        for s in d.space_ids:
            door_count[s] = door_count.get(s, 0) + 1
    for sp in ex.spaces:
        if sp.name is None and sp.kind == SpaceKind.UNKNOWN and mpu:
            reg = next(r for r, s in ex.region_to_space.items() if s == sp.id)
            x, y, w, h, _ = R.stats[reg]
            crop = (R.labels[y : y + h, x : x + w] == reg).astype(np.uint8)
            dist = cv2.distanceTransform(np.pad(crop, 1), cv2.DIST_L2, 3)
            width_m = 2 * float(dist.max()) * mpu / R.zoom
            if width_m < 2.6 and door_count.get(sp.id, 0) >= 2:
                sp.kind = SpaceKind.CORRIDOR
                sp.kind_basis = f"unlabelled region, max clear width ~{width_m:.1f} m (elongated), {door_count[sp.id]} doors open onto it"
            else:
                sp.notes.append(f"Unlabelled region, max inscribed width ~{width_m:.1f} m, {door_count.get(sp.id, 0)} detected doors.")

    # ---------------- escape markers ('ESC')
    for k, (tok, w, reg) in enumerate([m for m in ex.markers if m[0] == "ESC"], 1):
        sid = ex.region_to_space.get(reg)
        eid = f"{dkey}_ESC{k:02d}"
        ev = Evidence(id=f"EV_{eid}", page=deck.page, bbox=BBox(page=deck.page, x0=w.x0, y0=w.y0, x1=w.x1, y1=w.y1),
                      source=text_prov, method="Text 'ESC' on the drawing", text=w.text)
        evidence.append(ev)
        ex.escape_points.append(EscapePoint(
            id=eid, deck_id=deck.id, kind=EscapePointKind.ESCAPE_MARKER, space_id=sid,
            bbox=ev.bbox, label="ESC", provenance=text_prov, evidence_ids=[ev.id],
            notes="'ESC' read as an escape-route / escape-hatch marking. The drawing has no legend confirming this; verify against the fire & safety plan.",
        ))
        if sid:
            ex.connections.append(Connection(
                id=f"C_{eid}", source=sid, target=eid, type=ConnectionType.ESCAPE_ACCESS,
                provenance=text_prov, certainty="extracted", evidence_ids=[ev.id],
                note="escape marking located inside this space",
            ))

    # ---------------- open decks with label evidence become escape points
    for sp in ex.spaces:
        if sp.kind == SpaceKind.OPEN_DECK:
            _add_open_deck_escape(ex, sp, text_prov, sp.kind_basis)

    from backend.engineering.measurements import tank_hull_distances, travel_distances

    travel_distances(ex)
    tank_hull_distances(ex, page)
    log.append(
        f"{deck.name}: {len(ex.spaces)} spaces, {len(ex.doors)} door symbols "
        f"({sum(d.resolution=='resolved' for d in ex.doors)} resolved), {sum(1 for m in ex.markers if m[0]=='ESC')} ESC markers, "
        f"{ex.dropped_regions} small unlabelled regions ignored"
    )
    return ex


def _add_open_deck_escape(ex: DeckExtraction, sp: Space, prov: Provenance, basis: str):
    eid = f"{sp.id}_OPEN"
    if any(e.id == eid for e in ex.escape_points):
        return
    ex.escape_points.append(EscapePoint(
        id=eid, deck_id=sp.deck_id, kind=EscapePointKind.OPEN_DECK, space_id=sp.id, bbox=sp.bbox,
        label=sp.name or "open deck", provenance=prov, evidence_ids=list(sp.evidence_ids),
        notes=f"Open (weather) deck treated as an escape destination. Basis: {basis}. Whether it is the "
              "embarkation/muster deck is not shown on the GA.",
    ))
    ex.connections.append(Connection(
        id=f"C_{eid}", source=sp.id, target=eid, type=ConnectionType.ESCAPE_ACCESS, provenance=prov,
        certainty="extracted" if prov != Provenance.MANUAL_ANNOTATION else "manual", evidence_ids=list(sp.evidence_ids),
    ))


def local_coords(deck: Deck, x: float, y: float) -> tuple[float, float] | None:
    """Ship coordinates in metres: (distance from frame 0, transverse offset from centreline)."""
    if deck.frame0_x is None or deck.centerline_y is None or not deck.scale:
        return None
    m = deck.scale.metres_per_unit
    return (x - deck.frame0_x) * m, (y - deck.centerline_y) * m


def link_stairs_between_decks(extractions: list[DeckExtraction], evidence: list[Evidence], log: list[str]) -> list[Connection]:
    """Vertical connections: an 'UP' marker on a deck matched to a 'DN' marker on the next deck up
    at (nearly) the same ship position. Inferred, never extracted."""
    conns: list[Connection] = []
    ordered = [e for e in extractions if e.deck.elevation_mm is not None]
    ordered.sort(key=lambda e: e.deck.elevation_mm)
    k = 0
    for lower, upper in zip(ordered, ordered[1:]):
        ups = [(w, reg) for tok, w, reg in lower.markers if tok == "UP"]
        dns = [(w, reg) for tok, w, reg in upper.markers if tok == "DN"]
        used = set()
        for wu, ru in ups:
            lu = local_coords(lower.deck, wu.cx, wu.cy)
            best = None
            for wd, rd in dns:
                ld = local_coords(upper.deck, wd.cx, wd.cy)
                if lu is None or ld is None:
                    continue
                d = math.dist(lu, ld)
                if d <= 4.5 and (best is None or d < best[0]):
                    best = (d, wd, rd)
            if not best:
                continue
            d, wd, rd = best
            s_lo, s_up = lower.region_to_space.get(ru), upper.region_to_space.get(rd)
            if not s_lo or not s_up or (s_lo, s_up) in used:
                continue
            used.add((s_lo, s_up))
            k += 1
            eid = f"EV_VSTAIR_{k:03d}"
            evidence.append(Evidence(
                id=eid, page=lower.deck.page,
                bbox=BBox(page=lower.deck.page, x0=wu.x0, y0=wu.y0, x1=wu.x1, y1=wu.y1),
                source=Provenance.DERIVED_GEOMETRY,
                method="'UP' marker on lower deck matched to 'DN' marker on next deck at the same frame/transverse position",
                detail={"lower_marker_page_xy": [round(wu.cx, 1), round(wu.cy, 1)],
                        "upper_marker_page_xy": [round(wd.cx, 1), round(wd.cy, 1)],
                        "horizontal_offset_m": round(d, 2)},
            ))
            conns.append(Connection(
                id=f"C_VSTAIR_{k:03d}", source=s_lo, target=s_up, type=ConnectionType.VERTICAL_STAIR,
                provenance=Provenance.DERIVED_GEOMETRY, certainty="inferred", evidence_ids=[eid],
                note=f"{lower.deck.name} -> {upper.deck.name}, markers {d:.1f} m apart in plan",
            ))
    log.append(f"vertical stair links inferred: {len(conns)}")
    return conns
