#!/usr/bin/env python3
"""
verify_notes.py -- source-fidelity gate for H2 Chemistry study notes.

Checks every content line of a .notes spec against the lecture-notes text it
was compiled from. A build is only allowed (build_docx.js refuses otherwise)
when this script has written a PASS report whose hash matches the spec.

Usage:
    python3 -I verify_notes.py <spec.notes> <source.txt> [--report-dir DIR]

Checks per content line (bullets, paragraphs, quotes, equations, table cells,
checklist items):
  1. NUMBERS   every token containing a digit (values, charges, formulas such
               as CH4, Kc units, temperatures) must occur in the cited source
               range. Any unsupported number is a hard FAIL -- this is what
               stops invented data, computed answers, and "corrected" values.
  2. WORDS     >= 85% of the line's content words (stemmed) must occur in the
               cited source range. Below that is a FAIL.
  3. FOREIGN   content words that never occur anywhere in the source file are
               listed; more than 1 per line is a FAIL (catches imported
               terminology / outside knowledge).
  4. PHRASING  word-trigram overlap with the cited range is reported; very low
               overlap is a WARN (heavy paraphrase -- re-check meaning).
Reverse check:
  5. COVERAGE  numbered section headings in the source (e.g. "2.4 Boyle's Law")
               that are not represented anywhere in the spec are listed as
               WARN, so omissions are visible.

Lines starting with "! " (gap notices) are not content and are not checked,
but are counted and shown in the report. Headings are checked for FOREIGN
words only.
"""
import hashlib, json, os, re, sys, unicodedata

SLACK = 25          # lines of slack around a cited range
WORD_MIN = 0.85
FOREIGN_MAX = 1
TRIGRAM_WARN = 0.20

STOP = set("""
a an the and or of to in on at by for from with without into onto as is are was were be been being
this that these those it its it's they them their there here which who whom whose what when where why how
than then so such not no nor but if else also both each either neither any all some more most less least
very can could may might must shall should will would do does did done has have had having i e eg ie etc
we you your our one two three per via vs versus i.e e.g note notes see refer below above following
""".split())

# Structural vocabulary the notes may use even if a given lecture never does.
STRUCTURAL = set("""
summary key point points overview introduction section sections topic topics revision checklist quick
explain state describe define definition definitions compare comparison contrast outline identify list
deduce predict calculate use apply recall recognise recognize understand know able candidates
example examples worked question questions answer answers blank lecture lectures source sources diagram
diagrams figure figures table tables graph graphs original pdf page pages shown show included included
reproduced reproduce refer reference check learning outcome outcomes syllabus content contents
part parts step steps type types feature features factor factors main general specific case cases
left final remaining working unanswered fill complete completed blank blanks quantity symbol symbols
explanation explanations description condition conditions property properties notice notices
""".split())

def norm(s):
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("−", "-").replace("–", "-").replace("—", "-")
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("**", "")
    s = re.sub(r"[_^{}]", "", s)          # sub/superscript markup -> flattened (matches PDF text)
    s = s.replace("→", " ").replace("⇌", " ")
    return s.lower()

def tokens(s):
    return re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", norm(s))

