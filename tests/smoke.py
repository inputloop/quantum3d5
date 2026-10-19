#!/usr/bin/env python3
"""smoke.py -- the simulator, opened in a real browser with the network refused.

Checks (each PASS or FAIL, then a total):
  S1 load      the page opens from disk with no script errors and draws a canvas
  S2 offline   it asks the network for nothing at all
  S3 fill      Random Fill puts particles on the stage, and the clock runs
  S4 pause     Pause stops the clock; Step moves it exactly one tick
  S5 scene     a scene written by the page and read back holds the same particles
  S6 theme     a saved light theme is applied before the simulator's script runs, and after
  S7 clear     Clear All empties the stage
  S8 system    with no saved choice, a system that asks for light gets the light theme, switch ticked

usage:  python3 tests/smoke.py [PAGE]          PAGE defaults to ../index.html
        python3 tests/smoke.py --prove-red     plant one fault per check in a copy; each must go red

Needs Python 3 and Playwright with Chromium (pip install playwright; playwright install chromium).
Written in Python on purpose: a second language reading a JavaScript app.

Copyright (C) 2026 Corwin Brust, Bryant Frankford and Contributors.
SPDX-License-Identifier: GPL-3.0-or-later
"""
import os, shutil, sys, tempfile
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def run(page_path):
    res = {}; asked = []
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        def refuse(route):
            u = urlparse(route.request.url)
            if u.scheme in ("http", "https"):
                asked.append(u.netloc); return route.abort()
            return route.continue_()
        pg.route("**/*", refuse)
        url = Path(page_path).resolve().as_uri()
        pg.goto(url, wait_until="load"); pg.wait_for_timeout(1500)
        canv = pg.locator("canvas").count()
        res["S1 load"] = (canv >= 1 and not errs, f"canvas={canv} script errors={len(errs)} {errs[:1]}")
        try:
            pg.evaluate("try{localStorage.setItem('quantum_tour_done','1')}catch(e){}")
            pg.evaluate("document.querySelectorAll('#tourOverlay').forEach(e=>e.style.display='none')")
            pg.click("#randomFill", force=True); pg.wait_for_timeout(800)
            n = pg.evaluate("particles.filter(p => p && p.pos).length")
            f0 = pg.evaluate("frameCount"); pg.wait_for_timeout(400); f1 = pg.evaluate("frameCount")
            res["S3 fill"] = (n > 0 and f1 > f0, f"particles={n} frames {f0}->{f1}")
        except Exception as e:
            res["S3 fill"] = (False, str(e).splitlines()[0])
        try:
            pg.click("#pauseBtn", force=True); pg.wait_for_timeout(200)
            a = pg.evaluate("particles.filter(p=>p&&p.pos).map(p=>[p.pos.x,p.pos.y,p.pos.z].join(',')).join(';')")
            pg.wait_for_timeout(400)
            b2 = pg.evaluate("particles.filter(p=>p&&p.pos).map(p=>[p.pos.x,p.pos.y,p.pos.z].join(',')).join(';')")
            pg.click("#stepBtn", force=True); pg.wait_for_timeout(200)
            c = pg.evaluate("particles.filter(p=>p&&p.pos).map(p=>[p.pos.x,p.pos.y,p.pos.z].join(',')).join(';')")
            res["S4 pause"] = (a == b2 and c != b2, f"held while paused={a == b2}, step moved={c != b2}")
        except Exception as e:
            res["S4 pause"] = (False, str(e).splitlines()[0])
        try:
            got = pg.evaluate("""() => {
                const before = serializeSceneToObject();
                deserializeSceneFromObject(JSON.parse(JSON.stringify(before)));
                const after = serializeSceneToObject();
                const key = s => s.p.map(r => r.slice(0, 4).join(',')).join(';');
                return [before.p.length, after.p.length, key(before) === key(after)];
            }""")
            res["S5 scene"] = (got[0] > 0 and got[0] == got[1] and got[2], f"written {got[0]}, read back {got[1]}, same={got[2]}")
        except Exception as e:
            res["S5 scene"] = (False, str(e).splitlines()[0])
        try:
            # The saved theme must be applied before the simulator's own script runs (before first
            # paint, so a light-theme user never sees a dark flash): withhold that script and look.
            pg.evaluate("localStorage.setItem('quantum_theme','light')")
            pg.route("**/js/quantum3d5.js", lambda r: r.abort())
            pg.reload(wait_until="load"); pg.wait_for_timeout(300)
            early = pg.evaluate("document.documentElement.getAttribute('data-theme')")
            pg.unroute("**/js/quantum3d5.js")
            pg.reload(wait_until="load"); pg.wait_for_timeout(600)
            th = pg.evaluate("document.documentElement.getAttribute('data-theme')")
            res["S6 theme"] = (early == "light" and th == "light", f"before the app script: {early}; after: {th}")
            pg.evaluate("localStorage.removeItem('quantum_theme')")
        except Exception as e:
            res["S6 theme"] = (False, str(e).splitlines()[0])
        try:
            pg.evaluate("document.querySelectorAll('#tourOverlay').forEach(e=>e.style.display='none')")
            pg.click("#randomFill", force=True); pg.wait_for_timeout(300)
            pg.click("#clear", force=True); pg.wait_for_timeout(300)
            n = pg.evaluate("particles.filter(p => p && p.pos).length")
            res["S7 clear"] = (n == 0, f"particles after Clear All={n}")
        except Exception as e:
            res["S7 clear"] = (False, str(e).splitlines()[0])
        try:
            c2 = b.new_context(color_scheme="light"); p2 = c2.new_page()
            p2.route("**/*", lambda r: r.abort() if r.request.url.startswith("http") else r.continue_())
            p2.goto(url, wait_until="load"); p2.wait_for_timeout(800)
            th, ticked = p2.evaluate("[document.documentElement.getAttribute('data-theme'), !!(document.getElementById('lightModeCheckbox')||{}).checked]")
            res["S8 system"] = (th == "light" and ticked, f"data-theme={th} switch ticked={ticked}")
            c2.close()
        except Exception as e:
            res["S8 system"] = (False, str(e).splitlines()[0])
        res["S2 offline"] = (not asked, f"network requests refused: {len(asked)} {sorted(set(asked))}")
        b.close()
    return res


