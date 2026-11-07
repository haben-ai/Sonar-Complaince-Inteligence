"""Hybrid clause retrieval: BM25 (SQLite FTS5) + optional dense embeddings, fused with RRF.

Embeddings are used only when GEMINI_API_KEY is set and an embedding index has been built
(`build_embeddings()`); otherwise retrieval is BM25-only. Retrieval returns clauses, never verdicts.
"""
from __future__ import annotations

import json
import logging

import numpy as np

from backend.config import settings
from backend.models.regulatory_models import SearchHit
from backend.regulatory.index import store

log = logging.getLogger(__name__)
EMB_PATH = settings.root / "data" / "regulatory" / "embeddings.npy"
EMB_IDS = settings.root / "data" / "regulatory" / "embeddings_ids.json"
EMB_MODEL = "gemini-embedding-001"
_emb: tuple[np.ndarray, list[str]] | None = None


_client = None


def _client_get():
    global _client
    if _client is None:
        from google import genai
        from google.genai import types

        _client = genai.Client(api_key=settings.gemini_api_key, http_options=types.HttpOptions(
            timeout=int(max(settings.gemini_timeout_s, 60) * 1000), retry_options=types.HttpRetryOptions(attempts=1)))
    return _client


def _embed(texts: list[str], task: str = "RETRIEVAL_QUERY") -> np.ndarray | None:
    """Embed texts (task RETRIEVAL_DOCUMENT for clauses, RETRIEVAL_QUERY for searches). None on failure."""
    if not settings.llm_enabled or not texts:
        return None
    from google.genai import types

    try:
        r = _client_get().models.embed_content(model=EMB_MODEL, contents=texts,
                                               config=types.EmbedContentConfig(task_type=task))
        a = np.array([e.values for e in r.embeddings], np.float32)
        return a / np.linalg.norm(a, axis=1, keepdims=True)
    except Exception as e:  # pragma: no cover - network dependent
        log.warning("embedding failed: %s", str(e)[:200])
        return None


VEC_STORE = EMB_PATH.parent / "clause_vectors.npz"     # clause_id -> vector (incremental)
PRIORITY = ["SOLAS-II2-MSC99-73", "SPS-CODE-MSC266-84", "MARPOL-I-12A-MEPC141-54", "PVAG-CH-V4",
            "SOLAS-IMO-SUMMARY", "MARPOL-IMO-SUMMARY", "BWM-IMO-SUMMARY", "LOADLINE-IMO-SUMMARY",
            "COLREG-IMO-SUMMARY", "PVAG-ACCESS-BOARD", "ADA-2010-STANDARDS"]


def _load_store() -> dict[str, np.ndarray]:
    if VEC_STORE.exists():
        z = np.load(VEC_STORE)
        return {k: z[k] for k in z.files}
    return {}


def _save_store(vs: dict[str, np.ndarray]) -> None:
    np.savez(VEC_STORE, **vs)
    ids = list(vs)
    np.save(EMB_PATH, np.vstack([vs[i] for i in ids]))
    EMB_IDS.write_text(json.dumps(ids))
    global _emb
    _emb = None


def _migrate_old_checkpoints(vs: dict, ids_sorted: list[str]) -> None:
    ck = EMB_PATH.parent / "emb_ckpt"
    if not ck.exists():
        return
    for f in ck.glob("*.npy"):
        start = int(f.name.split("_")[0])
        for j, v in enumerate(np.load(f)):
            if start + j < len(ids_sorted):
                vs.setdefault(ids_sorted[start + j], v)


def build_embeddings(batch: int = 20, progress=print, min_interval_s: float = 25.0, max_texts: int | None = None) -> int:
    """Embed stored clauses not yet embedded, most important instruments first (paid / quota-limited calls).
    Incremental: every batch is saved, so quota stops lose nothing. Returns the number of clauses embedded in total."""
    import time

    rows = store.conn().execute("SELECT clause_id, doc_id, json FROM clauses ORDER BY clause_id").fetchall()
    vs = _load_store()
    _migrate_old_checkpoints(vs, [r[0] for r in rows])
    order = {d: i for i, d in enumerate(PRIORITY)}
    todo = sorted([r for r in rows if r[0] not in vs], key=lambda r: (order.get(r[1], 99), r[0]))
    if max_texts:
        todo = todo[:max_texts]
    progress(f"{len(vs)} clauses already embedded, {len(todo)} to do")
    last = 0.0
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        texts = []
        for r in chunk:
            c = json.loads(r[2])
            texts.append(f"{c['instrument']} {' > '.join(p for p in c['path'] if p)}: {c['text']}"[:2000])
        wait = min_interval_s - (time.time() - last)
        if wait > 0:
            time.sleep(wait)
        a = None
        for attempt in range(3):
            last = time.time()
            a = _embed(texts, "RETRIEVAL_DOCUMENT")
            if a is not None:
                break
            time.sleep(30 * (attempt + 1))
        if a is None:
            _save_store(vs)
            progress(f"stopped by quota/error after {len(vs)} clauses - rerun later to continue")
            return len(vs)
        for r, v in zip(chunk, a):
            vs[r[0]] = v
        _save_store(vs)
        progress(f"embedded {len(vs)}/{len(rows)}")
    _save_store(vs)
    return len(vs)


_qcache: dict[str, np.ndarray] = {}


def _query_vec(q: str):
    if q not in _qcache:
        v = _embed([q], "RETRIEVAL_QUERY")
        if v is None:
            return None
        _qcache[q] = v
    return _qcache[q]


def status() -> dict:
    n = len(json.loads(EMB_IDS.read_text())) if EMB_IDS.exists() else 0
    total = store.conn().execute("SELECT count(*) FROM clauses").fetchone()[0] if n else 0
    return {"vector_index": n > 0, "model": EMB_MODEL, "clauses_embedded": n, "clauses_total": total,
            "coverage": round(n / total, 3) if total else 0.0}


def _vector_ranking(q: str, limit: int) -> list[str]:
    global _emb
    if _emb is None:
        if not (EMB_PATH.exists() and EMB_IDS.exists()):
            return []
        _emb = (np.load(EMB_PATH), json.loads(EMB_IDS.read_text()))
    qv = _query_vec(q)
    if qv is None:
        return []
    sims = _emb[0] @ qv[0]
    return [_emb[1][i] for i in np.argsort(-sims)[:limit]]


def search(q: str, instruments: list[str] | None = None, limit: int = 10, k: int = 60) -> list[SearchHit]:
    bm = store.bm25(q, instruments, limit=limit * 3)
    vec = _vector_ranking(q, limit * 3)
    if not vec:
        return bm[:limit]
    scores: dict[str, float] = {}
    for i, h in enumerate(bm, 1):
        scores[h.clause.clause_id] = scores.get(h.clause.clause_id, 0) + 1 / (k + i)
    vrank = {cid: i for i, cid in enumerate(vec, 1)}
    for cid, i in vrank.items():
        scores[cid] = scores.get(cid, 0) + 1 / (k + i)
    hits = []
    for cid, s in sorted(scores.items(), key=lambda t: -t[1]):
        cl = store.clause(cid)
        if not cl or (instruments and cl.instrument not in instruments):
            continue
        hits.append(SearchHit(clause=cl, score=s, rank_bm25=next((h.rank_bm25 for h in bm if h.clause.clause_id == cid), None),
                              rank_vector=vrank.get(cid), excerpt=store.excerpt(cl.text, q)))
        if len(hits) >= limit:
            break
    return hits
