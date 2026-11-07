# Hybrid Regulatory RAG: Implementation Plan

> **Status (2026-11-07):** steps 0–4 implemented, plus the compliance matrix and the clause section of the evidence panel (from step 6). Not done: LLM spec extraction (step 5, needs a key), embedding index build, a dedicated validation screen (an inline validate button exists), and the full retrieval eval set (6 gold queries so far).

**Goal:** check the extracted (or imported) design against the rule set Meyer Turku listed in the challenge, with every
result tied to **a specific clause** and **specific drawing evidence**.

**Companion to:** the existing prototype (`backend/` engineering model + 3 safety engines + dashboard). Nothing in this
plan replaces it; it adds a regulatory layer on top of `EngineeringModel` and links its results into the existing
findings and evidence viewer.

---

## 1. The rule set provided by Meyer Turku (challenge appendix)

| Instrument | Public availability (per Meyer) | What it covers | Checkable from a GA? | Applies to DANA V? |
|---|---|---|---|---|
| **SOLAS** | Partially (IMO summaries/guidance) | Safety of life at sea: fire, escape, stability, LSA | **Partly**: escape routes (II-2/13), fire containment (II-2/9) and space categories; ratings need a fire plan | Yes, via the IMO **SPS Code** (special purpose ship, 38 persons). The exact provisions must be confirmed |
| **MARPOL** | Partially | Pollution prevention (oil, sewage, garbage…) | **Partly**: tank layout (fuel tanks vs. hull, sludge/bilge/sewage tanks present) | Yes; some regulations depend on capacity thresholds that are not on the GA |
| **COLREG** | Yes | Collision avoidance; Annex I = navigation-light positions | **Barely**: needs the light arrangement and mast heights; the GA profile gives only partial geometry | Yes |
| **Load Line Convention** | Partially | Freeboard, closures, deck-line marks | **Barely**: needs the freeboard plan, hydrostatics and closure heights | Yes |
| **Ballast Water Mgmt Convention** | Partially | Ballast water treatment and management | **Presence only**: ballast (WB) tanks can be identified; a treatment system usually can't | Yes |
| **Classification rules, e.g. DNV** | Yes (DNV rules portal) | Technical class requirements | Partly (arrangement rules) | DANA V is **BV**-classed (title block). DNV can only be used to demonstrate the method |
| **PVAG** | Yes (US Access Board) | Accessibility on passenger vessels | **Partly**: accessible routes and door widths, if *clear* widths are known | **No**: not a US passenger vessel. Demo mode only ("as if applicable") |
| **ADA** (2010 Standards) | Yes (US DOJ) | Accessibility (doors, routes, toilets…) | Same as PVAG | **No**: demo mode only |

**Consequence for the design:** the RAG must be **applicability-aware**. For each instrument and clause it must say
*applicable*, *not applicable (why)*, or *applicability unknown (what information is missing)* **before** any
compliance result is shown.

---

## 2. What "hybrid" means here

Three retrieval and reasoning channels, fused, with **Python deciding** and the **LLM extracting and explaining**:

```
           REGULATORY CORPUS                         DESIGN (existing)
   PDF/HTML of the 8 instruments              EngineeringModel (spaces, doors, decks,
              |                                connections, adjacencies, evidence)
     ingest -> clause tree                                 |
              |                                            |
   ┌──────────┴──────────┐                       design facts / properties
   | A. Lexical (BM25)   |                                 |
   | B. Semantic (emb.)  |  <- query built from design ->  |
   | C. Structured store |     element + ship profile      |
   |   (CheckSpecs,      |                                 |
   |    metadata filter) |                                 |
   └──────────┬──────────┘                                 |
              | RRF fusion + applicability filter          |
              v                                            v
     candidate clauses ──> CheckSpec (LLM-extracted, ENGINEER-VALIDATED)
                                   |
                                   v
              Deterministic evaluator (graph / numeric / presence / documentation)
                                   |
                                   v
        ComplianceResult  ── cites clause (doc, §, page, excerpt) + drawing evidence ids
                                   |
                                   v
          Findings panel / Evidence viewer / Compliance matrix (dashboard)
```

