from copy import deepcopy

from guidance_provenance import origins, resolve, stamp
from routes import _arr_dict_to_wire, _arr_to_data, _preserve_phrase_guidance
from lib.song import arrangement_from_wire


def chart():
    data = {"name": "Example", "tuning": [0] * 6, "capo": 0,
            "notes": [{"t": 1.123456, "s": 0, "f": 3, "sus": .456789}], "chords": [], "templates": [],
            "anchors": [{"time": .123456, "fret": 2, "width": 4}, {"time": 3, "fret": 7, "width": 4}],
            "handshapes": [], "ext": {"custom": {"kept": True}}}
    stamp(data, "anchors", "generated", producer="fixture", policy="v1")
    stamp(data, "handshapes", "source", producer="fixture", intentional_empty=True)
    return data


def save(data, change=None):
    view = _arr_to_data(arrangement_from_wire(data), data["name"])
    if change: change(view)
    return _arr_dict_to_wire(view["name"], view["tuning"], view["capo"], view["notes"],
        view["chords"], view["chord_templates"], anchors_user=view["anchors_user"],
        handshapes=view["handshapes"], original=data)


def test_unchanged_save_preserves_precision_and_origin_twice():
    before = chart()
    result = save(before)
    for key in before: assert result[key] == before[key]
    assert save(result) == result


def test_one_lane_edit_preserves_untouched_generated_lane():
    before = chart()
    result = save(before, lambda v: v["anchors_user"][1].update(fret=9))
    assert origins(result, "anchors") == ["generated", "user"]
    assert result["anchors"][0] == before["anchors"][0]
    assert result["ext"]["custom"] == before["ext"]["custom"]


def test_note_edit_stales_but_does_not_regenerate_lanes():
    before = chart()
    result = save(before, lambda v: v["notes"][0].update(fret=17))
    assert result["anchors"] == before["anchors"]
    assert resolve(result, "anchors")["applicability"] == "stale"


def test_untouched_difficulty_levels_are_preserved():
    before = chart()
    level = {"difficulty": 0, "notes": [], "chords": [], "anchors": [{"time": 0, "fret": 1, "width": 4}]}
    stamp(level, "anchors", "source", producer="fixture")
    before["phrases"] = [{"start_time": 0, "end_time": 5, "max_difficulty": 0, "levels": [level]}]
    result = save(before)
    _preserve_phrase_guidance(before, result, before["phrases"])
    assert result["phrases"] == before["phrases"]


def test_explicit_empty_and_automatic_positions_are_distinct():
    data = chart()
    data["anchors"] = []
    stamp(data, "anchors", "user", producer="fixture", intentional_empty=True)
    assert save(data)["anchors"] == []
    fresh = _arr_dict_to_wire("New", [0] * 6, 0, [], [], [])
    assert origins(fresh, "anchors") == ["generated"]