def report(res):
    bad = 0
    for k in sorted(res):
        ok, why = res[k]; bad += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {k}  ({why})")
    print(f"smoke: {len(res) - bad}/{len(res)} pass")
    return bad


PLANTS = [  # (check that must go red, file, text, replacement)
    ("S1 load", "js/quantum3d5.js", "function setup() {", "function setup() { undefinedThing();"),
    ("S2 offline", "index.html", '<script src="vendor/p5/p5.min.js"></script>',
     '<script src="vendor/p5/p5.min.js"></script><link rel="preconnect" href="https://example.org"><img src="https://example.org/x.png" alt="">'),
    ("S3 fill", "index.html", 'id="randomFill"', 'id="randomFill-off"'),
    ("S4 pause", "js/quantum3d5.js", 'logEvent("Simulation Stepped.");\n            advanceSimulation();', 'logEvent("Simulation Stepped.");'),
    ("S5 scene", "js/quantum3d5.js", "const list = particles.filter(p => p && p.pos);", "const list = particles.filter(p => p && p.pos).slice(1);"),
    ("S7 clear", "index.html", 'id="clear"', 'id="clear-off"'),
    ("S8 system", "index.html", "(saved === null && systemLight)", "(false)"),
    ("S6 theme", "index.html", "document.documentElement.setAttribute('data-theme', 'light')", "void 0"),
]


def prove_red():
    caught = 0
    for check, f, old, new in PLANTS:
        d = Path(tempfile.mkdtemp()) / "q"
        shutil.copytree(ROOT, d, ignore=shutil.ignore_patterns(".git", "tests"))
        src = (d / f).read_text(encoding="utf-8")
        if src.count(old) < 1:
            print(f"  NOT PLANTED  {check}"); continue
        (d / f).write_text(src.replace(old, new, 1), encoding="utf-8")
        ok, why = run(d / "index.html").get(check, (True, "absent"))
        print(f"  {'caught' if not ok else 'MISSED'}  {check} planted in {f}  ({why})")
        caught += not ok
    print(f"smoke --prove-red: {caught} of {len(PLANTS)} planted faults caught")
    return 0 if caught == len(PLANTS) else 1


if __name__ == "__main__":
    if "--prove-red" in sys.argv:
        sys.exit(prove_red())
    page = sys.argv[1] if len(sys.argv) > 1 else ROOT / "index.html"
    sys.exit(1 if report(run(page)) else 0)
