// Reaction maps for the Chem Drill, ported from the History Case Drill's flow-chart engine (v44):
// Study / Complete / Recall modes and spaced review. Every box name and every reagent label was checked
// against a card of the verified notes when the data was built, and each arrow's explanation is that card's
// point word for word. Map and stage titles are written for the app and labelled as not from the notes.
(function(){
const A = window.APP; if (!A) return;
const { el, $ } = A;
const DAY = 864e5;

const TYPE = {
  context:          { label: "Context",         cls: "t-context" },
  long_term_cause:  { label: "Long-term cause", cls: "t-long" },
  short_term_cause: { label: "Short-term cause",cls: "t-short" },
  trigger:          { label: "Trigger",         cls: "t-trigger" },
  policy:           { label: "Policy / action", cls: "t-policy" },
  event:            { label: "Event",           cls: "t-event" },
  actor:            { label: "Actor",           cls: "t-actor" },
  turning_point:    { label: "Turning point ◆", cls: "t-turn" },
  consequence:      { label: "Result",          cls: "t-cons" },
  evidence:         { label: "Evidence",        cls: "t-evid" },
  interpretation:   { label: "Interpretation",  cls: "t-interp" },
  judgement:        { label: "Judgement",       cls: "t-judge" },
  reactant:         { label: "Reactant",        cls: "t-long" },
  product:          { label: "Product",         cls: "t-cons pos" }
};
const NEG = new Set();
// Chemistry links are reagents and conditions, so the choices in Complete mode come from the chart's own labels.
const vocabOf = (c, right) => { const all = [...new Set(catalog(c).links.map(l => l.label))].filter(x => x !== right).sort(() => Math.random() - 0.5).slice(0, 5); return all.concat(right).sort(() => Math.random() - 0.5); };
const NOTMINE = () => el("span", { class: "nfl", text: "Not from your lecture notes" });
const typeLabel = n => n.type === "consequence" ? (n.sign === "-" ? "Result −" : n.sign === "±" ? "Result ±" : "Result +") : (TYPE[n.type] || {label:n.type}).label;
const typeCls = n => (TYPE[n.type] || {cls:"t-event"}).cls + (n.type === "consequence" ? (n.sign === "-" ? " neg" : n.sign === "±" ? " mix" : " pos") : "");

/* ---------- data ---------- */
const charts = t => ((window.FLOWS2 || {})[t] || []);
function ordered(t){
  const all = charts(t).slice().sort((a,b)=>(a.order||0)-(b.order||0)), ids = new Set(all.map(c=>c.id)), kids = {}, out = [];
  for (const c of all){ const p = c.parent && ids.has(c.parent) ? c.parent : ""; (kids[p] = kids[p] || []).push(c); }
  const walk = (k,d) => { for (const c of kids[k] || []){ c._depth = d; out.push(c); walk(c.id, d+1); } };
  walk("", 0); return out;
}
// Every node and every link of a chart, flattened, with stable keys.
function catalog(c){
  if (c._cat) return c._cat;
  const nodes = [], links = [];
  const firstEntries = steps => { for (const x of steps){ if (x.link !== undefined) continue; if (x.row) return x.row; if (x.split) return x.split.flatMap(tr => firstEntries(tr.steps || [])); return [x]; } return []; };
  // Walks a step list; records nodes and labelled links; returns the nodes the last step exits from.
  const seq = steps => {
    let exits = [], pending = null;
    for (const x of steps){
      if (x.link !== undefined){ pending = x; continue; }
      let ent, ex;
      if (x.row){ x.row.forEach(n => nodes.push(n)); ent = ex = x.row;
        (x.links || []).forEach(l => { const a = x.row.find(n=>n.id===l.from), b = x.row.find(n=>n.id===l.to); if (a && b) links.push({ a, b, label: l.label, sub: l.sub, how: l.how }); }); }
      else if (x.split){ ent = []; ex = []; x.split.forEach(tr => { ent.push(...firstEntries(tr.steps || [])); ex.push(...seq(tr.steps || [])); }); }
      else { nodes.push(x); ent = ex = [x]; }
      if (pending && exits.length) for (const a of exits) for (const b of ent) links.push({ a, b, label: pending.link, sub: pending.sub, how: pending.how });
      exits = ex; pending = null;
    }
    return exits;
  };
  let prev = [];
  (c.clusters || []).forEach(k => {
    const ent = firstEntries(k.steps || []), ex = seq(k.steps || []);
    if (k.link && prev.length) for (const a of prev) for (const b of ent) links.push({ a, b, label: k.link, sub: k.sub, how: k.how });
    if (ex.length) prev = ex;
  });
  links.forEach((l, i) => l.key = c.id + "#" + i);
  return (c._cat = { nodes, links });
}

/* ---------- case studies ---------- */
// Each box is tied to its case study: the fact cards it was built from, and the topic summary's case study that covers them.
// Boxes with no cards of their own (claims, verdicts) take the chart's most-used card.
const caseIx = {};
function sumCases(t){
  if (caseIx[t]) return caseIx[t];
  const m = {}; (((window.SUMMARIES || {})[t] || {}).cases || []).forEach(k => (k.cards || []).forEach(id => (m[id] = m[id] || []).push(k)));
  return (caseIx[t] = m);
}
function chartCards(c){
  if (c._cc) return c._cc;
  const n = {}; catalog(c).nodes.forEach(x => (x.cards || []).forEach(id => { n[id] = (n[id] || 0) + 1; }));
  return (c._cc = Object.keys(n).filter(id => A.CASE[id]).sort((a, b) => n[b] - n[a]));
}
function caseOf(n, c){
  let ids = (n.cards || []).filter(id => A.CASE[id]);
  if (!ids.length) ids = chartCards(c).slice(0, 1);
  const m = sumCases(curT), score = new Map();
  ids.forEach(id => (m[id] || []).forEach(k => score.set(k, (score.get(k) || 0) + 1)));
  const sum = [...score.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || null;
  return { cards: ids.map(id => A.CASE[id]), sum };
}

/* ---------- state ---------- */
const S = () => A.state();
const curChart = () => ordered(curT).find(x => x.id === curId);
const mapRec = id => (S().maps = S().maps || {})[id] || { lvl: 0, b: 0, n: 0, due: 0, last: 0, acc: null };
const LEVELS = [0.3, 0.5, 1.0];
function gradeMap(id, frac, mode){
  const st = S(); st.maps = st.maps || {}; const r = Object.assign({}, mapRec(id));
  if (frac >= 0.8){ r.b = Math.min(5, r.b + 1); if (mode === "complete" || mode === "recall") r.lvl = Math.min(2, r.lvl + 1); }
  else if (frac >= 0.5) r.b = Math.max(1, r.b);
  else { r.b = 1; r.lvl = Math.max(0, r.lvl - 1); }
  r.n++; r.last = Date.now(); r.acc = Math.round(frac * 100);
  r.due = frac < 0.5 ? Date.now() + DAY : Date.now() + A.intervalDays(r.b) * DAY;
  st.maps[id] = r; A.touchDay(); A.save();
}
function markStudied(id){ const st = S(); st.maps = st.maps || {}; if (!st.maps[id]) { st.maps[id] = { lvl: 0, b: 0, n: 0, due: Date.now() + DAY, last: Date.now(), acc: null }; A.save(); } }

/* ---------- view state ---------- */
let mode = "overview", showAll = false, showCases = true, showHist = false, focus = 0, hidden = null, answers = null, curT = null, curId = null;
try { showAll = localStorage.getItem("cd-f2-all") === "1"; showCases = localStorage.getItem("cd-f2-cases") !== "0"; } catch(e){}

/* ---------- detail sheet ---------- */
function closeSheet(){ document.querySelectorAll(".fsheet,.fsheet-bg").forEach(x=>x.remove()); }
function sheet(...kids){
  closeSheet();
  const bg = el("div", { class: "fsheet-bg", onclick: closeSheet });
  const sh = el("div", { class: "fsheet", role: "dialog" }, el("div", { class: "fsheet-in" },
    el("div", { class: "row spread" }, el("span"), el("button", { class: "x", text: "✕", "aria-label": "Close", onclick: closeSheet })), ...kids));
  document.body.append(bg, sh); return sh;
}
function caseEl(n, c){
  const { cards, sum } = caseOf(n, c);
  if (!cards.length && !sum) return null;
  return el("div", { class: "csx" }, el("span", { class: "csh", text: "From your notes" }),
    sum ? el("b", { text: sum.name + (sum.when ? " (" + sum.when + ")" : "") }) : null,
    sum && sum.what ? el("p", { class: "wrote" }, sum.what, NOTMINE()) : null,
    sum && (sum.facts || []).length ? el("ul", {}, sum.facts.map(f => el("li", { text: f }))) : null,
    sum && sum.why ? el("p", { class: "cw", text: "Why it matters: " + sum.why }) : null,
    cards.map(k => el("details", { class: "evid", open: sum ? null : "" }, el("summary", { text: "Card: " + k.title + (k.when ? " · " + k.when : "") }), el("ul", {}, (k.pts || []).map(x => el("li", { text: x }))))));
}
function nodeSheet(n, c){
  const ids = caseOf(n, c).cards.map(k => k.id);
  const hs = (c.historians || []).filter(h => (h.nodes || []).includes(n.id));
  sheet(el("span", { class: "ftag2 " + typeCls(n), text: typeLabel(n) + (n.date ? " · " + n.date : "") }),
    el("b", { text: n.t }), n.d ? el("p", { text: n.d }) : null,
    (n.ev || []).length ? el("details", { class: "evid", open: "" }, el("summary", { text: `Evidence (${n.ev.length})` }), el("ul", {}, n.ev.map(x => el("li", { text: x })))) : null,
    hs.length ? el("div", { class: "hist" }, hs.map(h => el("div", {}, el("b", { text: h.who + ": " }), h.view))) : null,
    caseEl(n, c),
    n.go ? el("button", { class: "btn", style: "justify-self:start", text: "Open this chart →", onclick: () => { closeSheet(); open(curT, n.go); } }) : null,
    ids.length ? el("button", { class: "btn ghost", style: "justify-self:start", text: ids.length === 1 ? "Study this card" : `Study these ${ids.length} cards`, onclick: () => { closeSheet(); A.startLearn({ t: curT, sec: n.t, cards: ids.map(id => A.CASE[id]) }); } }) : null);
}
function linkSheet(l){
  sheet(el("span", { class: "ftag2", text: "Reagents and conditions" }),
    el("p", { class: "prop" }, el("b", { text: l.a.t }), el("span", { class: "lbl" + (NEG.has(l.label) ? " neg" : ""), text: ` ${l.label}${l.sub ? " (" + l.sub + ")" : ""} → ` }), el("b", { text: l.b.t })),
    el("div", { class: "explain" }, el("b", { text: "From your notes" }), l.how || ""));
}

/* ---------- answering hidden items ---------- */
function answerNode(n, c, box){
  const inp = el("input", { type: "text", placeholder: "What goes here? Type your answer", "aria-label": "Your answer", autocomplete: "off" });
  const reveal = el("button", { class: "btn", text: "Reveal", disabled: "" });
  const dunno = el("button", { class: "btn ghost", text: "I don't know" });
  inp.addEventListener("input", () => { reveal.disabled = !inp.value.trim(); });
  const body = el("div", { class: "casegroup" });
  const show = (typed) => {
    body.innerHTML = "";
    body.append(typed ? el("div", { class: "your", text: typed }) : null, el("b", { text: n.t }), n.d ? el("p", { text: n.d }) : null,
      el("div", { class: "row" }, el("button", { class: "btn ghost", text: "Missed it", onclick: () => done(false) }), el("button", { class: "btn", text: "Got it", onclick: () => done(true) })));
  };
  const done = ok => { answers.set(n.id, ok); closeSheet(); render(); };
  reveal.onclick = () => show(inp.value.trim()); dunno.onclick = () => show("");
  inp.addEventListener("keydown", e => { if (e.key === "Enter" && inp.value.trim()) show(inp.value.trim()); });
  body.append(inp, el("div", { class: "row" }, dunno, reveal));
  sheet(el("span", { class: "ftag2 " + typeCls(n), text: typeLabel(n) + (n.date ? " · " + n.date : "") }), el("div", { class: "hint", text: "Recall it before you look. The answer only shows after you commit." }), body);
  setTimeout(() => inp.focus(), 50);
}
function answerLink(l){
  const key = "L" + l.key;
  const head = el("p", { class: "prop" }, el("b", { text: l.a.t }), el("span", { class: "lbl", text: " — ? → " }), el("b", { text: l.b.t }));
  const body = el("div", { class: "casegroup" });
  const finish = ok => { answers.set(key, ok); closeSheet(); render(); };
  const result = (picked) => {
    body.innerHTML = "";
    const right = picked === undefined ? null : picked === l.label;
    body.append(el("p", { class: "prop" }, el("b", { text: l.a.t }), el("span", { class: "lbl" + (NEG.has(l.label) ? " neg" : ""), text: ` ${l.label} → ` }), el("b", { text: l.b.t })),
      l.how ? el("div", { class: "explain" }, el("b", { text: "From your notes" }), l.how) : null);
    if (right === null) body.append(el("div", { class: "row" }, el("button", { class: "btn ghost", text: "Missed it", onclick: () => finish(false) }), el("button", { class: "btn", text: "Got it", onclick: () => finish(true) })));
    else body.append(el("div", { class: right ? "ok" : "bad", text: right ? "Correct." : `You chose “${picked}”.` }), el("button", { class: "btn", text: "Continue", onclick: () => finish(right) }));
  };
  if (mode === "complete"){
    body.append(el("div", { class: "hint", text: "Which reagents and conditions?" }), el("div", { class: "chips" }, vocabOf(curChart(), l.label).map(v => el("button", { class: "chip", onclick: () => result(v) }, v))));
  } else {
    const inp = el("input", { type: "text", placeholder: "Reagents and conditions?", autocomplete: "off" });
    const rv = el("button", { class: "btn", text: "Reveal", disabled: "" });
    inp.addEventListener("input", () => { rv.disabled = !inp.value.trim(); }); rv.onclick = () => { const t = inp.value.trim(); result(); body.prepend(el("div", { class: "your", text: t })); };
    body.append(inp, el("div", { class: "row" }, el("button", { class: "btn ghost", text: "I don't know", onclick: () => result() }), rv));
  }
  sheet(el("span", { class: "ftag2", text: "Name the reagents" }), head, body);
}

/* ---------- choosing what to hide ---------- */
const PRIORITY = { product: 1, reactant: 2, judgement: 0, trigger: 1, long_term_cause: 2, short_term_cause: 3, turning_point: 4, consequence: 5, policy: 6, event: 7, actor: 8, interpretation: 9, context: 10, evidence: 11 };
function pickHidden(c, frac){
  const { nodes, links } = catalog(c);
  const rnd = () => Math.random() * 0.9;
  const ns = nodes.filter(n => !n.go).map(n => ({ k: n.id, s: (PRIORITY[n.type] ?? 8) + rnd() })).sort((a,b)=>a.s-b.s);
  const ls = links.map(l => ({ k: "L" + l.key, s: (PRIORITY[l.b.type] ?? 8) + rnd() })).sort((a,b)=>a.s-b.s);
  const take = (arr) => arr.slice(0, Math.max(1, Math.ceil(arr.length * frac))).map(x => x.k);
  return new Set([...take(ns), ...(links.length ? take(ls) : [])]);
}

/* ---------- layout (series-parallel; chains snake across the width) ---------- */
function cols(){ const W = $("#stage").clientWidth; return W >= 1000 ? 4 : W >= 560 ? 3 : 2; }
function nodeEl(n, c){
  const isHidden = hidden && hidden.has(n.id), ans = answers && answers.get(n.id);
  const hs = showHist ? (c.historians || []).filter(h => (h.nodes || []).includes(n.id)) : [];
  if (isHidden && ans === undefined)
    return el("button", { class: "n2 blank " + typeCls(n), onclick: () => answerNode(n, c) }, el("span", { class: "ntag", text: typeLabel(n) }), el("span", { class: "nq", text: "?" }));
  return el("button", { class: "n2 " + typeCls(n) + (n.go ? " go" : "") + (ans === true ? " right" : ans === false ? " wrong" : ""), onclick: () => nodeSheet(n, c) },
    el("span", { class: "ntag", text: typeLabel(n) + (n.date ? " · " + n.date : "") }),
    el("span", { class: "nt", text: n.t }),
    showAll && n.d && mode !== "recall" && mode !== "complete" ? el("span", { class: "nd", text: n.d }) : null,
    (n.ev || []).length && showAll && mode !== "recall" && mode !== "complete" ? el("span", { class: "nev", text: `+ ${n.ev.length} evidence` }) : null,
    n.go ? el("span", { class: "ngo", text: "Tap for details · open chart" }) : null,
    hs.length ? el("span", { class: "nhist" }, hs.map(h => el("span", { text: h.who }))) : null,
    caseStrip(n, c));
}
// The case-study facts that belong to one box: points from its cards and its summary case study,
// ranked by how many words, names and dates they share with the box, so each box shows its own evidence.
const STOP = new Set("the a an and or of to in on for by with as at from into its it is was were be that this than then but not their his her they had has have which who after before over under more most less only also all any each per via".split(" "));
const words = x => (String(x).toLowerCase().match(/[a-z0-9%’']+/g) || []).map(w => w.replace(/[’']s?$/, "")).filter(w => w.length > 2 && !STOP.has(w) || /\d/.test(w));
// A fact written as a chain ("A → B → C" between words, not numbers) is drawn as boxes and links, so it is not repeated as text.
const isChain = x => String(x).split("→").slice(0, -1).some((seg, i, all) => /[A-Za-z]{3,}\W*$/.test(seg) && /^\W*[A-Za-z]{3,}/.test(String(x).split("→")[i + 1]));
function caseFacts(n, c, max){
  if (!c._facts){
    // Score every case fact against every box, then give each fact to its one best box.
    const { nodes } = catalog(c), best = new Map();
    const all = new Set(words(nodes.map(m => [m.t, m.d || "", ...(m.ev || [])].join(" ")).join(" ")));
    nodes.forEach(m => {
      const { cards, sum } = caseOf(m, c), key = new Set(words(m.t + " " + (m.d || "") + " " + (m.date || "")));
      const own = (m.ev || []).concat(m.d || []).join(" ");
      const cand = []; cards.forEach(k => (k.pts || []).forEach(x => cand.push(x))); if (sum) (sum.facts || []).forEach(x => cand.push(x));
      cand.forEach(x => {
        if (isChain(x) || own.includes(x.trim())) return;
        const ws = new Set(words(x)); let sc = 0, wd = 0, cov = 0;
        ws.forEach(w => { if (all.has(w)) cov++; if (key.has(w)) { sc++; if (!/\d/.test(w)) wd++; } });
        // Skip facts the box already says, or the chart already shows elsewhere.
        if (ws.size && (sc / ws.size >= 0.5 || cov / ws.size > 0.7)) return;
        // A date or number alone is not a match: need two shared words.
        const cur = best.get(x); if (wd >= 2 && (!cur || sc > cur.sc)) best.set(x, { m, sc });
      });
    });
    const per = new Map(), same = (a, b) => { const A = new Set(words(a)), B = new Set(words(b)); let k = 0; A.forEach(w => { if (B.has(w)) k++; }); return k / Math.min(A.size, B.size || 1) > 0.6; };
    [...best.entries()].sort((a, b) => b[1].sc - a[1].sc).forEach(([x, o]) => { const l = per.get(o.m) || []; if (!l.some(y => same(y, x))) l.push(x); per.set(o.m, l); });
    c._facts = per;
  }
  return (c._facts.get(n) || []).slice(0, max);
}
// The case study most boxes in a stage belong to; recorded on each box so it need not repeat the name.
function stageCase(k, c){
  const nodes = [], walk = steps => steps.forEach(x => { if (x.link !== undefined) return; if (x.row) x.row.forEach(n => nodes.push(n)); else if (x.split) x.split.forEach(t => walk(t.steps || [])); else nodes.push(x); });
  walk(k.steps || []);
  const cnt = new Map();
  nodes.forEach(n => { const { cards, sum } = caseOf(n, c), name = sum ? sum.name : cards[0] && cards[0].title; if (!name) return;
    const o = cnt.get(name) || { name, when: sum ? sum.when : cards[0].when, n: 0 }; o.n++; cnt.set(name, o); });
  const top = [...cnt.values()].sort((a, b) => b.n - a.n)[0] || null;
  nodes.forEach(n => { n._stc = top ? top.name : null; });
  return top;
}
function caseStrip(n, c){
  if (mode === "recall" || mode === "complete") return null;
  const { cards, sum } = caseOf(n, c), k = cards[0];
  if (!k) return null;
  const more = cards.length - 1;
  if (showCases){
    const f = caseFacts(n, c, n.go ? 1 : 3);
    return el("span", { class: "ncase open" }, el("span", { class: "ncx" },
      el("span", { class: "ncs" }, "Card: ", el("b", { text: k.title }), k.when ? " · " + k.when : "", more > 0 ? ` +${more}` : ""),
      n.d && !showAll ? el("span", { class: "ncd", text: n.d }) : null,
      f.length ? el("ul", {}, f.map(x => el("li", { text: x }))) : null));
  }
  return el("span", { class: "ncase" }, el("span", {}, el("b", { text: k.title }), k.when ? " · " + k.when : "", more > 0 ? ` +${more}` : ""));
}
function group(steps){
  const out = []; let run = null, pending = null;
  for (const x of steps){
    if (x.link !== undefined){ pending = x; continue; }
    if (x.row){ out.push({ k: "row", nodes: x.row, links: x.links || [], inLink: pending }); run = null; }
    else if (x.split){ out.push({ k: "split", tracks: x.split, inLink: pending }); run = null; }
    else if (run){ run.nodes.push(x); run.links.push(pending); }
    else { run = { k: "run", nodes: [x], links: [null], inLink: pending }; out.push(run); }
    pending = null;
  }
  return out;
}
function seqEl(steps, c, C, specs){
  const wrap = el("div", { class: "s2" }); let first = null, prev = null;
  for (const bk of group(steps)){
    let res;
    if (bk.k === "run"){
      const n = bk.nodes.length, k = Math.min(C, n), g = el("div", { class: "g2", style: `grid-template-columns:repeat(${k},minmax(0,1fr))` });
      const els = bk.nodes.map((x, i) => { const r = Math.floor(i / k), col = r % 2 ? k - 1 - i % k : i % k, e = nodeEl(x, c); e.style.gridRow = r + 1; e.style.gridColumn = col + 1; g.append(e); return e; });
      for (let i = 1; i < n; i++) specs.push({ kind: Math.floor(i / k) === Math.floor((i - 1) / k) ? "h" : "v", a: els[i - 1], b: els[i], link: bk.links[i], na: bk.nodes[i - 1], nb: bk.nodes[i] });
      res = { node: g, entries: [els[0]], exits: [els[n - 1]], en: [bk.nodes[0]], xn: [bk.nodes[n - 1]] };
    } else if (bk.k === "row"){
      const many = bk.nodes.length > C, g = el("div", { class: "g2 fan" + (many ? " grp" : ""), style: `grid-template-columns:repeat(${Math.min(bk.nodes.length, C)},minmax(0,1fr))` });
      const els = bk.nodes.map(x => nodeEl(x, c)); g.append(...els);
      const node = el("div", {}, g, bk.links.length ? el("div", { class: "rlinks" }, bk.links.map(l => { const a = bk.nodes.find(n => n.id === l.from), b = bk.nodes.find(n => n.id === l.to); if (!a || !b) return null; const L = { a, b, label: l.label, sub: l.sub, how: l.how, key: "" }; return el("button", { class: "rl", onclick: () => linkSheet(L) }, `${a.t} `, el("i", { class: NEG.has(l.label) ? "neg" : "", text: `${l.label} →` }), ` ${b.t}`); })) : null);
      res = many ? { node, entries: [g], exits: [g], en: bk.nodes, xn: bk.nodes } : { node, entries: els, exits: els, en: bk.nodes, xn: bk.nodes };
    } else {
      const tr = bk.tracks, side = tr.length <= C, g = el("div", { class: "sp2" + (side ? "" : " grp"), style: `grid-template-columns:repeat(${side ? tr.length : C},minmax(0,1fr))` }), ent = [], ex = [], en = [], xn = [];
      // A track without a heading is a parallel branch: arrows run straight into its first box.
      for (const k of tr){ const h = k.h ? el("div", { class: "th2", text: k.h }) : null, sub = seqEl(k.steps || [], c, 1, specs); g.append(el("div", { class: "tr2" + (h ? "" : " nh") }, h, sub.node));
        if (h && sub.entries.length) specs.push({ kind: "bus", from: [h], to: sub.entries }); if (h) ent.push(h); else ent.push(...sub.entries); ex.push(...(sub.exits.length ? sub.exits : h ? [h] : [])); en.push(...sub.en); xn.push(...sub.xn); }
      res = side ? { node: g, entries: ent, exits: ex, en, xn } : { node: g, entries: [g], exits: [g], en, xn };
    }
    if (prev && bk.inLink) specs.push({ kind: "bus", from: prev.exits, to: res.entries, link: bk.inLink, na: prev.xn[0], nb: res.en[0] });
    else if (prev) specs.push({ kind: "bus", from: prev.exits, to: res.entries });
    wrap.append(res.node); first = first || res; prev = res;
  }
  return { node: wrap, entries: first ? first.entries : [], exits: prev ? prev.exits : [], en: first ? first.en : [], xn: prev ? prev.xn : [] };
}
function linkObj(c, na, nb, link){
  if (!link || !na || !nb) return null;
  return catalog(c).links.find(l => l.a === na && l.b === nb && l.label === link.link) || { a: na, b: nb, label: link.link, sub: link.sub, how: link.how, key: "" };
}
function draw(root, specs, c){
  root.querySelectorAll(":scope>.svg2,:scope>.pill2").forEach(x => x.remove());
  const R = root.getBoundingClientRect(); if (!R.width) return;
  const box = e => { const q = e.getBoundingClientRect(); return { l: q.left - R.left, r: q.right - R.left, t: q.top - R.top, b: q.bottom - R.top, cx: (q.left + q.right) / 2 - R.left, cy: (q.top + q.bottom) / 2 - R.top }; };
  let solid = "", dash = "", hs = "", hd = "", isNeg = false;
  const head = (x, y, d) => { const t = d === "d" ? `M${x-5},${y-7}L${x},${y}L${x+5},${y-7}Z` : d === "r" ? `M${x-7},${y-5}L${x},${y}L${x-7},${y+5}Z` : `M${x+7},${y-5}L${x},${y}L${x+7},${y+5}Z`; if (isNeg) hd += t; else hs += t; return ""; };
  // Elbow from (x1,y1) down to mid, across, down to (x2,y2), with rounded corners.
  const elbow = (x1, y1, x2, y2, mid) => { const dx = x2 - x1; if (Math.abs(dx) < 1) return `M${x1},${y1}V${y2}`; const r = Math.min(10, Math.abs(dx) / 2, (mid - y1), (y2 - mid)), sx = Math.sign(dx);
    return `M${x1},${y1}V${mid-r}Q${x1},${mid} ${x1+sx*r},${mid}H${x2-sx*r}Q${x2},${mid} ${x2},${mid+r}V${y2}`; };
  const pill = (L, x, y, maxW) => {
    if (!L) return;
    const hid = hidden && L.key && hidden.has("L" + L.key) && answers.get("L" + L.key) === undefined;
    const p = el("button", { class: "pill2" + (NEG.has(L.label) ? " neg" : "") + (hid ? " blank" : ""), onclick: () => hid ? answerLink(L) : linkSheet(L) }, hid ? "?" : L.label);
    p.style.left = x + "px"; p.style.top = y + "px"; if (maxW) p.style.maxWidth = maxW + "px"; root.append(p);
  };
  for (const s of specs){
    const L = s.link ? linkObj(c, s.na, s.nb, s.link) : null, neg = L && NEG.has(L.label);
    let d = ""; isNeg = !!neg;
    if (s.kind === "h"){ const a = box(s.a), b = box(s.b), y = (a.cy + b.cy) / 2;
      if (b.l >= a.r){ d += `M${a.r+3},${y}H${b.l-3}` + head(b.l - 3, y, "r"); pill(L, (a.r + b.l) / 2, y, b.l - a.r - 4); }
      else { d += `M${a.l-3},${y}H${b.r+3}` + head(b.r + 3, y, "l"); pill(L, (b.r + a.l) / 2, y, a.l - b.r - 4); } }
    else if (s.kind === "v"){ const a = box(s.a), b = box(s.b); d += `M${a.cx},${a.b+3}V${b.t-3}` + head(a.cx, b.t - 3, "d"); pill(L, a.cx, (a.b + b.t) / 2); }
    else { const E = s.from.map(box), N = s.to.map(box); if (!E.length || !N.length) continue;
      const yb = Math.max(...E.map(e => e.b)), yt = Math.min(...N.map(n => n.t)), mid = (yb + yt) / 2, xs = [...E.map(e => e.cx), ...N.map(n => n.cx)];
      if (E.length === 1 && N.length === 1 && Math.abs(E[0].cx - N[0].cx) < 6) d += `M${E[0].cx},${E[0].b+3}V${N[0].t-3}` + head(N[0].cx, N[0].t - 3, "d");
      else { E.forEach(e => N.forEach(n => { d += elbow(e.cx, e.b + 3, n.cx, n.t - 3, mid); })); N.forEach(n => head(n.cx, n.t - 3, "d")); }
      pill(L, (Math.min(...xs) + Math.max(...xs)) / 2, mid); }
    if (neg) dash += d; else solid += d;
  }
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"); svg.setAttribute("class", "svg2"); svg.setAttribute("width", R.width); svg.setAttribute("height", R.height);
  const p1 = document.createElementNS(NS, "path"); p1.setAttribute("d", solid); svg.append(p1);
  const p2 = document.createElementNS(NS, "path"); p2.setAttribute("d", dash); p2.setAttribute("class", "neg"); svg.append(p2);
  const p3 = document.createElementNS(NS, "path"); p3.setAttribute("d", hs); p3.setAttribute("class", "hd"); svg.append(p3);
  const p4 = document.createElementNS(NS, "path"); p4.setAttribute("d", hd); p4.setAttribute("class", "hd neg"); svg.append(p4);
  root.prepend(svg);
}
function diagram(c){
  const root = el("div", { class: "d2" }), specs = [], C = cols();
  const cl = c.clusters || [];
  let prevEx = null, prevXn = null;
  cl.forEach((k, i) => {
    const collapsed = mode === "study" && i !== focus;
    let panel, ent, ex, en, xn;
    if (collapsed){
      panel = el("button", { class: "cl2 col" + (i > focus ? " later" : ""), onclick: () => { focus = i; render(); } },
        el("span", { class: "cln", text: String(i + 1), "aria-label": `Stage ${i + 1}` }), el("b", { text: k.title }), i < focus && k.summary ? el("span", { class: "hint", text: k.summary }) : el("span", { class: "hint", text: i > focus ? "Tap to study this stage" : "" }));
      ent = ex = [panel]; en = xn = [null];
    } else {
      const stc = stageCase(k, c);
      const s = seqEl(k.steps || [], c, C, specs);
      panel = el("div", { class: "cl2" + (mode === "study" ? " focus" : "") }, el("div", { class: "clh" }, el("span", { class: "cln", text: String(i + 1), "aria-label": `Stage ${i + 1}` }), el("b", { text: k.title }), k.summary ? el("span", { class: "hint", text: k.summary }) : null,
        showCases && stc && (mode === "overview" || mode === "study") ? el("span", { class: "clcase" }, "Section: ", el("b", { text: stc.name }), stc.when ? " · " + stc.when : "") : null), s.node);
      ent = s.entries; ex = s.exits; en = s.en; xn = s.xn;
    }
    if (prevEx && c.kind !== "reactions") specs.push({ kind: "bus", from: [prevEx], to: [panel], link: k.link ? { link: k.link, sub: k.sub, how: k.how } : null, na: prevXn[0], nb: en[0] });
    root.append(panel); prevEx = panel; prevXn = xn;
  });
  const redraw = () => { if (root.isConnected) draw(root, specs, c); };
  requestAnimationFrame(redraw); if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
  if (window.ResizeObserver) new ResizeObserver(redraw).observe(root);
  return root;
}
function matrixEl(c){
  const M = c.matrix; if (!M) return null;
  const tbl = el("table", { class: "mx" }, el("thead", {}, el("tr", {}, el("th", { text: "" }), M.cols.map(h => el("th", { text: h })))),
    el("tbody", {}, M.rows.map((r, ri) => el("tr", {}, el("th", { text: r.h }), r.cells.map((v, ci) => {
      const k = "M" + ri + "_" + ci, hid = hidden && hidden.has(k) && answers.get(k) === undefined, a = answers && answers.get(k);
      return el("td", { class: hid ? "blank" : a === true ? "right" : a === false ? "wrong" : "", onclick: hid ? () => answerCell(k, r.h, M.cols[ci], v) : null }, hid ? "?" : v);
    })))));
  return el("div", { class: "mxw" }, tbl);
}
function answerCell(k, row, col, v){
  const inp = el("input", { type: "text", placeholder: "Your answer", autocomplete: "off" });
  const body = el("div", { class: "casegroup" });
  const show = t => { body.innerHTML = ""; body.append(t ? el("div", { class: "your", text: t }) : null, el("b", { text: v }),
    el("div", { class: "row" }, el("button", { class: "btn ghost", text: "Missed it", onclick: () => { answers.set(k, false); closeSheet(); render(); } }), el("button", { class: "btn", text: "Got it", onclick: () => { answers.set(k, true); closeSheet(); render(); } }))); };
  const rv = el("button", { class: "btn", text: "Reveal", disabled: "" }); inp.addEventListener("input", () => { rv.disabled = !inp.value.trim(); }); rv.onclick = () => show(inp.value.trim());
  body.append(inp, el("div", { class: "row" }, el("button", { class: "btn ghost", text: "I don't know", onclick: () => show("") }), rv));
  sheet(el("span", { class: "ftag2", text: `${col} · ${row}` }), body); setTimeout(() => inp.focus(), 50);
}

/* ---------- judge ---------- */
function judgeEl(c){
  const J = c.judge, { nodes } = catalog(c), byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const st = S(); st.judge = st.judge || {}; const saved = st.judge[c.id];
  let order = (saved && saved.rank && saved.rank.filter(id => byId[id]).length === J.factors.filter(id => byId[id]).length ? saved.rank : J.factors).filter(id => byId[id]);
  const list = el("ol", { class: "rank" });
  const paint = () => { list.innerHTML = ""; order.forEach((id, i) => list.append(el("li", {}, el("span", { class: "rk", text: String(i + 1) }), el("span", { class: "rt" }, el("b", { text: byId[id].t }), el("span", { class: "hint", text: typeLabel(byId[id]) })),
    el("span", { class: "rb" }, el("button", { class: "x", "aria-label": "Move up", text: "▲", disabled: i === 0 ? "" : null, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; paint(); } }),
      el("button", { class: "x", "aria-label": "Move down", text: "▼", disabled: i === order.length - 1 ? "" : null, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; paint(); } }))))); };
  paint();
  const ta = el("textarea", { class: "jt", placeholder: "Justify your top factor in ≤ 40 words. Use a counterfactual: without it, would the outcome still have happened?" }); ta.value = (saved && saved.text) || "";
  const wc = el("span", { class: "hint" }); const upd = () => { const n = ta.value.trim().split(/\s+/).filter(Boolean).length; wc.textContent = `${n} / 40 words`; wc.style.color = n > 40 ? "var(--red)" : ""; }; ta.addEventListener("input", upd); upd();
  const cf = el("div", { class: "hint" }); const updCf = () => { cf.textContent = order[0] ? `Counterfactual: without “${byId[order[0]].t}”, would the outcome still have happened?` : ""; }; updCf();
  const model = el("div", {});
  const save = el("button", { class: "btn", text: "Save my judgement", onclick: () => {
    st.judge[c.id] = { rank: order.slice(), text: ta.value.trim(), at: Date.now() }; A.touchDay(); A.save();
    model.innerHTML = ""; model.append(el("div", { class: "explain" }, el("b", { text: "What your notes conclude" }), J.notes_view || "Your notes don't rank these factors, so the judgement is yours. Check it against your lecture slides."));
  } });
  list.addEventListener("click", updCf);
  return el("div", { class: "casegroup judge" }, el("h3", { text: J.prompt }), el("div", { class: "hint", text: "Rank the factors: most important at the top." }), list, cf, ta, el("div", { class: "row spread" }, wc, save), model,
    saved ? el("div", { class: "hint", text: `Last saved ${new Date(saved.at).toLocaleDateString()}` }) : null);
}

/* ---------- explain prompts ---------- */
function explainPrompts(c){
  const L = catalog(c).links.filter(l => l.how);
  if (!L.length) return null;
  const pick = L.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(3, L.length));
  const wrap = el("div", { class: "casegroup" }, el("b", { text: "Recall the conditions" }), el("div", { class: "hint", text: "Say or type the reagents and conditions for each reaction, then compare with your notes." }));
  pick.forEach(l => {
    const ta = el("textarea", { class: "jt", placeholder: "Reagents and conditions…" }), out = el("div", {});
    wrap.append(el("div", { class: "xq" }, el("p", { class: "prop" }, el("b", { text: l.a.t }), el("span", { class: "lbl", text: " — ? → " }), el("b", { text: l.b.t })), ta,
      el("button", { class: "btn ghost", text: "Compare with my notes", onclick: () => { out.innerHTML = ""; out.append(el("div", { class: "explain" }, el("b", { text: "Your notes" }), l.how),
        el("div", { class: "row" }, ["Missed it", "Partly", "Got it"].map((t, i) => el("button", { class: "btn ghost", text: t, onclick: () => { A.grade("link:" + curT + ":" + l.key, [0, 0.6, 1][i]); out.append(el("div", { class: "hint", text: "Saved to your link reviews." })); } })))); } }), out));
  });
  return wrap;
}