def stem(w):
    if w.endswith(("sses", "xes", "zes", "ches", "shes")) and len(w) > 6:
        w = w[:-2]
    for suf in ("ically", "ations", "ation", "ness", "ments", "ment", "ities", "ity", "ies", "ing",
                "ed", "ly", "es", "s", "e"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w

def has_digit(t):
    return any(c.isdigit() for c in t)

def content_words(toks):
    return [t for t in toks if not has_digit(t) and len(t) >= 3 and t not in STOP]

class Scope:
    def __init__(self, lines):
        text = " ".join(lines)
        self.toks = tokens(text)
        self.tokset = set(self.toks)
        self.stems = {stem(t) for t in self.toks}
        self.tri = {tuple(self.toks[i:i+3]) for i in range(len(self.toks) - 2)}
        # digit tokens are also matched inside glued tokens: PDF text often runs
        # values together (e.g. "105pa"), so keep the raw squashed text too.
        self.squashed = re.sub(r"[^a-z0-9.]", "", norm(text))

def parse_range(s, nlines):
    m = re.fullmatch(r"L(\d+)(?:-(\d+))?", s)
    if not m:
        raise ValueError(f"bad citation {s!r}")
    a = int(m.group(1)); b = int(m.group(2) or a)
    if not (1 <= a <= b <= nlines):
        raise ValueError(f"citation {s} outside source (1-{nlines})")
    return a, b

CITE_RE = re.compile(r"\s*@((?:L\d+(?:-\d+)?)(?:,L\d+(?:-\d+)?)*)\s*$")

def split_cite(line):
    m = CITE_RE.search(line)
    if m:
        return line[: m.start()], m.group(1).split(",")
    return line, None

def classify(raw):
    s = raw.rstrip("\n")
    st = s.strip()
    if not st or st.startswith("//"):
        return None, None
    if st.startswith("meta:"):
        return "meta", st[5:].strip()
    if re.match(r"#{1,3} ", st):
        return "heading", st.lstrip("#").strip()
    if st.startswith("! "):
        return "gap", st[2:]
    if st.startswith("? "):
        return "blank", st[2:]
    if st.startswith("[] "):
        return "check", st[3:]
    if st.startswith("|"):
        return "table", st
    if st.startswith("> "):
        return "quote", st[2:]
    if st.startswith("= "):
        return "eq", st[2:]
    if st.startswith("- "):
        return "bullet", st[2:]
    return "para", st

def main():
    args = sys.argv[1:]
    report_dir = None
    if "--report-dir" in args:
        i = args.index("--report-dir"); report_dir = args[i+1]; del args[i:i+2]
    if len(args) != 2:
        print(__doc__); sys.exit(2)
    spec_path, src_path = args
    spec_bytes = open(spec_path, "rb").read()
    spec_lines = spec_bytes.decode("utf-8").splitlines()
    src_lines = open(src_path, encoding="utf-8-sig").read().splitlines()
    N = len(src_lines)
    whole = Scope(src_lines)

    results, fails, warns = [], 0, 0
    current_cite = None
    gaps = blanks = checked = 0
    headings_text = []

    prev_kind = None
    for ln, raw in enumerate(spec_lines, 1):
        kind, body = classify(raw)
        if kind == "table" and prev_kind != "table":
            kind_row = "thead"
        else:
            kind_row = None
        prev_kind = kind
        if kind is None or kind == "meta":
            continue
        body, cite = split_cite(body)
        if kind == "heading":
            headings_text.append(body)
            if cite:
                current_cite = cite
        if kind == "gap":
            gaps += 1
            results.append({"line": ln, "kind": kind, "status": "GAP", "text": body}); continue

        cites = cite or current_cite
        if cites is None and kind != "heading":
            results.append({"line": ln, "kind": kind, "status": "FAIL", "text": body,
                            "why": ["no source citation (add @Lx-y to the line or its heading)"]})
            fails += 1; continue
        try:
            ranges = [parse_range(c, N) for c in cites] if cites else []
        except ValueError as e:
            results.append({"line": ln, "kind": kind, "status": "FAIL", "text": body, "why": [str(e)]})
            fails += 1; continue
        scope_lines = []
        for a, b in ranges:
            scope_lines += src_lines[max(0, a - 1 - SLACK): min(N, b + SLACK)]
        scope = Scope(scope_lines) if ranges else whole

        if kind == "blank":
            blanks += 1
        if kind == "table":
            cells = [c.strip() for c in body.strip().strip("|").split("|")]
            text = " ".join(cells)
        else:
            text = body
        toks = tokens(text)
        why, status = [], "PASS"

        foreign = sorted({w for w in content_words(toks)
                          if stem(w) not in whole.stems and w not in whole.tokset and w not in STRUCTURAL})
        if len(foreign) > FOREIGN_MAX:
            why.append(f"words not found anywhere in source: {foreign}"); status = "FAIL"
        elif foreign:
            why.append(f"1 word not in source (allowed, check it): {foreign}")

        if kind != "heading":
            checked += 1
            nums = sorted({t for t in toks if has_digit(t)
                           and t not in scope.tokset and t not in scope.squashed})
            if nums:
                why.append(f"numbers/formulae not in cited source lines: {nums}"); status = "FAIL"
            cw = [w for w in content_words(toks) if w not in STRUCTURAL]
            if kind_row == "thead":
                cw = []   # table header row: structural labels; numbers + foreign words still checked
            if cw:
                hit = sum(1 for w in cw if w in scope.tokset or stem(w) in scope.stems)
                cov = hit / len(cw)
                if cov < WORD_MIN:
                    miss = sorted({w for w in cw if w not in scope.tokset and stem(w) not in scope.stems})
                    why.append(f"only {cov:.0%} of content words found in cited lines; missing {miss}")
                    status = "FAIL"
            tri = [tuple(toks[i:i+3]) for i in range(len(toks) - 2)]
            if len(tri) >= 4 and kind not in ("check", "blank", "eq"):
                tcov = sum(1 for t in tri if t in scope.tri) / len(tri)
                if tcov < TRIGRAM_WARN and status == "PASS":
                    why.append(f"heavy paraphrase (trigram overlap {tcov:.0%}) - re-read source to confirm meaning")
                    status = "WARN"
        if status == "FAIL": fails += 1
        if status == "WARN": warns += 1
        results.append({"line": ln, "kind": kind, "status": status, "text": body, "cite": cites, "why": why})

    # ---- reverse coverage: numbered source headings not represented ----
    spec_all = Scope([l for l in spec_lines if not l.strip().startswith("meta:")])
    missing = []
    for i, l in enumerate(src_lines, 1):
        m = re.match(r"^\s*(\d{1,2}(?:\.\d{1,2}){0,2})\.?\s+([A-Z][A-Za-z][^\n]{2,70})$", l)
        if not m:
            continue
        title = m.group(2).strip()
        if re.search(r"\d{3,}|\bmol\b|=", title):
            continue
        ws = [w for w in content_words(tokens(title)) if w not in STRUCTURAL]
        if len(ws) < 1:
            continue
        hit = sum(1 for w in ws if w in spec_all.tokset or stem(w) in spec_all.stems)
        if hit / len(ws) < 0.5:
            missing.append({"source_line": i, "heading": l.strip()})
    warns += len(missing)

    sha = hashlib.sha256(spec_bytes).hexdigest()
    src_sha = hashlib.sha256(open(src_path, "rb").read()).hexdigest()
    report = {"spec": os.path.basename(spec_path), "source": os.path.basename(src_path),
              "spec_sha256": sha, "source_sha256": src_sha, "status": "PASS" if fails == 0 else "FAIL",
              "checked_lines": checked, "fails": fails, "warns": warns, "gaps": gaps, "blanks": blanks,
              "possibly_omitted_source_headings": missing, "results": results}
    out_dir = report_dir or os.path.dirname(os.path.abspath(spec_path))
    base = os.path.join(out_dir, os.path.splitext(os.path.basename(spec_path))[0])
    with open(base + ".verify.json", "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    with open(base + ".verify.md", "w", encoding="utf-8") as f:
        f.write(f"# Verification report: {report['spec']}\n\nSource: `{report['source']}`\n\n")
        f.write(f"**Status: {report['status']}** — {checked} content lines checked, {fails} fail, "
                f"{warns} warn, {gaps} gap notices, {blanks} blanks left unanswered\n\n")
        for r in results:
            if r["status"] in ("FAIL", "WARN"):
                f.write(f"- **{r['status']}** spec line {r['line']}: {r['text'][:120]}\n")
                for w in r.get("why", []):
                    f.write(f"    - {w}\n")
        if missing:
            f.write("\n## Source headings possibly not covered\n\n")
            for m in missing:
                f.write(f"- source line {m['source_line']}: {m['heading']}\n")
    for r in results:
        if r["status"] == "FAIL":
            print(f"FAIL spec:{r['line']}: {r['text'][:90]}")
            for w in r["why"]:
                print(f"      {w}")
    for r in results:
        if r["status"] == "WARN":
            print(f"WARN spec:{r['line']}: {'; '.join(r['why'])[:140]}")
    for m in missing:
        print(f"WARN possibly omitted source heading (L{m['source_line']}): {m['heading']}")
    print(f"\n{report['status']}: {checked} lines checked, {fails} fail, {warns} warn, "
          f"{gaps} gaps, {blanks} blanks -> {base}.verify.json")
    sys.exit(0 if fails == 0 else 1)

if __name__ == "__main__":
    main()
