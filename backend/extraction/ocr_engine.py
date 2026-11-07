"""OCR for raster drawings and for PDFs whose text was converted to outlines.

Vector PDFs with real text (e.g. DANA V) never need OCR. For outlined-text PDFs (e.g. the
OSU RCRV GA printed through a PostScript driver) pages are rendered at high resolution and
read with Tesseract; words keep their page coordinates (PDF points) and confidence, and
are marked provenance=ocr downstream.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np

from backend.extraction.pdf_parser import Word


def available() -> bool:
    if not shutil.which("tesseract"):
        return False
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return False
    return True


def ocr_words(image, scale: float = 1.0, min_conf: float = 55) -> list[Word]:
    """image: numpy grayscale array. Coordinates are divided by `scale` (pixels per page unit)."""
    if not available():
        return []
    import pytesseract

    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT, config="--psm 11")
    out = []
    for i, t in enumerate(data["text"]):
        t = (t or "").strip()
        if not t or float(data["conf"][i]) < min_conf:
            continue
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        out.append(Word(t, x / scale, y / scale, (x + w) / scale, (y + h) / scale,
                        data["block_num"][i], data["line_num"][i], float(data["conf"][i])))
    return out


def ocr_pdf_page(doc, page_no: int, cache_dir: Path | None = None, dpi: int = 450) -> list[Word]:
    """OCR one PDF page (rotation-aware: the render is in displayed coordinates). Cached as JSON."""
    import pymupdf

    cache = cache_dir / f"ocr_p{page_no}_{dpi}.json" if cache_dir else None
    if cache and cache.exists():
        return [Word(**w) for w in json.loads(cache.read_text())]
    page = doc[page_no]
    pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY, annots=False)
    img = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w)
    words = ocr_words(img, scale=dpi / 72)
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps([w.__dict__ for w in words]))
    return words
