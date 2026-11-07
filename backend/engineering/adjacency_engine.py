"""Spatial adjacency between spaces.

* Shared boundary (same deck): boundary pixels of space A lying within a wall-thickness
  distance of space B. Length is reported in metres. We also report how much of that
  boundary is drawn on Steel_* CAD layers (structural bulkhead line) as opposed to joiner
  lining only. That is a fact about the drawing, NOT a fire-integrity class.
* Vertical overlap: plan footprints overlapping on consecutive decks (deck above/below),
  aligned with frame numbering and centreline. Inferred.

Visual proximity alone (e.g. two rooms across a corridor) is never reported as adjacency.
"""
from __future__ import annotations

import cv2
import numpy as np
from shapely.geometry import Polygon

from backend.engineering.space_builder import DeckExtraction, local_coords
from backend.models.engineering_models import Adjacency, AdjacencyRelation, Evidence, Provenance, SpaceKind

WALL_GAP_M = 0.30   # max distance across a boundary for two regions to count as sharing it
MIN_SHARED_M = 0.5  # ignore corner touches


def shared_boundaries(ex: DeckExtraction, evidence: list[Evidence], only_ids: set[str] | None = None) -> list[Adjacency]:
    R = ex.raster
    mpu = ex.deck.scale.metres_per_unit if ex.deck.scale else None
    if not mpu:
        return []
    px_m = mpu / R.zoom
    gap = max(2, int(round(WALL_GAP_M / px_m)))
    min_px = MIN_SHARED_M / px_m
    space_of = ex.region_to_space
    out: list[Adjacency] = []
    seen = set()
    for reg, sid in space_of.items():
        if only_ids is not None and sid not in only_ids:
            continue
        x, y, w, h, _ = R.stats[reg]
        x0, y0 = max(0, x - gap - 1), max(0, y - gap - 1)
        x1, y1 = min(R.labels.shape[1], x + w + gap + 1), min(R.labels.shape[0], y + h + gap + 1)
        lab = R.labels[y0:y1, x0:x1]
        a = (lab == reg).astype(np.uint8)
        boundary = a - cv2.erode(a, np.ones((3, 3), np.uint8))
        # distance from every pixel to region A
        dist_a = cv2.distanceTransform((1 - a).astype(np.uint8), cv2.DIST_L2, 3)
        near = (dist_a <= gap) & (lab > 0) & (lab != reg)
        neighbours, counts = np.unique(lab[near], return_counts=True)
        steel = R.steel[y0:y1, x0:x1]
        for nb, cnt in zip(neighbours.tolist(), counts.tolist()):
            sid_b = space_of.get(nb)
            if not sid_b:
                continue
            key = tuple(sorted((sid, sid_b)))
            if key in seen:
                continue
            # boundary pixels of A that are within gap of B
            b = (lab == nb).astype(np.uint8)
            dist_b = cv2.distanceTransform((1 - b).astype(np.uint8), cv2.DIST_L2, 3)
            shared = (boundary > 0) & (dist_b <= gap)
            n = int(shared.sum())
            if n < min_px:
                continue
            seen.add(key)
            steel_near = cv2.dilate(steel, np.ones((2 * gap + 1, 2 * gap + 1), np.uint8))
            frac = float((steel_near[shared] > 0).mean()) if (n and R.has_steel_layer) else None
            ys, xs = np.nonzero(shared)
            px0, py0 = R.to_pt(xs.min() + x0, ys.min() + y0)
            px1, py1 = R.to_pt(xs.max() + x0, ys.max() + y0)
            eid = f"EV_ADJ_{key[0]}_{key[1]}"
            evidence.append(Evidence(
                id=eid, page=ex.deck.page,
                bbox={"page": ex.deck.page, "x0": px0, "y0": py0, "x1": px1 + 0.5, "y1": py1 + 0.5},
                source=Provenance.DERIVED_GEOMETRY,
                method=f"Boundary pixels of both regions within {WALL_GAP_M} m across a drawn boundary line",
                detail={"shared_length_m": round(n * px_m, 2), "steel_layer_fraction": round(frac, 2) if frac is not None else None},
            ))
            out.append(Adjacency(
                id=f"ADJ_{key[0]}_{key[1]}", space_a=key[0], space_b=key[1], relation=AdjacencyRelation.SHARED_BOUNDARY,
                shared_length_m=round(n * px_m, 2), boundary_on_steel_layer_fraction=round(frac, 2) if frac is not None else None,
                evidence_ids=[eid],
            ))
    return out


def vertical_overlaps(extractions: list[DeckExtraction], evidence: list[Evidence], only_ids: set[str]) -> list[Adjacency]:
    ordered = sorted([e for e in extractions if e.deck.elevation_mm is not None], key=lambda e: e.deck.elevation_mm)
    out = []

    def poly(ex, sp):
        pts = [local_coords(ex.deck, x, y) for x, y in sp.polygon]
        if len(pts) < 3 or any(p is None for p in pts):
            return None
        pg = Polygon(pts)
        return pg if pg.is_valid else pg.buffer(0)

    for lower, upper in zip(ordered, ordered[1:]):
        for a_ex, b_ex in ((lower, upper), (upper, lower)):
            for sa in a_ex.spaces:
                if sa.id not in only_ids:
                    continue
                pa = poly(a_ex, sa)
                if pa is None:
                    continue
                for sb in b_ex.spaces:
                    if sb.kind in (SpaceKind.UNKNOWN,) and not sb.name:
                        continue
                    pb = poly(b_ex, sb)
                    if pb is None:
                        continue
                    inter = pa.intersection(pb).area
                    if inter < 2.0:
                        continue
                    key = tuple(sorted((sa.id, sb.id)))
                    if any(o.space_a == key[0] and o.space_b == key[1] for o in out):
                        continue
                    eid = f"EV_VADJ_{key[0]}_{key[1]}"
                    evidence.append(Evidence(
                        id=eid, page=a_ex.deck.page, bbox=sa.bbox, source=Provenance.DERIVED_GEOMETRY,
                        method="Plan footprints overlap on consecutive decks (aligned by frame numbers and centreline)",
                        detail={"overlap_m2": round(inter, 1), "decks": [a_ex.deck.name, b_ex.deck.name]},
                    ))
                    out.append(Adjacency(
                        id=f"VADJ_{key[0]}_{key[1]}", space_a=key[0], space_b=key[1],
                        relation=AdjacencyRelation.VERTICAL_OVERLAP, overlap_area_m2=round(inter, 1),
                        certainty="inferred", evidence_ids=[eid],
                    ))
    return out