/* ---------- page ---------- */
function open(t, id, m){
  curT = t; const list = ordered(t), i = Math.max(0, list.findIndex(c => c.id === id)), c = list[i]; curId = c.id;
  if (m) mode = m; if (mode === "judge" && !c.judge) mode = "overview";
  if (mode === "complete" || mode === "recall"){
    const lv = mode === "recall" ? 1.0 : LEVELS[Math.min(mapRec(c.id).lvl, 1)];
    if (!hidden || hidden._for !== c.id + mode){ hidden = c.kind === "matrix" ? pickCells(c, lv) : pickHidden(c, lv); hidden._for = c.id + mode; answers = new Map(); }
  } else { hidden = null; answers = new Map(); }
  if (mode === "study"){ markStudied(c.id); if (focus >= (c.clusters || []).length) focus = 0; }
  render();
}
function pickCells(c, frac){ const ks = []; c.matrix.rows.forEach((r, ri) => r.cells.forEach((v, ci) => ks.push("M" + ri + "_" + ci))); return new Set(ks.sort(() => Math.random() - 0.5).slice(0, Math.max(1, Math.ceil(ks.length * frac)))); }
function render(){
  const t = curT, list = ordered(t), i = list.findIndex(c => c.id === curId), c = list[i];
  const s = A.openSession(`${i + 1} / ${list.length}`, true); closeSheet();
  $("#pfill").style.width = (100 * (i + 1) / list.length) + "%";
  const chain = []; for (let p = c.parent; p;){ const pc = list.find(x => x.id === p); if (!pc) break; chain.unshift(pc); p = pc.parent; }
  const modes = [["overview", "Map"], ["study", "Study"], ["complete", "Complete"], ["recall", "Recall"]].concat(c.judge ? [["judge", "Judge"]] : []);
  const mbar = el("div", { class: "mbar", role: "tablist" }, modes.map(([k, l]) => el("button", { role: "tab", "aria-selected": String(mode === k), onclick: () => { focus = 0; open(t, c.id, k); } }, l)));
  const rec = mapRec(c.id);
  const help = { overview: "The whole map. Tap a box for its card, or a reagent label for the exact line in your notes.", study: "One stage at a time. Read it, then move on. Finish with Complete or Recall.",
    complete: `Fill in the blanks (${Math.round(LEVELS[Math.min(rec.lvl, 1)] * 100)}% hidden). Gets harder as you improve.`, recall: "Rebuild the whole map from memory: every box and link is hidden.", judge: "Weigh the factors and write your judgement." }[mode];
  const tools = el("div", { class: "ftools" }, el("span", { text: help }),
    (mode === "overview" || mode === "study") ? el("span", { class: "row", style: "gap:8px" },
      el("button", { class: "linkbtn", style: "font-size:12.5px", text: showAll ? "Hide details" : "Show all details", onclick: () => { showAll = !showAll; try { localStorage.setItem("cd-f2-all", showAll ? "1" : "0"); } catch(e){} render(); } }),
      el("button", { class: "linkbtn", style: "font-size:12.5px", text: showCases ? "Hide card details" : "Show card details", onclick: () => { showCases = !showCases; try { localStorage.setItem("cd-f2-cases", showCases ? "1" : "0"); } catch(e){} render(); } }),
      (c.historians || []).length ? el("button", { class: "linkbtn", style: "font-size:12.5px", text: showHist ? "Hide historians" : "Show historians", onclick: () => { showHist = !showHist; render(); } }) : null) : null);
  let body;
  if (mode === "judge") body = judgeEl(c);
  else body = el("div", { class: "casegroup" }, c.kind === "matrix" ? matrixEl(c) : null, (c.clusters || []).length ? diagram(c) : null);
  // progress through blanks
  let status = null;
  if (hidden){
    const total = hidden.size, done = [...hidden].filter(k => answers.has(k)).length, right = [...hidden].filter(k => answers.get(k) === true).length;
    status = el("div", { class: "qstat" }, el("span", { text: `${done} / ${total} answered · ${right} right` }),
      done === total ? el("button", { class: "btn", text: "Finish and save", onclick: () => { gradeMap(c.id, total ? right / total : 1, mode); finishCard(c, right, total); } }) : el("span", { class: "hint", text: "Tap each ? to answer" }));
  }
  const studyNav = mode === "study" ? el("div", { class: "row spread qstat" },
    el("button", { class: "btn ghost", text: "← Stage", disabled: focus === 0 ? "" : null, onclick: () => { focus--; render(); } }),
    el("span", { text: `Stage ${focus + 1} of ${(c.clusters || []).length || 1}` }),
    focus < (c.clusters || []).length - 1 ? el("button", { class: "btn", text: "Next stage →", onclick: () => { focus++; render(); } })
      : el("button", { class: "btn", text: "Now test yourself →", onclick: () => open(t, c.id, rec.lvl >= 2 ? "recall" : "complete") })) : null;
  s.append(...[el("div", { class: "fhead" },
      chain.length ? el("div", { class: "fcrumb" }, chain.flatMap(p => [el("button", { onclick: () => open(t, p.id, "overview") }, p.title.replace(/^SEA economic change: /, "").replace(/^Cluster: /, "")), el("span", { text: "›" })])) : el("div", { class: "eyebrow", text: A.TOPIC[t].name }),
      el("span", { class: "flvl", text: c.kind === "reactions" ? "Reaction map" : ["Whole topic", "Cluster", "Country", "Detail"][c.level ?? (c._depth >= 3 ? 3 : c._depth === 1 ? 1 : 3)] || "Detail" }),
      el("h2", {}, c.title, c.kind === "reactions" ? NOTMINE() : null),
      c.kind === "reactions" && mode !== "recall" ? el("p", { class: "hint" }, "Box names and reagents are checked against your notes, and each arrow opens the exact line it came from. The map and stage titles are written for this app.") : null, c.question ? el("p", { class: "fq", text: "Answers: " + c.question }) : null, c.intro && mode !== "recall" ? el("p", { text: c.intro }) : null,
      rec.n ? el("span", { class: "hint", text: `Last recall ${rec.acc}% · next review ${new Date(rec.due).toLocaleDateString()}` }) : null),
    mbar, tools, studyNav, status, body,
    mode === "overview" && (c.takeaways || []).length ? el("div", { class: "fshow explain" }, el("b", { text: "What this shows" }), el("ul", {}, c.takeaways.map(x => el("li", { text: x })))) : null,
    mode === "overview" ? el("div", { class: "hint", style: "text-align:center" }, "Looking is the weakest way to learn a map. Try ", el("button", { class: "linkbtn", text: "Recall", onclick: () => open(t, c.id, "recall") }), " next.") : null,
    keyEl()].filter(Boolean));
  if (list.length === 1) A.setActions(el("button", { class: "btn ghost", text: "Close", onclick: () => $("#closesession").click() }), (window.SUMMARIES || {})[t] ? el("button", { class: "btn", text: "Read summary", onclick: () => A.openSummary(t) }) : null);
  else A.setActions(i > 0 ? el("button", { class: "btn ghost", text: "← Previous", onclick: () => { focus = 0; open(t, list[i - 1].id, "overview"); } }) : el("button", { class: "btn ghost", text: "All charts", onclick: () => listPage(t) }),
    i < list.length - 1 ? el("button", { class: "btn", text: "Next →", onclick: () => { focus = 0; open(t, list[i + 1].id, "overview"); } }) : el("button", { class: "btn", text: "All charts", onclick: () => listPage(t) }));
}
function finishCard(c, right, total){
  const s = $("#stage"), r = mapRec(c.id);
  s.prepend(el("div", { class: "explain" }, el("b", { text: `You got ${right} / ${total}` }),
    `Next review: ${new Date(r.due).toLocaleDateString()}. ${r.lvl >= 2 ? "Next time: full recall." : "Next time: more blanks."}`));
  const ex = explainPrompts(c); if (ex) s.append(ex);
  hidden = null; s.scrollIntoView({ block: "start" }); $("#sbody").scrollTop = 0;
}
function keyEl(){
  const k = [["t-long", "Reactant"], ["t-cons pos", "Product"]];
  return el("details", { class: "fkey" }, el("summary", { text: "Colour key" }),
    el("ul", {}, k.map(([cls, l]) => el("li", {}, el("i", { class: "sw " + cls }), el("span", { text: l })))),
    el("div", { class: "hint", style: "font-size:12px;margin-top:6px" }, "Every box names its type at the top and the card it comes from at the bottom (tap for the full card). Each arrow is labelled with the reagents and conditions from your notes."));
}
function listPage(t){
  curT = t; const list = ordered(t), s = A.openSession("Reaction maps", true);
  const due = list.filter(c => { const r = mapRec(c.id); return r.n || r.last ? r.due <= Date.now() : false; });
  s.append(el("div", { class: "fhead" }, el("div", { class: "eyebrow", text: `${A.TOPIC[t].paper} · ${A.TOPIC[t].theme} · Reaction maps` }), el("h2", { text: A.TOPIC[t].name }),
      el("p", { text: `${list.length} reaction map${list.length > 1 ? "s" : ""}. Study it once, then Complete, then Recall on later days.` }),
      due.length ? el("button", { class: "btn", style: "justify-self:start", text: `Recall ${due.length} due map${due.length > 1 ? "s" : ""}`, onclick: () => open(t, due[0].id, mapRec(due[0].id).lvl >= 2 ? "recall" : "complete") }) : null),
    el("div", { class: "casegroup" }, list.map((c, i) => { const d = Math.min(c._depth || 0, 3), r = mapRec(c.id);
      return el("button", { class: "mode", style: `margin-left:${d * 14}px`, onclick: () => { focus = 0; open(t, c.id, "overview"); } }, el("span", { class: "ic", text: String(i + 1) }),
        el("span", {}, el("span", { class: "flvl", text: c.kind === "reactions" ? "Reaction map" : c.kind === "matrix" ? "Table" : c.kind === "argument" ? "Argument" : ["Whole topic", "Cluster", "Country", "Detail"][c.level ?? (d === 1 ? 1 : 3)] }), el("b", { style: "display:block;margin-top:3px", text: c.title }),
          r.n ? el("span", { class: "hint", text: `Recall ${r.acc}% · due ${new Date(r.due).toLocaleDateString()}` }) : r.last ? el("span", { class: "hint", text: "Studied · recall due " + new Date(r.due).toLocaleDateString() } ) : null),
        el("span", { class: "go", text: "Open" })); })));
  A.setActions(el("button", { class: "btn ghost", text: "Close", onclick: () => $("#closesession").click() }), (window.SUMMARIES || {})[t] ? el("button", { class: "btn", text: "Read summary", onclick: () => A.openSummary(t) }) : null);
}

