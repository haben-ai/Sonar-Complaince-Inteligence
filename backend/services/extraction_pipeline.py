"""PDF / image / JSON -> EngineeringModel."""
from __future__ import annotations

import json
import re
from pathlib import Path

from backend.config import settings
from backend.engineering.adjacency_engine import shared_boundaries, vertical_overlaps
from backend.engineering.deck_layout import detect_decks
from backend.engineering.space_builder import (
    DeckExtraction,
    _add_open_deck_escape,
    extract_deck,
    link_stairs_between_decks,
)
from backend.extraction.pdf_parser import PdfDocument
from backend.models.engineering_models import (
    Connection,
    ConnectionType,
    DataOrigin,
    DesignDocument,
    EngineeringModel,
    Evidence,
    FireSafetyDocumentation,
    Provenance,
    SpaceKind,
)

# bump whenever extraction logic changes, so cached extractions are recomputed
PIPELINE_VERSION = "2026-11-07.4-outlined-ocr"

FIRE_PATTERNS = [
    r"^[ABC]-(0|15|30|60)$",       # SOLAS division classes ("A0" alone is the sheet size, so a hyphen is required)
    r"^H-(0|60|120)$",
    r"^A60$|^B15$|^B0$",
    r"INSUL",
    r"FIRE",
    r"^DIV(ISION)?$",
    r"SELF-?CLOSING",
]


def search_fire_documentation(doc: PdfDocument, evidence: list[Evidence]) -> FireSafetyDocumentation:
    matches = []
    for pat in FIRE_PATTERNS:
        for page_no, w in doc.search_text(pat):
            words = doc.page(page_no).words
            i = words.index(w)
            ctx = " ".join(x.text for x in words[i:i + 3] if abs(x.cy - w.cy) < 3)
            eid = f"EV_FIREDOC_{len(matches)+1:02d}"
            evidence.append(Evidence(id=eid, page=page_no,
                                     bbox={"page": page_no, "x0": w.x0, "y0": w.y0, "x1": w.x1, "y1": w.y1},
                                     source=Provenance.PDF_TEXT, method=f"text search /{pat}/", text=ctx))
            matches.append({"pattern": pat, "text": ctx, "page": page_no, "evidence_id": eid})
    rating_hits = [m for m in matches if m["pattern"] not in ("FIRE",)]
    note = (
        "No fire-integrity classes (A-/B-/C-/H- divisions), insulation or self-closing door annotations were "
        "found in the submitted drawing. "
        + (f"'FIRE' occurs only in room names ({', '.join(sorted({m['text'] for m in matches if m['pattern']=='FIRE'}))})."
           if any(m["pattern"] == "FIRE" for m in matches) else "")
        if not rating_hits else f"{len(rating_hits)} possible fire-integrity annotations found; review them."
    )
    return FireSafetyDocumentation(searched_patterns=FIRE_PATTERNS, matches=matches,
                                   fire_control_plan_available=False, note=note)


def _frame_point(deck, item) -> tuple[float, float]:
    """Annotations are written in ship terms: frame number and transverse offset (m, +starboard/down on sheet)."""
    if "point" in item:
        return tuple(item["point"])
    x = deck.frame0_x + item["frame"] * deck.units_per_frame
    y = deck.centerline_y + item.get("offset_m", 0.0) / deck.scale.metres_per_unit
    return x, y


