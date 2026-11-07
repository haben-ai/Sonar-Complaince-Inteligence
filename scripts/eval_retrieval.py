"""Compare BM25-only vs hybrid (BM25 + Gemini embeddings, RRF) clause retrieval.

    .venv/bin/python scripts/eval_retrieval.py

Gold set: hand-picked queries with the clause(s) that answer them. 'keyword' queries reuse
the regulation's own wording; 'paraphrase' queries ask in engineer's words. Writes
data/output/retrieval_eval.json. Uses paid embedding calls (one per query).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import settings  # noqa: E402
from backend.regulatory.index import store  # noqa: E402
from backend.regulatory.retrieve import hybrid  # noqa: E402

S13 = "SOLAS-II2-MSC99-73/Regulation13/"
GOLD = [
    # keyword-style (regulation wording)
    ("keyword", "dead-end corridor length", {S13 + "3.3.4"}),
    ("keyword", "two means of escape machinery space category A cargo ship", {S13 + "4.2.1"}),
    ("keyword", "door clear width 815 mm", {"ADA-2010-STANDARDS/404.2.3", "PVAG-CH-V4/V404.2.3"}),
    ("keyword", "ships carrying not more than 60 persons fire protection", {"SPS-CODE-MSC266-84/CHAPTER6/6.3"}),
    ("keyword", "oil fuel tanks inboard of side shell distance w", {"MARPOL-I-12A-MEPC141-54/Regulation12A/7"}),
    ("keyword", "definition machinery spaces of category A internal combustion 375 kW", {"SOLAS-II2-MSC99-73/Regulation3/31"}),
    # paraphrases (engineer's words)
    ("paraphrase", "how long may a corridor be if it only has a way out at one end", {S13 + "3.3.4", S13 + "3.1.2"}),
    ("paraphrase", "the engine room needs a second way out", {S13 + "4.2.1", S13 + "4.1.1", S13 + "4.2"}),
    ("paraphrase", "how wide must a doorway be for wheelchair users", {"ADA-2010-STANDARDS/404.2.3", "PVAG-CH-V4/V404.2.3"}),
    ("paraphrase", "research ship with fewer than sixty people on board - which fire safety rules apply", {"SPS-CODE-MSC266-84/CHAPTER6/6.3"}),
    ("paraphrase", "minimum gap between the fuel bunkers and the ship's side plating", {"MARPOL-I-12A-MEPC141-54/Regulation12A/7"}),
    ("paraphrase", "what counts as a category A engine space", {"SOLAS-II2-MSC99-73/Regulation3/31"}),
    ("paraphrase", "staircases must lead people to where the lifeboats are boarded", {S13 + "3.1.1"}),
    ("paraphrase", "fire resistance required for walls and decks on a cargo ship", {"SOLAS-II2-MSC99-73/Regulation9/2.3.3.1"}),
    ("paraphrase", "small machinery room where one exit is enough because the door is close by", {S13 + "4.2.3"}),
    ("paraphrase", "ships have to treat or exchange the water they take in for stability", {"BWM-IMO-SUMMARY/p004", "BWM-IMO-SUMMARY/p006", "BWM-IMO-SUMMARY/p017"}),
]


def evaluate(fn, k=5):
    rows = []
    for kind, q, gold in GOLD:
        ids = [h.clause.clause_id for h in fn(q)]
        rank = next((i + 1 for i, c in enumerate(ids) if c in gold), None)
        rows.append({"kind": kind, "query": q, "rank": rank, "hit@k": bool(rank and rank <= k), "top3": ids[:3]})
    return rows


def summary(rows, kind=None, k=5):
    rs = [r for r in rows if kind is None or r["kind"] == kind]
    return {"n": len(rs), f"recall@{k}": round(sum(r["hit@k"] for r in rs) / len(rs), 3),
            "mrr": round(sum(1 / r["rank"] for r in rs if r["rank"]) / len(rs), 3)}


if __name__ == "__main__":
    store.build()
    if not hybrid.status()["vector_index"]:
        sys.exit("No embedding index - run build_embeddings() first.")
    bm = evaluate(lambda q: store.bm25(q, None, limit=20))
    hy = evaluate(lambda q: hybrid.search(q, None, limit=20))
    out = {"embedding_model": hybrid.EMB_MODEL, "llm_model": settings.gemini_model,
           "bm25": {"all": summary(bm), "keyword": summary(bm, "keyword"), "paraphrase": summary(bm, "paraphrase")},
           "hybrid": {"all": summary(hy), "keyword": summary(hy, "keyword"), "paraphrase": summary(hy, "paraphrase")},
           "per_query": [{"query": a["query"], "kind": a["kind"], "bm25_rank": a["rank"], "hybrid_rank": b["rank"],
                          "hybrid_top3": b["top3"]} for a, b in zip(bm, hy)]}
    p = settings.output_dir / "retrieval_eval.json"
    p.write_text(json.dumps(out, indent=1))
    print(json.dumps({k: out[k] for k in ("bm25", "hybrid")}, indent=1))
    for r in out["per_query"]:
        print(f"{r['kind']:10s} bm25={str(r['bm25_rank']):>4s} hybrid={str(r['hybrid_rank']):>4s}  {r['query']}")
