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


def build_embeddings(batch: int = 50, progress=print, min_interval_s: float = 31.0) -> int:
    """Embed every stored clause (paid API calls). Resumable: finished batches are checkpointed."""
    import time

    rows = store.conn().execute("SELECT clause_id, json FROM clauses ORDER BY clause_id").fetchall()
    ids = [r[0] for r in rows]
    texts = []
    for r in rows:
        c = json.loads(r[1])
        head = " > ".join(p for p in c["path"] if p)
        texts.append(f"{c['instrument']} {head}: {c['text']}"[:2000])
    ck_dir = EMB_PATH.parent / "emb_ckpt"
    ck_dir.mkdir(parents=True, exist_ok=True)
    parts = []
    last = 0.0
    i = 0
    while i < len(texts):
        done = sorted(ck_dir.glob(f"{i:05d}_*_{len(texts)}.npy")) or sorted(ck_dir.glob(f"{i:05d}_{len(texts)}.npy"))
        if done:                                     # resume from any earlier checkpoint size
            a = np.load(done[0]); parts.append(a); i += len(a); continue
        f = ck_dir / f"{i:05d}_{batch:03d}_{len(texts)}.npy"
        # free tier counts every text as a request (100/min): pace batches
        wait = min_interval_s - (time.time() - last)
        if wait > 0:
            time.sleep(wait)
        for attempt in range(4):
            last = time.time()
            a = _embed(texts[i:i + batch], "RETRIEVAL_DOCUMENT")
            if a is not None:
                break
            time.sleep(30 * (attempt + 1))
        if a is None:
            progress(f"batch {i // batch + 1} failed after retries - rerun to resume")
            return 0
        np.save(f, a)
        parts.append(a)
        i += len(a)
        progress(f"embedded {i}/{len(texts)}")
    allv = np.vstack(parts)
    np.save(EMB_PATH, allv)
    EMB_IDS.write_text(json.dumps(ids))
    global _emb
    _emb = None
    return len(ids)


_qcache: dict[str, np.ndarray] = {}


def _query_vec(q: str):
    if q not in _qcache:
        v = _embed([q], "RETRIEVAL_QUERY")
        if v is None:
            return None
        _qcache[q] = v
    return _qcache[q]


def status() -> dict:
    return {"vector_index": EMB_PATH.exists() and EMB_IDS.exists(), "model": EMB_MODEL,
            "clauses_embedded": len(json.loads(EMB_IDS.read_text())) if EMB_IDS.exists() else 0}


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