def _apply_manual_annotations(path: Path, exs: list[DeckExtraction], model_conns: list[Connection], log: list[str]):
    if not path.exists():
        return
    data = json.loads(path.read_text())
    by_name = {e.deck.name: e for e in exs}
    for item in data.get("annotations", []):
        ex = by_name.get(item["deck"])
        if not ex:
            log.append(f"manual annotation skipped (deck not found): {item}")
            continue
        x, y = _frame_point(ex.deck, item)
        reg = ex.raster.region_at(x, y, search_px=6)
        sid = ex.region_to_space.get(reg)
        if not sid:
            log.append(f"manual annotation point not inside an extracted space: {item}")
            continue
        sp = next(s for s in ex.spaces if s.id == sid)
        note = f"MANUAL ANNOTATION ({data.get('annotator','team')}): {item.get('note','')}"
        if item["type"] == "open_deck":
            sp.kind = SpaceKind.OPEN_DECK
            sp.kind_basis = note
            sp.provenance = Provenance.MANUAL_ANNOTATION
            _add_open_deck_escape(ex, sp, Provenance.MANUAL_ANNOTATION, note)
        elif item["type"] == "kind":
            sp.kind = SpaceKind(item["kind"])
            sp.kind_basis = note
            if item.get("name") and not sp.name:
                sp.name = item["name"]
        sp.notes.append(note)
        log.append(f"manual annotation applied to {sid}: {item['type']}")
    for c in data.get("connections", []):
        a, b = by_name.get(c["deck_a"]), by_name.get(c["deck_b"])
        if not a or not b:
            continue
        sa = a.region_to_space.get(a.raster.region_at(*_frame_point(a.deck, c["a"]), search_px=6))
        sb = b.region_to_space.get(b.raster.region_at(*_frame_point(b.deck, c["b"]), search_px=6))
        if sa and sb:
            model_conns.append(Connection(
                id=f"C_MANUAL_{len(model_conns)+1:03d}", source=sa, target=sb, type=ConnectionType(c["type"]),
                provenance=Provenance.MANUAL_ANNOTATION, certainty="manual",
                note=f"MANUAL ANNOTATION: {c.get('note','')}",
            ))
            log.append(f"manual connection {sa} -> {sb}")


def extract_pdf(path: Path, design_id: str, name: str | None = None, decks_filter: list[str] | None = None) -> EngineeringModel:
    doc = PdfDocument(path)
    if pdf_mode(doc) == "outlined":
        return extract_outlined_pdf(path, design_id, name)
    evidence: list[Evidence] = []
    log: list[str] = []
    page = doc.page(0)
    log.append(f"PDF: {doc.page_count} page(s), {len(page.words)} text words and {len(page.paths)} vector paths on page 1, "
               f"{len(doc.layer_names)} CAD layers")
    decks = detect_decks(page, evidence, log)
    if decks_filter:
        decks = [d for d in decks if d.name in decks_filter]
    exs = [extract_deck(page, d, evidence, log) for d in decks]
    conns = [c for e in exs for c in e.connections]
    conns += link_stairs_between_decks(exs, evidence, log)
    ann = settings.manual_annotations_for(doc.sha256)
    if ann:
        _apply_manual_annotations(ann, exs, conns, log)
        conns = [c for e in exs for c in e.connections] + [c for c in conns if c.id.startswith(("C_VSTAIR", "C_MANUAL"))]

    hazard_ids = {s.id for e in exs for s in e.spaces if s.hazard}
    adj = []
    for e in exs:
        adj += shared_boundaries(e, evidence, only_ids=hazard_ids)
    adj += vertical_overlaps(exs, evidence, hazard_ids)

    fire_doc = search_fire_documentation(doc, evidence)
    meta = doc.metadata
    log.append("LLM: " + ("Gemini label suggestions requested" if settings.llm_enabled else "disabled (no GEMINI_API_KEY) - deterministic extraction only"))
    limitations = [
        "Input is a General Arrangement drawing only: no fire-control plan, door schedule, structural fire protection plan or escape-route plan was supplied.",
        "Door detection relies on drawn swing arcs; sliding, watertight or hatch-type closures without an arc symbol are not detected, so rooms reached only through them appear without doors.",
        "Leaf widths are derived from drawn symbols at the stated drawing scale. They are not clear opening widths and must not be used for compliance.",
        "Spaces are free-space regions between boundary lines on CAD layers; partitions not drawn on those layers merge spaces (flagged where several labels fall in one region).",
        "Vertical stair links are inferred by matching UP/DN markers on consecutive decks at the same frame position.",
        "'ESC' is interpreted as an escape-route/escape-hatch marking; the drawing carries no legend confirming this.",
        "Decks without a frame-number row (Bridge deck on this sheet) are not modelled.",
    ]
    model = EngineeringModel(
        document=DesignDocument(
            design_id=design_id, name=name or meta.get("title") or path.stem, source_type="pdf", filename=path.name,
            sha256=doc.sha256, page_count=doc.page_count,
            page_sizes=[(doc.doc[i].rect.width, doc.doc[i].rect.height) for i in range(doc.page_count)],
            metadata={**meta, "cad_layers": len(doc.layer_names), "pdf_mode": "vector_text", "pipeline_version": PIPELINE_VERSION,
                      "llm_enabled": settings.llm_enabled},
            data_origin=DataOrigin.ACTUAL_PDF,
        ),
        decks=decks,
        spaces=[s for e in exs for s in e.spaces],
        doors=[d for e in exs for d in e.doors],
        escape_points=[p for e in exs for p in e.escape_points],
        connections=conns,
        adjacencies=adj,
        evidence=evidence,
        fire_documentation=fire_doc,
        extraction_log=log,
        limitations=limitations,
    )
    if settings.llm_enabled:
        add_llm_label_suggestions(model)
    return model


