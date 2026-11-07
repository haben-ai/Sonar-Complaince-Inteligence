"""Maritime Safety Intelligence - FastAPI backend.

Run:  .venv/bin/uvicorn backend.main:app --port 8000
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.api import analysis, findings, scene, upload
from backend.compliance import regulatory_engine
from backend.regulatory import api as regulatory_api
from backend.regulatory.index import store as regulatory_store
from backend.services import store

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    regulatory_engine.load_defaults()
    try:
        logging.getLogger(__name__).info("regulatory index: %s", regulatory_store.build())
    except Exception as e:  # corpus not downloaded yet
        logging.getLogger(__name__).warning("regulatory index not built: %s", e)
    store.bootstrap()
    yield


app = FastAPI(title="Maritime Safety Intelligence", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(upload.router)
app.include_router(analysis.router)
app.include_router(findings.router)
app.include_router(scene.router)
app.include_router(regulatory_api.router)

_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _dist.exists():  # serve the built dashboard from the same origin
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
