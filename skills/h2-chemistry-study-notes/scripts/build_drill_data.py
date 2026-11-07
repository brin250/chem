#!/usr/bin/env python3
"""Build the data files for the Chemistry Drill app (same card format as the
H2 History Case Drill, v44) from verified .notes specs.

usage: python3 -I build_drill_data.py <notes_dir> <docs_dir>

Writes <docs_dir>/cases.js, <docs_dir>/essays.js and <docs_dir>/data/*.js.

Fidelity rules:
- A spec is refused unless its verify report exists, is PASS, and was made from
  this exact version of the spec (SHA-256 match).
- Only lines the verifier marked PASS or WARN become card points.
- Gap (!) and blank (?) lines are attached to the card as notes, never as points.
  Gaps that record a disagreement inside the notes become "Check this" warnings.
- Nothing is written that is not in the notes: card questions are a fixed template
  ("What do your notes say about …?") and are labelled as written for the drill.
"""
import hashlib, json, os, re, sys

POINT_KINDS = {"bullet", "para", "quote", "table"}
SEC0 = re.compile(r"syllabus map|learning outcomes?|^content$|references|lecture outline", re.I)
CHECKLIST = re.compile(r"quick-revision checklist", re.I)
STRAND = {"02": "Physical", "03": "Physical", "04": "Physical", "05a": "Physical", "05b": "Physical",
          "06": "Physical", "07": "Physical", "08": "Physical", "20": "Physical", "21": "Physical",
          "22a": "Physical", "22b": "Physical", "12a": "Inorganic", "12b": "Inorganic", "23": "Inorganic"}
MAX_PTS = 10
DISAGREE = re.compile(r"differs? from|whereas|although|while |both are reproduced|both as printed|elsewhere the notes|"
                      r"incorrect to say|two methods give|disagree", re.I)
NOT_DISAGREE = re.compile(r"extraction|is lost|are lost|lost in", re.I)

SUB = dict(zip("0123456789+-−–=()aehijklmnoprstuvx", "₀₁₂₃₄₅₆₇₈₉₊₋₋₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ"))
SUP = dict(zip("0123456789+-−–=()abcdefghijklmnoprstuvwxyzABDEGHIJKLMNOPRTUVW",
               "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ"))
KEEP_SUP = {"⦵", "‡", "°"}
MARK = re.compile(r"\*\*(.+?)\*\*|_\{([^}]*)\}|_([A-Za-z0-9+\-−–])|\^\{([^}]*)\}|\^([A-Za-z0-9+\-−–⦵‡])")


def uni(s):
    """Chemistry markup -> plain Unicode text (H_2O -> H₂O, ^{2+} -> ²⁺). Word subscripts stay inline (K_{sp} -> Ksp)."""
    def rep(m):
        if m.group(1) is not None:
            return m.group(1)
        sub = m.group(2) if m.group(2) is not None else m.group(3)
        if sub is not None:
            if all(c in SUB for c in sub) and not re.fullmatch(r"[a-z]{2,}", sub):
                return "".join(SUB[c] for c in sub)
            return sub
        sup = m.group(4) if m.group(4) is not None else m.group(5)
        if all(c in SUP or c in KEEP_SUP for c in sup):
            return "".join(SUP.get(c, c) for c in sup)
        return "^(" + sup + ")"
    return MARK.sub(rep, s)


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def strip_cite(s):
    return re.sub(r"\s*@(L\d+(?:-\d+)?(?:,L\d+(?:-\d+)?)*)\s*$", "", s)


def cells(row):
    return [c.strip() for c in row.strip().strip("|").split("|")]


STOP = set("the and for with that this from into were was are has had have its their than then them they which while "
           "about after before over under between by of to in on at as an a or be is it not but also only more most each "
           "per vs via can you what why how when does used use using describe explain state candidates should able "
           "following including terms".split())


def terms(s):
    return {w for w in re.findall(r"[a-z]+|\d+", uni(s).lower()) if w not in STOP and (len(w) >= 4 or w.isdigit())}


