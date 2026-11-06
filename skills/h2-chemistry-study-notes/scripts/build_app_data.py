#!/usr/bin/env python3
"""Build the card bank for the Chemistry Drill app from verified .notes specs.

usage: python3 -I build_app_data.py <notes_dir> <out.js>

Only lines the verifier marked PASS or WARN become drill points. A spec whose
verify report is missing, not PASS, or was made from a different version of the
spec is refused, so the app can never show text that skipped verification.
Gap (!) and blank (?) lines are counted per card and shown as such, never as
answer points.
"""
import hashlib, json, os, re, sys

POINT_KINDS = {"bullet", "para", "quote", "table"}
SKIP_SECTIONS = re.compile(r"syllabus map|learning outcomes?$|^references|lecture outline|^content$|quick-revision checklist", re.I)
GROUP = {  # strand used to group topic chips in the app
    "02": "Physical", "03": "Physical", "04": "Physical", "05a": "Physical", "05b": "Physical",
    "06": "Physical", "07": "Physical", "08": "Physical", "20": "Physical", "21": "Physical",
    "22a": "Physical", "22b": "Physical", "12a": "Inorganic", "12b": "Inorganic", "23": "Inorganic",
}
MAX_PTS = 10


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def strip_cite(s):
    return re.sub(r"\s*@(L\d+(?:-\d+)?(?:,L\d+(?:-\d+)?)*)\s*$", "", s)


def cells(row):
    return [c.strip() for c in row.strip().strip("|").split("|")]


def build_topic(spec_path, rep_path):
    rep = json.load(open(rep_path))
    if rep.get("status") != "PASS":
        raise SystemExit(f"refused: {rep_path} is not PASS")
    if rep.get("spec_sha256") != sha(spec_path):
        raise SystemExit(f"refused: {rep_path} was made from a different version of {spec_path}")
    key = os.path.basename(spec_path)[:-6]
    num = key.split("_")[0]
    lines = open(spec_path, encoding="utf8").read().split("\n")
    meta = {}
    for l in lines:
        m = re.match(r"meta:\s*(\w+)\s*=\s*(.*)$", l.strip())
        if m:
            meta[m.group(1)] = m.group(2)
    res = {r["line"]: r for r in rep["results"]}

    cards, checklist = [], []
    stack = {}          # heading level -> text
    cur = None          # current card
    thead = None        # header cells of the current table
    prev_table = False

    def new_card(level):
        nonlocal cur
        path = [stack[k] for k in sorted(stack) if k <= level]
        cur = {"title": path[-1], "path": path[:-1], "pts": [], "gaps": [], "blanks": [], "cite": None}
        cards.append(cur)

    for ln, raw in enumerate(lines, 1):
        st = raw.strip()
        is_table = st.startswith("|")
        if not is_table:
            thead = None
        r = res.get(ln)
        hm = re.match(r"^(#{1,4}) (.*)$", st)
        if hm:
            level = len(hm.group(1))
            text = strip_cite(hm.group(2)).strip()
            for k in list(stack):
                if k >= level:
                    del stack[k]
            stack[level] = text
            cite = re.search(r"@(L[\d,L-]+)\s*$", st)
            if any(SKIP_SECTIONS.search(stack[k]) for k in stack):
                cur = None
                prev_table = False
                continue
            new_card(level)
            if cite:
                cur["cite"] = cite.group(1)
            prev_table = False
            continue
        if r is None:
            prev_table = is_table
            continue
        kind, status = r["kind"], r["status"]
        if kind == "check":
            checklist.append(r["text"])
            continue
        if cur is None:
            prev_table = is_table
            continue
        cite = (r.get("cite") or [None])[0]
        if kind == "gap":
            cur["gaps"].append(r["text"])
        elif kind == "blank":
            cur["blanks"].append(r["text"])
        elif kind in POINT_KINDS and status in ("PASS", "WARN"):
            text = r["text"]
            if kind == "table":
                cs = cells(text)
                if thead is None:      # first row of a block is the header
                    thead = cs
                    prev_table = True
                    continue
                parts = []
                for i, c in enumerate(cs):
                    if not c or c in ("–", "-"):
                        continue
                    h = thead[i] if i < len(thead) else ""
                    parts.append(f"{h}: {c}" if h and i > 0 else c)
                text = " · ".join(parts)
                if not text:
                    continue
            cur["pts"].append([text, cite or cur["cite"] or ""])
        prev_table = is_table

    out = []
    n = 0
    for c in cards:
        if not c["pts"]:
            continue
        chunks = [c["pts"][i:i + MAX_PTS] for i in range(0, len(c["pts"]), MAX_PTS)]
        for j, ch in enumerate(chunks):
            n += 1
            title = c["title"] + (f" (part {j + 1} of {len(chunks)})" if len(chunks) > 1 else "")
            out.append({"id": f"{key}-{n}", "t": key, "title": title, "path": c["path"],
                        "pts": ch, "gaps": c["gaps"] if j == 0 else [], "blanks": c["blanks"] if j == 0 else []})
    topic = {"key": key, "num": num, "name": meta.get("title", key), "group": GROUP.get(num, "Organic"),
             "src": meta.get("file", ""), "checklist": checklist}
    return topic, out


def main():
    notes_dir, out_js = sys.argv[1], sys.argv[2]
    topics, cases = [], []
    for f in sorted(os.listdir(notes_dir)):
        if not f.endswith(".notes"):
            continue
        spec = os.path.join(notes_dir, f)
        t, cs = build_topic(spec, spec[:-6] + ".verify.json")
        topics.append(t)
        cases += cs
    with open(out_js, "w", encoding="utf8") as fh:
        fh.write("window.TOPICS=" + json.dumps(topics, ensure_ascii=False) + ";\n")
        fh.write("window.CASES=" + json.dumps(cases, ensure_ascii=False) + ";\n")
    pts = sum(len(c["pts"]) for c in cases)
    print(f"{len(topics)} topics, {len(cases)} cards, {pts} points, "
          f"{sum(len(t['checklist']) for t in topics)} checklist items -> {out_js}")


if __name__ == "__main__":
    main()
