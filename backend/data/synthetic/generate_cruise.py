"""SYNTHETIC 9-deck expedition cruise ship with planted fire, escape and hazardous-space deficiencies.

    .venv/bin/python -m backend.data.synthetic.generate_cruise

Writes backend/data/synthetic/synthetic_cruise_aurora.json, which the store registers at start-up (it appears in
the design selector). Everything is provenance=synthetic and data_origin=synthetic: it is a test design, not a
real ship. The layout borrows the zoning of a small polar research/expedition vessel (machinery and crew low and
aft, public rooms on the embarkation deck, bridge forward on top) scaled to a 140 m, 9-deck cruise ship.

Unlike a GA-only design, this input also carries a SYNTHETIC structural fire protection plan: the documented
division class of each boundary of a fire-risk space (Adjacency.fire_integrity). The deficiencies are not
hard-coded findings. They follow from the geometry, the doors and the documented classes, and the normal
engines and regulatory checks find them. `PLANTED` lists what they are expected to find.

Coordinates: ship x = metres*10 from the transom (aft = 0), ship y = metres*10 from the centreline (port +).
Page: decks drawn one above the other like a GA sheet (deck 9 at the top), 1 unit = 0.1 m.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from shapely.geometry import Polygon

from backend.compliance import fire_integrity as fi
from backend.engineering.hazard_classifier import classify_label
from backend.models.engineering_models import (
    Adjacency, AdjacencyRelation, BBox, Connection, ConnectionType, DataOrigin, Deck, DesignDocument, Door,
    EngineeringModel, EscapePoint, EscapePointKind, Evidence, FireSafetyDocumentation, Provenance, ScaleInfo, Space,
    SpaceKind,
)

HERE = Path(__file__).parent
DESIGN_ID = "synthetic_cruise_aurora"
SYN = Provenance.SYNTHETIC
MPU = 0.1                      # metres per unit
X0 = 60                        # page x of the transom
LOA = 1400                     # 140 m
HALF_B = 112                   # 11.2 m half-breadth
SLOT = 255                     # page height per deck plan
PAGE = (X0 * 2 + LOA, 80 + 9 * SLOT + 30)


def hull(x: float) -> float:
    """Half-breadth of the main hull at ship x (rounded transom, parallel body, fine bow)."""
    if x < 0 or x > LOA:
        return 0.0
    if x < 70:
        return HALF_B * (0.80 + 0.20 * math.sqrt(x / 70))
    if x <= 860:
        return HALF_B
    t = (x - 860) / (LOA - 860)
    return HALF_B * max(0.0, 1 - t ** 2.1) ** 0.6


@dataclass
class DeckCfg:
    n: int
    name: str
    elev_mm: int
    xa: float
    xb: float
    f: float                     # breadth factor (bilge / superstructure set-in)

    def out(self, x: float) -> float:
        return max(14.0, hull(min(max(x, self.xa), self.xb)) * self.f)

    @property
    def cy(self) -> float:
        return 80 + (9 - self.n) * SLOT + HALF_B + 6


DECKS = [
    DeckCfg(1, "DECK 1 - TANK TOP", 1500, 150, 1280, 0.80),
    DeckCfg(2, "DECK 2 - CREW", 4300, 50, 1340, 0.94),
    DeckCfg(3, "DECK 3 - RESTAURANT", 7100, 0, 1380, 1.00),
    DeckCfg(4, "DECK 4 - PROMENADE / EMBARKATION", 9900, 0, 1390, 1.00),
    DeckCfg(5, "DECK 5 - PASSENGER CABINS", 12700, 70, 1260, 0.98),
    DeckCfg(6, "DECK 6 - SUITES", 15500, 100, 1230, 0.97),
    DeckCfg(7, "DECK 7 - SPA & OBSERVATION", 18300, 150, 1170, 0.94),
    DeckCfg(8, "DECK 8 - SUN DECK", 21100, 200, 1110, 0.90),
    DeckCfg(9, "DECK 9 - BRIDGE", 23900, 840, 1090, 0.86),
]
D = {d.n: d for d in DECKS}

# vertical stair towers: (name, x0, x1, side, decks)
TOWERS = [("AFT", 340, 385, -1, range(1, 8)), ("MID", 640, 685, +1, range(2, 9)), ("FWD", 960, 1005, +1, range(1, 10))]
COR = 12                       # corridor half-width (2.4 m corridor)


# ------------------------------------------------------------------ geometry helpers (ship coordinates)
def _xs(x0, x1, n=7):
    return [x0 + (x1 - x0) * i / (n - 1) for i in range(n)]


def side(d: DeckCfg, x0, x1, side_, y_in=COR, outer: Optional[Callable[[float], float]] = None):
    """Room between y_in and the deck edge (or `outer(x)`) on port (+1) / starboard (-1)."""
    o = outer or d.out
    inner = [(x0, side_ * y_in), (x1, side_ * y_in)]
    edge = [(x, side_ * max(o(x), y_in + 6)) for x in reversed(_xs(x0, x1))]
    return inner + edge


def across(d: DeckCfg, x0, x1, outer: Optional[Callable[[float], float]] = None):
    """Full-width space between both deck edges."""
    o = outer or d.out
    return [(x, o(x)) for x in _xs(x0, x1)] + [(x, -o(x)) for x in reversed(_xs(x0, x1))]


def centre(x0, x1, half=COR):
    return [(x0, -half), (x1, -half), (x1, half), (x0, half)]


def band(d: DeckCfg, x0, x1, side_, inset):
    """Strip along the deck edge, `inset` units wide (promenades, bridge wings)."""
    return [(x, side_ * (d.out(x) - inset)) for x in _xs(x0, x1)] + [(x, side_ * d.out(x)) for x in reversed(_xs(x0, x1))]


# ------------------------------------------------------------------ design definition
@dataclass
class Room:
    id: str
    deck: int
    label: str
    poly: list
    kind: Optional[SpaceKind] = None        # only for labels outside the controlled vocabulary
    doors: list[str] = field(default_factory=list)   # ids of spaces this room has a door to


ROOMS: list[Room] = []


def R(deck, rid, label, poly, *doors, kind=None):
    ROOMS.append(Room(f"D{deck}_{rid}", deck, label, poly, kind, [f"D{deck}_{x}" if not x.startswith("D") or "_" not in x else x for x in doors]))


def towers(deck):
    d = D[deck]
    for name, x0, x1, s, decks in TOWERS:
        if deck in decks:
            R(deck, f"STAIR_{name}", f"{name} STAIRWAY", side(d, x0, x1, s))


def cabins(deck, x0, x1, n, s, prefix, corridor, label="CABIN {}"):
    step = (x1 - x0) / n
    for i in range(n):
        num = f"{deck}{'P' if s > 0 else 'S'}{prefix + i:02d}"
        R(deck, f"CAB_{num}", label.format(num), side(D[deck], x0 + i * step, x0 + (i + 1) * step, s), corridor)


PUB = SpaceKind.PUBLIC


def build_layout():
    ROOMS.clear()
    # ---------------- deck 1: machinery
    d = D[1]
    towers(1)
    R(1, "STEERING", "STEERING GEAR ROOM", across(d, 150, 250), "PASSAGE")
    R(1, "PASSAGE", "DECK 1 PASSAGEWAY", centre(250, 1100), "STAIR_AFT", "STAIR_FWD")
    R(1, "AUXGEN", "AUX. GENERATOR ROOM", side(d, 250, 340, -1), "PASSAGE")             # H2: single route (via passageway)
    R(1, "LOTANK", "LO TANK", side(d, 385, 430, -1, y_in=COR))
    R(1, "ECR", "ENGINE CONTROL ROOM", side(d, 430, 500, -1), "ENGINE")                  # H: control room reached only through the engine room
    R(1, "ENGINE", "ENGINE ROOM", side(d, 500, 770, -1), "ER_TRUNK")                    # H1: only exit is the escape trunk
    R(1, "ER_TRUNK", "ESCAPE TRUNK STAIRWAY", side(d, 770, 810, -1))
    R(1, "FOT_S", "MGO TANK 1 (S)", side(d, 810, 1000, -1))
    R(1, "FWT", "FRESH WATER TANK", side(d, 1000, 1100, -1))
    R(1, "PUMP", "BALLAST PUMP ROOM", side(d, 250, 385, +1), "PASSAGE", kind=SpaceKind.MACHINERY)
    R(1, "ESTORE", "ENGINE STORE", side(d, 385, 470, +1), "PASSAGE")
    R(1, "EWS", "ENGINE WORKSHOP", side(d, 470, 560, +1), "PASSAGE")
    R(1, "SEP", "SEPARATOR ROOM", side(d, 560, 660, +1), "PASSAGE", kind=SpaceKind.MACHINERY)
    R(1, "SWBD", "MAIN SWITCHBOARD ROOM", side(d, 660, 760, +1), "PASSAGE")
    R(1, "FOT_P", "MGO TANK 2 (P)", side(d, 760, 960, +1))
    R(1, "BOWTHR", "BOW THRUSTER ROOM", across(d, 1100, 1270), "PASSAGE")
    R(1, "WBT", "WB TANK", side(d, 1005, 1100, +1))

    # ---------------- deck 2: crew
    d = D[2]
    towers(2)
    R(2, "CREWCOR", "CREW CORRIDOR AFT", centre(120, 385), "STAIR_AFT")                 # E: dead end, single route
    cabins(2, 120, 385, 4, +1, 1, "CREWCOR", "CREW CABIN {}")
    cabins(2, 120, 340, 4, -1, 5, "CREWCOR", "CREW CABIN {}")
    R(2, "AFTST", "AFT STORE", across(d, 50, 120), "CREWCOR")
    R(2, "LINEN", "LINEN STORE", centre(385, 430), "COR")
    R(2, "COR", "DECK 2 MAIN CORRIDOR", centre(430, 1180), "STAIR_MID", "STAIR_FWD")
    cabins(2, 430, 770, 4, -1, 11, "COR", "CREW CABIN {}")                                # above the engine room (F1)
    cabins(2, 770, 1180, 5, -1, 15, "COR", "CREW CABIN {}")
    R(2, "MESS", "MESS ROOM", side(d, 385, 520, +1), "COR")
    R(2, "LAUNDRY", "LAUNDRY", side(d, 520, 600, +1), "COR")
    R(2, "BATT", "BATTERY ROOM", side(d, 600, 640, +1), "COR")
    R(2, "DAYRM", "DAY ROOM", side(d, 685, 780, +1), "COR")
    R(2, "WASTE", "WASTE ROOM", side(d, 780, 870, +1), "COR")
    R(2, "GAS", "OXY/ACET. GAS BOTTLE STORE", side(d, 870, 920, +1), "SPARES")          # H4: opens only into a store
    R(2, "SPARES", "SPARE PARTS STORE", side(d, 920, 960, +1))
    cabins(2, 1005, 1180, 2, +1, 21, "COR", "CREW CABIN {}")
    R(2, "PROV", "PROVISIONS STORE", across(d, 1180, 1340), "COR")

    # ---------------- deck 3: restaurant
    d = D[3]
    towers(3)
    R(3, "MARINA", "MARINA OPEN DECK", across(d, 0, 200))
    R(3, "REST", "MAIN RESTAURANT", across(d, 200, 340), "MARINA", "COR", "GALLEY", kind=PUB)
    R(3, "COR", "DECK 3 MAIN CORRIDOR", centre(340, 1180), "STAIR_AFT", "STAIR_MID", "STAIR_FWD")
    R(3, "GALLEY", "MAIN GALLEY", side(d, 340, 470, +1), "COR")
    R(3, "DRYPROV", "DRY PROVISIONS STORE", side(d, 470, 560, +1), "COR")
    R(3, "COLD", "COLD STORE", side(d, 560, 640, +1), "COR")
    cabins(3, 685, 960, 3, +1, 1, "COR")
    cabins(3, 1005, 1120, 2, +1, 4, "COR")
    R(3, "PAINT", "PAINT LOCKER", side(d, 1120, 1180, +1), "ROPE")                       # H3: opens only into the rope store
    R(3, "ROPE", "ROPE STORE", across(d, 1180, 1370))
    R(3, "SCUL", "SCULLERY", side(d, 385, 470, -1), "COR")
    R(3, "BARST", "BAR STORE", side(d, 470, 560, -1), "COR")
    R(3, "SHOP", "BOUTIQUE", side(d, 560, 685, -1), "COR", kind=PUB)
    cabins(3, 685, 1180, 6, -1, 10, "COR")

    # ---------------- deck 4: promenade / embarkation
    d = D[4]
    prom = lambda x: d.out(x) - 24  # noqa: E731
    for name, x0, x1, s, decks in TOWERS:
        R(4, f"STAIR_{name}", f"{name} STAIRWAY", side(d, x0, x1, s, outer=prom))
    R(4, "AFTDECK", "AFT OPEN DECK", across(d, 0, 150))
    R(4, "PROM_P", "PROMENADE OPEN DECK (P)", band(d, 150, 1150, +1, 24))
    R(4, "PROM_S", "PROMENADE OPEN DECK (S)", band(d, 150, 1150, -1, 24))
    R(4, "BOW", "BOW OPEN DECK", across(d, 1150, 1385))
    R(4, "THEATRE", "THEATRE", across(d, 150, 340, outer=prom), "AFTDECK", "COR", kind=PUB)
    R(4, "COR", "DECK 4 MAIN PASSAGEWAY", centre(340, 1150), "STAIR_AFT", "STAIR_MID", "STAIR_FWD", "BOW")
    R(4, "LOBBY", "RECEPTION LOBBY", side(d, 385, 640, +1, outer=prom), "COR", "PROM_P")
    R(4, "LIBRARY", "OBSERVATION LIBRARY", side(d, 685, 960, +1, outer=prom), "COR")
    R(4, "EXCUR", "SHORE EXCURSION OFFICE", side(d, 1005, 1150, +1, outer=prom), "COR")
    R(4, "LECTURE", "LECTURE HALL", side(d, 385, 640, -1, outer=prom), "COR", kind=PUB)
    R(4, "LOUNGE", "EXPEDITION LOUNGE", side(d, 640, 960, -1, outer=prom), "COR", "PROM_S", kind=PUB)
    R(4, "MED", "HOSPITAL", side(d, 960, 1150, -1, outer=prom), "COR")

    # ---------------- deck 5: passenger cabins with a dead-end branch forward
    d = D[5]
    towers(5)
    R(5, "TERRACE", "AFT TERRACE OPEN DECK", across(d, 70, 120))
    R(5, "COR", "DECK 5 MAIN CORRIDOR", centre(120, 1080), "STAIR_AFT", "STAIR_MID", "STAIR_FWD", "TERRACE", "BRANCH")
    R(5, "BRANCH", "DECK 5 FWD CORRIDOR BRANCH", centre(1080, 1200))                    # E: dead end, single route
    cabins(5, 120, 640, 6, +1, 1, "COR")
    cabins(5, 685, 960, 3, +1, 7, "COR")
    cabins(5, 1005, 1080, 1, +1, 10, "COR")
    cabins(5, 1080, 1200, 2, +1, 11, "BRANCH")
    cabins(5, 120, 340, 3, -1, 20, "COR")
    cabins(5, 385, 1080, 8, -1, 23, "COR")
    cabins(5, 1080, 1200, 2, -1, 31, "BRANCH")
    R(5, "FWDSUITE", "CABIN 5F01", across(d, 1200, 1258), "BRANCH")

    # ---------------- deck 6: suites; one suite group opens only into a pantry
    d = D[6]
    towers(6)
    R(6, "TERRACE", "AFT TERRACE OPEN DECK", across(d, 100, 150))
    R(6, "COR", "DECK 6 MAIN CORRIDOR", centre(150, 1150), "STAIR_AFT", "STAIR_MID", "STAIR_FWD", "TERRACE")
    cabins(6, 150, 640, 5, +1, 1, "COR", "SUITE STATEROOM {}")
    cabins(6, 685, 960, 3, +1, 6, "COR", "SUITE STATEROOM {}")
    cabins(6, 1005, 1150, 2, +1, 9, "COR", "SUITE STATEROOM {}")
    cabins(6, 150, 340, 2, -1, 20, "COR", "SUITE STATEROOM {}")
    cabins(6, 385, 1005, 6, -1, 22, "COR", "SUITE STATEROOM {}")
    R(6, "PANTRY", "BUTLER PANTRY", side(d, 1005, 1045, -1), kind=SpaceKind.SERVICE)                           # E: suite group without an exit
    R(6, "SUITE6S30", "SUITE STATEROOM 6S30", side(d, 1045, 1100, -1), "PANTRY")
    R(6, "SUITE6S31", "SUITE STATEROOM 6S31", side(d, 1100, 1150, -1), "SUITE6S30")
    R(6, "PANORAMA", "PANORAMA SUITE STATEROOM 6F01", across(d, 1150, 1228), "COR")

    # ---------------- deck 7: spa and observation
    d = D[7]
    towers(7)
    R(7, "POOL", "AFT POOL OPEN DECK", across(d, 150, 200))
    R(7, "COR", "DECK 7 CORRIDOR", centre(200, 1000), "STAIR_AFT", "STAIR_MID", "STAIR_FWD", "POOL")
    R(7, "FITNESS", "FITNESS CENTRE", side(d, 200, 340, +1), "COR")
    R(7, "SPA", "SPA TREATMENT ROOMS", side(d, 200, 340, -1), "COR", kind=PUB)
    R(7, "SAUNA", "SAUNA SUITE", side(d, 385, 640, +1), "COR", kind=PUB)
    R(7, "YOGA", "YOGA STUDIO", side(d, 685, 960, +1), "COR", kind=PUB)
    cabins(7, 385, 1000, 6, -1, 1, "COR")
    R(7, "OBS", "OBSERVATION LOUNGE", across(d, 1000, 1168), "COR", kind=PUB)

    # ---------------- deck 8: sun deck; cinema only reachable through an equipment store
    d = D[8]
    for name, x0, x1, s, decks in TOWERS:
        if 8 in decks:
            R(8, f"STAIR_{name}", f"{name} STAIRWAY", side(d, x0, x1, s))
    R(8, "SUN", "SUN DECK OPEN DECK", across(d, 200, 600))
    R(8, "COR", "DECK 8 PASSAGEWAY", centre(600, 1000), "STAIR_MID", "STAIR_FWD", "SUN")
    R(8, "TOWEL", "TOWEL STORE", side(d, 600, 640, +1), "COR")
    R(8, "AVSTORE", "AV EQUIPMENT STORE", side(d, 685, 730, +1))
    R(8, "CINEMA", "CINEMA", side(d, 730, 960, +1), "AVSTORE", kind=PUB)              # E: opens only into the AV store
    R(8, "POOLBAR", "POOL BAR", side(d, 600, 1000, -1), "COR", "SUN", kind=PUB)
    R(8, "SKY", "SKY LOUNGE", across(d, 1000, 1108), "COR", kind=PUB)

    # ---------------- deck 9: bridge
    d = D[9]
    towers(9)
    wings = lambda x: hull(x) * 1.0  # noqa: E731
    R(9, "RADIO", "RADIO ROOM", across(d, 845, 900), "COR", kind=SpaceKind.CONTROL)
    R(9, "COR", "DECK 9 CORRIDOR", centre(900, 1005), "STAIR_FWD", "BRIDGE")
    R(9, "CAPT", "CAPTAIN CABIN", side(d, 900, 960, +1), "COR")
    R(9, "MATE", "CHIEF MATE CABIN", side(d, 900, 960, -1), "COR")
    R(9, "CHART", "CHART ROOM", side(d, 960, 1005, -1), "COR", "BRIDGE", kind=SpaceKind.CONTROL)
    R(9, "BRIDGE", "BRIDGE", across(d, 1005, 1088), "WING_P", "WING_S")
    R(9, "WING_P", "NAVIGATION WING OPEN DECK (P)", [(x, wings(x)) for x in _xs(1005, 1070)] + [(x, d.out(x)) for x in reversed(_xs(1005, 1070))])
    R(9, "WING_S", "NAVIGATION WING OPEN DECK (S)", [(x, -d.out(x)) for x in _xs(1005, 1070)] + [(x, -wings(x)) for x in reversed(_xs(1005, 1070))])

    # stair doors: every stair opens onto its deck's corridor; on deck 4 the aft / fwd towers also open onto the promenades
    cor_of = {1: "D1_PASSAGE", 2: "D2_COR", 3: "D3_COR", 4: "D4_COR", 5: "D5_COR", 6: "D6_COR", 7: "D7_COR", 8: "D8_COR", 9: "D9_COR"}
    for r in ROOMS:
        if r.id.split("_", 1)[1].startswith("STAIR_"):
            n = r.deck
            if r.id == "D2_STAIR_AFT":
                continue                                    # aft tower on deck 2 serves only the crew corridor
            if not any(r.id in o.doors for o in ROOMS) and cor_of.get(n):
                r.doors.append(cor_of[n])
    for r in ROOMS:
        if r.id == "D4_STAIR_AFT":
            r.doors.append("D4_PROM_S")
        if r.id == "D4_STAIR_FWD":
            r.doors.append("D4_PROM_P")
    return ROOMS


# planted deficiencies the analysis is expected to find (documentation + tests)
PLANTED = {
    "fire": {
        "D1_ENGINE": "engine room below crew cabins: deck documented A-0, table 9.2 (12)/(6) requires A-60",
        "D3_GALLEY": "main galley / main restaurant bulkhead documented B-15, table 9.1 (8)/(12) requires A-60",
        "D3_PAINT": "paint locker / cabin bulkhead documented B-0, table 9.1 (6)/(14) requires A-30",
        "D1_AUXGEN": "aux. generator room / aft stairway bulkhead documented A-0, table 9.1 (2)/(12) requires A-30",
    },
    "escape": {
        "D2_CREWCOR": "crew corridor aft: single route (dead end, ~21 m)",
        "D5_BRANCH": "forward corridor branch: single route (dead end, ~11.8 m)",
        "D6_SUITE6S30": "suite group opening only into a pantry: no escape route",
        "D8_CINEMA": "cinema opening only into an equipment store: no escape route",
    },
    "hazard": {
        "D1_ENGINE": "engine room: one means of escape (escape trunk only)",
        "D1_AUXGEN": "aux. generator room: one route (via the deck 1 passageway)",
        "D3_PAINT": "paint locker opens only into the rope store: no escape route",
        "D2_GAS": "gas bottle store opens only into a spare-parts store: no escape route",
        "D1_ECR": "engine control room inside the machinery space: one means of escape (through the engine room)",
    },
    "fire_systems": {
        "D3_PAINT": "paint locker: no fixed fire-extinguishing system documented (SOLAS II-2 10.6.3.1)",
        "D1_FOT_S": "MGO tank 1 (S): 0.76 m from the side shell (MARPOL I/12A requires at least 1.0 m)",
    },
}
# boundaries whose documented class is planted below the table class: (space a, space b) -> documented class
FIRE_DEFICIENT = {
    frozenset({"D3_GALLEY", "D3_REST"}): "B-15",
    frozenset({"D3_PAINT", "D3_CAB_3P05"}): "B-0",
    frozenset({"D1_AUXGEN", "D1_STAIR_AFT"}): "A-0",
}
ENGINE_DECK_ABOVE = "A-0"            # every deck above the engine room (crew cabins on deck 2)
UNDOCUMENTED = {"D2_LAUNDRY"}        # the synthetic fire plan omits the laundry boundaries


# ------------------------------------------------------------------ model assembly
def _page(n: int, x: float, y: float) -> tuple[float, float]:
    return (round(X0 + x, 2), round(D[n].cy - y, 2))


def _bbox(n: int, poly) -> BBox:
    pts = [_page(n, x, y) for x, y in poly]
    return BBox(x0=min(p[0] for p in pts), y0=min(p[1] for p in pts), x1=max(p[0] for p in pts), y1=max(p[1] for p in pts))


def build() -> EngineeringModel:
    rooms = build_layout()
    scale = ScaleInfo(metres_per_unit=MPU, basis="synthetic grid, 1 unit = 0.1 m", cross_check="synthetic design - scale exact by construction")
    decks = []
    for d in DECKS:
        hb = max(d.out(x) for x in _xs(d.xa, d.xb, 30))
        decks.append(Deck(id=f"DECK_{d.n}", name=d.name, bbox=BBox(x0=X0 + d.xa, y0=d.cy - hb, x1=X0 + d.xb, y1=d.cy + hb),
                          elevation_mm=d.elev_mm, elevation_label=f"+{d.elev_mm / 1000:.1f} m ABL", scale=scale,
                          frame0_x=X0, centerline_y=d.cy, units_per_frame=7))
    spaces, ev, shapes = [], [], {}
    for r in rooms:
        kind, basis, hz = classify_label(r.label)
        if r.kind is not None and kind == SpaceKind.UNKNOWN:
            kind, basis = r.kind, f"synthetic definition (label '{r.label}' is outside the controlled vocabulary)"
        if hz:
            hz.classification_source = SYN
        shp = Polygon(r.poly).buffer(0)
        shapes[r.id] = shp
        bb = _bbox(r.deck, r.poly)
        e = Evidence(id=f"EV_{r.id}", page=0, bbox=bb, source=SYN, method="synthetic design geometry", text=r.label)
        ev.append(e)
        spaces.append(Space(id=r.id, deck_id=f"DECK_{r.deck}", name=r.label, labels=[r.label], kind=kind, kind_basis=basis,
                            polygon=[_page(r.deck, x, y) for x, y in r.poly], bbox=bb, hazard=hz,
                            computed_area_m2=round(shp.area * MPU * MPU, 1), provenance=SYN, evidence_ids=[e.id],
                            anchor=_page(r.deck, shp.representative_point().x, shp.representative_point().y)))
    sp = {s.id: s for s in spaces}
    deck_of = {r.id: r.deck for r in rooms}

    # doors at the shared boundary of the two spaces
    doors, conns = [], []
    for r in rooms:
        for other in r.doors:
            if other not in shapes:
                raise ValueError(f"{r.id}: door to unknown space {other}")
            shared = shapes[r.id].buffer(0.8).intersection(shapes[other].buffer(0.8))
            if shared.is_empty:
                raise ValueError(f"door {r.id} -> {other}: spaces do not touch")
            c = shared.centroid
            did = f"DR_{r.id}__{other}"
            x0, y0 = _page(r.deck, c.x - 4, c.y + 4)
            x1, y1 = _page(r.deck, c.x + 4, c.y - 4)
            e = Evidence(id=f"EV_{did}", page=0, bbox=BBox(x0=x0, y0=y0, x1=x1, y1=y1), source=SYN, method="synthetic door")
            ev.append(e)
            doors.append(Door(id=did, deck_id=f"DECK_{r.deck}", bbox=e.bbox, space_ids=[r.id, other], resolution="resolved",
                              provenance=SYN, evidence_ids=[e.id]))
            conns.append(Connection(id=f"C_{did}", source=r.id, target=other, type=ConnectionType.DOOR, door_id=did,
                                    provenance=SYN, certainty="synthetic", evidence_ids=[e.id]))
    # vertical links: stair towers deck to deck; engine-room escape trunk up to the deck 2 corridor
    for name, _, _, _, ds in TOWERS:
        ds = list(ds)
        for a, b in zip(ds, ds[1:]):
            conns.append(Connection(id=f"C_V_{name}_{a}{b}", source=f"D{a}_STAIR_{name}", target=f"D{b}_STAIR_{name}",
                                    type=ConnectionType.VERTICAL_STAIR, provenance=SYN, certainty="synthetic",
                                    note=f"{name} stair tower, deck {a} to deck {b}"))
    conns.append(Connection(id="C_V_ERTRUNK", source="D1_ER_TRUNK", target="D2_COR", type=ConnectionType.VERTICAL_STAIR,
                            provenance=SYN, certainty="synthetic", note="engine-room escape trunk exits into the deck 2 corridor"))
    # escape points: every open deck
    escapes = []
    for s in spaces:
        if s.kind == SpaceKind.OPEN_DECK:
            escapes.append(EscapePoint(id=f"E_{s.id}", deck_id=s.deck_id, kind=EscapePointKind.OPEN_DECK, space_id=s.id, bbox=s.bbox,
                                       label=s.name, provenance=SYN, evidence_ids=s.evidence_ids))
            conns.append(Connection(id=f"C_E_{s.id}", source=s.id, target=f"E_{s.id}", type=ConnectionType.ESCAPE_ACCESS,
                                    provenance=SYN, certainty="synthetic"))

    # derived measurements used by the regulatory checks
    door_id = {(d.space_ids[0], d.space_ids[1]): d.id for d in doors}
    sp["D2_CREWCOR"].measurements["max_travel_from_door_m"] = {
        "values": {door_id[("D2_CREWCOR", "D2_STAIR_AFT")]: 21.0}, "unit": "m", "provenance": "synthetic"}
    sp["D5_BRANCH"].measurements["max_travel_from_door_m"] = {
        "values": {door_id[("D5_COR", "D5_BRANCH")]: 11.8}, "unit": "m", "provenance": "synthetic"}
    sp["D3_PAINT"].measurements["fire_extinguishing_system"] = {
        "value": None, "unit": "", "provenance": "synthetic", "basis": "synthetic fire-fighting arrangement plan FFA-AURORA-01: no fixed system listed"}
    for tid, dist in (("D1_FOT_S", 0.76), ("D1_FOT_P", 1.20)):
        sp[tid].measurements["min_distance_to_side_shell_m"] = {"value": dist, "unit": "m", "provenance": "synthetic"}

    # adjacency of fire-risk spaces (shared walls on one deck, overlaps with the deck above / below)
    fire_ids = {s.id for s in spaces if s.hazard and s.hazard.fire_risk}
    adj: list[Adjacency] = []
    ids = list(shapes)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            if a not in fire_ids and b not in fire_ids:
                continue
            na, nb = deck_of[a], deck_of[b]
            if na == nb:
                inter = shapes[a].buffer(0.8).intersection(shapes[b].buffer(0.8))
                length_m = inter.area / 1.6 * MPU if not inter.is_empty else 0
                if length_m >= 1.0:
                    adj.append(Adjacency(id=f"ADJ_{a}__{b}", space_a=a, space_b=b, relation=AdjacencyRelation.SHARED_BOUNDARY,
                                         shared_length_m=round(length_m, 1), provenance=SYN, certainty="synthetic"))
            elif abs(na - nb) == 1:
                area = shapes[a].intersection(shapes[b]).area * MPU * MPU
                if area >= 4.0:
                    adj.append(Adjacency(id=f"ADJ_{a}__{b}", space_a=a, space_b=b, relation=AdjacencyRelation.VERTICAL_OVERLAP,
                                         overlap_area_m2=round(area, 1), provenance=SYN, certainty="synthetic"))

    # SYNTHETIC structural fire protection plan: documented class per boundary
    elev = {f"DECK_{d.n}": d.elev_mm for d in DECKS}
    for a in adj:
        if {a.space_a, a.space_b} & UNDOCUMENTED:
            continue
        sa, sb = sp[a.space_a], sp[a.space_b]
        ca, cb = fi.category(sa)[0], fi.category(sb)[0]
        if ca is None or cb is None:
            continue
        if a.relation == AdjacencyRelation.VERTICAL_OVERLAP:
            below, above = (ca, cb) if elev[sa.deck_id] < elev[sb.deck_id] else (cb, ca)
            req = fi.required_deck(below, above)
        else:
            req = fi.required_bulkhead(ca, cb)
        if req is None:
            continue
        doc = FIRE_DEFICIENT.get(frozenset({a.space_a, a.space_b}), req)
        if "D1_ENGINE" in (a.space_a, a.space_b) and a.relation == AdjacencyRelation.VERTICAL_OVERLAP:
            doc = ENGINE_DECK_ABOVE
        a.fire_integrity = doc
        a.fire_integrity_source = "synthetic structural fire protection plan SFP-AURORA-01"
    n_doc = sum(1 for a in adj if a.fire_integrity)

    profile = {"ship_type": "Expedition Cruise Ship (synthetic)", "class_society": "DNV", "class_notation": "SYNTHETIC - not a classed ship",
               "persons_on_board": 452, "passengers": 300, "special_personnel": 0, "gross_tonnage": 13500,
               "oil_fuel_capacity_m3": 900, "delivery_date": "2027-03-15", "length_overall_m": 140.0, "breadth_m": 22.4}
    return EngineeringModel(
        document=DesignDocument(design_id=DESIGN_ID, name="SYNTHETIC - MV Aurora Borealis, 9-deck expedition cruise ship (planted deficiencies)",
                                source_type="json", data_origin=DataOrigin.SYNTHETIC, page_sizes=[PAGE],
                                metadata={"vessel_profile": profile, "title": "SYNTHETIC expedition cruise ship - test design with planted deficiencies",
                                          "planted_deficiencies": PLANTED}),
        decks=decks, spaces=spaces, doors=doors, escape_points=escapes, connections=conns, adjacencies=adj, evidence=ev,
        fire_documentation=FireSafetyDocumentation(
            fire_control_plan_available=True,
            note=(f"SYNTHETIC structural fire protection plan supplied: division classes documented for {n_doc} of {len(adj)} "
                  "boundaries of fire-risk spaces (laundry boundaries not documented).")),
        extraction_log=["Synthetic design generated by backend/data/synthetic/generate_cruise.py",
                        f"{len(DECKS)} decks, {len(spaces)} spaces, {len(doors)} doors, {len(escapes)} escape points, {len(adj)} fire-risk adjacencies"],
        limitations=["SYNTHETIC test data - not a real ship. Deficiencies are planted on purpose.",
                     "Space categories for SOLAS tables 9.1/9.2 are a screening interpretation.",
                     "Main vertical zones, stair widths and fire doors are not modelled."],
    )


if __name__ == "__main__":
    m = build()
    out = HERE / f"{DESIGN_ID}.json"
    out.write_text(m.model_dump_json(indent=1))
    print("wrote", out.name, "-", m.extraction_log[-1])
