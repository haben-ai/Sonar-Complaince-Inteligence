"""Controlled vocabulary for space types and hazard categories.

Classification is driven ONLY by the label written on the drawing. A rule records exactly
which keyword matched so the classification can be audited. Spaces whose label does not
match a rule stay `unknown` (or can receive an LLM *suggestion*, stored separately with
provenance `llm_interpretation`).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from backend.models.engineering_models import HazardClassification, Provenance, SpaceKind

HAZARD_VOCABULARY: dict[str, tuple[str, bool]] = {
    # category: (description, relevant to fire-risk screening)
    "machinery_space_combustion_engine": ("Space labelled for combustion-engine generating machinery", True),
    "machinery_space_unspecified": ("Machinery space; machinery type not stated on the drawing", True),
    "electrical_battery_hazard": ("Battery room (electrical energy storage, possible off-gassing / thermal runaway)", True),
    "electrical_power_equipment": ("Switchboard / converter / inverter room (high-energy electrical equipment)", True),
    "flammable_liquid_store": ("Store explicitly labelled for paint or flammable liquids", True),
    "compressed_gas_store": ("Store explicitly labelled for oxygen / gas bottles", True),
    "chemical_store": ("Locker explicitly labelled for (scientific) chemicals", True),
    "hot_work_area": ("Welding workshop (hot work)", True),
    "galley_cooking": ("Galley (cooking appliances, grease)", True),
    "laundry": ("Laundry (dryers, lint accumulation)", True),
    "waste_store": ("Waste room (combustible waste)", True),
    "fuel_oil_tank_or_space": ("Tank/space labelled for fuel or lubricating oil (MGO, MDO, LO, sludge)", True),
}


@dataclass(frozen=True)
class Rule:
    rule_id: str
    pattern: str
    kind: SpaceKind
    hazard: str | None = None


OPEN_DECK_PATTERN = r"\bOUTDOOR\b|\bMOORING DECK\b|\bWINCH DECK\b|\bFLEX DECK\b|\bOPEN DECK\b|\bRAILING\b|\bBULWARK\b"

RULES: list[Rule] = [
    # tanks / voids first: a "GENERATOR FUEL TANK" is a fuel tank, a "THRUSTER VOID" is a void
    Rule("R-FUELTANK", r"\bFUEL (OIL )?TANK\b|\bLO TANK\b|\bLUBE OIL\b|\bSLUDGE\b|\bDIESEL OIL\b", SpaceKind.TANK_VOID, "fuel_oil_tank_or_space"),
    Rule("R-VOID", r"\bVOID\b", SpaceKind.TANK_VOID),
    # hazards (more specific)
    Rule("R-GEN", r"\bGENERATOR\b", SpaceKind.MACHINERY, "machinery_space_combustion_engine"),
    Rule("R-BATT", r"\bBATTERY\b", SpaceKind.MACHINERY, "electrical_battery_hazard"),
    Rule("R-SWBD", r"\bSWBD\b|\bSWITCHBOARD\b", SpaceKind.MACHINERY, "electrical_power_equipment"),
    Rule("R-CONV", r"\bCONVERTER\b|\bINVERTER\b", SpaceKind.MACHINERY, "electrical_power_equipment"),
    Rule("R-PAINT", r"\bPAINT\b", SpaceKind.SERVICE, "flammable_liquid_store"),
    Rule("R-GAS", r"\bOXY\b|\bGAS\b", SpaceKind.SERVICE, "compressed_gas_store"),
    Rule("R-CHEM", r"\bCHEM\b|\bHAZ\.? ?MAT\b|\bHAZMAT\b", SpaceKind.SERVICE, "chemical_store"),
    Rule("R-WELD", r"\bWELDING\b", SpaceKind.WORK, "hot_work_area"),
    Rule("R-GALLEY", r"\bGALLEY\b", SpaceKind.SERVICE, "galley_cooking"),
    Rule("R-LAUNDRY", r"\bLAUNDRY\b", SpaceKind.SERVICE, "laundry"),
    Rule("R-WASTE", r"\bWASTE ROOM\b", SpaceKind.SERVICE, "waste_store"),
    Rule("R-FUEL", r"^(MGO|MDO|LO|LUBE OIL|SLUDGE|WASTE OIL|MGO O/F|MGO SERV\.?)\b", SpaceKind.TANK_VOID, "fuel_oil_tank_or_space"),
    Rule("R-PROP", r"\bPROPULSION ROOM\b|\bAUX\.? MACH(INE)?\.? ROOM\b|\bTHRUSTER\b|\bSTEERING GEAR\b", SpaceKind.MACHINERY, "machinery_space_unspecified"),
    # non-hazard kinds
    Rule("R-ENGRM", r"\bENGINE ROOM\b|\bMAIN MACHINERY\b", SpaceKind.MACHINERY, "machinery_space_combustion_engine"),
    Rule("R-STAIR", r"\bSTAIRWAY\b|\bSTAIRS?\b|\bSTAIR TOWER\b", SpaceKind.STAIR),
    Rule("R-PASSAGE", r"\bPASSAGEWAY\b|\bCORRIDOR\b|\bVESTIBULE\b", SpaceKind.CORRIDOR),
    Rule("R-ECR", r"\bENGINE CONTROL\b|\bBRIDGE\b(?!.*TECH)|\bOPERATIONS ROOM\b", SpaceKind.CONTROL),
    Rule("R-CABIN", r"\bPERS\.?\b|\bCABIN\b|\bSTATEROOM\b|\bBERTH", SpaceKind.ACCOMMODATION),
    Rule("R-BERTH", r"^(CREW|SCIENCE|CHIEF SCIENCE|MARINE TECH|CAPTAIN|MASTER|CHIEF MATE|MATE|CHIEF ENGINEER|ENGINEER|STEWARD|COOK|OFFICER|CREW DOUBLE|CREW SINGLE|SCIENCE DOUBLE)\b(?!.*\b(LAB|LKR|LOCKER|STORE|OFFICE|WORKSHOP|CONTROL)\b)",
         SpaceKind.ACCOMMODATION),
    Rule("R-HOSP", r"\bSICKBAY\b|\bHOSPITAL\b", SpaceKind.ACCOMMODATION),
    Rule("R-PUBLIC", r"\bMESS\b|\bDAY ROOM\b|\bLIBRARY\b|\bCONFERENCE\b|\bFITNESS\b|\bLOBBY\b|\bRECEPTION\b", SpaceKind.PUBLIC),
    Rule("R-WORK", r"\bLAB\b|\bLABORATORY\b|\bWORKSHOP\b|\bHANGAR\b|\bOFFICE\b|\bCHANGE\b|\bCTD\b|\bTECH\b", SpaceKind.WORK),
    Rule("R-STORE", r"\bSTORE\b|\bSTORES\b|\bPROVISIONS\b|\bFREEZER\b|\bREFRI|\bLKR\b|\bLOCKER\b|\bLINEN\b|\bSCULLERY\b|\bEQUIPMENT\b", SpaceKind.SERVICE),
    Rule("R-ACROOM", r"\bA/C ROOM\b|\bCHILLER\b|\bAC-\d", SpaceKind.MACHINERY),
    Rule("R-WC", r"^WC$|\bWC\b", SpaceKind.SANITARY),
    Rule("R-TECHN", r"\bCASING\b|\bVENT\b|\bCABLES\b|\bPIPES\b|\bTRUNK\b|\bDUCT\b", SpaceKind.TECHNICAL),
    Rule("R-TANK", r"\bVOID\b|\bTANK\b|^WB$|^FW$|\bBILGE\b|\bSEW", SpaceKind.TANK_VOID),
    Rule("R-OPEN", OPEN_DECK_PATTERN, SpaceKind.OPEN_DECK),
]


def classify_label(name: str | None) -> tuple[SpaceKind, str, HazardClassification | None]:
    if not name:
        return SpaceKind.UNKNOWN, "no label", None
    up = name.upper()
    for r in RULES:
        if re.search(r.pattern, up):
            hz = None
            if r.hazard:
                desc, fire = HAZARD_VOCABULARY[r.hazard]
                hz = HazardClassification(
                    category=r.hazard,
                    description=desc,
                    fire_risk=fire,
                    classification_source=Provenance.PDF_TEXT,
                    matched_rule=f"{r.rule_id}: /{r.pattern}/ matched drawing label '{name}'",
                )
            return r.kind, f"{r.rule_id} matched label '{name}'", hz
    return SpaceKind.UNKNOWN, f"label '{name}' not in controlled vocabulary", None
