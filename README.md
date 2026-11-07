# Maritime Safety Intelligence

An engineering screening assistant that interprets a ship **General Arrangement (GA) drawing**, builds a spatial model of
it, and runs three evidence-based safety analyses:

1. **Escape-route connectivity**: do occupied spaces, corridors and stairs connect to identified escape points?
2. **Hazardous-space escape accessibility**: can spaces labelled as hazardous reach an escape point, and by how many independent routes?
3. **Fire-risk proximity screening**: which spaces border fire-risk spaces, and is any fire separation documented?

Every finding states what was detected, where, why it may matter, the relationship or measurement behind it, what
information is missing, and which requirement to review. Click a finding and the original PDF opens at that location
with the evidence highlighted.

> This is an engineering screening tool, not a compliance determination. A connected path is not proof of
> compliance, and missing information is not proof of non-compliance. Approval rests with naval architects, the
> classification society and the flag administration.

Built for the Meyer Turku "Automated class & regulatory compliance checking" challenge, Since AI Hackathon 2026.

---

## Quick start

```bash
scripts/fetch_dana_v.sh          # downloads the DANA V GA PDF to data/input/ and checks its sha256
.venv/bin/python scripts/fetch_regulations.py   # downloads the regulatory corpus (IMO resolutions, ADA, PVAG, IMO summaries)
scripts/run.sh                   # creates .venv, installs deps, builds the UI, serves http://localhost:8000
```

Manual equivalent:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
(cd frontend && npm install && npm run build)
.venv/bin/uvicorn backend.main:app --port 8000      # API + dashboard on :8000
# development UI with hot reload: (cd frontend && npm run dev) -> http://localhost:5173 (proxies /api)
.venv/bin/python -m pytest backend/tests -q        # tests
```

Tested with Python 3.14 and Node 26. If the PDF is missing, the dashboard has a **Fetch DANA V GA** button, and any
PDF, PNG/JPG or JSON engineering-data file can be uploaded.

**Gemini is optional.** Copy `.env.example` to `.env` and set `GEMINI_API_KEY` to enable it. Without a key the system
runs in deterministic mode: extraction, graph analysis and every finding status are computed without an LLM in
any case.

---

## How it works

```
PDF ─► pdf_parser (PyMuPDF: text + vector paths + CAD layers)
     ─► deck_layout   (deck plans from frame-number rows, scale cross-check)
     ─► room_extraction + space_builder (OpenCV regions between wall layers, labels -> spaces)
     ─► door_detection (door-swing arcs -> door connections between regions)
     ─► stair linking (UP/DN markers matched across decks), escape points (ESC, open decks)
     ─► adjacency_engine (shared boundaries, steel-layer fraction, deck-above/below overlaps)
     ─► EngineeringModel (Pydantic, JSON; every fact has provenance + evidence record)
     ─► spatial_graph (NetworkX) ─► 3 safety engines ─► findings ─► FastAPI ─► React dashboard
