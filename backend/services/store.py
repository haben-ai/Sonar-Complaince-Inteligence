"""In-memory design store with on-disk cache (data/output/<design_id>/)."""
from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass, field
from pathlib import Path

from backend.config import settings
from backend.extraction.pdf_parser import PdfDocument
from backend.models.engineering_models import SCHEMA_VERSION, EngineeringModel
from backend.models.finding_models import AnalysisResult
from backend.services import analysis_service, scenarios
from backend.services.extraction_pipeline import PIPELINE_VERSION, extract_image, extract_pdf, load_json_model


@dataclass
class DesignEntry:
    design_id: str
    source_path: Path | None
    source_type: str
    model: EngineeringModel | None = None
    status: str = "pending"          # pending | extracting | ready | error
    progress: list[str] = field(default_factory=list)
    error: str | None = None
    results: dict[str, AnalysisResult] = field(default_factory=dict)
    _pdf: PdfDocument | None = None

    @property
    def pdf(self) -> PdfDocument | None:
        if self._pdf is None and self.source_type == "pdf" and self.source_path:
            self._pdf = PdfDocument(self.source_path)
        return self._pdf


_designs: dict[str, DesignEntry] = {}
_lock = threading.Lock()


def _cache_path(design_id: str) -> Path:
    return settings.output_dir / design_id / "engineering_model.json"


def list_designs() -> list[DesignEntry]:
    return list(_designs.values())


def get(design_id: str) -> DesignEntry:
    if design_id not in _designs:
        raise KeyError(design_id)
    return _designs[design_id]


def register(path: Path, source_type: str, design_id: str | None = None, name: str | None = None, background=True) -> DesignEntry:
    if design_id is None:
        h = hashlib.sha256(path.read_bytes()).hexdigest()[:10]
        design_id = f"{path.stem[:24].lower().replace(' ', '_')}_{h}"
    entry = DesignEntry(design_id, path, source_type)
    _designs[design_id] = entry

    def work():
        try:
            entry.status = "extracting"
            entry.progress.append(f"Reading {source_type.upper()} {path.name}")
            cache = _cache_path(design_id)
            if source_type == "json":
                entry.model = load_json_model(path, design_id)
            else:
                sha = hashlib.sha256(path.read_bytes()).hexdigest()
                if cache.exists():
                    cached = EngineeringModel.model_validate_json(cache.read_text())
                    if (cached.document.sha256 == sha and cached.schema_version == SCHEMA_VERSION
                            and cached.document.metadata.get("pipeline_version") == PIPELINE_VERSION
                            and bool(cached.document.metadata.get("llm_enabled")) == settings.llm_enabled):
                        entry.model = cached
                        entry.progress.append("Loaded cached extraction for identical file (sha256 match)")
                if entry.model is None:
                    if source_type == "pdf":
                        from backend.services.extraction_pipeline import pdf_mode
                        if pdf_mode(PdfDocument(path)) == "outlined":
                            entry.progress.append("No text layer and no CAD layers (text converted to outlines): running OCR on every "
                                                  "sheet - this takes about 5 s per sheet on first import")
                    entry.progress.append("Extracting decks, spaces, doors, escape points and adjacencies")
                    entry.model = (extract_pdf(path, design_id, name) if source_type == "pdf" else extract_image(path, design_id, name))
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    cache.write_text(entry.model.model_dump_json(indent=1))
            entry.progress += entry.model.extraction_log
            entry.progress.append("Running safety engines")
            analyze(design_id)
            entry.status = "ready"
            entry.progress.append("Analysis complete")
        except Exception as e:  # surface errors to the UI
            entry.status = "error"
            entry.error = f"{type(e).__name__}: {e}"
            entry.progress.append(entry.error)

    if background:
        threading.Thread(target=work, daemon=True).start()
    else:
        work()
    return entry


def analyze(design_id: str, scenario: str | None = None) -> AnalysisResult:
    entry = get(design_id)
    key = scenario or "_base"
    with _lock:
        if key in entry.results:
            return entry.results[key]
        model = entry.model if not scenario else scenarios.apply(entry.model, scenario)
        res = analysis_service.analyze(model)
        entry.results[key] = res
        out = settings.output_dir / design_id
        out.mkdir(parents=True, exist_ok=True)
        (out / f"findings{'' if not scenario else '_' + scenario}.json").write_text(res.model_dump_json(indent=1))
        return res


def model_for(design_id: str, scenario: str | None) -> EngineeringModel:
    entry = get(design_id)
    return entry.model if not scenario else scenarios.apply(entry.model, scenario)


def bootstrap() -> None:
    """Register the default DANA V drawing (if present) and the synthetic designs."""
    if settings.default_pdf.exists():
        register(settings.default_pdf, "pdf", design_id="dana_v", name="DANA V - General Arrangement (rev 2.14)")
    for p in sorted((settings.data_dir / "synthetic").glob("*.json")):
        register(p, "json", design_id=p.stem, background=False)