def pdf_mode(doc: PdfDocument) -> str:
    """'vector_text' (real text, e.g. DANA V) or 'outlined' (text converted to outlines - needs OCR)."""
    words = sum(len(doc.doc[i].get_text("words")) for i in range(doc.page_count))
    return "vector_text" if words >= 20 * max(1, min(doc.page_count, 3)) or doc.layer_names else "outlined"


def _path_len(p) -> float:
    import math

    total = 0.0
    for it in p.items:
        if it[0] == "l":
            total += math.dist((it[1].x, it[1].y), (it[2].x, it[2].y))
        elif it[0] == "c":
            total += math.dist((it[1].x, it[1].y), (it[4].x, it[4].y))
    return total


def _outlined_wall(p) -> bool:
    """No CAD layers: walls/bulkheads/furniture are the heavier strokes; thin strokes are text, leaders and
    hatching, except long multi-segment thin lines (hull outline)."""
    if p.kind == "f":
        return False
    if p.width >= 0.33:
        return True
    return 0.15 <= p.width < 0.33 and _path_len(p) >= 120 and len(p.items) >= 3


def extract_outlined_pdf(path: Path, design_id: str, name: str | None = None) -> EngineeringModel:
    """Multi-sheet GA whose text was converted to outlines (no text objects, no CAD layers)."""
    from backend.engineering import sheet_views as sv
    from backend.engineering.room_extraction import DeckSource
    from backend.extraction import ocr_engine
    from backend.models.engineering_models import BBox, Deck, ScaleInfo

    doc = PdfDocument(path)
    evidence: list[Evidence] = []
    log = [f"PDF: {doc.page_count} page(s), no text objects and no CAD layers - text is drawn as outlines; using OCR "
           f"({'Tesseract available' if ocr_engine.available() else 'Tesseract NOT available'})"]
    use_llm = False
    if not ocr_engine.available():
        if settings.llm_enabled:
            use_llm = True
            log.append("Tesseract not available - using Gemini vision to read labels (provenance llm_interpretation; boxes approximate)")
        else:
            raise RuntimeError("This PDF has no text layer (text converted to outlines) and no CAD layers. Reading it needs OCR: "
                               "install Tesseract (e.g. 'brew install tesseract') or set GEMINI_API_KEY for vision reading, "
                               "or provide a vector PDF / DWG export with real text.")
    cache = settings.output_dir / design_id / "ocr"
    page_words, views, levels, level_ratio = {}, [], [], None
    for n in range(doc.page_count):
        if use_llm:
            from backend.extraction import drawing_interpreter

            pg = doc.doc[n]
            ws = drawing_interpreter.vision_words(pg.get_pixmap(dpi=150).tobytes("png"), pg.rect.width, pg.rect.height) or []
        else:
            ws = ocr_engine.ocr_pdf_page(doc.doc, n, cache)
        page_words[n] = ws
        vs = sv.find_views(doc.page(n), ws, doc.doc)
        views += vs
        lv = sv.level_labels(ws, doc.doc, n)
        if lv:
            levels += lv
            level_ratio = level_ratio or next((v.ratio for v in vs if v.kind == "section" and v.ratio), None)
        log.append(f"page {n+1}: {len(ws)} OCR words; views: " + (", ".join(f"{v.kind} {v.view_id} '{v.name}'" for v in vs) or "none")
                   + (f"; {len(lv)} deck-height callouts" if lv else ""))
    plan_ratios = [v.ratio for v in views if v.kind == "plan" and v.ratio]
    common = max(set(plan_ratios), key=plan_ratios.count) if plan_ratios else None
    scale_res = sv.establish_scale(level_ratio or common, doc.page(0).width, levels, level_ratio or common)
    log.append(f"scale: {scale_res.basis}. Cross-check: {scale_res.cross_check}. Accepted: {scale_res.ok}")
    elev = {}
    for nm, ft, _, _ in levels:
        elev.setdefault(sv.deck_name(nm), ft * 304.8)

    decks, exs = [], []
    for v in views:
        if v.kind != "plan":
            continue
        ratio_note = None
        ratio = v.ratio
        if ratio is None and common and plan_ratios.count(common) >= 0.8 * len(plan_ratios):
            ratio, ratio_note = common, f"view scale text unreadable; assumed 1:{common:g} like the other plan views"
        scale = None
        if scale_res.ok and ratio == (level_ratio or common):
            scale = ScaleInfo(metres_per_unit=scale_res.metres_per_unit, basis=scale_res.basis + (f" ({ratio_note})" if ratio_note else ""),
                              cross_check=scale_res.cross_check)
        slug = re.sub(r"[^A-Z0-9]+", "_", v.view_id.upper()).strip("_")
        did = f"DECK_P{v.page+1}_{slug}"
        tw = v.title_words
        ev = Evidence(id=f"EV_{did}", page=v.page,
                      bbox=BBox(page=v.page, x0=min(w.x0 for w in tw), y0=min(w.y0 for w in tw), x1=max(w.x1 for w in tw), y1=max(w.y1 for w in tw)),
                      source=Provenance.OCR, method="OCR of the view title under the plan (title, deck name, scale)",
                      text=f"PLAN {v.view_id} / {v.name} / {v.scale_text or 'scale unreadable'}")
        evidence.append(ev)
        nm = sv.deck_name(v.name)
        e_mm = next((mm for k, mm in elev.items() if k and (k in nm or nm.startswith(k))), None)
        deck = Deck(id=did, name=f"{nm} (sheet {v.page+1}, {v.view_id})", page=v.page,
                    bbox=BBox(page=v.page, x0=v.bbox[0], y0=v.bbox[1], x1=v.bbox[2], y1=v.bbox[3]),
                    elevation_mm=e_mm, elevation_label=f"{e_mm/304.8:.1f} ft ABL (section view, OCR)" if e_mm else None,
                    scale=scale, evidence_ids=[ev.id])
        decks.append(deck)
        src = DeckSource(words=page_words[v.page], text_provenance=Provenance.LLM_INTERPRETATION if use_llm else Provenance.OCR, wall_filter=_outlined_wall,
                         door_filter=lambda p: p.kind != "f" and p.width >= 0.15, erase_text=True, leader_labels=True,
                         close_gaps_m=0.45,
                         method_note="stroked lines >= 0.33 pt plus long hull lines; no CAD layers, so furniture also bounds regions")
        exs.append(extract_deck(doc.page(v.page), deck, evidence, log, source=src))
    conns = [c for e in exs for c in e.connections]
    hazard_ids = {s.id for e in exs for s in e.spaces if s.hazard}
    adj = []
    for e in exs:
        adj += shared_boundaries(e, evidence, only_ids=hazard_ids)
    all_text = "\n".join(" ".join(w.text for w in sorted(ws, key=lambda w: (round(w.cy / 4), w.x0))) for ws in page_words.values())
    fire = FireSafetyDocumentation(
        searched_patterns=FIRE_PATTERNS,
        matches=[{"pattern": "OCR", "text": m.group(0), "page": -1, "evidence_id": ""}
                 for m in re.finditer(r"\b[ABCH]-(0|15|30|60|120)\b", all_text)],
        note=("No fire-integrity class annotations (A-/B-/C-/H- divisions) were read by OCR in the submitted drawings. "
              "OCR can miss small text; absence is not proof that none exist."))
    limitations = [
        "Source PDF has no text layer and no CAD layers: all labels come from OCR (provenance 'ocr') and may contain recognition errors.",
        "Room labels are linked to rooms by following leader lines; a wrong or missed leader gives a wrong or missing room name.",
        "Without CAD layers, furniture and equipment lines also bound regions, so rooms can be fragmented.",
        f"Scale: {scale_res.basis}. {scale_res.cross_check or ''}",
        "Views on different sheets are not aligned to a common frame system, so stairs are not linked between decks (vertical routes unknown).",
        "Open decks / exits are only identified where a label says so; otherwise escape points are missing and checks are INCONCLUSIVE.",
        "Elevations, sections and profiles are read for deck heights only.",
    ]
    model = EngineeringModel(
        document=DesignDocument(
            design_id=design_id, name=name or path.stem, source_type="pdf", filename=path.name, sha256=doc.sha256,
            page_count=doc.page_count, page_sizes=[(doc.doc[i].rect.width, doc.doc[i].rect.height) for i in range(doc.page_count)],
            metadata={**doc.metadata, "pdf_mode": "outlined_text_ocr", "pipeline_version": PIPELINE_VERSION, "llm_enabled": settings.llm_enabled,
                      "drawing_text": all_text[:200000],
                      "views": [{"page": v.page, "kind": v.kind, "id": v.view_id, "name": v.name, "scale": v.scale_text} for v in views]},
            data_origin=DataOrigin.ACTUAL_PDF),
        decks=decks, spaces=[s for e in exs for s in e.spaces], doors=[d for e in exs for d in e.doors],
        escape_points=[p for e in exs for p in e.escape_points], connections=conns, adjacencies=adj, evidence=evidence,
        fire_documentation=fire, extraction_log=log, limitations=limitations,
    )
    if settings.llm_enabled:
        add_llm_label_suggestions(model)
    return model