```

### Supported inputs

| Input | How it is read | Example |
|---|---|---|
| Vector PDF with real text + CAD layers | Text objects + layer-filtered geometry (most reliable) | DANA V GA |
| **Vector PDF with text converted to outlines, no layers, multi-sheet** | Per-sheet **OCR** (Tesseract, 450 dpi, plus targeted 900 dpi reads of titles and callouts); view detection from `PLAN x-y / deck / scale` titles; walls chosen by line weight; door swings closed into the wall raster; room labels followed along **leader lines**; scale **calibrated from deck-height callouts** on section views and accepted only if it matches the stated scale at a standard ANSI sheet reduction | OSU RCRV GA (12 sheets) |
| Raster image | Thresholded walls, OCR labels, no doors | scans |
| JSON `EngineeringModel` | Loaded directly | synthetic test ships |
| **URL** | Direct file links, and **Box share links** (`…app.box.com/s/…`), which are resolved to the file; private and local addresses are refused | "Import from URL" button, `POST /api/upload/url` |

Requirements for outlined PDFs: Tesseract (`brew install tesseract`) plus `pytesseract`. If Tesseract is missing and a Gemini key is set, Gemini vision reads the labels instead (provenance `llm_interpretation`; **not tested**, because no key was available). If neither is available, the import fails with an explicit message rather than producing an empty model.

### What the DANA V drawing gives us

The DANA V GA (`23007.01.101.0110.01`, rev 2.14) is an **AutoCAD vector export**. It has 1,420 text objects, about
305k vector paths and 90 CAD layers that survive as PDF optional-content groups (`Lining`, `Steel_*`, `Door_WT`,
`Stairs-railing`, `Furniture`, …). So the extraction is deterministic and needs no OCR:

| Step | Method | Provenance |
|---|---|---|
| Deck plans | Rows of frame-number labels (…45, 50, 55…) fitted linearly; nearest deck title; elevation label (`11300 ABL`) | `pdf_text` |
| Scale | Title block `1:150` (52.92 mm/pt), **cross-checked** against the frame spacing in the principal particulars (0.60 m) and the measured frame-label spacing: 0.00 % deviation. If the two disagreed, no metric values would be produced. | `pdf_text` + `derived_geometry` |
| Spaces | Rasterise only boundary layers (linings, steel, doors, windows); OpenCV connected components; cavities inside double walls removed by clear-width tests | `derived_geometry` |
| Labels / names | Text objects inside each region; area labels (`15 m2`) parsed | `pdf_text` |
| Doors | Quarter-circle swing arcs (circle fit to the flattened polylines); region sampled on both sides of the opening | `pdf_vector_geometry` |
| Door leaf width | Arc radius × scale. **Derived; it is the leaf, not the clear opening**, and is never used for compliance | `derived_geometry` |
| Corridors | Unlabelled, elongated regions (clear width < 2.6 m) with ≥ 2 doors | `derived_geometry` |
| Stairs | Regions holding `UP`/`DN` markers; vertical links by matching `UP` on one deck to `DN` on the next at the same frame/offset (≤ 4.5 m) | `derived_geometry`, *inferred* |
| Escape points | `ESC` markings; open decks identified by labels (`RAILING`, `OUTDOOR AREA`, `MOORING DECK`, …) | `pdf_text` |
| Hazard classes | Controlled vocabulary on labels only (e.g. `BATTERY ROOM` → `electrical_battery_hazard`); labs are **not** assumed hazardous | `pdf_text` |
| Adjacency | Boundary pixels of two regions within 0.30 m across a drawn line; % of that boundary drawn on `Steel_*` layers; footprint overlap with the deck above/below | `derived_geometry` |
| Fire documentation | Text search for A-/B-/C-/H-class divisions, insulation, self-closing doors. **None found** in this GA | `pdf_text` |

**Manual annotations.** Two bow open decks are drawn but carry no text label. They are recorded in
`backend/data/manual_annotations/dana_v_r2_14.json` (tied to the PDF's sha256), drawn dashed in the viewer, and any
finding that depends on them is badged **MANUAL ANNOTATION**. Pathfinding prefers extracted links: inferred links
cost 2.5× and manual links 6×.

### Self-check against the drawing

For the 65 rooms that have an area printed on the drawing, the extracted polygon area differs from the printed area
by a **median of 7.0 %**, and 58 of the 65 are within 25 %. This checks the geometry against the drawing itself. It is
**not** an accuracy benchmark for the safety findings, and no such benchmark exists here.

### Safety engines (deterministic)

| Engine | Logic | Statuses |
|---|---|---|
| Escape | Weighted shortest path to an escape point; node connectivity (Menger) for independent routes; dead-end corridors = single route, naming the choke point | `CONNECTIVITY_VERIFIED`: path exists. `POTENTIAL_CONNECTIVITY_ISSUE`: doors exist but the group reaches no exit and contains no stair, or a corridor has only one escape direction. `INCONCLUSIVE`: no door detected, the group reaches a stair whose onward connection was not identified, or no escape points at all |
| Hazard | Same graph, for spaces with a hazard class (tanks excluded); combustion-engine machinery spaces also screened for two independent routes | as above |
| Fire | Shared boundaries + vertical overlaps of fire-risk spaces, prioritising escape routes / occupied / other hazardous neighbours; checks for any fire-integrity data | always `INCONCLUSIVE` with *"Fire separation cannot be verified from the submitted General Arrangement drawing. Detailed fire-control plans and construction specifications are required."* |

The LLM never sets a status.

### Results on DANA V (actual run)

| Engine | Analysed | Verified | Potential issue | Inconclusive |
|---|---|---|---|---|
| Escape-route connectivity | 79 (76 occupied spaces, 3 corridors) | 47 | 3 | 29 |
| Hazardous-space accessibility | 16 | 3 | 2 | 11 |
| Fire-risk proximity | 28 | 0 | 0 | 28 |

Most inconclusive results come from rooms whose access is a watertight/sliding door or hatch with no swing symbol, or
from groups that reach a stair whose onward connection was not matched. Those are the honest outcomes for a GA-only
input. The *potential issues* (e.g. Library/Lobby on the Main deck, the Converter room, a single-route Generator room)
are review prompts, not defects. Each one shows exactly which doors and groups led to it.

### Demonstration scenarios (clearly labelled SYNTHETIC)

* **Blocked accommodation exits.** Removes the extracted doors between the Shelter-deck corridor and the fore deck and stairwell. Result: 24 potential issues, with the cut-off cabins highlighted.
* **Escape information withheld.** Removes all escape points. Result: every connectivity check becomes `INCONCLUSIVE` (0 verified, 0 issues), showing that missing information never turns into a compliance or non-compliance claim.
* **Synthetic test ship** (`backend/data/synthetic/`). A generated design with a known expected outcome for each element (connected / disconnected room, dead-end corridor, missing door, missing escape points, adjacent / non-adjacent hazards, missing boundaries).

### Hybrid regulatory RAG (`backend/regulatory/`, plan: `docs/HYBRID_RAG_PLAN.md`)

Checks the design against the instruments in Meyer Turku's appendix. Every result cites **a stored clause (document,
section, page, verbatim quote)** and **drawing evidence**.

| Instrument | Corpus (official / public sources) | Completeness |
|---|---|---|
| SOLAS II-2 | IMO res. **MSC.99(73)**: full revised Chapter II-2 (2000; later amendments not included) | full text, historic |
| SPS Code | IMO res. **MSC.266(84)**: 2008 SPS Code | full text |
| MARPOL Annex I | IMO res. **MEPC.141(54)**: reg. 12A oil fuel tank protection | partial |
| ADA | 2010 ADA Standards (US DOJ) | full text |
| PVAG | US Access Board, Chapter V4 (**proposed, not finalized**) + status page | full text (proposed) |
| COLREG, Load Line, BWM, SOLAS (general) | IMO summary pages | summary only |
| DNV / BV class rules | not available | no text: no checks |

Pipeline:
1. **Clause parser** (per-instrument numbering) loads the texts into SQLite + **FTS5/BM25**. Gemini embeddings can be fused with **RRF** when a key is set; they were not built in this run.
2. **Vessel profile** comes from the title block (ship type, 38 persons, BV, LOA, breadth), with user-entered unknowns (GT, fuel capacity, delivery date…).
3. The **applicability engine** cites clauses. For DANA V: SPS Code 6.3 (≤ 60 persons) gives **SOLAS II-2 cargo-ship provisions** (assumptions stated); passenger-ship provisions, PVAG, ADA and DNV are *not applicable*; MARPOL 12A is *unknown* (fuel capacity not on the GA).
4. **12 CheckSpecs** (`backend/data/check_specs.json`). Each quote is **verified verbatim** against the stored clause at load time.
5. **Deterministic evaluators** reuse the escape graph plus new measurements: dead-end length and travel-to-door distance (geodesic), and fuel-tank to side-shell distance.
6. **Validation gate:** a rule encoding that no engineer has validated can never produce a final *compliant* or *non-compliant* status. Those results show *indicative → REQUIRES_EXPERT_REVIEW* (validate via the UI or `PUT /api/regulatory/specs/{id}/validate`).

Result statuses: `POTENTIAL_NON_COMPLIANCE`, `COMPLIANT_ON_AVAILABLE_EVIDENCE`, `INSUFFICIENT_EVIDENCE`, `NOT_APPLICABLE`,
`APPLICABILITY_UNKNOWN`, `NOT_ASSESSABLE_FROM_GA`, `REQUIRES_EXPERT_REVIEW`. PVAG/ADA/DNV can be run **as if
applicable** with a DEMO toggle; those results are stamped DEMO.

Dashboard: **Regulatory compliance** tab (matrix, vessel profile, applicability reasoning, clause search). Clicking a
result zooms the drawing and shows required vs measured, the reasoning, the cited clause and the caveats. Engine
findings also list the related check results and retrieved clauses.

### Regulatory knowledge (`backend/data/sample_requirements.json`)

Three classes are kept apart: **verified** requirements (none yet, because no official text was supplied),
**unverified references** (SOLAS II-2 Reg. 13 *Means of escape*, Reg. 9 *Containment of fire*, BV class rules) with
`clause: null` rather than a guessed paragraph, and **synthetic demonstration rules** that encode the screening logic.
Applicability notes record that DANA V is a BV *Special Service/Research Vessel SP38* with 38 persons, so SOLAS
applicability goes through the IMO SPS Code and must be confirmed by an engineer. Regulatory PDFs can be imported:
sentences containing *shall / is to be / must* are stored with their page as **unverified** candidates.

### Gemini (optional, `backend/extraction/drawing_interpreter.py`)

When `GEMINI_API_KEY` is set, Gemini:
* suggests controlled-vocabulary classes for labels the rules did not match (stored as notes and evidence with provenance `llm_interpretation`, **not applied**);
* writes a plain-language explanation of a finding on request (the *Explain with Gemini* button), constrained to the structured facts;
* summarises imported regulatory sentences (the original text is kept).

**Not tested in this build:** no API key was available during development.

---

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/upload/design` | Upload PDF / PNG / JPG / JSON (`EngineeringModel`) |
| POST | `/api/upload/fetch-dana-v` | Download the public DANA V GA |
| GET | `/api/designs`, `/api/designs/{id}` | Status, page count, extraction progress |
| POST | `/api/analyze` | `{design_id, scenario?}` |
| GET | `/api/analysis/summary` | Engine summaries, limitations, extraction log |
| GET | `/api/design/elements` | Spaces, doors, escape points, connections, adjacencies |
| GET | `/api/design/graph` | Node-link escape graph |
| GET | `/api/findings`, `/api/findings/{id}` | Findings; detail with resolved evidence and requirements (`explain=true` → Gemini) |
| GET | `/api/design/pages/{n}?zoom=&clip=` | Rendered page / zoomed crop of the original drawing |
| GET/POST | `/api/requirements`, `/api/requirements/import` | Regulatory knowledge base |