def line_range(cites):
    lo, hi = None, None
    for c in cites:
        for part in c.split(","):
            m = re.fullmatch(r"L(\d+)(?:-(\d+))?", part)
            if m:
                a, b = int(m.group(1)), int(m.group(2) or m.group(1))
                lo = a if lo is None else min(lo, a)
                hi = b if hi is None else max(hi, b)
    return f"L{lo}–{hi}" if lo is not None else ""


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
    title = meta.get("title", key)
    name = re.sub(r"^Lecture Notes\s*\S+\s*[–−-]\s*", "", title)
    lect = re.match(r"Lecture Notes\s*(\S+)", title)
    topic = {"key": key, "paper": STRAND.get(num, "Organic"), "theme": "Lecture " + (lect.group(1) if lect else num),
             "name": name, "src": meta.get("file", "").removesuffix(".txt")}

    stack, cur, thead = {}, None, None
    cards, los, content, checklist = [], [], [], []
    mode = None  # "sec0" | "check" | "cards"
    sec0_kind = None

    for ln, raw in enumerate(lines, 1):
        st = raw.strip()
        if not st.startswith("|"):
            thead = None
        hm = re.match(r"^(#{1,4}) (.*)$", st)
        if hm:
            level, text = len(hm.group(1)), strip_cite(hm.group(2)).strip()
            for k in list(stack):
                if k >= level:
                    del stack[k]
            stack[level] = text
            top = stack.get(1, "")
            if CHECKLIST.search(text) or CHECKLIST.search(top):
                mode, cur = "check", None
            elif re.match(r"0\.", top) or SEC0.search(text) and level == 1:
                mode, cur = "sec0", None
                sec0_kind = "lo" if re.search(r"learning outcome", text, re.I) else "content" if re.fullmatch(r"content", text, re.I) else ("lo" if level == 1 else None)
            else:
                mode = "cards"
                path = [stack[k] for k in sorted(stack)]
                cur = {"sec": path[0], "mid": path[1:-1], "title": path[-1], "pts": [], "cites": [], "gaps": [], "blanks": [],
                       "hcite": (re.search(r"@(L[\d,L-]+)\s*$", st) or [None, None])[1]}
                cards.append(cur)
            continue
        r = res.get(ln)
        if r is None:
            continue
        kind, status, text = r["kind"], r["status"], r["text"]
        if kind == "check":
            checklist.append(uni(text))
            continue
        if mode == "sec0":
            if kind in ("bullet", "para") and status in ("PASS", "WARN"):
                if sec0_kind == "lo":
                    los.append(uni(text))
                elif sec0_kind == "content":
                    content.append(uni(text))
            continue
        if mode != "cards" or cur is None:
            continue
        if kind == "gap":
            cur["gaps"].append(uni(text))
        elif kind == "blank":
            cur["blanks"].append(uni(text))
        elif kind in POINT_KINDS and status in ("PASS", "WARN"):
            if kind == "table":
                cs = cells(text)
                if thead is None:
                    thead = cs
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
            cur["pts"].append(uni(text))
            cur["cites"].append((r.get("cite") or [cur["hcite"] or ""])[0] or "")

    out, n = [], 0
    for c in cards:
        if not c["pts"]:
            continue
        chunks = list(range(0, len(c["pts"]), MAX_PTS))
        for j, s in enumerate(chunks):
            n += 1
            pts, cites = c["pts"][s:s + MAX_PTS], c["cites"][s:s + MAX_PTS]
            ttl = uni(c["title"]) + (f" (part {j + 1} of {len(chunks)})" if len(chunks) > 1 else "")
            mid = " › ".join(uni(x) for x in c["mid"])
            card = {"id": f"{key}-{n}", "t": key, "sec": uni(c["sec"]), "src": topic["src"], "qs": "me",
                    "title": ttl, "when": "", "mid": mid,
                    "q": "What do your notes say about " + uni(c["title"]) + (f" (under {mid})" if mid else "") + "?",
                    "pts": pts, "lines": line_range([x for x in cites if x]), "pcite": cites}
            if j == 0:
                warn = [g for g in c["gaps"] if DISAGREE.search(g) and not NOT_DISAGREE.search(g)]
                other = [g for g in c["gaps"] if g not in warn]
                if warn:
                    card["warn"] = [{"text": w, "quotes": []} for w in warn]
                if other:
                    card["gaps"] = other
                if c["blanks"]:
                    card["blanks"] = c["blanks"]
            if len(pts) >= 2:
                card["clue"] = make_clue(c["title"], pts)
            out.append(card)

    secs = []
    for c in out:
        if not secs or secs[-1]["name"] != c["sec"]:
            secs.append({"name": c["sec"], "when": "", "what": "", "facts": [], "cards": []})
        secs[-1]["facts"].append(c["title"] + (f" — {c['mid']}" if c["mid"] else ""))
        secs[-1]["cards"].append(c["id"])
    summary = {"question": " ".join(content), "themes": [{"h": "Learning outcomes", "pts": los}] if los else [],
               "cases": secs, "exam": checklist}

    essays = []
    for i, lo in enumerate(los):
        q = re.sub(r"^\(?[a-z]\)\s*|^\([a-z]\)\s*", "", lo).strip()
        lt = terms(q)
        if not lt:
            continue
        scored = []
        for c in out:
            s = 2 * len(lt & terms(c["title"])) + len(lt & terms(" ".join(c["pts"])))
            if s >= 3:
                scored.append((s, c["id"]))
        scored.sort(key=lambda x: -x[0])
        use = [cid for _, cid in scored[:5]]
        if use:
            essays.append({"id": f"{key}-lo{i}", "t": key, "q": q[0].upper() + q[1:], "use": use})
    return topic, out, summary, essays


