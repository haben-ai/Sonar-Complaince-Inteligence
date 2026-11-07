"""Locate deck plan views on a GA sheet and establish a defensible scale.

Approach (deterministic):
* Each deck plan on a GA carries a row of frame numbers (…, 45, 50, 55, …) along its
  centreline. We cluster those numeric labels into rows; a linear fit of x against frame
  number gives the frame-0 position and the drawing units per frame.
* The deck title ("SHELTER DECK", "TANKTOP", …) is the nearest title text below the row.
* Scale: the title-block scale (e.g. 1:150) gives metres per PDF point. It is accepted
  only if it agrees with the frame spacing printed in the principal particulars measured
  against the frame-label spacing. If they disagree, no scale is used.
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass

from backend.extraction.pdf_parser import ParsedPage, Word
from backend.models.engineering_models import BBox, Deck, Evidence, Provenance, ScaleInfo

PT_TO_M = 25.4 / 72 / 1000  # one PDF point on paper, in metres

DECK_TITLE_PATTERNS = [
    ("DOUBLE BOTTOM", r"^DOUBLE$", "BOTTOM"),
    ("TANKTOP", r"^TANKTOP$", None),
    ("MAIN DECK", r"^MAIN$", "DECK"),
    ("TRAWL DECK", r"^TRAWL$", "DECK"),
    ("SHELTER DECK", r"^SHELTER$", "DECK"),
    ("FORECASTLE DECK", r"^FORECASTLE$", "DECK"),
    ("BRIDGE DECK", r"^BRIDGE$", "DECK"),
]


@dataclass
class ScaleFacts:
    drawing_scale: int | None
    drawing_scale_word: Word | None
    frame_spacing_m: float | None
    frame_spacing_words: list[Word]
    breadth_m: float | None


def read_scale_facts(page: ParsedPage) -> ScaleFacts:
    scale, scale_word = None, None
    for w in page.words:
        m = re.fullmatch(r"1:(\d{2,4})", w.text)
        if m:
            scale, scale_word = int(m.group(1)), w
    fs, fs_words, breadth = None, [], None
    words = page.words
    for i, w in enumerate(words):
        if w.text.upper() == "SPACING" and i > 0 and words[i - 1].text.upper() == "FRAME":
            # value is the next number-like word on the same line
            for nxt in words[i + 1 : i + 5]:
                m = re.fullmatch(r"(\d+)[,.](\d+)", nxt.text)
                if m and abs(nxt.cy - w.cy) < 3:
                    fs = float(f"{m.group(1)}.{m.group(2)}")
                    fs_words = [words[i - 1], w, nxt]
                    break
        if w.text.upper() == "BREADTH":
            for nxt in words[i + 1 : i + 6]:
                m = re.fullmatch(r"(\d+)[,.](\d+)", nxt.text)
                if m and abs(nxt.cy - w.cy) < 3:
                    breadth = float(f"{m.group(1)}.{m.group(2)}")
                    break
    return ScaleFacts(scale, scale_word, fs, fs_words, breadth)


def _frame_rows(page: ParsedPage) -> list[list[Word]]:
    cands = []
    for w in page.words:
        if re.fullmatch(r"-?\d{1,3}", w.text):
            v = int(w.text)
            if -10 <= v <= 130 and v % 5 == 0:
                cands.append(w)
    cands.sort(key=lambda w: w.cy)
    rows: list[list[Word]] = []
    for w in cands:
        if rows and abs(rows[-1][-1].cy - w.cy) < 2.5:
            rows[-1].append(w)
        else:
            rows.append([w])
    good = []
    for r in rows:
        vals = sorted({int(w.text) for w in r})
        if len(vals) >= 6:
            good.append(r)
    return good


def _fit(row: list[Word]) -> tuple[float, float, float]:
    """Least squares x = a + b*frame. Returns (a, b, max_residual)."""
    xs = [w.cx for w in row]
    fs = [int(w.text) for w in row]
    n = len(xs)
    mf, mx = sum(fs) / n, sum(xs) / n
    b = sum((f - mf) * (x - mx) for f, x in zip(fs, xs)) / sum((f - mf) ** 2 for f in fs)
    a = mx - b * mf
    res = max(abs(a + b * f - x) for f, x in zip(fs, xs))
    return a, b, res


def detect_decks(page: ParsedPage, evidence: list[Evidence], log: list[str]) -> list[Deck]:
    facts = read_scale_facts(page)
    rows = _frame_rows(page)
    titles: list[tuple[str, Word]] = []
    for name, rx, second in DECK_TITLE_PATTERNS:
        for i, w in enumerate(page.words):
            if re.match(rx, w.text):
                nxt = page.words[i + 1] if i + 1 < len(page.words) else None
                if second is None or (nxt and nxt.text.upper() == second and abs(nxt.cy - w.cy) < 3):
                    # title texts are large (>= 9pt); ignore small cross-references in section views
                    if w.y1 - w.y0 >= 9:
                        titles.append((name, w))

    decks: list[Deck] = []
    used_titles = set()
    for row in rows:
        a, b, res = _fit(row)
        if b <= 0 or res > 2.0:
            log.append(f"frame-label row at y={row[0].cy:.0f} rejected (fit residual {res:.1f})")
            continue
        cy = statistics.median(w.cy for w in row)
        # deck title: closest title text below the row, within ~ one plan height
        best = None
        for name, tw in titles:
            dy = tw.cy - cy
            if 0 < dy < 260 and name not in used_titles:
                if best is None or dy < best[1].cy - cy:
                    best = (name, tw)
        if best is None:
            log.append(f"frame-label row at y={cy:.0f} has no deck title nearby (profile/section view) - skipped")
            continue
        name, tw = best
        used_titles.add(name)

        scale = None
        upf = b  # page units per frame
        if facts.drawing_scale and facts.frame_spacing_m:
            m_per_unit_title = facts.drawing_scale * PT_TO_M
            m_per_unit_frames = facts.frame_spacing_m / upf
            dev = abs(m_per_unit_title - m_per_unit_frames) / m_per_unit_frames
            if dev < 0.01:
                scale = ScaleInfo(
                    metres_per_unit=m_per_unit_title,
                    basis=f"Title block scale 1:{facts.drawing_scale} on A-size sheet (PDF points)",
                    cross_check=(
                        f"Frame labels are {upf:.3f} pt apart; with frame spacing {facts.frame_spacing_m} m "
                        f"(principal particulars) that is {m_per_unit_frames*1000:.2f} mm/pt vs "
                        f"{m_per_unit_title*1000:.2f} mm/pt from the title block ({dev*100:.2f} % deviation)."
                    ),
                )
            else:
                log.append(f"{name}: scale cross-check failed ({dev*100:.1f} %); no metric measurements")

        half_breadth_units = ((facts.breadth_m or 16.0) / 2 + 0.9) / (scale.metres_per_unit if scale else PT_TO_M * 150)
        x_min = a + b * (-8)
        x_max = a + b * 118
        bbox = BBox(page=page.number, x0=x_min, y0=cy - half_breadth_units, x1=x_max, y1=cy + half_breadth_units)

        # deck elevation label such as "11300 ABL" just below the title
        elev, elev_label = None, None
        for i, w in enumerate(page.words):
            if re.fullmatch(r"\d{4,5}", w.text) and 0 < w.cy - tw.cy < 30 and abs(w.cx - tw.cx) < 120:
                nxt = page.words[i + 1] if i + 1 < len(page.words) else None
                if nxt and nxt.text.upper() in ("ABL", "OBL"):
                    elev, elev_label = float(w.text), f"{w.text} {nxt.text}"
                    break

        did = "DECK_" + name.replace(" DECK", "").replace(" ", "_")
        ev = Evidence(
            id=f"EV_{did}",
            page=page.number,
            bbox=BBox(page=page.number, x0=tw.x0, y0=tw.y0, x1=tw.x1 + 60, y1=tw.y1),
            source=Provenance.PDF_TEXT,
            method="Deck title text + row of frame-number labels (linear fit) on the plan centreline",
            text=name,
            detail={
                "frame_labels": len(row),
                "units_per_frame": round(upf, 4),
                "fit_max_residual_pt": round(res, 3),
                "elevation_label": elev_label,
            },
        )
        evidence.append(ev)
        decks.append(
            Deck(
                id=did,
                name=name,
                page=page.number,
                bbox=bbox,
                elevation_mm=elev,
                elevation_label=elev_label,
                centerline_y=cy,
                frame0_x=a,
                units_per_frame=upf,
                scale=scale,
                evidence_ids=[ev.id],
            )
        )
        log.append(f"{name}: frame row y={cy:.0f}, {len(row)} labels, {upf:.3f} pt/frame, elevation {elev_label}")

    # order bottom-up by elevation if available, else by drawing order
    decks.sort(key=lambda d: (d.elevation_mm is None, d.elevation_mm or 0))
    return decks