Outputs are also written to `data/output/<design_id>/` (`engineering_model.json`, `findings*.json`).

## Repository layout

```
backend/
  main.py                 FastAPI app (also serves frontend/dist)
  api/                    upload, analysis/findings/pages, requirements
  extraction/             pdf_parser, ocr_engine (Tesseract, optional), drawing_interpreter (Gemini, optional)
  engineering/            deck_layout, room_extraction, door_detection, space_builder, hazard_classifier,
                          adjacency_engine, spatial_graph
  compliance/             escape_route_checker, hazardous_space_checker, fire_proximity_checker, regulatory_engine
  models/                 engineering_models, finding_models, requirement_models (Pydantic)
  services/               extraction_pipeline, analysis_service, scenarios, store
  data/                   sample_requirements.json, manual_annotations/, synthetic/ (+ generate.py)
  tests/                  69 tests (synthetic expectations, DANA V consistency checks, API)
frontend/                 React + TypeScript + Vite + Tailwind dashboard
scripts/                  fetch_dana_v.sh, run.sh
```

## Tests

`.venv/bin/python -m pytest backend/tests -q` gives **69 passed** (latest run). Regulatory tests: verbatim quotes, applicability branches, validation gate, seeded synthetic violations (9.5 m dead end, 760 mm door, single-route generator room), a no-data safety property, and BM25 recall@5 = 5/6 on gold queries. The suite also covers:
* graph construction, pathfinding and independent routes;
* the expected status of every synthetic element, including dead ends, missing doors, missing escape points and stairs without a continuation;
* the hazard vocabulary, and that labs and cabins are not assumed hazardous;
* adjacency identification, vertical adjacency and missing boundary information;
* that fire findings are always inconclusive;
* on DANA V: scale cross-check, the labelled-area consistency check above, traceable derived door widths, no fabricated fire ratings, evidence references that resolve, manual annotations that are labelled, known layout facts, and no compliance wording in any finding;
* the API: upload → analyse → finding evidence, and that no requirement has an invented clause.

