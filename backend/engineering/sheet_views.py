"""Locate drawing views on multi-sheet GA sets whose text is only readable by OCR.

* View titles: OCR'd "PLAN <id>" with the deck name on the next line and the view scale
  ("1/8\"=1'-0\"") below it (title-under-view convention).
* View extent: geometry cluster directly above the title (stroked paths, dilated).
* Scale: the stated view scale applies to the original sheet size printed in the title block
  ("SIZE D"); the PDF may be a reduced print, so metres-per-point = stated ratio x
  (original sheet width / PDF page width). The result is accepted as *cross-checked* only if
  deck-height labels on a section view ("MAIN DECK 19'-0\" ABL" ...) are spaced consistently
  with it.
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field

import cv2
import numpy as np

from backend.extraction.pdf_parser import ParsedPage, Word

ANSI = {"A": (11.0, 8.5), "B": (17.0, 11.0), "C": (22.0, 17.0), "D": (34.0, 22.0), "E": (44.0, 34.0)}
INCH = 0.0254


@dataclass
class View:
    page: int
    kind: str                    # plan | section | elevation | profile
    view_id: str
    name: str                    # e.g. "01 LEVEL"
    scale_text: str | None
    ratio: float | None          # e.g. 96 for 1/8" = 1'-0"
    bbox: tuple[float, float, float, float]
    title_words: list[Word] = field(default_factory=list)


def lines_of(words: list[Word], tol: float = 0.5) -> list[list[Word]]:
    ws = sorted(words, key=lambda w: (w.cy, w.x0))
    out: list[list[Word]] = []
    for w in ws:
        h = w.y1 - w.y0
        for ln in out:
            ref = ln[-1]
            if abs(ref.cy - w.cy) < tol * max(h, ref.y1 - ref.y0) and 0 <= w.x0 - ref.x1 < 3.5 * h:
                ln.append(w)
                break
        else:
            out.append([w])
    return out


def _text(ln: list[Word]) -> str:
    return " ".join(w.text for w in sorted(ln, key=lambda w: w.x0))


def norm_ocr(t: str) -> str:
    t = t.replace("”", '"').replace("“", '"').replace("’", "'").replace("°", "'").replace("—", "-").replace("–", "-")
    return re.sub(r"\bO(?=\d)|(?<=\d)O\b", "0", t)


def parse_scale(text: str) -> float | None:
    """'1/8"=1'-0"' -> 96 (tolerates OCR noise such as '| /8"=17-0"'); '1:100' -> 100."""
    t = norm_ocr(text).replace(" ", "")
    m = re.search(r"([13|lI!])?/(\d{1,2})[\"']?=1", t)
    if m:
        num = 3 if m.group(1) == "3" else 1
        den = int(m.group(2))
        if den in (2, 4, 8, 16, 32, 64):
            return 12 * den / num
    m = re.search(r"1:(\d{2,4})", t)
    return float(m.group(1)) if m else None


def roi_text(doc, page_no: int, rect, dpi: int = 900, psm: int = 6) -> str:
    """High-resolution OCR of a small region (titles, callouts)."""
    import pymupdf
    import pytesseract

    pix = doc[page_no].get_pixmap(dpi=dpi, clip=pymupdf.Rect(*rect), colorspace=pymupdf.csGRAY, annots=False)
    img = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w)
    img = cv2.copyMakeBorder(img, 25, 25, 25, 25, cv2.BORDER_CONSTANT, value=255)
    return pytesseract.image_to_string(img, config=f"--psm {psm}")


def sheet_size(words: list[Word]) -> str | None:
    for i, w in enumerate(words):
        if w.text.upper().rstrip(":") == "SIZE":
            for c in words:
                if c.text in ANSI and 0 < c.cy - w.cy < 25 and abs(c.cx - w.cx) < 25:
                    return c.text
    return None


