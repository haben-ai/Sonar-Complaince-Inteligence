"""Regulatory knowledge endpoints."""
from __future__ import annotations

import re

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from backend.compliance import regulatory_engine
from backend.config import settings

router = APIRouter(prefix="/api", tags=["requirements"])


@router.get("/requirements")
def requirements():
    return regulatory_engine.all_requirements()


@router.post("/requirements/import")
async def import_requirements(file: UploadFile = File(...), source_name: str = Form(...)):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Upload a PDF of a legally obtained regulatory document")
    data = await file.read()
    path = settings.upload_dir / ("reg_" + re.sub(r"[^A-Za-z0-9_.-]", "_", file.filename))
    path.write_bytes(data)
    reqs = regulatory_engine.import_document(path, source_name)
    return {"imported": len(reqs), "validation_status": "unverified_extracted_requirement", "items": reqs[:50]}
