from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

ROOT = Path(__file__).resolve().parent.parent
if load_dotenv:
    load_dotenv(ROOT / ".env")

BACKEND = ROOT / "backend"


class Settings:
    root = ROOT
    data_dir = BACKEND / "data"
    input_dir = ROOT / "data" / "input"
    upload_dir = ROOT / "data" / "input" / "uploads"
    output_dir = ROOT / "data" / "output"
    gemini_api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    # tried in order when the primary model is overloaded / unavailable
    gemini_fallback_models = [m.strip() for m in os.getenv("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash-lite").split(",") if m.strip()]
    gemini_timeout_s = float(os.getenv("GEMINI_TIMEOUT_S", "20"))
    default_pdf = ROOT / os.getenv("DEFAULT_DESIGN_PDF", "data/input/dana_general_arrangement.pdf")
    dana_v_url = "https://dana.dtu.dk/-/media/subsites/dana/23007-01-101-0110-01-r2-14-general-arrangement.pdf"
    dana_v_sha256 = "764dfabfedfb37e6bf6bc3623a3e8434ad624d3d3601d2f982bb914f9d489c9d"

    @property
    def llm_enabled(self) -> bool:
        return bool(self.gemini_api_key)

    def manual_annotations_for(self, sha256: str) -> Path | None:
        """Manual annotations are tied to one exact drawing revision (by hash)."""
        if sha256 == self.dana_v_sha256:
            p = self.data_dir / "manual_annotations" / "dana_v_r2_14.json"
            return p if p.exists() else None
        return None


settings = Settings()
for d in (settings.upload_dir, settings.output_dir):
    d.mkdir(parents=True, exist_ok=True)
