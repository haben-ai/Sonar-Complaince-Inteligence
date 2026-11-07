"""Split regulatory documents into a clause tree.

Each parser understands the numbering style of one instrument:
* IMO resolutions (SOLAS II-2, SPS Code, MARPOL Annex I): "Regulation 13" / "CHAPTER 6" headers,
  paragraphs numbered "3.3.4", sub-items ".1".
* ADA 2010 Standards: "404.2.3 Clear Width." sections.
* PVAG (HTML): "V404.2.3 Clear Width" sections.
* IMO / Access Board summary pages (HTML): paragraphs.
"""
from __future__ import annotations

import html as htmlmod
import re
from pathlib import Path

import pymupdf

from backend.models.regulatory_models import Clause, RegulatoryDocument

XREF_RX = re.compile(
    r"\bregulations?\s+[IVX]+-?\d?/\d+[A-Z]?(?:\.\d+)*|\bregulations?\s+\d+[A-Z]?(?:\.\d+)*|\bparagraphs?\s+\d+(?:\.\d+)+"
    r"|\btables?\s+9\.\d+|\b[V]?\d{3}\.\d+(?:\.\d+)*\b",
    re.I,
)


def _pdf_lines(path: Path) -> list[tuple[int, str]]:
    doc = pymupdf.open(str(path))
    out = []
    for pno, page in enumerate(doc, 1):
        for ln in page.get_text().splitlines():
            out.append((pno, ln.rstrip()))
    return out


def _html_text(path: Path) -> str:
    t = path.read_text(encoding="utf-8", errors="ignore")
    t = re.sub(r"<script.*?</script>|<style.*?</style>|<nav.*?</nav>|<header.*?</header>|<footer.*?</footer>", "", t, flags=re.S | re.I)
    t = re.sub(r"<(br|/p|/h\d|/li|/div|/tr)[^>]*>", "\n", t, flags=re.I)
    t = htmlmod.unescape(re.sub(r"<[^>]+>", " ", t))
    t = re.sub(r"[ \t\xa0]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t)


IMO_NOISE = re.compile(
    r"^\s*(-\s*\d+\s*-|RESOLUTION (MSC|MEPC)\.\d+\(\d+\)|\(adopted on .*\)|ADOPTION OF AMENDMENTS.*|AMENDMENTS TO THE ANNEX.*|"
    r"CONVENTION FOR THE PREVENTION.*|CODE OF SAFETY FOR SPECIAL PURPOSE SHIPS, 2008|MSC \d+/\d+/Add\.\d+|ANNEX \d+|Page \d+|"
    r"I:\\.*|MEPC \d+/\d+/Add\.\d+)\s*$"
)
NUM_RX = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,4})(?:\s+(.*))?$")


def _plausible_number(num: str, rest: str | None) -> bool:
    parts = [int(p) for p in num.split(".")]
    if parts[0] > 60 or any(p > 40 for p in parts[1:]):
        return False
    if rest and not re.match(r"[A-Z\"“(]", rest.strip()):
        return False   # e.g. "2.0 m, whichever ..." or "60 persons"
    return True


def parse_imo(doc: RegulatoryDocument, path: Path, section_rx: str) -> list[Clause]:
    """section_rx matches the section header line (Regulation N / CHAPTER N); the title is the next line."""
    lines = [(p, l) for p, l in _pdf_lines(path) if not IMO_NOISE.match(l)]
    sec_rx = re.compile(section_rx)
    clauses: list[Clause] = []
    section, section_title = "front", ""
    cur: dict | None = None
    seen_ids: dict[str, int] = {}

    def flush():
        nonlocal cur
        if cur and cur["text"].strip():
            text = re.sub(r"\s+", " ", cur["text"]).strip()
            base = f"{doc.doc_id}/{section}/{cur['number']}" if cur["number"] else f"{doc.doc_id}/{section}/text"
            seen_ids[base] = seen_ids.get(base, 0) + 1
            # stable ids: the n-th occurrence of the same number in the same section gets "~n"
            cid = base if seen_ids[base] == 1 else f"{base}~{seen_ids[base]}"
            clauses.append(Clause(
                clause_id=cid, doc_id=doc.doc_id, instrument=doc.instrument,
                path=[f"{section} - {section_title}".strip(" -"), cur["number"] or ""],
                number=cur["number"], heading=cur["heading"], text=text, page=cur["page"],
                cross_refs=sorted(set(m.group(0) for m in XREF_RX.finditer(text)))[:20],
            ))
        cur = None

    i = 0
    while i < len(lines):
        page, line = lines[i]
        s = line.strip()
        m = sec_rx.match(s)
        if m:
            flush()
            section = re.sub(r"\s+", "", m.group(1)) if m.lastindex else s
            nxt = lines[i + 1][1].strip() if i + 1 < len(lines) else ""
            title = m.group(2).strip() if m.lastindex and m.lastindex >= 2 and m.group(2) else nxt
            section_title = title.strip(" –-")
            i += 1 if (m.lastindex and m.lastindex >= 2 and m.group(2)) else 2
            continue
        nm = NUM_RX.match(s)
        if nm and _plausible_number(nm.group(1), nm.group(2)):
            flush()
            rest = (nm.group(2) or "").strip()
            heading = None
            if not rest and i + 1 < len(lines):           # number alone; next line is a title or the text
                nxt = lines[i + 1][1].strip()
                if len(nxt) < 70 and not nxt.endswith((".", ":", ";", ",")) and len(nxt.split()) <= 9 and nxt[:1].isupper():
                    heading = nxt
                else:
                    rest = nxt
                i += 1
            elif rest and len(rest) < 70 and not rest.endswith((".", ":", ";")) and rest[0].isupper() and len(rest.split()) <= 9:
                heading = rest
                rest = ""
            cur = {"number": nm.group(1), "heading": heading, "text": (heading + ". " if heading else "") + rest, "page": page}
        else:
            if cur is None:
                cur = {"number": None, "heading": None, "text": "", "page": page}
            cur["text"] += " " + s
        i += 1
    flush()
    return clauses