def extract_image(path: Path, design_id: str, name: str | None = None) -> EngineeringModel:
    """Raster drawings: walls by thresholding, regions by connected components, labels by OCR
    when Tesseract is available. No CAD layers, no door symbols and no scale -> most checks
    end INCONCLUSIVE, which is the correct outcome for this input quality."""
    import cv2
    import numpy as np

    from backend.extraction import ocr_engine
    from backend.engineering.hazard_classifier import classify_label
    from backend.models.engineering_models import BBox, Deck, Space

    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("Unreadable image")
    h, w = img.shape
    log = [f"Image {w}x{h}px. No vector data, no CAD layers, no drawing scale."]
    evidence: list[Evidence] = []
    deck = Deck(id="DECK_IMAGE", name="Image plan", page=0, bbox=BBox(page=0, x0=0, y0=0, x1=w, y1=h))
    walls = cv2.dilate((img < 140).astype(np.uint8), np.ones((3, 3), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(1 - walls, connectivity=4)
    words = ocr_engine.ocr_words(img)
    log.append(f"OCR: {'Tesseract, ' + str(len(words)) + ' words' if ocr_engine.available() else 'not available - labels not extracted'}")
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])).tolist())
    spaces = []
    min_px = max(400, int(0.002 * w * h))
    for reg in range(1, n):
        if reg in border or stats[reg][4] < min_px:
            continue
        x, y, ww, hh, area = stats[reg]
        inside = [wd for wd in words if labels[int(wd.cy), int(wd.cx)] == reg] if words else []
        name_ = " ".join(wd.text for wd in inside) or None
        kind, basis, hz = classify_label(name_)
        crop = (labels[y:y + hh, x:x + ww] == reg).astype(np.uint8)
        cs, _ = cv2.findContours(crop, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        poly = [(float(p[0][0] + x), float(p[0][1] + y)) for p in cv2.approxPolyDP(max(cs, key=cv2.contourArea), 2, True)] if cs else []
        sid = f"IMG_S{len(spaces)+1:03d}"
        ev = Evidence(id=f"EV_{sid}", page=0, bbox=BBox(page=0, x0=x, y0=y, x1=x + ww, y1=y + hh),
                      source=Provenance.OCR if inside else Provenance.DERIVED_GEOMETRY,
                      method="Enclosed region in thresholded raster image", text=name_)
        evidence.append(ev)
        spaces.append(Space(id=sid, deck_id=deck.id, name=name_, kind=kind, kind_basis=basis, hazard=hz, polygon=poly,
                            bbox=ev.bbox, evidence_ids=[ev.id]))
    log.append(f"{len(spaces)} enclosed regions; door symbols are not detected in raster mode")
    return EngineeringModel(
        document=DesignDocument(design_id=design_id, name=name or path.stem, source_type="image", filename=path.name,
                                page_count=1, page_sizes=[(w, h)], data_origin=DataOrigin.ACTUAL_PDF),
        decks=[deck], spaces=spaces, evidence=evidence, extraction_log=log,
        fire_documentation=FireSafetyDocumentation(note="Raster image: no fire-integrity information extracted."),
        limitations=["Raster input: no CAD layers, no scale, no door detection; connectivity results will be INCONCLUSIVE.",
                     "Coordinates are image pixels."],
    )


def add_llm_label_suggestions(model: EngineeringModel) -> None:
    """Optional: ask Gemini to classify labels the rules could not. Stored as notes + evidence only."""
    from backend.engineering.hazard_classifier import HAZARD_VOCABULARY
    from backend.extraction import drawing_interpreter

    unmatched = sorted({s.name for s in model.spaces if s.name and s.kind == SpaceKind.UNKNOWN})
    if not unmatched:
        return
    vocab = [k.value for k in SpaceKind] + list(HAZARD_VOCABULARY)
    res = drawing_interpreter.classify_labels(unmatched, vocab)
    if not res:
        model.extraction_log.append("LLM label suggestions: not available")
        return
    for s in model.spaces:
        sug = res.get(s.name or "")
        if not sug:
            continue
        eid = f"EV_{s.id}_LLM"
        model.evidence.append(Evidence(id=eid, page=s.bbox.page if s.bbox else 0, bbox=s.bbox,
                                       source=Provenance.LLM_INTERPRETATION, method=f"Gemini ({drawing_interpreter.last_model_used}) label classification",
                                       text=s.name, detail=sug))
        s.notes.append(f"LLM suggestion (not applied): {sug.get('category')} - {sug.get('reason')}")
        s.evidence_ids.append(eid)
    model.extraction_log.append(f"LLM label suggestions recorded for {len(res)} labels (not applied to classifications)")


def load_json_model(path: Path, design_id: str) -> EngineeringModel:
    data = json.loads(Path(path).read_text())
    model = EngineeringModel.model_validate(data)
    model.document.design_id = design_id
    return model
