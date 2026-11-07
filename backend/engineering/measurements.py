"""Deterministic measurements needed by regulatory checks (scale cross-checked, derived_geometry).

* max_travel_from_door_m: geodesic (walking) distance from a door opening to the farthest
  point of the space, computed on the free-space raster (Dijkstra, 8-neighbour). Used for
  dead-end corridor length (SOLAS II-2/13.3.3.4) and the 5 m travel-distance exception
  (II-2/13.4.2.3).
* min_distance_to_side_shell_m: shortest plan-view distance from a fuel-tank polygon to the
  hull outline drawn on CAD layer Steel_1 (MARPOL I/12A.7 side protection).
"""
from __future__ import annotations

import heapq
import math

import cv2
import numpy as np
from shapely.geometry import LineString, MultiLineString, Polygon

from backend.extraction.pdf_parser import ParsedPage
from backend.engineering.room_extraction import _flatten

DOWN = 4  # raster down-sampling for geodesics (1 cell = 4 px = 1 pt = 53 mm at 1:150)


def _geodesic_max(mask: np.ndarray, seeds: list[tuple[int, int]]) -> float:
    h, w = mask.shape
    dist = np.full((h, w), np.inf, np.float32)
    pq = []
    for (y, x) in seeds:
        if 0 <= y < h and 0 <= x < w and mask[y, x]:
            dist[y, x] = 0
            pq.append((0.0, y, x))
    heapq.heapify(pq)
    nbrs = [(-1, 0, 1), (1, 0, 1), (0, -1, 1), (0, 1, 1), (-1, -1, math.sqrt(2)), (-1, 1, math.sqrt(2)), (1, -1, math.sqrt(2)), (1, 1, math.sqrt(2))]
    while pq:
        d, y, x = heapq.heappop(pq)
        if d > dist[y, x]:
            continue
        for dy, dx, c in nbrs:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and d + c < dist[ny, nx]:
                dist[ny, nx] = d + c
                heapq.heappush(pq, (d + c, ny, nx))
    finite = dist[np.isfinite(dist)]
    return float(finite.max()) if finite.size else float("nan")


def travel_distances(ex) -> None:
    """Fill space.measurements['max_travel_from_door_m'] = {door_id: metres} for every space with doors."""
    R = ex.raster
    if not ex.deck.scale:
        return
    m_per_cell = ex.deck.scale.metres_per_unit / R.zoom * DOWN
    reg_of = {sid: reg for reg, sid in ex.region_to_space.items()}
    doors_by_space: dict[str, list] = {}
    for d in ex.doors:
        for sid in d.space_ids:
            doors_by_space.setdefault(sid, []).append(d)
    for sp in ex.spaces:
        reg = reg_of.get(sp.id)
        ds = doors_by_space.get(sp.id)
        if reg is None or not ds:
            continue
        x, y, w, h, _ = R.stats[reg]
        full = (R.labels[y:y + h, x:x + w] == reg).astype(np.uint8)
        small = cv2.resize(full, (max(1, w // DOWN), max(1, h // DOWN)), interpolation=cv2.INTER_NEAREST)
        out = {}
        for d in ds:
            # seed: region pixels inside the door symbol's box (the swing area / opening)
            bx0, by0 = R.to_px(d.bbox.x0, d.bbox.y0)
            bx1, by1 = R.to_px(d.bbox.x1, d.bbox.y1)
            sub = full[max(0, by0 - y):max(0, by1 - y) + 1, max(0, bx0 - x):max(0, bx1 - x) + 1]
            ys, xs = np.nonzero(sub)
            if not len(ys):
                continue
            seeds = list({((int(yy) + max(0, by0 - y)) // DOWN, (int(xx) + max(0, bx0 - x)) // DOWN) for yy, xx in zip(ys[::7], xs[::7])})
            dmax = _geodesic_max(small, seeds)
            if math.isfinite(dmax):
                out[d.id] = round(dmax * m_per_cell, 2)
        if out:
            sp.measurements["max_travel_from_door_m"] = {
                "values": out, "unit": "m", "provenance": "derived_geometry",
                "method": "Geodesic distance inside the extracted space from the door opening to the farthest point "
                          f"(Dijkstra on free-space raster, cell {m_per_cell*1000:.0f} mm, scale cross-checked)",
                "evidence_ids": [e for dd in ds for e in dd.evidence_ids],
            }


def hull_lines(page: ParsedPage, deck) -> MultiLineString | None:
    b = deck.bbox
    lines = []
    for p in page.paths_in(b.x0, b.y0, b.x1, b.y1, {"Steel_1"}):
        if (p.rect[2] - p.rect[0]) > 0.4 * (b.x1 - b.x0):
            for pl in _flatten(p.items):
                if len(pl) > 1:
                    lines.append(LineString(pl))
    return MultiLineString(lines) if lines else None


def tank_hull_distances(ex, page: ParsedPage) -> None:
    hull = hull_lines(page, ex.deck)
    if hull is None or not ex.deck.scale:
        return
    mpu = ex.deck.scale.metres_per_unit
    for sp in ex.spaces:
        if not (sp.hazard and sp.hazard.category == "fuel_oil_tank_or_space") or len(sp.polygon) < 3:
            continue
        pg = Polygon(sp.polygon)
        if not pg.is_valid:
            pg = pg.buffer(0)
        d = pg.boundary.distance(hull) * mpu
        sp.measurements["min_distance_to_side_shell_m"] = {
            "value": round(d, 2), "unit": "m", "provenance": "derived_geometry",
            "method": "Plan-view distance from the tank polygon to the hull outline on CAD layer Steel_1 "
                      "(moulded line vs. drawn line not distinguished; resolution ~0.05 m)",
            "evidence_ids": list(sp.evidence_ids),
        }
