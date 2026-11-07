"""Optional Gemini integration (multimodal drawing interpretation + explanations).

Role of the LLM in this system (and nothing more):
* suggest a controlled-vocabulary class for labels the deterministic rules did not match;
* write a plain-language explanation of a finding from the structured facts;
* summarise imported regulatory sentences.

Every LLM output is stored with provenance `llm_interpretation`, shown as such in the UI,
and never changes a finding status. Without GEMINI_API_KEY all functions return None and
the system runs in deterministic fallback mode.
"""
from __future__ import annotations

import json
import logging

from backend.config import settings

log = logging.getLogger(__name__)
_client = None


last_model_used: str | None = None


def _get_client():
    global _client
    if _client is None and settings.llm_enabled:
        try:
            from google import genai
            from google.genai import types

            # bounded: a request never blocks the API for long (overloaded models answer 503 and would be retried forever)
            _client = genai.Client(api_key=settings.gemini_api_key, http_options=types.HttpOptions(
                timeout=int(settings.gemini_timeout_s * 1000),
                retry_options=types.HttpRetryOptions(attempts=1)))
        except Exception as e:  # pragma: no cover - depends on environment
            log.warning("Gemini client unavailable: %s", e)
            _client = False
    return _client or None


def _generate(contents, json_mode: bool = False) -> str | None:
    """Try the configured model, then the fallbacks. Returns None if all fail (callers degrade gracefully)."""
    global last_model_used
    client = _get_client()
    if not client:
        return None
    from google.genai import types

    cfg = types.GenerateContentConfig(temperature=0.1, response_mime_type="application/json" if json_mode else "text/plain")
    for model in [settings.gemini_model] + [m for m in settings.gemini_fallback_models if m != settings.gemini_model]:
        try:
            resp = client.models.generate_content(model=model, contents=contents, config=cfg)
            last_model_used = model
            return resp.text
        except Exception as e:  # pragma: no cover - network dependent
            log.warning("Gemini %s failed: %s", model, str(e)[:200])
    last_model_used = None
    return None


def status() -> dict:
    return {
        "llm_enabled": settings.llm_enabled,
        "model": settings.gemini_model if settings.llm_enabled else None,
        "fallback_models": settings.gemini_fallback_models if settings.llm_enabled else [],
        "mode": "gemini-assisted" if settings.llm_enabled else "deterministic fallback (no GEMINI_API_KEY)",
    }


def classify_labels(labels: list[str], vocabulary: list[str], image_png: bytes | None = None) -> dict[str, dict] | None:
    """Suggest a vocabulary term for unmatched labels. Returns {label: {category, confidence, reason}}."""
    if not labels or not settings.llm_enabled:
        return None
    prompt = (
        "You are assisting a naval architect. Classify each ship-drawing room label into exactly one of these "
        f"categories, or 'unknown' if the label does not support a category: {vocabulary}.\n"
        "Rules: use only the label text (and the image if given); never infer hazards that the label does not state; "
        "return JSON {label: {\"category\": str, \"confidence\": number 0-1, \"reason\": str}}.\n"
        f"Labels: {json.dumps(labels)}"
    )
    contents = [prompt]
    if image_png:
        from google.genai import types

        contents.append(types.Part.from_bytes(data=image_png, mime_type="image/png"))
    txt = _generate(contents, json_mode=True)
    try:
        return json.loads(txt) if txt else None
    except json.JSONDecodeError:
        return None


def explain_finding(finding: dict) -> str | None:
    if not settings.llm_enabled:
        return None
    prompt = (
        "Explain this ship-design screening finding to a design engineer in 3-4 sentences. Use ONLY the facts given. "
        "Do not state or imply regulatory compliance or non-compliance, do not cite regulation paragraphs that are not "
        "in the input, and keep the uncertainty explicit.\n\n" + json.dumps(finding, default=str)[:12000]
    )
    return _generate([prompt])


def summarise_requirement(sentence: str) -> str | None:
    prompt = (
        "Summarise this regulatory sentence in one plain sentence. Do not add requirements, numbers or "
        f"references that are not in the text.\n\n{sentence}"
    )
    return _generate([prompt])


def vision_words(png: bytes, page_w: float, page_h: float) -> list | None:
    """Fallback when Tesseract is unavailable: ask Gemini to read every text label on a drawing sheet with a
    bounding box. Returns pdf_parser.Word objects in page units (conf fixed at 70 - LLM boxes are approximate).
    Gemini returns boxes as [ymin, xmin, ymax, xmax] normalised to 0-1000."""
    if not settings.llm_enabled:
        return None
    from google.genai import types

    from backend.extraction.pdf_parser import Word

    prompt = ("This is a ship general-arrangement drawing sheet. Return EVERY text label exactly as written (room names, "
              "compartment numbers, view titles, scales, deck-height callouts, UP/DN markers). JSON list of objects "
              "{\"text\": str, \"box_2d\": [ymin, xmin, ymax, xmax]} with coordinates normalised to 0-1000. Do not invent text.")
    txt = _generate([prompt, types.Part.from_bytes(data=png, mime_type="image/png")], json_mode=True)
    try:
        items = json.loads(txt) if txt else []
    except json.JSONDecodeError:
        return None
    out = []
    for i, it in enumerate(items):
        try:
            y0, x0, y1, x1 = [float(v) for v in it["box_2d"]]
            for tok in str(it["text"]).split():
                out.append(Word(tok, x0 / 1000 * page_w, y0 / 1000 * page_h, x1 / 1000 * page_w, y1 / 1000 * page_h, i, 0, 70.0))
        except (KeyError, ValueError, TypeError):
            continue
    return out