def find_views(page: ParsedPage, words: list[Word], doc) -> list[View]:
    views = []
    seen = []
    for w in words:
        kw = w.text.upper().strip(".,")
        if kw not in ("PLAN", "SECTION", "ELEVATION", "PROFILE"):
            continue
        if any(abs(w.cx - x) < 30 and abs(w.cy - y) < 10 for x, y in seen):
            continue
        h = w.y1 - w.y0
        rect = (w.x0 - 9 * h, w.y0 - 0.6 * h, w.x1 + 11 * h, w.y1 + 4.2 * h)
        m = name = scale_line = None
        for dpi in (900, 1200, 600):              # OCR is noisy on thin stroked fonts: try a few renders
            txt = norm_ocr(roi_text(doc, page.number, rect, dpi=dpi))
            lns = [l.strip(" |_~-") for l in txt.splitlines() if l.strip(" |_~-")]
            if not lns:
                continue
            mm = re.search(r"(PLAN|SECTION|ELEVATION|PROFILE)\s+([0-9SO/]{1,2}[A-Z]?\s*-+\s*[0-9O]{1,2}[A-Z]?)\b", lns[0].upper())
            if not mm:
                continue
            m = m or mm
            rest = lns[1:]
            scale_line = scale_line or next((l for l in rest if parse_scale(l)), None)
            name = name or next((l for l in rest if re.search(r"LEVEL|DECK|TOP|PLATFORM|HOLD|LOOKING|PROFILE", l.upper())
                                 and not l.upper().startswith("LOOKING")), None)
            if name and scale_line:
                break
        if not m:
            continue            # e.g. 'PLAN VIEW - ...' in the title block
        seen.append((w.cx, w.cy))
        name = name or m.group(2)
        title_words = [x for x in words if rect[0] <= x.cx <= rect[2] and rect[1] <= x.cy <= rect[3]]
        bbox = _view_extent(page, title_words or [w], words)
        if bbox:
            views.append(View(page.number, m.group(1).lower(), re.sub(r"\s*-+\s*", "-", m.group(2)), deck_name(name),
                              scale_line, parse_scale(scale_line) if scale_line else None, bbox, title_words or [w]))
    return views


def deck_name(raw: str) -> str:
    t = norm_ocr(raw).upper().strip(" ,.")
    t = re.sub(r"^[QO0]*0?([1-9])\s*(?=LEVEL)", lambda m: f"0{m.group(1)} ", t)
    t = re.sub(r"^IST\b", "1ST", t)
    return re.sub(r"\s+", " ", t)


