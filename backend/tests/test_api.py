from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import app

SYN = Path(__file__).resolve().parent.parent / "data" / "synthetic" / "synthetic_test_ship.json"


def test_upload_analyze_and_evidence():
    with TestClient(app) as c:
        st = c.get("/api/status").json()
        assert "mode" in st
        r = c.post("/api/upload/design", files={"file": ("synthetic_api.json", SYN.read_bytes(), "application/json")})
        assert r.status_code == 200
        did = r.json()["design_id"]
        for _ in range(50):
            if c.get(f"/api/designs/{did}").json()["status"] == "ready":
                break
        s = c.get("/api/analysis/summary", params={"design_id": did}).json()
        assert len(s["summaries"]) == 3
        fs = c.get("/api/findings", params={"design_id": did, "status": "POTENTIAL_CONNECTIVITY_ISSUE"}).json()
        assert fs
        d = c.get(f"/api/findings/{fs[0]['id']}", params={"design_id": did}).json()
        assert d["evidence"] and d["requirements"]
        assert all(r["validation_status"] for r in d["requirements"])


def test_rejects_unknown_file_type():
    with TestClient(app) as c:
        r = c.post("/api/upload/design", files={"file": ("x.exe", b"MZ", "application/octet-stream")})
        assert r.status_code == 400


def test_requirements_have_no_invented_clauses():
    with TestClient(app) as c:
        reqs = c.get("/api/requirements").json()
        assert reqs
        for r in reqs:
            if r["validation_status"] != "verified_regulatory_requirement":
                assert r["clause"] is None
        assert not any(r["validation_status"] == "verified_regulatory_requirement" for r in reqs)
