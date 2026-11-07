"""Room / space extraction from vector wall geometry.

1. Rasterise only the CAD layers that carry boundaries (linings, steel, doors, windows)
   for one deck view. Furniture, machinery and equipment layers are excluded.
2. Text is not drawn (it is not part of the path set), so labels never break regions.
3. Free space is split into connected regions (OpenCV connected components). Door swing
   symbols (leaf + arc) close door openings, so each room becomes its own region; the door
   itself is then resolved separately (see door_detection.py).
4. Regions are matched with the text labels lying inside them.

The raster is an intermediate computation; every resulting polygon is reported back in
PDF coordinates together with the method used.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable

import cv2
import numpy as np

from backend.extraction.pdf_parser import ParsedPage, VectorPath, Word
from backend.models.engineering_models import BBox, Deck, Provenance

WALL_LAYERS = {
    "Lining", "Lining1", "Lining2", "Steel_1", "Steel_2", "Steel_3", "Steel_4", "Steel 4",
    "Doors", "Door_WT", "Windows", "stairs", "Collision Bulkhead",
}
STEEL_LAYERS = {"Steel_1", "Steel_2", "Steel_3", "Steel_4", "Steel 4", "Collision Bulkhead"}

ZOOM = 4.0  # raster pixels per PDF point (1 px = 13 mm at 1:150)


@dataclass
class DeckSource:
    """How to read one deck view. Default: CAD-layered vector PDF with real text (DANA V).
    Layerless / outlined-text PDFs supply OCR words and width-based wall selection instead."""
    words: list | None = None                         # None -> PDF text objects
    text_provenance: Provenance = Provenance.PDF_TEXT
    wall_filter: Callable | None = None               # None -> CAD layer names (WALL_LAYERS)
    door_filter: Callable | None = None               # None -> CAD layer names (DOOR_LAYERS)
    erase_text: bool = False                          # blank OCR word boxes in the wall raster (text drawn as strokes)
    leader_labels: bool = False                       # labels sit outside rooms with leader lines
    method_note: str = "CAD layers Lining*/Steel*/Doors/Windows"
    close_gaps_m: float = 0.0                         # bridge gaps up to this size (dashed lines, unsnapped joints)


def _flatten(items) -> list[list[tuple[float, float]]]:
    """Convert PyMuPDF path items into polylines."""
    lines = []
    for it in items:
        op = it[0]
        if op == "l":
            lines.append([(it[1].x, it[1].y), (it[2].x, it[2].y)])
        elif op == "c":
            p0, p1, p2, p3 = it[1], it[2], it[3], it[4]
            pts = []
            for t in np.linspace(0, 1, 12):
                mt = 1 - t
                x = mt**3 * p0.x + 3 * mt**2 * t * p1.x + 3 * mt * t**2 * p2.x + t**3 * p3.x
                y = mt**3 * p0.y + 3 * mt**2 * t * p1.y + 3 * mt * t**2 * p2.y + t**3 * p3.y
                pts.append((x, y))
            lines.append(pts)
        elif op == "re":
            r = it[1]
            lines.append([(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1), (r.x0, r.y0)])
        elif op == "qu":
            q = it[1]
            lines.append([(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y), (q.ul.x, q.ul.y)])
    return lines


@dataclass
class DeckRaster:
    deck: Deck
    x0: float
    y0: float
    zoom: float
    walls: np.ndarray          # uint8 0/1, boundary pixels (dilated)
    steel: np.ndarray          # uint8 0/1, steel-layer pixels (dilated)
    labels: np.ndarray         # int32 region ids (0 = wall)
    stats: np.ndarray
    n: int
    exterior_ids: set[int] = field(default_factory=set)
    max_width_px: np.ndarray | None = None   # per region: 2 x max inscribed radius (clear width)
    mean_width_px: np.ndarray | None = None  # per region: 2 x area / perimeter
    has_steel_layer: bool = True

    def is_thin(self, reg: int, min_width_m: float = 0.45, min_mean_width_m: float = 0.4) -> bool:
        """Cavities between double boundary lines (wall thickness), not usable spaces."""
        if self.max_width_px is None or not self.deck.scale:
            return False
        k = self.deck.scale.metres_per_unit / self.zoom
        return self.max_width_px[reg] * k < min_width_m or self.mean_width_px[reg] * k < min_mean_width_m

    def to_px(self, x: float, y: float) -> tuple[int, int]:
        return int(round((x - self.x0) * self.zoom)), int(round((y - self.y0) * self.zoom))

    def to_pt(self, px: float, py: float) -> tuple[float, float]:
        return self.x0 + px / self.zoom, self.y0 + py / self.zoom

    def region_at(self, x: float, y: float, search_px: int = 0) -> int:
        px, py = self.to_px(x, y)
        h, w = self.labels.shape
        if not (0 <= px < w and 0 <= py < h):
            return -1
        v = int(self.labels[py, px])
        if v or not search_px:
            return v
        win = self.labels[max(0, py - search_px): py + search_px + 1, max(0, px - search_px): px + search_px + 1]
        vals, counts = np.unique(win[win > 0], return_counts=True)
        return int(vals[np.argmax(counts)]) if len(vals) else 0


def rasterize_deck(page: ParsedPage, deck: Deck, extra_lines: list[list[tuple[float, float]]] | None = None,
                   source: DeckSource | None = None) -> DeckRaster:
    b = deck.bbox
    w = int((b.x1 - b.x0) * ZOOM) + 1
    h = int((b.y1 - b.y0) * ZOOM) + 1
    walls = np.zeros((h, w), np.uint8)
    steel = np.zeros((h, w), np.uint8)
    SHIFT = 4
    f = ZOOM * (1 << SHIFT)

    def draw(mask, polylines):
        pts = [np.array([[(x - b.x0) * f, (y - b.y0) * f] for x, y in pl], np.int32) for pl in polylines if len(pl) > 1]
        if pts:
            cv2.polylines(mask, pts, False, 1, thickness=1, lineType=cv2.LINE_8, shift=SHIFT)

    layered = not (source and source.wall_filter)
    paths = page.paths_in(b.x0, b.y0, b.x1, b.y1, WALL_LAYERS) if layered else \
        [p for p in page.paths_in(b.x0, b.y0, b.x1, b.y1) if source.wall_filter(p)]
    for p in paths:
        pl = _flatten(p.items)
        draw(walls, pl)
        if layered and p.layer in STEEL_LAYERS:
            draw(steel, pl)
    if extra_lines:
        draw(walls, extra_lines)
    if source and source.erase_text and source.words:
        for w in source.words:
            if b.x0 <= w.cx <= b.x1 and b.y0 <= w.cy <= b.y1:
                x0, y0 = int((w.x0 - b.x0) * ZOOM) - 2, int((w.y0 - b.y0) * ZOOM) - 2
                x1, y1 = int((w.x1 - b.x0) * ZOOM) + 2, int((w.y1 - b.y0) * ZOOM) + 2
                walls[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = 0
    # close hairline gaps of CAD joints (<= ~0.5 pt = 26 mm)
    k = np.ones((3, 3), np.uint8)
    walls = cv2.dilate(walls, k)
    if source and source.close_gaps_m and deck.scale:
        g = max(3, int(round(source.close_gaps_m / (deck.scale.metres_per_unit / ZOOM))))
        walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (g, g)))
    steel = cv2.dilate(steel, k, iterations=2)
    n, labels, stats, _ = cv2.connectedComponentsWithStats((1 - walls).astype(np.uint8), connectivity=4)
    ext = set(np.unique(np.concatenate([labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])).tolist()) - {0}
    dist = cv2.distanceTransform((1 - walls).astype(np.uint8), cv2.DIST_L2, 3)
    maxd = np.zeros(n, np.float32)
    np.maximum.at(maxd, labels.ravel(), dist.ravel())
    free = (labels > 0).astype(np.uint8)
    edge = free - cv2.erode(free, np.ones((3, 3), np.uint8))
    perim = np.bincount(labels[edge > 0].ravel(), minlength=n).astype(np.float32)
    mean_w = 2 * stats[:, 4] / np.maximum(perim, 1)
    R = DeckRaster(deck, b.x0, b.y0, ZOOM, walls, steel, labels, stats, n, ext, 2 * maxd, mean_w)
    R.has_steel_layer = layered
    return R


# ---------------------------------------------------------------------------
# labels


NOISE_TOKENS = {"WT", "IN", "OUT", "UP", "DN", "ESC", "COG", "V", "SC", "LO", "FW", "WB", "HWB"}
MARKER_TOKENS = {"UP", "DN", "ESC", "IN", "OUT"}


@dataclass
class LabelGroup:
    words: list[Word]

    @property
    def text(self) -> str:
        ws = sorted(self.words, key=lambda w: (round(w.cy / 3), w.x0))
        return " ".join(w.text for w in ws)

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return (min(w.x0 for w in self.words), min(w.y0 for w in self.words),
                max(w.x1 for w in self.words), max(w.y1 for w in self.words))


AREA_RX = re.compile(r"(\d+(?:[.,]\d+)?)\s*m2?$", re.I)


def parse_area(tokens: list[str]) -> tuple[float | None, list[str]]:
    """Find 'NN m2' / 'NN m' + '2' / 'NNm2' in a token list. Returns (area, remaining tokens)."""
    out, area, i = [], None, 0
    while i < len(tokens):
        t = tokens[i]
        nxt = tokens[i + 1] if i + 1 < len(tokens) else ""
        if re.fullmatch(r"\d+(?:[.,]\d+)?m2", t, re.I):
            area = float(t[:-2].replace(",", ".")); i += 1; continue
        if re.fullmatch(r"\d+(?:[.,]\d+)?", t) and nxt.lower() in ("m2", "m²"):
            area = float(t.replace(",", ".")); i += 2; continue
        if re.fullmatch(r"\d+(?:[.,]\d+)?", t) and nxt.lower() == "m":
            area = float(t.replace(",", ".")); i += 2
            if i < len(tokens) and tokens[i] == "2":
                i += 1
            continue
        out.append(t); i += 1
    return area, out


def is_frame_label(w: Word, deck: Deck) -> bool:
    return bool(re.fullmatch(r"-?\d{1,3}", w.text)) and deck.centerline_y is not None and abs(w.cy - deck.centerline_y) < 4
