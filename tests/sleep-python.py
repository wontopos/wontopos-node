import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "python", "src"))
import wontopos.sleep as s  # noqa: E402

def safe(f, *a):
    try:
        return f(*a)
    except Exception as e:
        return {"error": type(e).__name__}

out = {}
out["tokens"] = [[t, s._sleep_tokens(t)] for t in [
    "", "abcd", "2024\u5e74 10\u6708 20\u65e5 \u5348\u5f8c 3\u6642\u306e \u5929\u6c17\u306f \u6674\u308c.", "😀🎉 emoji and 𝟏𝟐 astral digits", "e1, e2 · \u65e5\u4ed8 2026-10-20",
    "日本語のテキスト。カタカナ", "naïve café — résumé", "Привет, мир! 123456789", "١٢٣ عربي", "x" * 1001, "\x85　 tabs\tand\nlines",
    "今日", "こんばんは 今日は 2026年 10月", "ሀჿ",
]]
out["when"] = [[w, s._sleep_when(w)] for w in [
    "2026-10-20T09:30:00+09:00", "2026-10-20T09:30:00.123456Z", "2026-10-20T09:30:00.1234567-05:30", "2026-02-30T00:00:00Z",
    "２０２６-１０-２０T09:30:00Z", "0001-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00", "2026-10-20 09:30", "2026-10-20",
    "2026-10-20T24:00:00Z", "2026-10-20T09:30:60Z", "2026-10-20T09:30:00+0930", "2026-10-20T09:30", "2026-10-20T09:30:00.5z",
    "1969-12-31T23:59:59.999999Z", "2026-10-20T09:30:00Z ", 20261020, None,
]]
out["eids"] = [[v, s._sleep_eids(v)] for v in [
    ["e1", "e11"], "e1, e11", ["e1,e11", "e13"], "e1, e1", ["e1", "e1"], "e12\u756a e13 x", "\u4e00e3 e4\u4e00 e5", "xe1 e2x e3_ _e4 e5", "e١٢ and e٣",
    [["e1", "e2"]], [{"line": "e5"}], [12, None, True], "(e7)/e8;e9", "é1 e1", 12, None,
]]
out["str"] = [[v, str(v)] for v in [
    None, True, False, 1, -7, 1.5, 0.1, 1e-05, 123.456, 1.5e-07, "s", ["a", 1, None], {"a": "b'c", "d": [True]},
    {"x": 'q"r', "y": "both'\""}, "\n\t", ["\x85", "​", "\U000e0001", "\x7f"], ["日本", "😀"], [],  {},
    2 ** 53, 9007199254740996.0, 2.0 ** 60, 1e20, [1e300],
]]
out["int"] = [[v, safe(int, v)] for v in [" 12 ", "+5", "-3", "1_000", "١٢", "１２", True, False, 2.9, -2.9, "2.0", "", "1__0", "_1", "²"]]
out["int_none"] = safe(int, None)
out["strip"] = [[t, t.strip()] for t in ["  a  ", "\x85a　", "﻿a﻿", "\x1cb\x1f", "​c​", " d ", " e "]]
out["format_room"] = s._SLEEP_ROOM.format(being="Mira", where='box "Garden"', used=123456, cap=20000, core_way=", x", moved=', "moved": []')
out["format_digest"] = s._SLEEP_DIGEST.format(being="\u52a9\u624b {not a field}", k=2, n=13)
out["format_merge"] = s._SLEEP_MERGE.format(being="Mira", me="Me", today="2026-10-20 23:00", core_used=1234567, core_cap=70000,
                                            box_cap=20000, self_rule=s._SLEEP_SELF_RULE.format(me="Me", being="Mira"))
items = [{"kind": "work", "topic": "\u5f15\u7528\u7b26", "text": "\u5f15\u7528\u7b26\u306f\"\u304b\u304e\"\u3068\n\u6539\u884c, \u30bf\u30d6\t, \\ \u3092\u4f7f\u3046 😀", "evidence": ["e1", "e12"]},
         {"kind": "work", "topic": "", "text": "x", "evidence": []}]
out["indent0"] = [items, json.dumps(items, ensure_ascii=False, indent=0)]
out["indent0_empty"] = [json.dumps([], ensure_ascii=False, indent=0), json.dumps([{}], ensure_ascii=False, indent=0)]
out["round6"] = [[x, round(x, 6)] for x in [0.0078125, 0.0078135, 4.8599999999, 1.2345675, 0.0000005, 2.5e-07, 123.4567895, 0.0]]
def days(v):
    d = s._sleep_date(v)
    return None if d is None else (d - datetime.date(1970, 1, 1)).days
out["date"] = [[v, days(v)] for v in ["2026-10-05", "2024-02-29", "2026-02-29", "２０２６-10-05", "2026-１0-05", "2026-10-1٥",
                                     "2026-10-3٠", "0000-01-01", "0001-01-01", "2026-13-01", "2026-10-5", "2026-10-05 ", 20261005]]
