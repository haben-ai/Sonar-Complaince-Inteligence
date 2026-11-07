"""Follow leader lines from an outside label to the room it names.

GA sets often place room labels outside the plan with a leader line (short tick + straight
or bent line) ending inside the room. We look for straight vector segments that start next
to the label box and leave it, then follow connected segments to the far end.
"""
from __future__ import annotations

import math

from backend.extraction.pdf_parser import ParsedPage


class SegmentIndex:
    def __init__(self, page: ParsedPage, bbox, max_width: float = 0.3, cell: float = 6.0):
        self.cell = cell
        self.segs: list[tuple[tuple[float, float], tuple[float, float]]] = []
        self.grid: dict[tuple[int, int], list[int]] = {}
        x0, y0, x1, y1 = bbox
        for p in page.paths_in(x0 - 80, y0 - 80, x1 + 80, y1 + 80):
            if p.kind == "f" or p.width > max_width:
                continue
            for it in p.items:
                if it[0] != "l":
                    continue
                a, b = (it[1].x, it[1].y), (it[2].x, it[2].y)
                if math.dist(a, b) < 1.0:
                    continue
                k = len(self.segs)
                self.segs.append((a, b))
                for pt in (a, b):
                    self.grid.setdefault((int(pt[0] // cell), int(pt[1] // cell)), []).append(k)

    def near(self, pt, r):
        cx, cy = int(pt[0] // self.cell), int(pt[1] // self.cell)
        out = set()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                out.update(self.grid.get((cx + dx, cy + dy), []))
        return [k for k in out if min(math.dist(pt, self.segs[k][0]), math.dist(pt, self.segs[k][1])) <= r]


def leader_target(idx: SegmentIndex, box: tuple[float, float, float, float], h: float) -> tuple[float, float] | None:
    """Far end of the longest leader starting at the label box (x0, y0, x1, y1); h = text height."""
    ex = (box[0] - 1.6 * h, box[1] - 0.8 * h, box[2] + 1.6 * h, box[3] + 0.8 * h)

    def inside(pt):
        return ex[0] <= pt[0] <= ex[2] and ex[1] <= pt[1] <= ex[3]

    best = None
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    cand = set()
    for pt in ((box[0], cy), (box[2], cy), (cx, box[1]), (cx, box[3]), (box[0], box[1]), (box[0], box[3])):
        cand.update(idx.near(pt, 2.2 * h))
    for k in cand:
        a, b = idx.segs[k]
        if inside(a) == inside(b):
            continue                 # glyph stroke (both inside) or unrelated (both outside)
        start, far = (a, b) if inside(a) else (b, a)
        length = math.dist(start, far)
        used = {k}
        cur = far
        for _ in range(6):           # follow bends
            nxt = [j for j in idx.near(cur, 0.8) if j not in used]
            if not nxt:
                break
            j = max(nxt, key=lambda j: math.dist(*idx.segs[j]))
            used.add(j)
            a2, b2 = idx.segs[j]
            cur = b2 if math.dist(cur, a2) < math.dist(cur, b2) else a2
            length += math.dist(a2, b2)
        if length >= 3 * h and (best is None or length > best[0]):
            best = (length, cur)
    return best[1] if best else None