/* ---------- link review items (spaced, interleaved across topics) ---------- */
function linkIndex(){
  const out = {};
  for (const t of Object.keys(window.FLOWS2 || {})) for (const c of charts(t)) { if (!mapRec(c.id).last) continue; for (const l of catalog(c).links) if (l.how) out["link:" + t + ":" + l.key] = { t, c, l }; }
  return out;
}
function linkKeys(topicsOn){ const ix = linkIndex(); return Object.keys(ix).filter(k => !topicsOn || topicsOn.has(ix[k].t)); }
function linkCard(key, next){
  const ix = linkIndex(), it = ix[key]; if (!it){ next(key, 1); return; }
  const { l, c, t } = it, q = (key.length + l.a.t.length) % 3;
  const s = A.stageClear();
  const prompt = q === 0 ? el("p", { class: "prop big" }, el("b", { text: l.a.t }), el("span", { class: "lbl" + (NEG.has(l.label) ? " neg" : ""), text: ` ${l.label} → ` }), el("b", { text: "?" }))
    : q === 1 ? el("p", { class: "prop big" }, el("b", { text: "?" }), el("span", { class: "lbl" + (NEG.has(l.label) ? " neg" : ""), text: ` ${l.label} → ` }), el("b", { text: l.b.t }))
    : el("p", { class: "prop big" }, el("b", { text: l.a.t }), el("span", { class: "lbl", text: " — ? → " }), el("b", { text: l.b.t }), el("span", { class: "hint", style: "display:block", text: "Which reagents and conditions?" }));
  const ta = el("textarea", { placeholder: "Answer from memory", "aria-label": "Your answer" }); ta.style.minHeight = "20vh";
  s.append(el("div", { class: "meta" }, el("span", { class: "eyebrow", text: `${A.TOPIC[t].name} · ${c.title}` }), el("span", { class: "box", text: "Link" })), prompt, ta);
  const reveal = () => {
    const s2 = A.stageClear();
    s2.append(el("div", { class: "meta" }, el("span", { class: "eyebrow", text: `${A.TOPIC[t].name} · ${c.title}` })),
      el("p", { class: "prop big" }, el("b", { text: l.a.t }), el("span", { class: "lbl" + (NEG.has(l.label) ? " neg" : ""), text: ` ${l.label} → ` }), el("b", { text: l.b.t })),
      ta.value.trim() ? el("div", { class: "your", text: ta.value.trim() }) : null, el("div", { class: "explain" }, el("b", { text: "From your notes" }), l.how || ""));
    A.setActions(...["Missed it", "Partly", "Got it"].map((x, i) => el("button", { class: i === 2 ? "btn" : "btn ghost", text: x, onclick: () => next(key, [0, 0.6, 1][i]) })));
  };
  A.setActions(el("button", { class: "btn ghost", text: "I don't know", onclick: reveal }), el("button", { class: "btn", text: "Check", onclick: reveal }));
}
function dueMaps(topicsOn){
  const out = [];
  for (const t of Object.keys(window.FLOWS2 || {})) { if (topicsOn && !topicsOn.has(t)) continue; for (const c of charts(t)) { const r = mapRec(c.id); if (r.last && r.due <= Date.now()) out.push({ t, c, r }); } }
  return out.sort((a, b) => a.r.due - b.r.due);
}
function progressCard(){
  const st = S(), maps = st.maps || {}, ix = linkIndex();
  const weak = Object.entries(st.cards || {}).filter(([k, r]) => k.startsWith("link:") && r.n && (r.score ?? 100) < 60 && ix[k]).sort((a, b) => (a[1].score || 0) - (b[1].score || 0)).slice(0, 6);
  const rows = Object.keys(window.FLOWS2 || {}).map(t => { const cs = charts(t), done = cs.filter(c => maps[c.id] && maps[c.id].n), acc = done.length ? Math.round(done.reduce((s, c) => s + (maps[c.id].acc || 0), 0) / done.length) : null;
    return el("div", { class: "topicrow" }, el("span", { text: A.TOPIC[t].name + " maps" }), el("span", { class: "num", text: `${done.length}/${cs.length} recalled · avg ${acc ?? "–"}%` })); });
  return el("div", { class: "card" }, el("h2", { style: "font-size:18px", text: "Reaction-map recall" }), rows,
    weak.length ? el("div", {}, el("div", { class: "eyebrow", text: "Weakest links" }), el("ul", { style: "margin:0;padding-left:20px" }, weak.map(([k, r]) => { const { l } = ix[k]; return el("li", {}, `${l.a.t} ${l.label} ${l.b.t} · ${r.score}%`); }))) : el("span", { class: "hint", text: "Weak links will show here once you've reviewed some." }));
}

window.FLOW2 = { has: t => charts(t).length > 0, ordered, open, listPage, linkKeys, linkCard, dueMaps, progressCard, closeSheet, catalog };
})();
