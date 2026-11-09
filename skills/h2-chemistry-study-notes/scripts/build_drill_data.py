#!/usr/bin/env python3
"""Build the data files for the Chemistry Drill app (same card format as the
H2 History Case Drill, v44) from verified .notes specs.

usage: python3 -I build_drill_data.py <notes_dir> <docs_dir> [<maps_dir>]

Writes <docs_dir>/cases.js, <docs_dir>/essays.js and <docs_dir>/data/*.js.
<maps_dir> (default: ../maps next to this script) holds three hand-made files:
  written.json      one short line per lecture and per section, written for the app.
                    The app labels every one "Written for this app – not from your lecture notes".
  notes_check.json  where the notes disagree with themselves; quotes are found by pattern
                    in the card points and copied word for word (build fails if one is missing).
  answers.json      suggested answers for blanks in the notes, written for the app and labelled
                    as not from the notes; every card with a blank must be answered or listed
                    under "cannot" (blank needs a drawing only in the PDF).
  reaction_maps.json reaction flow charts; every arrow names a card and point, and the build
                    fails unless both box names and every reagent occur in that card.

Fidelity rules:
- A spec is refused unless its verify report exists, is PASS, and was made from
  this exact version of the spec (SHA-256 match).
- Only lines the verifier marked PASS or WARN become card points.
- Gap (!) and blank (?) lines are attached to the card as notes, never as points.
  Gaps that record a disagreement inside the notes become "Check this" warnings.
- Card questions are either taken from the notes (worked examples, "Q: … A: …" lines,
  labelled "Question from your notes") or a fixed template ("What do your notes say about …?").
- The only other written text comes from written.json and map/stage titles, and the app
  labels it as not from the lecture notes.
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


NOTES_Q = re.compile(r"^(Worked Example|Exercise|Try it yourself)", re.I)
# The first point of a worked example is used as its question only if it reads as one
# (a question mark or an instruction word) and carries no part of the answer.
ASKS = re.compile(r"\?|\b(calculate|complete|write|draw|explain|describe|suggest|state|identify|predict|arrange|determine|deduce|"
                  r"find|sketch|compare|estimate|construct|outline|show that)\b", re.I)
ANSWERED = re.compile(r"reagents? (and|&) conditions?:|reagent and condition:|name of mechanism|ΔS [<>]|initial rate for|"
                      r"\bK[cₚ] =|let the| · |⇒|∴|\bnote:", re.I)
QA = re.compile(r"^Q\d*:\s*(.+?\?)\s*(?:A:\s*)?(\S.*)$")


def build_topic(spec_path, rep_path, written=None):
    written = written or {}
    wsec = written.get("sections", {})
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

    out, n, nq = [], 0, 0
    for c in cards:
        if not c["pts"]:
            continue
        noteq = None
        p0 = c["pts"][0]
        if NOTES_Q.search(c["title"]) and len(c["pts"]) >= 2 and ASKS.search(p0) and not ANSWERED.search(p0) and "[left blank]" not in p0:
            noteq = c["pts"][0]
            c["pts"], c["cites"] = c["pts"][1:], c["cites"][1:]
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
            if noteq:
                card["qs"], card["q"] = "notes", noteq
            if uni(c["sec"]) in wsec:
                card["exp"] = wsec[uni(c["sec"])]
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
        # A "Q: …? A: …" line in the notes becomes its own card, asked exactly as written.
        for p, ci in zip(c["pts"], c["cites"]):
            m = QA.match(p)
            if m and "[left blank]" not in p:
                nq += 1
                out.append({"id": f"{key}-q{nq}", "t": key, "sec": uni(c["sec"]), "src": topic["src"], "qs": "notes",
                            "title": uni(c["title"]) + " – question", "when": "", "mid": " › ".join(uni(x) for x in c["mid"]),
                            "q": m.group(1), "pts": [m.group(2)], "lines": line_range([ci] if ci else []), "pcite": [ci],
                            **({"exp": wsec[uni(c["sec"])]} if uni(c["sec"]) in wsec else {})})

    secs = []
    for c in out:
        if not secs or secs[-1]["name"] != c["sec"]:
            secs.append({"name": c["sec"], "when": "", "what": wsec.get(c["sec"], ""), "facts": [], "cards": []})
        secs[-1]["facts"].append(c["title"] + (f" — {c['mid']}" if c["mid"] else ""))
        secs[-1]["cards"].append(c["id"])
    summary = {"question": " ".join(content), "overview": [written["overview"]] if written.get("overview") else [], "themes": [{"h": "Learning outcomes", "pts": los}] if los else [],
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


SUBN = str.maketrans("₀₁₂₃₄₅₆₇₈₉₊₋⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻", "0123456789+-0123456789+-")


def nrm(s):
    return re.sub(r"\s+", " ", s.translate(SUBN).lower().replace("−", "-").replace("–", "-")).strip()


def find_point(cases, where, pat):
    """First card point in a lecture (or one card, if `where` is a card id) matching `pat`; copied word for word."""
    rx = re.compile(pat)
    for c in cases:
        if c["t"] == where or c["id"] == where:
            if c["qs"] == "notes" and rx.search(c["q"]):
                return c, -1
            for i, p in enumerate(c["pts"]):
                if rx.search(p):
                    return c, i
    raise SystemExit(f"notes_check.json: nothing in {where} matches {pat!r}")


def notes_check(cases, topics, spec):
    name = {t["key"]: t["name"] for t in topics}
    quote = lambda c, i: {"text": c["q"] if i < 0 else c["pts"][i], "doc": name[c["t"]] + " notes", "sec": c["sec"] + (" › " + c["title"])}
    real, possible, dropped = [], list(spec.get("possible", [])), list(spec.get("dropped", []))
    for c in cases:
        for w in c.pop("warn", []):
            mv = spec.get("move", {}).get(c["id"])
            if mv:
                c.setdefault("gaps", []).append(w["text"])
                if mv["to"] == "dropped":
                    dropped.append({"was": w["text"], "reason": mv["reason"]})
                else:
                    possible.append({"text": w["text"], "why": mv["reason"], "quotes": []})
                continue
            qs = [quote(*find_point(cases, wh, pat)) for wh, pat in spec.get("quotes", {}).get(c["id"], [])]
            real.append({"text": w["text"], "quotes": qs or [{"text": c["title"], "doc": name[c["t"]] + " notes", "sec": c["sec"]}], "_cards": {c["id"]}})
    for r in spec.get("real", []):
        hits = [find_point(cases, wh, pat) for wh, pat in r["find"]]
        real.append({"text": r["text"], "quotes": [quote(c, i) for c, i in hits], "_cards": {c["id"] for c, _ in hits}})
    by = {c["id"]: c for c in cases}
    for r in real:
        for cid in sorted(r.pop("_cards")):
            by[cid].setdefault("warn", []).append({"text": r["text"], "quotes": r["quotes"]})
    return {"real": real, "possible": possible, "dropped": dropped}


def build_maps(cases, spec):
    """Reaction maps -> FLOWS2 charts. Refuses any arrow whose boxes or reagents are not in its card."""
    by = {c["id"]: c for c in cases}
    out, bad, n = {}, [], 0
    for m in spec["maps"]:
        clusters = []
        for cl in m["clusters"]:
            tracks = []
            for f, lab, to, cid, pi in cl["rx"]:
                c = by.get(cid)
                if not c or pi >= len(c["pts"]):
                    bad.append(f"{m['id']}: no point {pi} in card {cid}")
                    continue
                txt = nrm(" ".join([c["sec"], c["mid"], c["title"]] + c["pts"]))
                parts = [re.sub(r"^then\s+", "", x) for x in re.split(r",\s*|\s*\(|\)|\s+and\s+|\s+\+\s+|\s+in\s+", lab) if x and x.strip()]
                parts += [x for x in re.split(r"\s+\+\s+", f) + re.split(r"\s+\+\s+", to) if x.strip()]
                miss = [x for x in parts if nrm(x) not in txt]
                if miss:
                    bad.append(f"{m['id']}: {f} → {to} – not in {cid}: {miss}")
                    continue
                n += 1
                node = lambda t, ty: {"id": f"{m['id']}-{n}{ty[0]}", "type": ty, "t": t, "cards": [cid]}
                tracks.append({"steps": [node(f, "reactant"), {"link": lab, "how": c["pts"][pi]}, node(to, "product")]})
            clusters.append({"title": cl["title"], "steps": [{"split": tracks}]})
        out.setdefault(m["t"], []).append({"id": m["id"], "order": len(out.get(m["t"], [])), "level": 0, "kind": "reactions",
                                           "title": m["title"], "clusters": clusters})
    if bad:
        raise SystemExit("reaction_maps.json refused:\n  " + "\n  ".join(bad))
    return out, n


def attach_answers(cases, spec):
    """Suggested answers (written for the app) for cards whose notes have blanks."""
    by = {c["id"]: c for c in cases}
    A, cannot = spec.get("answers", {}), spec.get("cannot", {})
    bad = [k for k in list(A) + list(cannot) if k not in by]
    if bad:
        raise SystemExit("answers.json names cards that do not exist: " + ", ".join(bad))
    blank = lambda c: c.get("blanks") or any("[left blank]" in p or "[blank]" in p or "____" in p for p in c["pts"])
    missing = [c["id"] for c in cases if blank(c) and c["id"] not in A and c["id"] not in cannot]
    if missing:
        raise SystemExit("answers.json: no answer or 'cannot' entry for " + ", ".join(missing))
    for k, v in A.items():
        by[k]["sugg"] = v
    for k, v in cannot.items():
        by[k]["nosugg"] = v
    return sum(len(v) for v in A.values())


def main():
    notes_dir, docs = sys.argv[1], sys.argv[2]
    maps_dir = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "maps")
    load = lambda f: json.load(open(os.path.join(maps_dir, f), encoding="utf8")) if os.path.exists(os.path.join(maps_dir, f)) else {}
    written, check_spec, map_spec = load("written.json"), load("notes_check.json"), load("reaction_maps.json")
    ans_spec = load("answers.json")
    os.makedirs(os.path.join(docs, "data"), exist_ok=True)
    topics, cases, sums, essays, missing = [], [], {}, [], []
    for f in sorted(os.listdir(notes_dir)):
        if f.endswith(".notes"):
            spec = os.path.join(notes_dir, f)
            w = written.get(f[:-6], {})
            t, cs, s, es = build_topic(spec, spec[:-6] + ".verify.json", w)
            topics.append(t); cases += cs; sums[t["key"]] = s; essays += es
            missing += [f"{t['key']}: {x['name']}" for x in s["cases"] if not x["what"]]
            if not w.get("overview"):
                missing.append(f"{t['key']}: (overview)")
    nc = notes_check(cases, topics, check_spec)
    nans = attach_answers(cases, ans_spec) if ans_spec else 0
    flows, nrx = build_maps(cases, map_spec) if map_spec else ({}, 0)
    with open(os.path.join(docs, "cases.js"), "w", encoding="utf8") as fh:
        fh.write("// Topic list for the H2 Chemistry Drill. Built by build_drill_data.py from the verified study notes.\n")
        fh.write(js("TOPICS", topics) + "window.CASES=window.CASES||[];\n")
    with open(os.path.join(docs, "data", "cards.js"), "w", encoding="utf8") as fh:
        fh.write("// Cards built line by line from the verified notes. Only lines that passed the source check are points.\n"
                 "// `exp` is the one short line per section from written.json: written for the app, not from the lecture notes.\n")
        fh.write("window.CASES.push(..." + json.dumps(cases, ensure_ascii=False, separators=(",", ":")) + ");\n")
    with open(os.path.join(docs, "data", "summaries.js"), "w", encoding="utf8") as fh:
        fh.write("// `overview` and each section's `what` are written for the app (not from the lecture notes); the rest is from the notes.\n")
        fh.write(js("SUMMARIES", sums))
    with open(os.path.join(docs, "data", "notes-check.js"), "w", encoding="utf8") as fh:
        fh.write("// Where the notes disagree with themselves. Every quote is copied word for word from a card point.\n")
        fh.write(js("NOTES_CHECK", nc))
    with open(os.path.join(docs, "data", "maps.js"), "w", encoding="utf8") as fh:
        fh.write("// Reaction maps. Box names and reagents were checked against the named card; each arrow's `how` is that card point word for word.\n"
                 "// Map and stage titles are written for the app (not from the lecture notes).\n")
        fh.write(js("FLOWS2", flows))
    with open(os.path.join(docs, "essays.js"), "w", encoding="utf8") as fh:
        fh.write("// Learning-outcome prompts for Apply mode, taken word for word from each lecture's learning outcomes.\n"
                 "// `use` lists cards that share key words with the outcome (matched automatically).\n")
        fh.write(js("ESSAYS", essays))
    if missing:
        print("no written line for:\n  " + "\n  ".join(missing))
    print(f"{len(topics)} topics, {len(cases)} cards ({sum(len(c['pts']) for c in cases)} points, "
          f"{sum(1 for c in cases if c['qs'] == 'notes')} with questions from the notes, "
          f"{sum(1 for c in cases if 'clue' in c)} with Name-it clues), {len(essays)} outcome prompts, "
          f"{len(nc['real'])} disagreements ({len(nc['possible'])} possible, {len(nc['dropped'])} dropped), "
          f"{sum(len(v) for v in flows.values())} reaction maps ({nrx} reactions), {nans} suggested answers for blanks -> {docs}")


if __name__ == "__main__":
    main()
