"""SQLite store for regulatory documents and clauses, with an FTS5 (BM25) index.

The database lives in data/regulatory/ (git-ignored, because IMO texts are copyrighted)
and is rebuilt from the raw downloads by `build()`.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
from pathlib import Path

from backend.config import settings
from backend.models.regulatory_models import Clause, RegulatoryDocument, SearchHit
from backend.regulatory.ingest.clause_parser import parse

DB_PATH = settings.root / "data" / "regulatory" / "regulatory.db"
RAW_DIR = settings.root / "data" / "regulatory" / "raw"
MANIFEST = settings.data_dir / "regulatory_sources.json"
_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
    return _conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (doc_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clauses (clause_id TEXT PRIMARY KEY, doc_id TEXT, instrument TEXT, json TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS clauses_fts USING fts5(clause_id UNINDEXED, instrument UNINDEXED, heading, text, tokenize='porter unicode61');
"""


def build(force: bool = False) -> dict:
    """(Re)build the index from the manifest + raw downloads. Returns a summary."""
    manifest = json.loads(MANIFEST.read_text())
    c = conn()
    with _lock:
        c.executescript(SCHEMA)
        have = {r["doc_id"] for r in c.execute("SELECT doc_id FROM documents")}
        summary = {}
        for d in manifest["documents"]:
            doc = RegulatoryDocument(**{k: v for k, v in d.items() if k in RegulatoryDocument.model_fields})
            raw = RAW_DIR / f"{doc.doc_id}.{doc.format}"
            if not raw.exists():
                summary[doc.doc_id] = "missing (run scripts/fetch_regulations.py)"
                continue
            sha = hashlib.sha256(raw.read_bytes()).hexdigest()
            if doc.doc_id in have and not force:
                old = RegulatoryDocument.model_validate_json(c.execute("SELECT json FROM documents WHERE doc_id=?", (doc.doc_id,)).fetchone()[0])
                if old.sha256 == sha:
                    summary[doc.doc_id] = f"indexed ({old.clause_count} clauses)"
                    continue
            clauses = parse(doc, raw)
            doc.sha256, doc.clause_count = sha, len(clauses)
            c.execute("DELETE FROM clauses WHERE doc_id=?", (doc.doc_id,))
            c.execute("DELETE FROM clauses_fts WHERE clause_id IN (SELECT clause_id FROM clauses WHERE doc_id=?)", (doc.doc_id,))
            c.execute("DELETE FROM clauses_fts WHERE clause_id LIKE ?", (doc.doc_id + "/%",))
            for cl in clauses:
                c.execute("INSERT OR REPLACE INTO clauses VALUES (?,?,?,?)", (cl.clause_id, cl.doc_id, cl.instrument, cl.model_dump_json()))
                c.execute("INSERT INTO clauses_fts VALUES (?,?,?,?)", (cl.clause_id, cl.instrument, cl.heading or "", cl.text))
            c.execute("INSERT OR REPLACE INTO documents VALUES (?,?)", (doc.doc_id, doc.model_dump_json()))
            summary[doc.doc_id] = f"parsed {len(clauses)} clauses"
        c.commit()
    return summary


def documents() -> list[RegulatoryDocument]:
    try:
        return [RegulatoryDocument.model_validate_json(r[0]) for r in conn().execute("SELECT json FROM documents ORDER BY doc_id")]
    except sqlite3.OperationalError:
        return []


def document(doc_id: str) -> RegulatoryDocument | None:
    r = conn().execute("SELECT json FROM documents WHERE doc_id=?", (doc_id,)).fetchone()
    return RegulatoryDocument.model_validate_json(r[0]) if r else None


def clause(clause_id: str) -> Clause | None:
    r = conn().execute("SELECT json FROM clauses WHERE clause_id=?", (clause_id,)).fetchone()
    return Clause.model_validate_json(r[0]) if r else None


def clauses_of(doc_id: str) -> list[Clause]:
    return [Clause.model_validate_json(r[0]) for r in conn().execute("SELECT json FROM clauses WHERE doc_id=? ORDER BY rowid", (doc_id,))]


def _fts_query(q: str) -> str:
    toks = [t for t in re.findall(r"[A-Za-z0-9]+", q.lower()) if len(t) > 1 and t not in {"the", "of", "and", "or", "to", "a", "in", "for", "is", "be", "shall"}]
    return " OR ".join(f'"{t}"' for t in toks) if toks else '""'


def excerpt(text: str, q: str, words: int = 40) -> str:
    toks = [t.lower() for t in re.findall(r"[A-Za-z0-9-]+", q) if len(t) > 3]
    ws = text.split()
    idx = next((i for i, w in enumerate(ws) if any(t in w.lower() for t in toks)), 0)
    start = max(0, idx - 8)
    s = " ".join(ws[start:start + words])
    return ("… " if start else "") + s + (" …" if start + words < len(ws) else "")


def bm25(q: str, instruments: list[str] | None = None, limit: int = 20) -> list[SearchHit]:
    sql = "SELECT clause_id, bm25(clauses_fts, 0, 0, 3.0, 1.0) AS s FROM clauses_fts WHERE clauses_fts MATCH ?"
    args: list = [_fts_query(q)]
    if instruments:
        sql += f" AND instrument IN ({','.join('?' * len(instruments))})"
        args += instruments
    sql += " ORDER BY s LIMIT ?"
    args.append(limit)
    hits = []
    for rank, r in enumerate(conn().execute(sql, args).fetchall(), 1):
        cl = clause(r["clause_id"])
        if cl:
            hits.append(SearchHit(clause=cl, score=-float(r["s"]), rank_bm25=rank, excerpt=excerpt(cl.text, q)))
    return hits
