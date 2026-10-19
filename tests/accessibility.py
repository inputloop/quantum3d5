#!/usr/bin/env python3
"""accessibility.py -- the simulator measured for WCAG 2.1 AA, in both themes, with every panel opened.

Two readers, so neither is trusted alone:
  A1  axe-core (the Deque engine) finds no violation, page by page: the main view, then each panel
      (Study Journal, Guided Lessons, Graphs, Double-Slit, Discoveries, Glossary, Help) opened in turn.
  A2  our own contrast measure: every visible run of text against EVERY colour stop of the background
      it sits on (axe skips text on gradients; this does not). 4.5:1, or 3:1 for large text.
  A3  every canvas has a name a screen reader can say.
  A4  every form control has a label.
  A5  the keyboard reaches the controls, and each focused control shows a visible focus ring.

usage:  python3 tests/accessibility.py [PAGE]
        python3 tests/accessibility.py --prove-red     plant one fault per check in a copy; each must go red
Needs Playwright with Chromium, and axe-core (npm install, see package.json; or AXE=/path/axe.min.js).

Copyright (C) 2026 Corwin Brust, Bryant Frankford and Contributors.
SPDX-License-Identifier: GPL-3.0-or-later
"""
import os, shutil, sys, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
AXE = Path(os.environ.get("AXE", ROOT / "node_modules" / "axe-core" / "axe.min.js"))
PANELS = ["toggleAchievementsBtn", "lessonsBtn", "toggleGraphsBtn", "toggleDoubleSlitBtn",
          "toggleDiscoveriesBtn", "glossaryBtn", "helpBtn"]

CONTRAST_JS = r"""() => {
 const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if(!m) return null; const v = m[1].split(',').map(Number); return {r:v[0],g:v[1],b:v[2],a:v.length>3?v[3]:1}; };
 const lum = c => { const f = x => { x/=255; return x<=0.03928? x/12.92 : Math.pow((x+0.055)/1.055,2.4); }; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); };
 const blend = (top, bot) => ({r: top.r*top.a+bot.r*(1-top.a), g: top.g*top.a+bot.g*(1-top.a), b: top.b*top.a+bot.b*(1-top.a), a:1});
 let grad = false;
 const stopsOf = bi => (bi.match(/rgba?\([^)]+\)/g)||[]).map(parse);
 const bgsOf = el => { // every background the text may sit on: each gradient stop composed over what lies below
   const layers=[]; for(let e=el; e; e=e.parentElement){ const s=getComputedStyle(e); const st = (s.backgroundImage && s.backgroundImage!=='none') ? stopsOf(s.backgroundImage) : [];
     const c=parse(s.backgroundColor); layers.push({c, st}); if ((c && c.a>=1) || st.some(x=>x.a>=1)) break; }
   let bases=[document.documentElement.getAttribute('data-theme')==='light'?{r:255,g:255,b:255,a:1}:{r:0,g:0,b:0,a:1}];
   for (let i=layers.length-1;i>=0;i--){ const L=layers[i]; if (L.c && L.c.a>0) bases=bases.map(b=>blend(L.c,b)); if (L.st.length) bases=[].concat(...bases.map(b=>L.st.map(x=>blend(x,b)))); }
   return bases; };
 const bgOf = el => { const all=bgsOf(el); grad = all.length>1; return all; };
 const old_unused = el => { const stack=[]; for(let e=el; e; e=e.parentElement){ const s=getComputedStyle(e); const c=parse(s.backgroundColor); if(c && c.a>0){ stack.push(c); if(c.a>=1) break; } }
   let base = {r:0,g:0,b:0,a:1}; if (document.documentElement.getAttribute('data-theme')==='light') base={r:255,g:255,b:255,a:1};
   for (let i=stack.length-1;i>=0;i--) base = blend(stack[i], base); return base; };
 const out = []; const seen = new Set();
 // open every section so collapsed text is checked too
 document.querySelectorAll('.section-body').forEach(e => e.style.display='block');
 for (const el of document.querySelectorAll('body *')) {
   if (!el.childNodes || ![...el.childNodes].some(n => n.nodeType===3 && n.textContent.trim())) continue;
   const cs = getComputedStyle(el); if (cs.display==='none' || cs.visibility==='hidden' || +cs.opacity===0) continue;
   if (el.disabled) continue; let fg0 = parse(cs.color); if(!fg0) continue; const bgs = bgOf(el); if (grad) window.__grad=(window.__grad||0)+1;
   let ratio = 99, bg = bgs[0]; for (const b of bgs) { const fg = blend(fg0, b); const L1 = lum(fg), L2 = lum(b); const r = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); if (r < ratio) { ratio = r; bg = b; } }
   const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700; const large = size >= 24 || (bold && size >= 18.66);
   const need = large ? 3 : 4.5;
   if (ratio < need) { const k = el.id ? '#'+el.id : el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.split(' ')[0]:'');
     const key = k+'|'+cs.color+'|'+cs.backgroundColor; if (seen.has(key)) continue; seen.add(key);
     out.push([ratio.toFixed(2), need, k, cs.color, 'on', `rgb(${bg.r|0},${bg.g|0},${bg.b|0})`, size, el.textContent.trim().slice(0,30)]); }
 }
 return out.sort((a,b)=>a[0]-b[0]);
}"""