## Limitations

* GA only: there is no fire-control plan, door schedule or escape-route plan, so fire separation is never verified and route widths and distances are not assessed.
* Doors without swing arcs (sliding, watertight, hatches) are not detected. The affected rooms are reported as INCONCLUSIVE.
* Partitions not drawn on boundary layers merge spaces. This is flagged when one region holds several labels (e.g. the CTD hangar merged with the aft working deck).
* The Bridge deck plan has too few frame labels to be located and is not modelled.
* `ESC` is read as an escape marking; the sheet has no legend confirming this.
* Raster images: walls by thresholding, labels only if Tesseract is installed (it was not in this environment), no door detection. Results are mostly empty or INCONCLUSIVE by design.
* Regulatory corpus: SOLAS II-2 is the 2000 text (later amendments missing); COLREG/Load Line/BWM are summaries only; no class rules. Rule encodings are not engineer-validated.
* Outlined-text PDFs (e.g. OSU RCRV): labels are OCR results and can be wrong. Partitions are often not closed and there are no layers, so several rooms can merge into one region. Each label is then kept as a **label-anchored space** marked "GEOMETRY NOT RESOLVED" (a point at the leader end, not an outline). Sheets are not aligned to a common frame system, so stairs are not linked between decks and escape checks are mostly INCONCLUSIVE.
* No 3D view: no 3D model of DANA V was used, and none is fabricated.

## Data notice

The DANA V GA carries a confidentiality notice from Dansk DANA Konsortium, although it is publicly hosted by DTU and
listed in the challenge brief. It is therefore **not committed**: `data/input/*.pdf` is git-ignored and
`scripts/fetch_dana_v.sh` downloads it and checks its sha256.
