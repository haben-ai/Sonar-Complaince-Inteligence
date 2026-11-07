"""Door detection from CAD door-swing symbols.

A hinged door on a GA is drawn as a leaf line plus a quarter-circle swing arc centred on
the hinge. We find quarter arcs (Bezier segments) on boundary layers, recover the hinge
point and radius exactly from the curve control points, and then sample the region
raster on both sides of the opening to find which two spaces the door joins.

Leaf width = arc radius x drawing scale. This is a DERIVED quantity of the drawn symbol
(GA symbols are often generic), and it is not the clear opening width.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from backend.extraction.pdf_parser import ParsedPage
from backend.engineering.room_extraction import DeckRaster
from backend.models.engineering_models import Deck

DOOR_LAYERS = {"Lining", "Lining1", "Lining2", "Doors", "Door_WT", "Steel_1", "Steel_2", "Steel_3", "Steel_4", "Steel 4"}


@dataclass
class DoorArc:
    hinge: tuple[float, float]
    e1: tuple[float, float]
    e2: tuple[float, float]
    radius: float
    layer: str

    @property
    def bbox(self):
        xs = [self.hinge[0], self.e1[0], self.e2[0], self.e1[0] + self.e2[0] - self.hinge[0]]
        ys = [self.hinge[1], self.e1[1], self.e2[1], self.e1[1] + self.e2[1] - self.hinge[1]]
        return min(xs), min(ys), max(xs), max(ys)


def _center(p0, p1, p2, p3):
    t0 = np.array([p1.x - p0.x, p1.y - p0.y])
    t3 = np.array([p3.x - p2.x, p3.y - p2.y])
    A = np.array([t0, t3])
    if abs(np.linalg.det(A)) < 1e-9:
        return None
    rhs = np.array([t0 @ np.array([p0.x, p0.y]), t3 @ np.array([p3.x, p3.y])])
    return np.linalg.solve(A, rhs)


def _polylines(items) -> list[list[tuple[float, float]]]:
    """Connected runs of straight and curved (sampled Bezier) segments in a path."""
    runs, cur = [], []
    for it in items:
        if it[0] == "l":
            pts = [(it[1].x, it[1].y), (it[2].x, it[2].y)]
        elif it[0] == "c":
            p0, p1, p2, p3 = it[1], it[2], it[3], it[4]
            pts = []
            for t in np.linspace(0, 1, 9):
                mt = 1 - t
                pts.append((mt**3 * p0.x + 3 * mt**2 * t * p1.x + 3 * mt * t**2 * p2.x + t**3 * p3.x,
                            mt**3 * p0.y + 3 * mt**2 * t * p1.y + 3 * mt * t**2 * p2.y + t**3 * p3.y))
        else:
            if len(cur) > 1:
                runs.append(cur)
            cur = []
            continue
        if cur and math.dist(cur[-1], pts[0]) < 0.08:
            cur.extend(pts[1:])
        else:
            if len(cur) > 1:
                runs.append(cur)
            cur = list(pts)
    if len(cur) > 1:
        runs.append(cur)
    return runs


def _split_at_corners(pl: list[tuple[float, float]], max_turn_deg=25.0) -> list[list[tuple[float, float]]]:
    pieces, cur = [], [pl[0]]
    for i in range(1, len(pl) - 1):
        cur.append(pl[i])
        v1 = np.subtract(pl[i], pl[i - 1]); v2 = np.subtract(pl[i + 1], pl[i])
        n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
        if n1 < 1e-6 or n2 < 1e-6:
            continue
        turn = math.degrees(math.acos(max(-1, min(1, float(v1 @ v2 / (n1 * n2))))))
        if turn > max_turn_deg:
            pieces.append(cur); cur = [pl[i]]
    cur.append(pl[-1])
    pieces.append(cur)
    return pieces


def _fit_circle(pts: np.ndarray):
    """Algebraic (Kasa) circle fit. Returns centre, radius, max abs residual."""
    x, y = pts[:, 0], pts[:, 1]
    A = np.c_[2 * x, 2 * y, np.ones(len(x))]
    sol, *_ = np.linalg.lstsq(A, x**2 + y**2, rcond=None)
    cx, cy = sol[0], sol[1]
    r = math.sqrt(max(sol[2] + cx**2 + cy**2, 0))
    res = np.abs(np.hypot(x - cx, y - cy) - r).max()
    return np.array([cx, cy]), r, res


def _arc_from_points(pts: np.ndarray, rmin: float, rmax: float, layer: str) -> DoorArc | None:
    if len(pts) < 4:
        return None
    c, r, res = _fit_circle(pts)
    if not (rmin <= r <= rmax) or res > 0.04 * r:
        return None
    s, e = pts[0], pts[-1]
    # sweep = sum of angle increments (robust for any direction)
    ang = np.unwrap(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))
    sweep = abs(math.degrees(ang[-1] - ang[0]))
    if not 80 <= sweep <= 100:
        return None
    return DoorArc((float(c[0]), float(c[1])), (float(s[0]), float(s[1])), (float(e[0]), float(e[1])), float(r), layer)


def find_door_arcs(page: ParsedPage, deck: Deck, min_r_m=0.45, max_r_m=1.7, path_filter=None) -> list[DoorArc]:
    b = deck.bbox
    mpu = deck.scale.metres_per_unit if deck.scale else None
    rmin = min_r_m / mpu if mpu else 8
    rmax = max_r_m / mpu if mpu else 32
    arcs: list[DoorArc] = []
    paths = page.paths_in(b.x0, b.y0, b.x1, b.y1, DOOR_LAYERS) if path_filter is None else \
        [p for p in page.paths_in(b.x0, b.y0, b.x1, b.y1) if path_filter(p)]
    for p in paths:
        # (a) arcs flattened to polylines (AutoCAD plot output)
        for pl in _polylines(p.items):
            for piece in _split_at_corners(pl):
                a = _arc_from_points(np.array(piece), rmin, rmax, p.layer)
                if a:
                    arcs.append(a)
        # (b) arcs kept as Bezier curves
        # chain consecutive bezier segments
        chains, cur = [], []
        for it in p.items:
            if it[0] == "c":
                if cur and (abs(cur[-1][4].x - it[1].x) > 0.05 or abs(cur[-1][4].y - it[1].y) > 0.05):
                    chains.append(cur); cur = []
                cur.append(it)
            else:
                if cur:
                    chains.append(cur); cur = []
        if cur:
            chains.append(cur)
        for ch in chains:
            first, last = ch[0], ch[-1]
            c = _center(first[1], first[2], last[3], last[4])
            if c is None:
                continue
            s = np.array([first[1].x, first[1].y]); e = np.array([last[4].x, last[4].y])
            r1, r2 = np.linalg.norm(s - c), np.linalg.norm(e - c)
            if not (rmin <= r1 <= rmax) or abs(r1 - r2) > 0.06 * r1:
                continue
            cosang = float(np.dot(s - c, e - c) / (r1 * r2))
            ang = math.degrees(math.acos(max(-1, min(1, cosang))))
            if not 80 <= ang <= 100:
                continue
            # the arc must actually bulge around the centre (reject S-curves): check midpoint radius
            mid = ch[len(ch) // 2]
            mp = np.array([mid[1].x, mid[1].y])
            if abs(np.linalg.norm(mp - c) - r1) > 0.1 * r1:
                continue
            arcs.append(DoorArc((float(c[0]), float(c[1])), (float(s[0]), float(s[1])), (float(e[0]), float(e[1])), float((r1 + r2) / 2), p.layer))
    # de-duplicate (same hinge and radius)
    out: list[DoorArc] = []
    for a in arcs:
        if any(math.dist(a.hinge, o.hinge) < 0.8 and abs(a.radius - o.radius) < 0.8 for o in out):
            continue
        out.append(a)
    return out


@dataclass
class DoorResolution:
    swing_side: int      # region the door swings into
    other_side: int      # region on the other side of the opening
    status: str          # resolved | one_side_only | unresolved
    samples: dict


def resolve_door(arc: DoorArc, raster: DeckRaster, min_region_px: int) -> DoorResolution:
    C = np.array(arc.hinge); r = arc.radius
    u1 = (np.array(arc.e1) - C) / r
    u2 = (np.array(arc.e2) - C) / r
    diag = (u1 + u2) / np.linalg.norm(u1 + u2)

    def valid(reg):
        return (reg > 0 and reg not in raster.exterior_ids and raster.stats[reg][4] >= min_region_px
                and not raster.is_thin(reg))

    def first_region(points):
        for pt in points:
            reg = raster.region_at(float(pt[0]), float(pt[1]))
            if valid(reg):
                return reg
        return 0

    rA = first_region([C + diag * r * f for f in (1.12, 1.2, 1.3, 1.45, 1.6)])
    rQ = first_region([C + diag * r * f for f in (0.4, 0.3, 0.55)])
    across1 = first_region([C + u1 * r * 0.5 - u2 * r * d for d in (0.12, 0.2, 0.3, 0.45, 0.6, 0.8, 1.0)])
    across2 = first_region([C + u2 * r * 0.5 - u1 * r * d for d in (0.12, 0.2, 0.3, 0.45, 0.6, 0.8, 1.0)])
    samples = {"beyond_arc": rA, "swing_quarter": rQ, "across_edge_1": across1, "across_edge_2": across2}

    cands = [x for x in (across1, across2) if x and x != rA]
    other = 0
    if len(cands) == 1:
        other = cands[0]
    elif len(cands) == 2:
        other = rQ if rQ in cands else max(cands, key=lambda reg: raster.stats[reg][4])
    elif rQ and rQ != rA:
        other = rQ
    if rA and other:
        return DoorResolution(rA, other, "resolved", samples)
    if rA or other:
        return DoorResolution(rA or other, 0, "one_side_only", samples)
    return DoorResolution(0, 0, "unresolved", samples)
