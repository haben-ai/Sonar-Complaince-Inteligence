from __future__ import annotations

from backend.services.store import DesignEntry


def design_summary(e: DesignEntry) -> dict:
    m = e.model
    return {
        "design_id": e.design_id,
        "status": e.status,
        "error": e.error,
        "source_type": e.source_type,
        "progress": e.progress[-60:],
        "name": m.document.name if m else (e.source_path.name if e.source_path else e.design_id),
        "filename": m.document.filename if m else (e.source_path.name if e.source_path else None),
        "page_count": m.document.page_count if m else None,
        "page_sizes": m.document.page_sizes if m else [],
        "data_origin": m.document.data_origin.value if m else None,
        "metadata": m.document.metadata if m else {},
        "counts": {
            "decks": len(m.decks), "spaces": len(m.spaces), "doors": len(m.doors),
            "escape_points": len(m.escape_points), "connections": len(m.connections),
            "adjacencies": len(m.adjacencies), "evidence": len(m.evidence),
        } if m else {},
    }