def make_clue(title, pts):
    tw = {w for w in terms(title) if not w.isdigit() and len(w) >= 4}
    p = max(pts, key=len)
    if len(p) > 420:
        p = p[:420].rsplit(" ", 1)[0] + " …"
    words = re.split(r"(\s+)", p)
    outw = []
    for w in words:
        lw = re.sub(r"[^a-z0-9-]", "", w.lower())
        outw.append("____" if lw and any(lw == t or (len(t) >= 6 and lw.startswith(t[:6])) for t in tw) else w)
    return "".join(outw)


def js(name, obj):
    return f"window.{name}=" + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n"


def main():
    notes_dir, docs = sys.argv[1], sys.argv[2]
    os.makedirs(os.path.join(docs, "data"), exist_ok=True)
    topics, cases, sums, essays, real = [], [], {}, [], []
    for f in sorted(os.listdir(notes_dir)):
        if f.endswith(".notes"):
            spec = os.path.join(notes_dir, f)
            t, cs, s, es = build_topic(spec, spec[:-6] + ".verify.json")
            topics.append(t); cases += cs; sums[t["key"]] = s; essays += es
            for c in cs:
                for w in c.get("warn", []):
                    real.append({"text": w["text"], "quotes": [{"text": c["title"], "doc": t["name"] + " notes", "sec": c["sec"]}]})
    with open(os.path.join(docs, "cases.js"), "w", encoding="utf8") as fh:
        fh.write("// Topic list for the H2 Chemistry Drill. Built by build_drill_data.py from the verified study notes.\n")
        fh.write(js("TOPICS", topics) + "window.CASES=window.CASES||[];\n")
    with open(os.path.join(docs, "data", "cards.js"), "w", encoding="utf8") as fh:
        fh.write("// Cards built line by line from the verified notes. Only lines that passed the source check are points.\n")
        fh.write("window.CASES.push(..." + json.dumps(cases, ensure_ascii=False, separators=(",", ":")) + ");\n")
    with open(os.path.join(docs, "data", "summaries.js"), "w", encoding="utf8") as fh:
        fh.write(js("SUMMARIES", sums))
    with open(os.path.join(docs, "data", "notes-check.js"), "w", encoding="utf8") as fh:
        fh.write(js("NOTES_CHECK", {"real": real, "possible": [], "dropped": []}))
    with open(os.path.join(docs, "essays.js"), "w", encoding="utf8") as fh:
        fh.write("// Learning-outcome prompts for Apply mode, taken word for word from each lecture's learning outcomes.\n"
                 "// `use` lists cards that share key words with the outcome (matched automatically).\n")
        fh.write(js("ESSAYS", essays))
    print(f"{len(topics)} topics, {len(cases)} cards ({sum(len(c['pts']) for c in cases)} points, "
          f"{sum(1 for c in cases if 'clue' in c)} with Name-it clues), {len(essays)} outcome prompts, "
          f"{len(real)} disagreements -> {docs}")


if __name__ == "__main__":
    main()
