from __future__ import annotations

import hashlib
import re
import urllib.request

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.api.serializers import design_summary
from backend.config import settings
from backend.services import store

router = APIRouter(prefix="/api", tags=["upload"])

ALLOWED = {".pdf": "pdf", ".png": "image", ".jpg": "image", ".jpeg": "image", ".json": "json"}


@router.post("/upload/design")
async def upload_design(file: UploadFile = File(...)):
    name = file.filename or "upload"
    ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ALLOWED:
        raise HTTPException(400, f"Unsupported file type {ext}. Use PDF, PNG/JPG or JSON engineering data.")
    data = await file.read()
    if len(data) > 60 * 1024 * 1024:
        raise HTTPException(413, "File too large (60 MB limit)")
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", name)
    path = settings.upload_dir / safe
    path.write_bytes(data)
    sha = hashlib.sha256(data).hexdigest()
    design_id = "dana_v" if sha == settings.dana_v_sha256 else None
    entry = store.register(path, ALLOWED[ext], design_id=design_id,
                           name="DANA V - General Arrangement (rev 2.14)" if design_id == "dana_v" else None)
    return design_summary(entry)


class UrlImport(BaseModel):
    url: str


@router.post("/upload/url")
def upload_url(req: UrlImport):
    """Import a design from a URL (direct file link or Box share link)."""
    from backend.services.url_import import ImportErrorWithHint, download

    try:
        d = download(req.url.strip())
    except ImportErrorWithHint as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, f"Download failed: {e}")
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", d.filename)
    ext = "." + safe.rsplit(".", 1)[-1].lower() if "." in safe else ""
    if ext not in ALLOWED:
        raise HTTPException(400, f"Downloaded file '{d.filename}' is not a PDF, image or JSON design.")
    path = settings.upload_dir / safe
    path.write_bytes(d.data)
    sha = hashlib.sha256(d.data).hexdigest()
    design_id = "dana_v" if sha == settings.dana_v_sha256 else None
    entry = store.register(path, ALLOWED[ext], design_id=design_id)
    out = design_summary(entry)
    out["resolved_from"] = d.resolved_from
    return out


@router.post("/upload/fetch-dana-v")
def fetch_dana_v():
    """Download the public DANA V GA PDF to data/input/ (used when it was not shipped with the repo)."""
    dest = settings.default_pdf
    if not dest.exists():
        req = urllib.request.Request(settings.dana_v_url, headers={"User-Agent": "maritime-safety-intelligence/0.1"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
        except Exception as e:
            raise HTTPException(502, f"Download failed ({e}). Upload the PDF manually instead.")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    entry = store.register(dest, "pdf", design_id="dana_v", name="DANA V - General Arrangement (rev 2.14)")
    return design_summary(entry)
