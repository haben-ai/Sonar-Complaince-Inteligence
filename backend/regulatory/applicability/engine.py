"""Applicability gate: which instruments / parts apply to this vessel, and why.

Every step cites the clause it relies on (stored in the regulatory index) and the profile
facts it uses. Unknown facts produce APPLICABILITY_UNKNOWN or explicit assumptions; they
are never silently filled in.
"""
from __future__ import annotations

from datetime import date

from backend.models.regulatory_models import ApplicabilityStep, ApplicabilityVerdict, VesselProfile

C_SPS_DEF = "SPS-CODE-MSC266-84/front/3~2"
C_SPS_NOT_PAX = "SPS-CODE-MSC266-84/front/4~2"
C_SPS_61 = "SPS-CODE-MSC266-84/CHAPTER6/6.1"
C_SPS_62 = "SPS-CODE-MSC266-84/CHAPTER6/6.2"
C_SPS_63 = "SPS-CODE-MSC266-84/CHAPTER6/6.3"
C_12A_1 = "MARPOL-I-12A-MEPC141-54/Regulation12A/1"
C_PVAG_STATUS = "PVAG-ACCESS-BOARD/p002"
C_COLREG_SCOPE = "COLREG-IMO-SUMMARY/p006"
C_BWM_SCOPE = "BWM-IMO-SUMMARY/p004"
C_LL_SCOPE = "LOADLINE-IMO-SUMMARY/p003"
C_SOLAS_SCOPE = "SOLAS-IMO-SUMMARY/p003"