* **A. Lexical (SQLite FTS5 / BM25).** Exact terms matter in regulations ("means of escape", "dead-end",
  "clear width", "A-60"). No extra infrastructure.
* **B. Semantic (embeddings).** Catches paraphrase ("way out of the engine room" → *means of escape from machinery
  spaces*). Gemini embeddings when a key exists; vectors stored as a NumPy array next to the SQLite file. **No vector
  database**: the corpus is thousands of clauses, not millions.
* **C. Structured requirement store.** Atomic, machine-checkable `CheckSpec`s with metadata (instrument, ship type,
  object type, property, threshold, unit, conditions). Filtering by metadata happens **before** ranking, so a PVAG
  clause is never ranked for a non-passenger vessel unless demo mode is on.
* **Fusion:** Reciprocal Rank Fusion (RRF) of A and B, re-ranked by structured metadata match (C). With no LLM key the
  system falls back to BM25 + C only.

---

## 3. Data model additions (`backend/models/regulatory_models.py`)

```python
class RegulatoryDocument(BaseModel):
    doc_id: str                 # "SOLAS-2020-CONSOLIDATED", "ADA-2010", "PVAG-2013-NPRM", "DNV-RU-SHIP-Pt3Ch?"
    instrument: Literal["SOLAS","MARPOL","COLREG","LOAD_LINE","BWM","CLASS_DNV","CLASS_BV","PVAG","ADA","SPS_CODE","FSS_CODE"]
    title: str; edition: str; source_url: str | None
    licence: str                # "public domain (US Gov)", "IMO copyright - local licensed copy", ...
    sha256: str; imported_at: datetime
    completeness: Literal["full_text","partial","summary_only"]

class Clause(BaseModel):
    clause_id: str              # "SOLAS-2020/II-2/13/3.2.1"   (stable, hierarchical)
    doc_id: str
    path: list[str]             # ["Chapter II-2","Part D","Regulation 13","3","3.2","3.2.1"]
    heading: str | None
    text: str                   # stored locally; displayed as a short excerpt only (copyright)
    page: int
    char_span: tuple[int, int]
    cross_refs: list[str]       # clause ids referenced ("see regulation 9", "FSS Code ch.13")
    text_hash: str

class VesselProfile(BaseModel):  # drives applicability; extracted from the title block + user input
    ship_type: str              # "special_purpose_ship (research)"   <- "Special Service/Research Vessel SP38"
    persons_on_board: int | None  # 38                                  <- "ACCOMMODATION FOR 38 PERSONS"
    passengers: int | None      # 0 (special personnel are not passengers under SPS) -> to confirm
    length_m: float | None      # LOA 69.80 / LPP 67.40
    gross_tonnage: float | None # NOT on GA -> unknown
    flag: str | None; class_society: str | None   # BV
    keel_laid: date | None      # needed for "ships constructed on or after" clauses -> unknown
    ice_class: str | None       # "ICE CLASS IA, POLAR CLASS 6"
    evidence_ids: list[str]

class CheckSpec(BaseModel):     # one atomic, testable requirement derived from a clause
    spec_id: str                # "SOLAS-II2-13-MACH-TWO-MEANS"
    clause_ids: list[str]       # provenance: which clause text it came from
    applicability: list[Condition]   # e.g. ship_type in [...], persons_on_board > 60, constructed_after ...
    target: Selector            # object type / space kind / hazard category / label regex
    evaluator: Literal["graph_connectivity","graph_independent_routes","numeric_threshold",
                       "presence","adjacency_documentation","not_assessable_from_ga"]
    property: str | None        # "door.clear_width_mm", "corridor.dead_end_length_m", "space.independent_routes"
    operator: Literal[">=","<=","==","exists","count>="] | None
    threshold: float | None; unit: str | None
    required_evidence: list[str]     # what must exist in the design data to evaluate
    extracted_by: Literal["manual","llm"]; extraction_model: str | None
    validation: ValidationRecord     # status: draft | engineer_validated | rejected ; who ; when ; note

class ComplianceResult(BaseModel):
    result_id: str; spec_id: str; element_ids: list[str]
    status: Literal["POTENTIAL_NON_COMPLIANCE","COMPLIANT_ON_AVAILABLE_EVIDENCE","INSUFFICIENT_EVIDENCE",
                    "NOT_APPLICABLE","APPLICABILITY_UNKNOWN","NOT_ASSESSABLE_FROM_GA","REQUIRES_EXPERT_REVIEW"]
    measured: dict | None       # {"value": 760, "unit": "mm", "status": "derived", "evidence_ids": [...]}
    required: dict | None       # {"operator": ">=", "value": 813, "unit": "mm", "clause_id": "..."}
    reasoning: list[str]        # deterministic steps
    clause_citations: list[Citation]   # clause_id, page, excerpt (<= ~25 words)
    design_evidence_ids: list[str]
    demo_as_if_applicable: bool
```