def _view_extent(page: ParsedPage, title: list[Word], words: list[Word]) -> tuple[float, float, float, float] | None:
    """Cluster of stroked geometry directly above the view title (text strokes and the sheet border zone excluded)."""
    Z = 0.5
    W, H = int(page.width * Z) + 1, int(page.height * Z) + 1
    mask = np.zeros((H, W), np.uint8)
    M = 42  # sheet border zone (frame, zone letters/numbers)
    for p in page.paths:
        r = p.rect
        if (r[2] - r[0]) > 0.6 * page.width or (r[3] - r[1]) > 0.6 * page.height:
            continue            # sheet border / frame
        if r[2] < M or r[3] < M or r[0] > page.width - M or r[1] > page.height - M:
            continue
        cv2.rectangle(mask, (int(r[0] * Z), int(r[1] * Z)), (int(r[2] * Z), int(r[3] * Z)), 1, -1)
    for w in words:             # glyph strokes of OCR'd text
        cv2.rectangle(mask, (int(w.x0 * Z) - 1, int(w.y0 * Z) - 1), (int(w.x1 * Z) + 1, int(w.y1 * Z) + 1), 0, -1)
    mask = cv2.dilate(mask, np.ones((9, 9), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    tx = int(statistics.mean(w.cx for w in title) * Z)
    ty = int(min(w.y0 for w in title) * Z)
    for y in range(ty - 3, max(0, ty - 90), -1):
        for dx in range(0, 120, 4):
            for x in (tx - dx, tx + dx):
                if 0 <= x < W and lab[y, x] > 0:
                    k = lab[y, x]
                    x0, y0, w, h, _ = stats[k]
                    if w * h < 15000 * Z * Z:
                        continue
                    return (max(x0 / Z, M), max(y0 / Z, M), min((x0 + w) / Z, page.width - M), min((y0 + h) / Z, page.height - M))
    return None


HEIGHT_RX = re.compile(r"(\d{1,3})\s*'?\s*-\s*(\d{1,2})\s*\"?\s*'?\s*ABL", re.I)


def level_labels(words: list[Word], doc, page_no: int) -> list[tuple[str, float, float, float]]:
    """(name, feet above baseline, y, x) from section-view callouts like 'MAIN DECK' / '19'-0\" ABL'."""
    out = []
    for w in words:
        if w.text.upper().strip(".,") != "ABL":
            continue
        h = w.y1 - w.y0
        txt = norm_ocr(roi_text(doc, page_no, (w.x0 - 9 * h, w.y0 - 2.2 * h, w.x1 + 9 * h, w.y1 + 0.4 * h)))
        lines = [l.strip(" _~|-") for l in txt.splitlines() if l.strip(" _~|-")]
        hit = next((HEIGHT_RX.search(l) for l in lines if HEIGHT_RX.search(l)), None)
        if not hit:
            continue
        ft = int(hit.group(1)) + int(hit.group(2)) / 12
        name = next((l for l in lines if not HEIGHT_RX.search(l)), "?").upper().replace(".", "")
        out.append((name, ft, w.cy, w.cx))
    return out


@dataclass
class ScaleResult:
    metres_per_unit: float | None
    basis: str
    cross_check: str | None
    ok: bool


def establish_scale(view_ratio: float | None, page_width_pt: float,
                    levels: list[tuple[str, float, float, float]], level_ratio: float | None) -> ScaleResult:
    """Calibrate metres per PDF point from deck-height callouts (feet ABL vs vertical spacing on a section
    view) and accept it only if it matches the stated view scale printed at a standard ANSI sheet reduction."""
    implied = []
    cols: dict[int, list] = {}
    for name, ft, y, x in levels:
        cols.setdefault(int(x // 60), []).append((ft, y))
    for pts in cols.values():
        pts.sort(key=lambda t: t[1])
        for (f1, y1), (f2, y2) in zip(pts, pts[1:]):
            if f1 - f2 >= 3 and y2 - y1 > 5:
                implied.append((f1 - f2) * 0.3048 / (y2 - y1))
    if len(implied) < 3:
        return ScaleResult(None, "fewer than 3 deck-height intervals readable on section views", None, False)
    med = statistics.median(implied)
    spread = statistics.median(abs(v / med - 1) for v in implied)
    basis = f"Calibrated from {len(implied)} deck-height intervals on a section view (OCR): {med*1000:.1f} mm/pt (median spread {spread*100:.1f} %)"
    if not level_ratio:
        return ScaleResult(None, basis, "section-view scale not readable - no independent cross-check", False)
    page_in = page_width_pt / 72
    best = None
    for size, (w_in, _) in ANSI.items():
        factor = page_in / w_in
        stated = (1 / 72) / factor * level_ratio * INCH
        dev = abs(stated / med - 1)
        if best is None or dev < best[0]:
            best = (dev, size, factor, stated)
    dev, size, factor, stated = best
    ok = dev < 0.03 and spread < 0.05
    cc = (f"Stated scale 1:{level_ratio:g} printed from an ANSI {size} sheet at {factor:.3f}x gives {stated*1000:.1f} mm/pt: "
          f"{dev*100:.1f} % from the deck-height calibration ({'consistent' if ok else 'INCONSISTENT'}, tolerance 3 %).")
    return ScaleResult(stated if ok else None, basis, cc, ok)
