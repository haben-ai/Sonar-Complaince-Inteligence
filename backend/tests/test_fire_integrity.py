"""The fire-integrity tables are transcribed from the stored SOLAS text, not typed from memory."""
import re

import pytest

from backend.compliance import fire_integrity as fi


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


@pytest.fixture(scope="module")
def clause_text():
    from backend.regulatory.index import store

    cl = store.clause(fi.SOURCE_CLAUSE)
    if cl is None:
        pytest.skip("regulatory corpus not installed (scripts/fetch_regulations.py)")
    return _norm(cl.text)


def test_table_rows_are_verbatim(clause_text):
    t91 = clause_text[clause_text.index("Table 9.1 – Bulkheads"):clause_text.index("Table 9.2 – Decks")]
    t92 = clause_text[clause_text.index("Table 9.2 – Decks"):]
    def row_ok(text, n, row):
        # "(n)" then optional label words, then exactly the transcribed cells, then the next label / note
        return re.search(rf"\({n}\)[A-Za-z ,]*?{re.escape(row)}(?= [A-Z][a-z]| See|$)", text) is not None

    for n, row in fi.TABLE_9_1_ROWS.items():
        assert row_ok(t91, n, row), (n, row)
    for n, row in fi.TABLE_9_2_ROWS.items():
        assert row_ok(t92, n, row), (n, row)


def test_lookups():
    assert fi.required_bulkhead(12, 8) == "A-60"      # machinery / main galley vs large public space
    assert fi.required_bulkhead(2, 12) == "A-30"      # stairway vs machinery
    assert fi.required_bulkhead(14, 6) == "A-30"      # paint locker vs cabin
    assert fi.required_deck(12, 6) == "A-60"          # machinery below cabins
    assert fi.required_bulkhead(4, 12) is None        # row (4) not encoded: no requirement invented
