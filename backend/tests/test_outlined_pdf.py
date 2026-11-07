"""Outlined-text (OCR) drawings, URL import, scale calibration."""
import pytest

from backend.engineering.sheet_views import deck_name, establish_scale, parse_scale
from backend.engineering.hazard_classifier import classify_label
from backend.services import url_import


@pytest.mark.parametrize("txt,ratio", [('1/8"=1\'-0"', 96), ('| /8"=1\'-0"', 96), ('1/8" =17-0"', 96), ('3/16"=1\'-0"', 64), ("1:150", 150)])
def test_parse_scale_tolerates_ocr_noise(txt, ratio):
    assert parse_scale(txt) == ratio


def test_deck_name_normalisation():
    assert deck_name("004 LEVEL (PILOTHOUSE TOP)") == "04 LEVEL (PILOTHOUSE TOP)"
    assert deck_name("QO2 LEVEL") == "02 LEVEL"
    assert deck_name("IST PLATFORM") == "1ST PLATFORM"


def _levels(mm_per_pt):
    # deck heights in feet, y positions consistent with the given scale
    feet = [54, 45.5, 37, 28, 19, 10, 6]
    return [(f"L{f}", f, 500 - f * 0.3048 / (mm_per_pt / 1000), 500) for f in feet]


def test_scale_accepted_when_two_sources_agree():
    r = establish_scale(96, 1224, _levels(67.73), 96)          # D sheet printed at 0.5x
    assert r.ok and abs(r.metres_per_unit - 0.06773) < 1e-4 and "ANSI D" in r.cross_check


def test_scale_rejected_when_sources_disagree():
    r = establish_scale(96, 1224, _levels(80.0), 96)
    assert not r.ok and r.metres_per_unit is None


def test_scale_rejected_without_callouts():
    assert not establish_scale(96, 1224, [], 96).ok


@pytest.mark.parametrize("label,cat", [("SHIP'S HAZ MAT 01-13-1", "chemical_store"), ("ENGINE ROOM", "machinery_space_combustion_engine"),
                                       ("EMERGENCY GENERATOR FUEL TANK 02-41-4", "fuel_oil_tank_or_space")])
def test_osu_style_labels(label, cat):
    assert classify_label(label)[2].category == cat


def test_berth_and_route_labels():
    assert classify_label("CREW DOUBLE 01-29-0")[0].value == "accommodation"
    assert classify_label("PASSAGEWAY 01-15-2")[0].value == "corridor"
    assert classify_label("STAIRWAY 01-24-0")[0].value == "stair"
    assert classify_label("SCIENCE LAB")[0].value == "work_space"


def test_box_share_page_resolves_to_file():
    html = '{"typedID":"f_836309805515","name":"6096-070-001-(J) General Arrangement.pdf"}'
    dl, name = url_import._resolve_box("https://oregonstate.app.box.com/s/xbxepay8qgd31pmvisxtwtemvpb4637q", html)
    assert "shared_name=xbxepay8qgd31pmvisxtwtemvpb4637q" in dl and "file_id=f_836309805515" in dl
    assert name.endswith(".pdf")


def test_box_folder_link_gives_clear_error():
    with pytest.raises(url_import.ImportErrorWithHint, match="folder"):
        url_import._resolve_box("https://x.app.box.com/s/abc", '{"typedID":"d_123"}')


def test_private_addresses_refused():
    with pytest.raises(url_import.ImportErrorWithHint):
        url_import._check_host("http://127.0.0.1/file.pdf")
