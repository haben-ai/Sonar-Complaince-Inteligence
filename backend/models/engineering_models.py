"""Canonical engineering data model.

Everything the safety engines consume is expressed in these models. Extraction
(PDF, image or JSON upload) produces an `EngineeringModel`; the engines never look
at the PDF directly. That keeps the engines testable with synthetic designs.

Coordinates are in *page units*: PDF points (1/72 inch) for PDF input, pixels for
image input. `Deck.scale` converts page units to metres when a scale is known.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


SCHEMA_VERSION = "1.1"


class Provenance(str, Enum):
    """Where a fact came from. Shown to the user for every element."""

    PDF_TEXT = "pdf_text"                      # text object read from the PDF
    PDF_VECTOR = "pdf_vector_geometry"         # vector path read from the PDF (with CAD layer)
    DERIVED_GEOMETRY = "derived_geometry"      # computed by deterministic geometry from the above
    OCR = "ocr"
    LLM_INTERPRETATION = "llm_interpretation"  # suggestion by a language model; never final
    MANUAL_ANNOTATION = "manual_annotation"    # entered/validated by a person
    SYNTHETIC = "synthetic"                    # synthetic test data, not a real design


class DataOrigin(str, Enum):
    ACTUAL_PDF = "actual_pdf"
    MANUAL_ANNOTATION = "manual_annotation"
    SYNTHETIC = "synthetic"


class BBox(BaseModel):
    page: int = 0
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


class Evidence(BaseModel):
    id: str
    page: int = 0
    bbox: Optional[BBox] = None
    source: Provenance
    method: str = Field(description="How the evidence was produced, e.g. 'door swing arc on CAD layer Lining'")
    text: Optional[str] = Field(None, description="Original text from the drawing, if any")
    detail: dict = Field(default_factory=dict)


class ScaleInfo(BaseModel):
    """Page-unit to metre conversion. Only present when it is defensible."""

    metres_per_unit: float
    basis: str = Field(description="How the scale was established")
    cross_check: Optional[str] = None


class Deck(BaseModel):
    id: str
    name: str
    page: int = 0
    bbox: BBox
    elevation_mm: Optional[float] = Field(None, description="Deck height above baseline, if labelled")
    elevation_label: Optional[str] = None
    centerline_y: Optional[float] = None
    frame0_x: Optional[float] = Field(None, description="Page x of frame 0 (for aligning decks)")
    units_per_frame: Optional[float] = None
    scale: Optional[ScaleInfo] = None
    evidence_ids: list[str] = Field(default_factory=list)


class SpaceKind(str, Enum):
    ACCOMMODATION = "accommodation"      # cabins
    PUBLIC = "public_space"              # mess, day room, library, fitness...
    WORK = "work_space"                  # labs, workshops, offices, hangars
    CONTROL = "control_station"          # bridge, engine control room
    SERVICE = "service_space"            # galley, laundry, stores
    MACHINERY = "machinery_space"
    SANITARY = "sanitary"
    CORRIDOR = "corridor"
    STAIR = "stair"
    OPEN_DECK = "open_deck"
    TECHNICAL = "technical"              # casings, vent trunks, cable/pipe ducts
    TANK_VOID = "tank_or_void"
    UNKNOWN = "unknown"


OCCUPIED_KINDS = {SpaceKind.ACCOMMODATION, SpaceKind.PUBLIC, SpaceKind.WORK, SpaceKind.CONTROL, SpaceKind.SERVICE}


class HazardClassification(BaseModel):
    category: str = Field(description="Controlled vocabulary term, see hazard_classifier.HAZARD_VOCABULARY")
    description: str
    fire_risk: bool
    classification_source: Provenance
    matched_rule: Optional[str] = Field(None, description="Deterministic rule that matched the label")
    confidence: Optional[float] = Field(None, description="Only set for LLM suggestions; never invented for rules")


class Space(BaseModel):
    id: str
    deck_id: str
    name: Optional[str] = None
    labels: list[str] = Field(default_factory=list, description="Raw label lines found inside the space")
    kind: SpaceKind = SpaceKind.UNKNOWN
    kind_basis: str = ""
    labelled_area_m2: Optional[float] = Field(None, description="Area written on the drawing")
    computed_area_m2: Optional[float] = Field(None, description="Area of the extracted polygon (needs scale)")
    polygon: list[tuple[float, float]] = Field(default_factory=list)
    bbox: Optional[BBox] = None
    hazard: Optional[HazardClassification] = None
    provenance: Provenance = Provenance.DERIVED_GEOMETRY
    evidence_ids: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    measurements: dict = Field(default_factory=dict, description="Derived measurements used by regulatory checks")


class Door(BaseModel):
    id: str
    deck_id: str
    bbox: BBox
    hinge: Optional[tuple[float, float]] = None
    leaf_width_mm: Optional[float] = Field(
        None, description="DERIVED from swing-arc radius and drawing scale. This is the leaf, not the clear opening."
    )
    clear_width_mm: Optional[float] = Field(
        None, description="Clear opening width. Only from a door schedule / imported data - never derived from a GA symbol."
    )
    clear_width_source: Optional[str] = None
    watertight: bool = False
    cad_layer: Optional[str] = None
    space_ids: list[str] = Field(default_factory=list, description="Spaces on either side, if resolved")
    resolution: str = Field("unresolved", description="resolved | one_side_only | unresolved")
    provenance: Provenance = Provenance.PDF_VECTOR
    evidence_ids: list[str] = Field(default_factory=list)


class EscapePointKind(str, Enum):
    ESCAPE_MARKER = "escape_marker"          # explicit 'ESC' marking on the drawing
    OPEN_DECK = "open_deck_access"           # access to an external open deck
    MANUAL = "manually_annotated_exit"


class EscapePoint(BaseModel):
    id: str
    deck_id: str
    kind: EscapePointKind
    space_id: Optional[str] = None
    bbox: Optional[BBox] = None
    label: Optional[str] = None
    provenance: Provenance
    evidence_ids: list[str] = Field(default_factory=list)
    notes: str = ""


class ConnectionType(str, Enum):
    DOOR = "door"
    OPENING = "opening"
    VERTICAL_STAIR = "vertical_stair"
    ESCAPE_ACCESS = "escape_access"


class Connection(BaseModel):
    id: str
    source: str
    target: str
    type: ConnectionType
    door_id: Optional[str] = None
    provenance: Provenance
    certainty: str = Field("extracted", description="extracted | inferred | manual | synthetic")
    evidence_ids: list[str] = Field(default_factory=list)
    note: str = ""


class AdjacencyRelation(str, Enum):
    SHARED_BOUNDARY = "shared_boundary"
    VERTICAL_OVERLAP = "vertical_overlap"   # footprint overlaps space on deck directly above/below


class Adjacency(BaseModel):
    id: str
    space_a: str
    space_b: str
    relation: AdjacencyRelation
    shared_length_m: Optional[float] = None
    overlap_area_m2: Optional[float] = None
    boundary_on_steel_layer_fraction: Optional[float] = Field(
        None, description="Fraction of the shared boundary drawn on a Steel_* CAD layer (structural bulkhead line)"
    )
    provenance: Provenance = Provenance.DERIVED_GEOMETRY
    certainty: str = "extracted"
    evidence_ids: list[str] = Field(default_factory=list)
    fire_integrity: Optional[str] = Field(
        None, description="Documented division class (e.g. 'A-60', 'B-15', 'C'). Only from a fire-control / structural fire "
                          "protection plan supplied with the design - never derived from a GA line type.")
    fire_integrity_source: Optional[str] = None


class FireSafetyDocumentation(BaseModel):
    """What fire-integrity information the submitted documents contain."""

    searched_patterns: list[str] = Field(default_factory=list)
    matches: list[dict] = Field(default_factory=list)
    fire_control_plan_available: bool = False
    note: str = ""


class DesignDocument(BaseModel):
    design_id: str
    name: str
    source_type: str = Field(description="pdf | image | json")
    filename: Optional[str] = None
    sha256: Optional[str] = None
    page_count: int = 1
    page_sizes: list[tuple[float, float]] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)
    data_origin: DataOrigin = DataOrigin.ACTUAL_PDF


class EngineeringModel(BaseModel):
    schema_version: str = SCHEMA_VERSION
    document: DesignDocument
    decks: list[Deck] = Field(default_factory=list)
    spaces: list[Space] = Field(default_factory=list)
    doors: list[Door] = Field(default_factory=list)
    escape_points: list[EscapePoint] = Field(default_factory=list)
    connections: list[Connection] = Field(default_factory=list)
    adjacencies: list[Adjacency] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    fire_documentation: FireSafetyDocumentation = Field(default_factory=FireSafetyDocumentation)
    extraction_log: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    scenario: Optional[str] = Field(None, description="Set when a synthetic modification was applied")
    scenario_description: Optional[str] = None
    scenario_affected_ids: list[str] = Field(default_factory=list)

    # convenience lookups -------------------------------------------------
    def space(self, sid: str) -> Optional[Space]:
        return next((s for s in self.spaces if s.id == sid), None)

    def evidence_by_id(self) -> dict[str, Evidence]:
        return {e.id: e for e in self.evidence}