**Hard rules enforced in code:**
1. A `CheckSpec` with `validation.status != engineer_validated` can produce at most `REQUIRES_EXPERT_REVIEW` and is
   shown as *"draft rule - not verified"*.
2. A result can never be `COMPLIANT_*` or `POTENTIAL_NON_COMPLIANCE` if a required input has status `derived`
   when the clause asks for a measured quantity. Example: a door **leaf** width derived from a symbol vs. a **clear
   width** requirement gives `INSUFFICIENT_EVIDENCE`.
3. Missing input gives `INSUFFICIENT_EVIDENCE`, never non-compliance.
4. Every result carries **at least one clause citation and one design evidence id**, or it is not emitted.
5. The LLM never writes `status`; its output is validated against the Pydantic schema, and the cited text must exist
   verbatim in the stored clause (string match), or the extraction is discarded.

---

## 4. Module layout (fits the current repo)

```
backend/regulatory/
  ingest/
    loaders.py          PDF (PyMuPDF) / HTML loaders; one per source format
    clause_parser.py    heading-pattern parser -> Clause tree (Regulation/Paragraph numbering per instrument)
    profiles/*.yaml     numbering patterns per instrument (SOLAS "Regulation 13", "3.2.1"; ADA "404.2.3"; COLREG "Rule 21", "Annex I 2(a)")
  index/
    fts.py              SQLite FTS5 (BM25) over clauses
    embeddings.py       Gemini embeddings -> numpy .npy + id map (optional)
    store.py            SQLite tables: documents, clauses, check_specs, validations, results
  retrieve/
    query_builder.py    design element + vessel profile -> query text + metadata filters
    hybrid.py           BM25 + vector + RRF + metadata re-rank
  extract/
    spec_extractor.py   LLM: clause text -> CheckSpec draft (JSON schema, verbatim-quote check)
    manual_specs.yaml   hand-written CheckSpecs for the demo set (always available, no LLM)
  applicability/
    vessel_profile.py   extract VesselProfile from GA title block / principal particulars
    engine.py           evaluate Conditions -> applicable / not / unknown (+ missing facts)
  evaluate/
    evaluators.py       graph_connectivity, independent_routes, numeric_threshold, presence, adjacency_documentation
    runner.py           for each validated spec x matching elements -> ComplianceResult
  api.py                FastAPI router (/api/regulatory/...)
```

Existing modules that get small changes:
* `compliance/regulatory_engine.py` is replaced by `backend/regulatory/` (it keeps reading `sample_requirements.json` as seed data).
* `models/finding_models.py`: `Finding.requirement_refs` → `Finding.compliance_results: list[result_id]`.
* `engineering/`: new **measurements** the specs need (§6).
* Frontend: a **Compliance matrix** tab, clause viewer in the Evidence panel, and a spec validation screen.

---

## 5. Applicability: the first gate

`VesselProfile` from the DANA V title block (already readable as PDF text):
`Special Service/Research Vessel SP38`, `ACCOMMODATION FOR 38 PERSONS`, `LOA 69,80 m`, `BV CLASS`, `ICE CLASS IA`,
`POLAR CLASS 6`. Unknown and **asked from the user**: flag, keel-laying date, gross tonnage, number of special
personnel versus crew.

