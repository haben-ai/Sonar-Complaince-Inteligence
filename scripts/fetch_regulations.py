"""Download the regulatory sources listed in backend/data/regulatory_sources.json into data/regulatory/raw/."""
import hashlib, json, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / "backend/data/regulatory_sources.json").read_text())
out = ROOT / "data/regulatory/raw"
out.mkdir(parents=True, exist_ok=True)
for d in manifest["documents"]:
    dest = out / f"{d['doc_id']}.{d['format']}"
    if dest.exists():
        print("have ", d["doc_id"]); continue
    req = urllib.request.Request(d["url"], headers={"User-Agent": "Mozilla/5.0 (maritime-safety-intelligence research prototype)"})
    try:
        data = urllib.request.urlopen(req, timeout=90).read()
    except Exception as e:
        print("FAIL ", d["doc_id"], e, file=sys.stderr); continue
    dest.write_bytes(data)
    print("got  ", d["doc_id"], len(data), hashlib.sha256(data).hexdigest()[:12])
