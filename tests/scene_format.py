#!/usr/bin/env python3
"""scene_format.py -- scene files read by a second reader, written from docs/SCENE-FORMAT.md alone.

The simulator writes and reads scenes in JavaScript (serializeSceneToObject, deserializeSceneFromObject).
This reader is Python and knows only the format document, so the two can be held to agree:

  F1 every example scene in examples/scenes/ is valid by the document
  F2 each example, loaded into the page and written out again, keeps every particle (type and place)
  F3 a scene the page writes now is valid by the document too

usage:  python3 tests/scene_format.py [SCENE.json ...]    check the given files (default: the examples)
        python3 tests/scene_format.py --prove-red          corrupt copies; each fault must be caught
Copyright (C) 2026 Corwin Brust, Bryant Frankford and Contributors.
SPDX-License-Identifier: GPL-3.0-or-later
"""
import copy, json, math, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TYPES = {"e", "p", "n", "q"}          # electron, proton, neutron, positron
SETTINGS = {"T": "number", "G": "number", "ef": "vec3", "bf": "vec3", "ub": "flag", "cb": "flag"}


def finite(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def problems(scene):
    """Every way SCENE breaks the format, as sentences; an empty list means valid."""
    out = []
    if not isinstance(scene, dict):
        return ["a scene is a JSON object"]
    if scene.get("v") != 1:
        out.append(f"version must be 1, got {scene.get('v')!r}")
    p = scene.get("p")
    if not isinstance(p, list):
        return out + ["p (particles) must be a list"]
    n = len(p)
    for i, e in enumerate(p):
        if not isinstance(e, list) or len(e) not in (7, 8):
            out.append(f"particle {i}: must be [type, x, y, z, vx, vy, vz] with an optional extras object"); continue
        if e[0] not in TYPES:
            out.append(f"particle {i}: unknown type {e[0]!r}")
        if not all(finite(v) for v in e[1:7]):
            out.append(f"particle {i}: position and velocity must be finite numbers")
        if len(e) == 8 and not isinstance(e[7], dict):
            out.append(f"particle {i}: the eighth entry, if present, is an extras object")
    for k, b in enumerate(scene.get("b", [])):
        if not (isinstance(b, list) and len(b) in (2, 3) and all(isinstance(x, int) for x in b)):
            out.append(f"bond {k}: must be [i, j] or [i, j, order]"); continue
        if not (0 <= b[0] < n and 0 <= b[1] < n and b[0] < b[1]):
            out.append(f"bond {k}: indexes must name two particles, the lower first")
        if len(b) == 3 and b[2] not in (0, 2, 3):
            out.append(f"bond {k}: order is 0 (ionic), 2 or 3 (a single bond is written as [i, j])")
    for key, what in (("n", "nucleus"), ("e", "electron group")):
        for k, g in enumerate(scene.get(key, [])):
            if not (isinstance(g, list) and g and all(isinstance(x, int) and 0 <= x < n for x in g)):
                out.append(f"{what} {k}: must be a non-empty list of particle indexes")
    s = scene.get("s", {})
    if not isinstance(s, dict):
        out.append("s (settings) must be an object")
    else:
        for k, kind in SETTINGS.items():
            if k not in s:
                continue
            v = s[k]
            ok = (finite(v) if kind == "number" else
                  isinstance(v, list) and len(v) == 3 and all(finite(x) for x in v) if kind == "vec3" else
                  v in (0, 1))
            if not ok:
                out.append(f"setting {k}: must be a {kind}")
    if "t" in scene and not finite(scene["t"]):
        out.append("t (simulation time) must be a finite number")
    return out


def page_round_trip(paths):
    """F2: each scene loaded into the real page and written out again keeps every particle."""
    from playwright.sync_api import sync_playwright
    bad = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page()
        pg.route("**/*", lambda r: r.abort() if r.request.url.startswith("http") else r.continue_())
        pg.goto((ROOT / "index.html").as_uri()); pg.evaluate("localStorage.setItem('quantum_tour_completed','1')")
        pg.reload(); pg.wait_for_timeout(1200)
        for path in paths:
            scene = json.loads(Path(path).read_text(encoding="utf-8"))
            got = pg.evaluate("""(s) => { const r = deserializeSceneFromObject(s); noLoop();
                const o = serializeSceneToObject(); loop(); return [r.ok, r.message || '', o]; }""", scene)
            if not got[0]:
                bad.append(f"{Path(path).name}: the page refused it ({got[1]})"); continue
            key = lambda sc: sorted((e[0], round(e[1]), round(e[2]), round(e[3])) for e in sc["p"])
            if key(got[2]) != key(scene):
                bad.append(f"{Path(path).name}: particles changed on the way through the page")
            more = problems(got[2])
            if more:
                bad.append(f"{Path(path).name}: the page wrote an invalid scene: {more[0]}")
        b.close()
    return bad


def main(paths):
    fails = 0
    for path in paths:
        pr = problems(json.loads(Path(path).read_text(encoding="utf-8")))
        print(f"  {'PASS' if not pr else 'FAIL'}  F1 {Path(path).name}" + ("" if not pr else f"  ({pr[0]}; {len(pr)} in all)"))
        fails += bool(pr)
    rt = page_round_trip(paths)
    print(f"  {'PASS' if not rt else 'FAIL'}  F2+F3 through the page" + ("" if not rt else f"  ({rt[0]})"))
    fails += bool(rt)
    print(f"scene_format: {'all pass' if not fails else str(fails) + ' failing'}")
    return 1 if fails else 0


PLANTS = [
    ("an unknown particle type", lambda s: s["p"][0].__setitem__(0, "z")),
    ("a bond to a particle that is not there", lambda s: s["b"].append([0, len(s["p"]) + 5])),
    ("a position that is not a number", lambda s: s["p"][0].__setitem__(1, "far")),
    ("the wrong version", lambda s: s.__setitem__("v", 2)),
    ("an empty nucleus", lambda s: s["n"].append([])),
]


def prove_red():
    base = json.loads((ROOT / "examples" / "scenes" / "waterCluster.json").read_text(encoding="utf-8"))
    caught = 0
    for name, plant in PLANTS:
        s = copy.deepcopy(base); plant(s)
        found = problems(s)
        print(f"  {'caught' if found else 'MISSED'}  {name}" + (f"  ({found[0]})" if found else ""))
        caught += bool(found)
    print(f"scene_format --prove-red: {caught} of {len(PLANTS)} planted faults caught")
    return 0 if caught == len(PLANTS) else 1


if __name__ == "__main__":
    if "--prove-red" in sys.argv:
        sys.exit(prove_red())
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    sys.exit(main(args or sorted(str(p) for p in (ROOT / "examples" / "scenes").glob("*.json"))))