| Instrument | Applicability logic (to be confirmed against text) | DANA V result |
|---|---|---|
| SOLAS II-2 | Via the SPS Code: provisions depend on persons on board (thresholds in the Code) | `APPLICABILITY_UNKNOWN` until the SPS Code thresholds are imported and verified, then resolved automatically |
| MARPOL Annex I | Some regulations have capacity / GT thresholds | Unknown until oil-fuel capacity and GT are given |
| PVAG / ADA | US passenger vessels / facilities | `NOT_APPLICABLE` (UI toggle *"evaluate as if applicable"* for the demo, with every result stamped **DEMO**) |
| DNV rules | Only DNV-classed ships | `NOT_APPLICABLE` (vessel is BV); demo only |
| COLREG, Load Line, BWM | Generally applicable to seagoing ships | Applicable, but most items are `NOT_ASSESSABLE_FROM_GA` |

---

## 6. Demo requirement set: what we can actually check against the DANA V GA

Target **8 to 10 CheckSpecs**, at least one per instrument, chosen so the demo shows **every result status**. Clause
numbers below are the *target sections to import and verify*. They are **not** to be shown as verified until a person
has checked them against the official text.

| # | Instrument / target section | CheckSpec (atomic) | Evaluator | Design data used | Expected on DANA V |
|---|---|---|---|---|---|
| 1 | SOLAS II-2/13 (means of escape, accommodation) | Each accommodation space has ≥ 1 route to an escape point; stair enclosures give access to the embarkation deck | `graph_connectivity` | existing escape graph | Mostly **COMPLIANT_ON_AVAILABLE_EVIDENCE** (connectivity only) / INSUFFICIENT_EVIDENCE |
| 2 | SOLAS II-2/13 (machinery spaces) | Machinery spaces of category A have ≥ 2 independent means of escape | `graph_independent_routes` | escape graph + hazard class | Generator room: **POTENTIAL_NON_COMPLIANCE** *or* REQUIRES_EXPERT_REVIEW (category A not provable from the GA) |
| 3 | SOLAS II-2/13 (dead-end corridors) | Dead-end corridor length ≤ L (value from the verified text) | `numeric_threshold` | **new measurement:** dead-end length along the corridor skeleton (scale verified) | Forecastle corridor branch: measured value vs limit |
| 4 | SOLAS II-2/9 (containment of fire) | Boundaries between space categories have the required integrity class | `adjacency_documentation` | adjacencies + fire-doc search | **INSUFFICIENT_EVIDENCE** (no fire plan) |
| 5 | MARPOL Annex I (oil fuel tank protection) | Fuel tanks located ≥ d from bottom/side shell, *if* capacity ≥ threshold | `presence` + `numeric_threshold` | MGO/MDO tank polygons vs hull outline (Steel_1) | **APPLICABILITY_UNKNOWN** (capacity not on GA); distances reported as derived |
| 6 | BWM Convention | Ballast tanks present → ballast management arrangement required | `presence` | WB tank labels | Ballast tanks found; treatment system **NOT_ASSESSABLE_FROM_GA** |
| 7 | COLREG Annex I (light positions) | Masthead light height / separation | `not_assessable_from_ga` | profile view only | **NOT_ASSESSABLE_FROM_GA** (lists the drawings needed) |
| 8 | Load Line | Freeboard / closure heights | `not_assessable_from_ga` | – | **NOT_ASSESSABLE_FROM_GA** |
| 9 | ADA 2010 §404 / PVAG (doors) | Door clear opening width ≥ W (value from the verified text) | `numeric_threshold` | door **leaf** width (derived from arc) | **NOT_APPLICABLE**; in demo mode **INSUFFICIENT_EVIDENCE** (leaf ≠ clear width) and, for imported JSON designs with real clear widths, a true numeric comparison |
| 10 | Class rules (DNV, demo) | Example arrangement rule (e.g. escape from a specific space type) | `graph_*` | escape graph | **NOT_APPLICABLE** (BV); demo only |