AXE_JS = """axe.run(document, {resultTypes: ['violations']}).then(r => r.violations.map(v =>
    v.id + ' x' + v.nodes.length + ' (' + v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(', ') + ')'))"""


def run(page_path):
    res = {}; axe = AXE.read_text(encoding="utf-8")
    viol, low, unnamed, unlabelled, unringed = [], [], [], [], []
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 900})
        pg.route("**/*", lambda r: r.abort() if r.request.url.startswith("http") else r.continue_())
        url = Path(page_path).resolve().as_uri()
        for theme in ("dark", "light"):
            pg.goto(url)
            pg.evaluate(f"localStorage.setItem('quantum_theme','{theme}'); localStorage.setItem('quantum_tour_completed','1')")
            pg.reload(); pg.wait_for_timeout(1200); pg.add_script_tag(content=axe)
            for panel in [None] + PANELS:
                if panel:
                    pg.evaluate(f"document.getElementById('{panel}') && document.getElementById('{panel}').click()")
                    pg.wait_for_timeout(300)
                where = f"{theme}/{panel or 'main'}"
                viol += [f"{where}: {v}" for v in pg.evaluate(AXE_JS)]
                low += [f"{where}: {r[2]} {r[0]}:1 needs {r[1]}" for r in pg.evaluate(CONTRAST_JS)]
                if panel:
                    pg.keyboard.press("Escape"); pg.evaluate(f"document.getElementById('{panel}') && document.getElementById('{panel}').click()")
                    pg.reload(); pg.wait_for_timeout(900); pg.add_script_tag(content=axe)
            unnamed += [f"{theme}: {c}" for c in pg.evaluate(
                "[...document.querySelectorAll('canvas')].filter(c => !c.getAttribute('aria-label')).map(c => c.id || c.className || 'canvas')")]
            unlabelled += [f"{theme}: {c}" for c in pg.evaluate("""[...document.querySelectorAll('input,select,textarea')]
                .filter(e => e.type !== 'hidden' && e.type !== 'file' && !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby'))
                .map(e => e.id || e.name || e.type)""")]
            pg.reload(); pg.wait_for_timeout(900)
            for _ in range(8):
                pg.keyboard.press("Tab")
                f = pg.evaluate("""(() => { const e = document.activeElement; if (!e || e === document.body) return 'nothing focused';
                    const c = getComputedStyle(e); return (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 2) ? '' : (e.id || e.tagName); })()""")
                if f:
                    unringed.append(f"{theme}: {f}")
        b.close()
    res["A1 axe"] = (not viol, f"{len(viol)} violation(s) {viol[:3]}")
    low = sorted(set(low))
    res["A2 contrast"] = (not low, f"{len(low)} text style(s) under AA {low[:3]}")
    res["A3 canvas names"] = (not unnamed, f"{len(unnamed)} unnamed {unnamed[:3]}")
    res["A4 control labels"] = (not unlabelled, f"{len(unlabelled)} unlabelled {sorted(set(unlabelled))[:4]}")
    res["A5 keyboard focus"] = (not unringed, f"{len(unringed)} focus stop(s) without a visible ring {unringed[:3]}")
    return res


def report(res):
    bad = 0
    for k in sorted(res):
        ok, why = res[k]; bad += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {k}  ({why})")
    print(f"accessibility: {len(res) - bad}/{len(res)} pass")
    return bad


PLANTS = [
    ("A1 axe", "index.html", '<label for="atomSelect">Atom:</label>', '<span>Atom:</span>'),
    ("A2 contrast", "css/accessibility.css", "main#stage { display: contents; }",
     "main#stage { display: contents; }\nhtml[data-theme=\"light\"] .empty { color: #c8c8d0 !important; }"),
    ("A3 canvas names", "index.html", '<script src="js/accessibility.js"></script>', ''),
    ("A5 keyboard focus", "css/accessibility.css", "outline: 2px solid #ffcf5a !important;", "outline: none !important;"),
    ("A4 control labels", "index.html", '<label for="moleculeSelect">Molecule:</label>', '<span>Molecule:</span>'),
]


def prove_red():
    caught = 0
    for check, f, old, new in PLANTS:
        d = Path(tempfile.mkdtemp()) / "q"
        shutil.copytree(ROOT, d, ignore=shutil.ignore_patterns(".git", "node_modules"))
        src = (d / f).read_text(encoding="utf-8")
        if old not in src:
            print(f"  NOT PLANTED  {check}"); continue
        (d / f).write_text(src.replace(old, new, 1), encoding="utf-8")
        ok, why = run(d / "index.html")[check]
        print(f"  {'caught' if not ok else 'MISSED'}  {check} planted in {f}")
        caught += not ok
    print(f"accessibility --prove-red: {caught} of {len(PLANTS)} planted faults caught")
    return 0 if caught == len(PLANTS) else 1


if __name__ == "__main__":
    if not AXE.exists():
        sys.exit(f"NOT CHECKED: axe-core not found at {AXE} (run: npm install)")
    if "--prove-red" in sys.argv:
        sys.exit(prove_red())
    page = sys.argv[1] if len(sys.argv) > 1 else ROOT / "index.html"
    sys.exit(1 if report(run(page)) else 0)
