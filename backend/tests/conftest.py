import pytest

from backend.config import settings
from backend.data.synthetic.generate import build
from backend.services.analysis_service import analyze


@pytest.fixture(scope="session")
def synthetic_model():
    return build(True, "synthetic_test_ship")


@pytest.fixture(scope="session")
def synthetic_result(synthetic_model):
    return analyze(synthetic_model)


@pytest.fixture(scope="session")
def dana_model():
    if not settings.default_pdf.exists():
        pytest.skip("DANA V PDF not present (run scripts/fetch_dana_v.sh)")
    from backend.services.extraction_pipeline import extract_pdf

    return extract_pdf(settings.default_pdf, "dana_v_test")


@pytest.fixture(scope="session")
def dana_result(dana_model):
    return analyze(dana_model)


def by_space(result, engine_prefix):
    return {f.affected_ids[0]: f for f in result.findings if f.engine.value.startswith(engine_prefix)}