New measurements needed in `engineering/` (all deterministic, scale cross-checked, provenance `derived_geometry`):
* `corridor.dead_end_length_m`: skeletonise the corridor region (OpenCV thinning) and take the longest skeleton path from a branch tip to the nearest node with ≥ 2 independent routes.
* `tank.min_distance_to_hull_m`: Shapely distance from the tank polygon to the `Steel_1` hull outline on the same deck.
* `door.clear_width_mm`: **only** from imported JSON or a door schedule (never from a GA symbol).

---

## 7. Retrieval: how a design element finds its clauses

For each element / engine finding:

1. **Metadata filter (C):** instrument applicable or demo-on, `target` matches the element (e.g. `space.hazard = machinery_space_combustion_engine`).
2. **Query (A + B):** template + element facts, e.g. *"means of escape from machinery space; generator room; two means of escape; ladders; escape trunk"*.
3. **Fuse:** RRF(BM25, embeddings) → top 8 clauses → follow `cross_refs` one hop (e.g. Reg. 13 → FSS Code ch. 13) → top 5.
4. **Bind:** clauses that already back a **validated CheckSpec** are evaluated. Others are shown as *"related clauses - not yet encoded"* (still useful to the engineer, never a result).

Retrieval is also exposed as **free search** in the UI (*"show me what applies to this room"*). It always returns
clauses, never a verdict.

---

## 8. LLM roles (Gemini, optional, schema-constrained)

| Task | Input | Output | Guardrail |
|---|---|---|---|
| Clause → CheckSpec draft | one clause + its cross-refs | `CheckSpec` JSON | Must quote the numeric value verbatim; unit normalised by Python; status = `draft` |
| Applicability condition draft | clause text | `Condition[]` | Same quote check; engineer validates |
| Query expansion | element facts | extra search terms | Affects ranking only |
| Explanation | ComplianceResult (structured) | 3–4 sentences | May not add facts, numbers or clauses (post-check) |

Without a key, the system runs on `manual_specs.yaml` (hand-written, validated specs) and BM25 only. The demo still
works.

---

