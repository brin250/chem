#!/usr/bin/env python3
"""Turn docs/index.html (the installable app) into a page for a Claude Artifact.

usage: python3 -I make_artifact.py <docs/index.html> <out.html>

The Artifact tool adds its own <!doctype>/<head>/<body> skeleton, so this keeps the
title, fonts, styles, body markup and scripts, and drops what only matters when the app
is installed from GitHub Pages (manifest, icons, home-screen meta tags).
"""
import re, sys

src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf8").read()
head = s[s.index("<head>") + 6:s.index("</head>")]
body = s[s.index("<body>") + 6:s.rindex("</body>")]
title = re.search(r"<title>.*?</title>", head).group(0)
fonts = "\n".join(re.findall(r'<link rel="(?:preconnect|stylesheet)"[^>]*fonts\.googleapis[^>]*>', head))
styles = "\n".join(re.findall(r"<style>.*?</style>", head, re.S))
page = "\n".join([title, '<meta name="claude:viewport-fit-sides" content="cover">', fonts, styles, body.strip()]) + "\n"
open(out, "w", encoding="utf8").write(page)
print(f"{out}: {len(page)} bytes")