def parse_ada(doc: RegulatoryDocument, path: Path) -> list[Clause]:
    rx = re.compile(r"^(\d{3}(?:\.\d{1,2}){0,4})\s+([A-Z][A-Za-z0-9 ,/'’()-]{2,80}?)\.\s*(.*)$")
    clauses, cur = [], None
    for page, line in _pdf_lines(path):
        s = line.strip()
        m = rx.match(s)
        if m and page > 50:      # skip the front matter/TOC
            if cur:
                clauses.append(cur)
            num = m.group(1)
            cur = Clause(clause_id=f"{doc.doc_id}/{num}", doc_id=doc.doc_id, instrument=doc.instrument,
                         path=[f"Chapter {num[0]}", num], number=num, heading=m.group(2), text=f"{m.group(2)}. {m.group(3)}", page=page)
        elif cur:
            cur.text += " " + s
    if cur:
        clauses.append(cur)
    seen, out = set(), []
    for c in clauses:
        c.text = re.sub(r"\s+", " ", c.text).strip()
        if c.clause_id in seen:
            c.clause_id += f"~p{c.page}"
        seen.add(c.clause_id)
        c.cross_refs = sorted(set(m.group(0) for m in XREF_RX.finditer(c.text)) - {c.number})[:20]
        out.append(c)
    return out


def parse_pvag_html(doc: RegulatoryDocument, path: Path) -> list[Clause]:
    text = _html_text(path)
    rx = re.compile(r"^(V\d{3}(?:\.\d{1,2}){0,4})\s+(.{2,90})$")
    clauses, cur = [], None
    for line in text.splitlines():
        s = line.strip()
        m = rx.match(s)
        if m and not s.endswith("."):
            if cur:
                clauses.append(cur)
            num = m.group(1)
            cur = Clause(clause_id=f"{doc.doc_id}/{num}", doc_id=doc.doc_id, instrument=doc.instrument,
                         path=["Chapter V4 (proposed)", num], number=num, heading=m.group(2), text=m.group(2) + ".", page=0)
        elif cur and s:
            cur.text += " " + s
    if cur:
        clauses.append(cur)
    seen = set()
    for c in clauses:
        c.text = re.sub(r"\s+", " ", c.text).strip()
        if c.clause_id in seen:
            c.clause_id += f"~{len(seen)}"
        seen.add(c.clause_id)
        c.cross_refs = sorted(set(m.group(0) for m in XREF_RX.finditer(c.text)) - {c.number})[:20]
    return clauses


def parse_html_generic(doc: RegulatoryDocument, path: Path) -> list[Clause]:
    text = _html_text(path)
    paras = [p.strip() for p in text.splitlines() if len(p.strip()) > 90]
    # drop cookie banners / navigation boilerplate
    paras = [p for p in paras if not re.search(r"cookie|javascript|Skip to main|official website of the United States", p, re.I)]
    return [Clause(clause_id=f"{doc.doc_id}/p{i:03d}", doc_id=doc.doc_id, instrument=doc.instrument,
                   path=["summary page", f"paragraph {i}"], number=None, heading=None, text=p, page=0)
            for i, p in enumerate(paras, 1)]


def parse(doc: RegulatoryDocument, path: Path) -> list[Clause]:
    if doc.parser == "solas_ii2":
        return parse_imo(doc, path, r"^(Regulation\s+\d+[A-Z]?)\s*[–-]?\s*(.*)$")
    if doc.parser == "sps_code":
        return parse_imo(doc, path, r"^(CHAPTER\s+\d+)\s*(.*)$")
    if doc.parser == "marpol":
        return parse_imo(doc, path, r"^[“\"]?(Regulation\s+\d+[A-Z]?)\s*[–-]\s*(.+)$")
    if doc.parser == "ada":
        return parse_ada(doc, path)
    if doc.parser == "pvag_html":
        return parse_pvag_html(doc, path)
    return parse_html_generic(doc, path)
