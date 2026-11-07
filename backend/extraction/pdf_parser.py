"""Low-level PDF access: text with coordinates, vector paths with CAD layers, page rendering.

DANA V's GA is an AutoCAD export: text and geometry are vector objects and the CAD
layer names survive as PDF optional-content groups. We read those directly instead
of OCR-ing a raster, which is both more accurate and fully traceable.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

import pymupdf


@dataclass
class Word:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    block: int
    line: int
    conf: float = 100.0          # OCR confidence (100 for real PDF text)

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


@dataclass
class VectorPath:
    layer: str          # CAD layer (base name, AutoCAD xref prefix stripped)
    raw_layer: str
    rect: tuple[float, float, float, float]
    items: list         # PyMuPDF path items: ('l', p1, p2), ('c', p1, p2, p3, p4), ('re', rect, ...), ('qu', quad)
    width: float
    kind: str = ""      # 's' stroke, 'f' fill, 'fs' both


def _xform_item(it, m):
    op = it[0]
    if op in ("l", "c"):
        return (op, *[pt * m for pt in it[1:]])
    if op == "re":
        return ("qu", it[1].quad * m) if len(it) < 3 else ("qu", it[1].quad * m, *it[2:])
    if op == "qu":
        return ("qu", it[1] * m, *it[2:])
    return it


def base_layer(name: str | None) -> str:
    if not name:
        return ""
    return name.split("$")[-1]


@dataclass
class ParsedPage:
    number: int
    width: float
    height: float
    words: list[Word]
    paths: list[VectorPath] = field(repr=False)

    def words_in(self, x0, y0, x1, y1) -> list[Word]:
        return [w for w in self.words if x0 <= w.cx <= x1 and y0 <= w.cy <= y1]

    def paths_in(self, x0, y0, x1, y1, layers: set[str] | None = None) -> list[VectorPath]:
        out = []
        for p in self.paths:
            r = p.rect
            if r[2] < x0 or r[0] > x1 or r[3] < y0 or r[1] > y1:
                continue
            if layers is not None and p.layer not in layers:
                continue
            out.append(p)
        return out


class PdfDocument:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.doc = pymupdf.open(str(self.path))
        self._pages: dict[int, ParsedPage] = {}

    @cached_property
    def sha256(self) -> str:
        return hashlib.sha256(self.path.read_bytes()).hexdigest()

    @property
    def page_count(self) -> int:
        return len(self.doc)

    @property
    def metadata(self) -> dict:
        return {k: v for k, v in (self.doc.metadata or {}).items() if v}

    @cached_property
    def layer_names(self) -> list[str]:
        return sorted({base_layer(v["name"]) for v in self.doc.get_ocgs().values()})

    def page(self, n: int) -> ParsedPage:
        if n not in self._pages:
            p = self.doc[n]
            words = [Word(w[4], w[0], w[1], w[2], w[3], w[5], w[6]) for w in p.get_text("words")]
            paths = []
            # Vector paths come in unrotated page space; words and renders are in the rotated (displayed)
            # space. Transform paths so everything shares the displayed coordinate system.
            rot = p.rotation_matrix if p.rotation else None
            for d in p.get_drawings():
                lay = d.get("layer") or ""
                items = d["items"]
                r = d["rect"]
                if rot is not None:
                    items = [_xform_item(it, rot) for it in items]
                    r = r * rot
                paths.append(
                    VectorPath(base_layer(lay), lay, (r.x0, r.y0, r.x1, r.y1), items, d.get("width") or 0.0,
                               d.get("type") or "")
                )
            self._pages[n] = ParsedPage(n, p.rect.width, p.rect.height, words, paths)
        return self._pages[n]

    def render_png(self, n: int, zoom: float = 1.0, clip: tuple[float, float, float, float] | None = None) -> bytes:
        p = self.doc[n]
        kw = {}
        if clip:
            kw["clip"] = pymupdf.Rect(*clip)
        pix = p.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False, annots=False, **kw)
        return pix.tobytes("png")

    def search_text(self, pattern: str) -> list[tuple[int, Word]]:
        rx = re.compile(pattern, re.I)
        hits = []
        for i in range(self.page_count):
            for w in self.page(i).words:
                if rx.search(w.text):
                    hits.append((i, w))
        return hits
