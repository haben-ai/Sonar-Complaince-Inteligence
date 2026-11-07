"""CheckSpec loading, verbatim-quote verification and engineer validation records."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from backend.config import settings
from backend.models.regulatory_models import CheckSpec
from backend.regulatory.index import store

SPECS_PATH = settings.data_dir / "check_specs.json"
VALIDATIONS_PATH = settings.output_dir / "spec_validations.json"


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace("’", "'").replace("“", '"').replace("”", '"')).strip().lower()


def quote_found(spec: CheckSpec) -> bool:
    q = _norm(spec.quote)
    for cid in spec.clause_ids:
        cl = store.clause(cid)
        if cl and q in _norm(cl.text):
            return True
    return False


def load() -> list[CheckSpec]:
    data = json.loads(SPECS_PATH.read_text())
    vals = json.loads(VALIDATIONS_PATH.read_text()) if VALIDATIONS_PATH.exists() else {}
    out = []
    for s in data["specs"]:
        spec = CheckSpec.model_validate(s)
        spec.quote_verified = quote_found(spec)
        v = vals.get(spec.spec_id)
        if v:
            spec.validation_status, spec.validated_by, spec.validated_at = v["status"], v["by"], v["at"]
        out.append(spec)
    return out


def validate(spec_id: str, by: str, status: str) -> dict:
    if status not in ("engineer_validated", "rejected", "draft"):
        raise ValueError("status must be engineer_validated, rejected or draft")
    vals = json.loads(VALIDATIONS_PATH.read_text()) if VALIDATIONS_PATH.exists() else {}
    vals[spec_id] = {"status": status, "by": by, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    VALIDATIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    VALIDATIONS_PATH.write_text(json.dumps(vals, indent=1))
    return vals[spec_id]