## 9. API additions

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/regulatory/documents` | Upload a regulatory PDF/HTML with instrument, edition and licence metadata |
| GET | `/api/regulatory/documents`, `/clauses/{id}` | Browse the corpus / clause tree |
| GET | `/api/regulatory/search?q=&instrument=&design_id=&element_id=` | Hybrid retrieval (clauses only) |
| GET/PUT | `/api/regulatory/specs`, `/specs/{id}/validate` | List, edit and validate CheckSpecs (engineer gate) |
| GET/PUT | `/api/regulatory/vessel-profile?design_id=` | Extracted profile + user-supplied unknowns |
| POST | `/api/regulatory/evaluate` | `{design_id, scenario?, demo_as_if_applicable}` → ComplianceResults |
| GET | `/api/regulatory/matrix?design_id=` | Instrument × status matrix for the dashboard |

---

## 10. Dashboard additions

1. **Compliance matrix tab:** rows = the 8 instruments; columns = the statuses; cells link to the results. Applicability shown first with its reason.
2. **Evidence panel:** a *Regulation* section with the clause excerpt, path (`SOLAS II-2 / Reg 13 / 3.2.1`), page and validation badge, next to the drawing evidence that is already there. *Required vs measured* is shown as a two-column card with units and the provenance of each side.
3. **Vessel profile card:** extracted facts (with evidence links) plus editable unknowns (flag, keel date, GT) that re-run applicability.
4. **Spec validation screen:** the engineer sees the clause text and the draft CheckSpec side by side, then Approve, Edit or Reject. Approvals are logged.
5. **Demo toggle** *"Evaluate PVAG/ADA/DNV as if applicable"*: results stamped **DEMO**, matching the existing SYNTHETIC / MANUAL badges.

---

## 11. Implementation sequence (hackathon-sized, alongside the prototype)

| Step | Work | Est. | Done when |
|---|---|---|---|
| 0 | **Source acquisition:** download the public texts (ADA 2010 Standards, PVAG, COLREG, a DNV rule part); for SOLAS/MARPOL/Load Line/BWM use the IMO summaries Meyer pointed to, or a licensed copy if the team has one. Record licence and completeness per document | 1 h | `RegulatoryDocument` rows with sha256 and licence |
| 1 | Clause parser + SQLite FTS5 index + clause API | 2 h | Searching "means of escape machinery" returns the right regulation in the top 3 |
| 2 | VesselProfile extraction + applicability engine + profile UI card | 1.5 h | DANA V: PVAG/ADA/DNV = not applicable, SOLAS = unknown with the missing facts listed |
| 3 | `manual_specs.yaml` for the 10 demo specs (values copied from the imported text, each with clause id + quote) + validation records | 2 h | 10 specs, each traceable to a stored clause |
| 4 | Evaluators (reusing the existing graph engines) + 2 new measurements (dead-end length, tank–hull distance) | 3 h | ComplianceResults for DANA V and the synthetic ship |
| 5 | Hybrid retrieval (embeddings + RRF) + LLM spec extractor with quote check (optional if a key exists) | 2 h | Draft specs for unseen clauses appear in the validation screen |
| 6 | Dashboard: compliance matrix, clause section in the evidence panel, demo toggle | 2.5 h | Click a result → drawing location + clause excerpt + required vs measured |
| 7 | Evaluation + README section | 1.5 h | Metrics table filled with real numbers |

**If time runs short, cut in this order:** step 5 (LLM extraction), then the embeddings (BM25 only), then the
validation-screen UI (validate in YAML). Steps 0–4 and the matrix are the minimum credible demo.

---

## 12. Evaluation (no fabricated numbers)

| What | How | Metric |
|---|---|---|
| Retrieval | 30 hand-written queries (e.g. "two means of escape machinery space") → gold clause ids | Recall@5, MRR; BM25 vs hybrid |
| Spec extraction (if LLM) | Gold CheckSpecs for 10 clauses | Field accuracy (threshold, unit, operator, target); quote-check pass rate |
| Applicability | 4 synthetic vessel profiles (passenger US vessel, cargo ship, SPS > 60 persons, DANA V) | Correct status per instrument |
| Evaluators | Synthetic ship with **seeded** violations (narrow door with real clear width, long dead end, single-exit machinery room, fuel tank near the hull) | Each seeded case detected; no false NON_COMPLIANCE on missing data |
| Safety property | Property tests: removing any input never produces `POTENTIAL_NON_COMPLIANCE` or `COMPLIANT_*` | 0 violations |

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| SOLAS/MARPOL/Load Line/BWM full texts are not freely available | Use the public summaries Meyer pointed to, marked `completeness: summary_only` (results capped at REQUIRES_EXPERT_REVIEW); support importing a licensed copy later |
| Copyright of IMO / class texts | Store locally, show only short excerpts with a citation, do not commit the texts to the repo |
| LLM invents thresholds or clause numbers | Verbatim quote check, engineer validation gate, LLM never sets a status |
| Wrong applicability → misleading results | Applicability gate first; unknown facts are asked for, not assumed; demo mode stamped DEMO |
| GA lacks the needed data (clear widths, ratings, light heights) | `INSUFFICIENT_EVIDENCE` / `NOT_ASSESSABLE_FROM_GA` that lists the drawings needed; JSON import path for richer data |
| Clause numbering differs between editions | `edition` on every document; `clause_id` includes the edition |

---

## 14. Definition of done for the demo

On DANA V the dashboard shows, for each of the 8 instruments, an applicability verdict with its reason. For at least
SOLAS II-2, MARPOL, BWM and (in demo mode) ADA/PVAG it shows results that:
* open the drawing at the element,
* show the **clause excerpt with document, section and page**,
* show **required vs measured** with the provenance of both sides,
* end in a status that never claims more than the evidence supports.

The synthetic ship shows every seeded violation detected, and the "remove the data" test shows insufficient evidence,
not non-compliance.
