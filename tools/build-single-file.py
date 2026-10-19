#!/usr/bin/env python3
"""build-single-file.py -- the whole simulator as one self-contained HTML file.

The project runs as it stands (open index.html). This builds the other way to ship it: one file
with every stylesheet and script inside, p5.js included, that runs from anywhere with no network:
email it, put it on a USB stick, upload it to a web host as a single page.

usage:  python3 tools/build-single-file.py [OUT]      default: dist/quantum3d5.html
        python3 tools/build-single-file.py --check    exit 1 if dist/quantum3d5.html is out of date

It reads index.html and replaces each local <link rel="stylesheet" href="..."> and
<script src="..."></script> with the file's contents. Anything it cannot inline (a remote URL, a
missing file) stops the build: the result is self-contained or it is not written.

Copyright (C) 2026 Corwin Brust, Bryant Frankford and Contributors.
SPDX-License-Identifier: GPL-3.0-or-later
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT = ROOT / "dist" / "quantum3d5.html"


def build():
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    def local(href):
        if re.match(r"^[a-z]+:|^//", href):
            sys.exit(f"build-single-file: {href} is not a local file; refusing to build a file that needs the network")
        p = ROOT / href
        if not p.is_file():
            sys.exit(f"build-single-file: {href} not found")
        text = p.read_text(encoding="utf-8")
        for bad in ("</script", "</style"):
            if bad in text.lower():
                sys.exit(f"build-single-file: {href} contains {bad}, which would end the inlined block early")
        return href, text

    def css(m):
        href, text = local(m.group(1))
        return f"<style>/* {href} */\n{text}\n</style>"

    def js(m):
        href, text = local(m.group(1))
        return f"<script>/* {href} */\n{text}\n</script>"

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js, html)
    html = html.replace("<head>", "<head>\n    <!-- Built by tools/build-single-file.py from the quantum3d5 repository; edit the sources there, not this file. -->", 1)
    return html


if __name__ == "__main__":
    out = build()
    if "--check" in sys.argv:
        ok = DEFAULT.is_file() and DEFAULT.read_text(encoding="utf-8") == out
        print("dist/quantum3d5.html is " + ("current" if ok else "OUT OF DATE: run python3 tools/build-single-file.py"))
        sys.exit(0 if ok else 1)
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(out, encoding="utf-8")
    print(f"wrote {dest} ({len(out.encode('utf-8')):,} bytes, self-contained)")