def _num(f):
    try:
        return float(f.value) if f.value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def evaluate(vp: VesselProfile) -> list[ApplicabilityVerdict]:
    out: list[ApplicabilityVerdict] = []
    persons = _num(vp.persons_on_board)
    gt = _num(vp.gross_tonnage)
    sp = _num(vp.special_personnel)
    st = str(vp.ship_type.value or "")
    is_sps_type = any(k in st.lower() for k in ("special service", "research", "special purpose"))

    # ---------------- SPS Code
    steps = [ApplicabilityStep(statement=f"Class notation on the drawing gives ship type '{st or 'unknown'}'.", profile_facts=["ship_type"])]
    missing, assumptions = [], []
    if gt is None:
        missing.append("gross tonnage (SPS Code scope: not less than 500 GT)")
    if sp is None:
        missing.append("number of special personnel (SPS Code scope: more than 12)")
    steps.append(ApplicabilityStep(statement="SPS Code scope: special purpose ship of not less than 500 GT carrying more than 12 special personnel.",
                                   clause_ids=[C_SPS_DEF]))
    if not is_sps_type:
        status = "APPLICABILITY_UNKNOWN"
    elif (gt is not None and gt < 500) or (sp is not None and sp <= 12):
        status = "NOT_APPLICABLE"
    elif missing:
        status = "APPLICABLE_WITH_ASSUMPTIONS"
        assumptions.append("Research vessel assumed to be >= 500 GT and to carry > 12 special personnel (not stated on the GA).")
    else:
        status = "APPLICABLE"
    out.append(ApplicabilityVerdict(scope_id="SPS_CODE", instrument="SPS_CODE", title="IMO SPS Code 2008 (special purpose ships)",
                                    status=status, reasoning=steps, assumptions=assumptions, missing_facts=missing))
    sps_ok = status in ("APPLICABLE", "APPLICABLE_WITH_ASSUMPTIONS")

    # ---------------- SOLAS II-2: cargo vs passenger provisions
    base_steps = [ApplicabilityStep(statement="SOLAS specifies minimum standards for construction, equipment and operation of ships.",
                                    clause_ids=[C_SOLAS_SCOPE])]
    if persons is None:
        for scope, title in (("SOLAS_II2_CARGO", "SOLAS II-2 - cargo-ship provisions"), ("SOLAS_II2_PASSENGER", "SOLAS II-2 - passenger-ship provisions")):
            out.append(ApplicabilityVerdict(scope_id=scope, instrument="SOLAS", title=title, status="APPLICABILITY_UNKNOWN",
                                            reasoning=base_steps, missing_facts=["persons on board"]))
    else:
        s = base_steps + [
            ApplicabilityStep(statement=f"Drawing states accommodation for {int(persons)} persons.", profile_facts=["persons_on_board"]),
            ApplicabilityStep(statement="Special personnel need not be treated as passengers.", clause_ids=[C_SPS_NOT_PAX]),
        ]
        cargo_assume = ["SOLAS applies to the ship (international voyages; gross tonnage not on the GA). SOLAS chapter I is not in the corpus."]
        if persons <= 60:
            s.append(ApplicabilityStep(statement="SPS Code 6.3: ships carrying not more than 60 persons apply SOLAS II-2 requirements for cargo ships.",
                                       clause_ids=[C_SPS_63]))
            if not sps_ok:
                s.append(ApplicabilityStep(statement="Even outside the SPS Code, a ship carrying no passengers is a cargo ship under SOLAS - same branch."))
            out.append(ApplicabilityVerdict(scope_id="SOLAS_II2_CARGO", instrument="SOLAS", title="SOLAS II-2 - cargo-ship provisions",
                                            status="APPLICABLE_WITH_ASSUMPTIONS", reasoning=s, assumptions=cargo_assume + assumptions,
                                            missing_facts=missing))
            out.append(ApplicabilityVerdict(scope_id="SOLAS_II2_PASSENGER", instrument="SOLAS", title="SOLAS II-2 - passenger-ship provisions",
                                            status="NOT_APPLICABLE", reasoning=s[:-1] + [ApplicabilityStep(
                                                statement="Passenger-ship provisions apply under the SPS Code only above 60 persons (6.1, 6.2).",
                                                clause_ids=[C_SPS_61, C_SPS_62])]))
        else:
            s.append(ApplicabilityStep(statement="More than 60 persons: SPS Code 6.1/6.2 apply SOLAS II-2 passenger-ship requirements.",
                                       clause_ids=[C_SPS_61, C_SPS_62]))
            out.append(ApplicabilityVerdict(scope_id="SOLAS_II2_PASSENGER", instrument="SOLAS", title="SOLAS II-2 - passenger-ship provisions",
                                            status="APPLICABLE_WITH_ASSUMPTIONS", reasoning=s, assumptions=cargo_assume))
            out.append(ApplicabilityVerdict(scope_id="SOLAS_II2_CARGO", instrument="SOLAS", title="SOLAS II-2 - cargo-ship provisions",
                                            status="NOT_APPLICABLE", reasoning=s))

    # ---------------- MARPOL Annex I reg. 12A
    cap = _num(vp.oil_fuel_capacity_m3)
    dd = vp.delivery_date.value
    s = [ApplicabilityStep(statement="Reg. 12A applies to ships with aggregate oil fuel capacity of 600 m3 and above delivered on or after 1 August 2010.",
                           clause_ids=[C_12A_1])]
    miss = []
    if cap is None:
        miss.append("aggregate oil fuel capacity (m3) - not on the GA")
    if not dd:
        miss.append("delivery date")
    if cap is not None and cap < 600:
        status = "NOT_APPLICABLE"
    elif cap is None:
        status = "APPLICABILITY_UNKNOWN"
    elif dd:
        try:
            status = "APPLICABLE" if date.fromisoformat(str(dd)) >= date(2010, 8, 1) else "NOT_APPLICABLE"
        except ValueError:
            status = "APPLICABILITY_UNKNOWN"
    else:
        status = "APPLICABLE_WITH_ASSUMPTIONS"
    out.append(ApplicabilityVerdict(scope_id="MARPOL_I_12A", instrument="MARPOL", title="MARPOL Annex I reg. 12A - oil fuel tank protection",
                                    status=status, reasoning=s, missing_facts=miss,
                                    assumptions=["Delivered on or after 1 Aug 2010 (new build)"] if status == "APPLICABLE_WITH_ASSUMPTIONS" else []))

    # ---------------- PVAG / ADA
    pax = _num(vp.passengers)
    us = vp.us_passenger_vessel.value
    s = [ApplicabilityStep(statement="The PVAG are proposed guidelines for passenger vessels under the ADA and are not yet finalized.",
                           clause_ids=[C_PVAG_STATUS])]
    if pax is None and sps_ok:
        s.append(ApplicabilityStep(statement="Persons on board are crew and special personnel, who are not passengers under the SPS Code.",
                                   clause_ids=[C_SPS_NOT_PAX]))
    not_pax = (pax == 0) or (pax is None and sps_ok)
    pvag_status = "NOT_APPLICABLE" if (not_pax or us in (False, "false", "no")) else "APPLICABILITY_UNKNOWN"
    out.append(ApplicabilityVerdict(scope_id="PVAG", instrument="PVAG", title="PVAG (proposed) - passenger vessel accessibility",
                                    status=pvag_status, reasoning=s,
                                    missing_facts=[] if pvag_status == "NOT_APPLICABLE" else ["passengers carried / US passenger vessel"]))
    out.append(ApplicabilityVerdict(scope_id="ADA", instrument="ADA", title="2010 ADA Standards for Accessible Design",
                                    status="NOT_APPLICABLE",
                                    reasoning=[ApplicabilityStep(statement="The 2010 ADA Standards cover buildings and facilities; accessibility of passenger vessels "
                                                                           "under the ADA is the subject of the (proposed) PVAG.", clause_ids=[C_PVAG_STATUS])] + s[1:]))

    # ---------------- COLREG / Load Line / BWM (summary-only corpus)
    for scope, inst, title, cid, txt in (
        ("COLREG", "COLREG", "COLREG 1972 (lights, shapes, sound signals)", C_COLREG_SCOPE, "COLREG apply to all vessels upon the high seas."),
        ("LOAD_LINE", "LOAD_LINE", "International Convention on Load Lines 1966", C_LL_SCOPE, "Load Line convention: freeboard assignment."),
        ("BWM", "BWM", "Ballast Water Management Convention 2004", C_BWM_SCOPE, "All ships in international traffic manage ballast water per a ship-specific plan."),
    ):
        out.append(ApplicabilityVerdict(scope_id=scope, instrument=inst, title=title, status="APPLICABLE_WITH_ASSUMPTIONS",
                                        reasoning=[ApplicabilityStep(statement=txt, clause_ids=[cid])],
                                        assumptions=["Seagoing ship on international voyages. Corpus holds only the IMO summary, not the convention text."]))

    # ---------------- class rules
    soc = str(vp.class_society.value or "")
    out.append(ApplicabilityVerdict(scope_id="CLASS_DNV", instrument="CLASS_DNV", title="DNV class rules",
                                    status=("APPLICABLE" if soc == "DNV" else "NOT_APPLICABLE") if soc else "APPLICABILITY_UNKNOWN",
                                    reasoning=[ApplicabilityStep(statement=f"Class society on the drawing: {soc or 'unknown'}. DNV rules apply only to DNV-classed ships.",
                                                                 profile_facts=["class_society"])],
                                    missing_facts=[] if soc else ["class society"]))
    if soc and soc != "DNV":
        out.append(ApplicabilityVerdict(scope_id=f"CLASS_{soc}", instrument=f"CLASS_{soc}", title=f"{soc} class rules",
                                        status="APPLICABLE", reasoning=[ApplicabilityStep(statement=f"Vessel is {soc}-classed (title block).",
                                                                                           profile_facts=["class_society"])],
                                        missing_facts=[f"{soc} rule text (not in the corpus) - no checks possible"]))
    return out