texts = ["## Jamie\n- a\n\n## Me\nI am.\n", "intro\n## A \n x\n　\n## \n y\n## B\n- z  \n\x85", "",
         "## Self\n## Inner\nline", "plain line\n-dash\n - spaced\n## H\n\t- tab"]
out["sections"] = [[t, [list(x) for x in s._sleep_sections(t)], s._sleep_join(s._sleep_sections(t)), s._sleep_as_lines(t)] for t in texts]
out["set_section"] = [s._sleep_set_section("## A\nx\n", " ## B ", "one\n## two\n- three", raw=False),
                      s._sleep_set_section("## A\nx\n", "A", "## raw\ntext", raw=True)]
out["doubt"] = [[t, d, s._sleep_doubt_lines_out(t, d, s._sleep_tokens)] for t, d in [
    ("- a fact\n- Status: not yet confirmed.\n- to be checked", [2, 3]), ("- one\n- two", [1, 2]), ("- 3 figures\n- unsure", ["1", "2"]),
    ("- x\n- y", [True, 2.0, "٢", " 1"]), ("- x\n- y", "1"), ("- x\n\n- y", [2])]]
known = {"e1", "e2", "e3"}
said = {"e2"}
out["checked"] = [[g, s._sleep_checked_items(g, known, said)] for g in [
    {"items": [{"kind": "person", "topic": 7, "text": 5, "evidence": "e1, e3"}, {"kind": "self", "text": "x", "evidence": ["e1", "e3"]},
               {"kind": "self", "text": " y ", "evidence": ["e3", "e2"]}, {"kind": "work", "text": "w", "evidence": "e1, e1"},
               {"kind": "work", "text": "", "evidence": ["e1", "e2"]}, "not a dict", {"kind": "work", "text": [1], "evidence": ["e2", "e1"]}]},
    {"items": {"a": 1, "b": 2}}, {"items": "abc"}, {"items": 0}, {"items": None}, {}, None]]
out["parse"] = [[t, safe(s._sleep_parse_json, t)] for t in [
    '{"a": 1}', 'Here: ```json\n{"a": {"b": 2}}\n``` done', 'x {"a": 1} y {"b": 2} z', "no json", '```\n{"a":1}\n```',
    '　{"a": "　"}　', '{"a": 1', '}{', '{"line": Infinity}', '{"line": -Infinity}', '{"line": NaN}', '{"line": 1e999}',
    '{"line": -1e999}', '{"n": 1' + "0" * 309 + '}', '{"a": ' + "[" * 126 + "]" * 126 + "}",
    '{"a": ' + "[" * 127 + "]" * 127 + "}",
    '{"a": 1.0, "b": 1e2, "c": 2.5, "e": 9007199254740995, "f": 1e300, "g": [3.0, -2E0], "h": 9007199254740992.0}']]
view = [{"title": "", "version": 2, "tokens": 9, "day": "2026-10-01", "body": "## Jamie\n- Close friend.\n\n## Me\nI am.\n"},
        {"title": "Garden", "version": 1, "tokens": 9, "day": "2026-09-28"}, {"title": "", "version": 0, "tokens": 0, "day": None},
        {"title": "Reading List", "version": 1, "tokens": 1, "day": "2026-10-05"}, {"title": "", "version": 0, "tokens": 0, "day": None}]
v = {i: f for i, f in enumerate(view)}
out["pick"] = [[w, s._sleep_box_pick(v, w)] for w in ["1", " 2 ", "garden", "READING", "list", "", None, 4, "5", "Recipes"]]
out["render"] = [view, s._sleep_render(v, datetime.date(2026, 10, 5))]
def parts(tokens, ts, limit):
    lines = [s._SleepLine(f"e{i}", "", "", "", "", n, t, False) for i, (n, t) in enumerate(zip(tokens, ts), 1)]
    return [[m.eid for m in p] for p in s._sleep_parts(lines, limit)]
out["parts"] = [[tk, ts, lim, parts(tk, ts, lim)] for tk, ts, lim in [
    ([10] * 10, [float(i) for i in range(10)], 35),
    ([10] * 12, [0, 1, 2, 3, 13, 14, 15, 25, 26, 27, 28, 29], 45),
    ([10] * 8, [0, 5, 10, 15, 20, 25, 30, 35], 70),
    ([30, 30, 30, 30, 30], [50, 40, 30, 20, 10], 60),
    ([100, 5, 5], [0, 1, 2], 50),
    ([12, 12, 12, 12, 12, 12, 12, 12, 12], [0, 0.5, 1.5, 1.5, 9.25, 9.25, 9.75, 20, 20.125], 50),
    ([10] * 12, [float(i) for i in range(12)], 85),
    ([10] * 14, [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14, 15], 125),
]]
print(json.dumps(out, ensure_ascii=True, indent=1))
