// build_docx.js -- render a verified .notes spec into a formatted .docx
// Usage: node build_docx.js <spec.notes> <out.docx> [--report path/to/spec.verify.json]
// Refuses to build unless verify_notes.py has PASSED on this exact spec (sha256 match).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, AlignmentType, LevelFormat, PageBreak,
} = require("docx");

const args = process.argv.slice(2);
let reportPath = null;
const ri = args.indexOf("--report");
if (ri >= 0) { reportPath = args[ri + 1]; args.splice(ri, 2); }
if (args.length !== 2) { console.error("usage: node build_docx.js <spec.notes> <out.docx> [--report r.json]"); process.exit(2); }
const [specPath, outPath] = args;
const specBuf = fs.readFileSync(specPath);
reportPath = reportPath || specPath.replace(/\.notes$/, "") + ".verify.json";

// ---------- anti-hallucination gate ----------
if (!fs.existsSync(reportPath)) { console.error(`REFUSING TO BUILD: no verification report at ${reportPath}. Run verify_notes.py first.`); process.exit(1); }
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const sha = crypto.createHash("sha256").update(specBuf).digest("hex");
if (report.spec_sha256 !== sha) { console.error("REFUSING TO BUILD: spec changed since it was verified. Re-run verify_notes.py."); process.exit(1); }
if (report.status !== "PASS") { console.error(`REFUSING TO BUILD: verification status is ${report.status}.`); process.exit(1); }

const PORTRAIT_W = 9026, LANDSCAPE_W = 13958;

// ---------- inline markup: **bold**, _x / _{..} subscript, ^x / ^{..} superscript ----------
function runs(s, base = {}) {
  const out = [];
  const re = /\*\*(.+?)\*\*|_\{([^}]*)\}|_([A-Za-z0-9+\-−–])|\^\{([^}]*)\}|\^([A-Za-z0-9+\-−–⦵‡])/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(new TextRun({ text: s.slice(last, m.index), ...base }));
    if (m[1] !== undefined) out.push(...runs(m[1], { ...base, bold: true }));
    else if (m[2] !== undefined || m[3] !== undefined) out.push(new TextRun({ text: m[2] ?? m[3], subScript: true, ...base }));
    else out.push(new TextRun({ text: m[4] ?? m[5], superScript: true, ...base }));
    last = re.lastIndex;
  }
  if (last < s.length) out.push(new TextRun({ text: s.slice(last), ...base }));
  return out.length ? out : [new TextRun({ text: "", ...base })];
}

const CITE = /\s*@((?:L\d+(?:-\d+)?)(?:,L\d+(?:-\d+)?)*)\s*$/;
function stripCite(s) { const m = s.match(CITE); return m ? [s.slice(0, m.index), m[1]] : [s, null]; }
function citeRun(c) {
  return new TextRun({ text: `   [src ${c.replace(/L/g, "L").replace(/-/g, "–")}]`, size: 16, color: "8C8C8C", italics: true });
}

// ---------- block helpers (styles inherited from the approved H2 History template) ----------
const H = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };
function heading(level, text, cite) {
  const children = runs(text);
  if (cite) children.push(citeRun(cite));
  return new Paragraph({ children, heading: H[level] });
}
function para(text) { return new Paragraph({ children: runs(text), spacing: { after: 120 } }); }
function bullet(text, level) { return new Paragraph({ children: runs(text), numbering: { reference: "bullet-list", level }, spacing: { after: 80 } }); }
function check(text) { return new Paragraph({ children: runs(text), numbering: { reference: "checkbox-list", level: 0 }, spacing: { after: 80 } }); }
function quote(text) {
  return new Paragraph({
    children: runs(text, { italics: true }), indent: { left: 400 },
    shading: { type: ShadingType.CLEAR, color: "auto", fill: "EAF1FB" },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: "2E5395", space: 8 } },
    spacing: { before: 100, after: 160 },
  });
}
function equation(text) {
  return new Paragraph({ children: runs(text, { font: "Cambria Math" }), alignment: AlignmentType.CENTER, spacing: { before: 80, after: 120 } });
}
function callout(icon, label, text, fill, edge) {
  return new Paragraph({
    children: [new TextRun({ text: `${icon} ${label}: `, bold: true, size: 20 }), ...runs(text, { size: 20 })],
    shading: { type: ShadingType.CLEAR, color: "auto", fill },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: edge, space: 8 } },
    indent: { left: 200 }, spacing: { before: 80, after: 140 },
  });
}
function makeTable(rows, totalW) {
  const ncol = Math.max(...rows.map(r => r.length));
  const first = Math.round(totalW * (ncol >= 3 ? 0.22 : 0.3));
  const rest = Math.floor((totalW - first) / (ncol - 1));
  const w = [first, ...Array(ncol - 1).fill(rest)];
  const mk = (txt, i, hdr, shade) => new TableCell({
    children: txt.split(" // ").map(t => new Paragraph({ children: runs(t, hdr ? { bold: true, color: "FFFFFF" } : {}) })),
    width: { size: w[i], type: WidthType.DXA },
    shading: hdr ? { type: ShadingType.CLEAR, color: "auto", fill: "2E5395" } : shade ? { type: ShadingType.CLEAR, color: "auto", fill: shade } : undefined,
    verticalAlign: hdr ? "center" : "top",
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
  return new Table({
    width: { size: w.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: w,
    rows: rows.map((r, ri) => {
      while (r.length < ncol) r.push("");
      return new TableRow({ tableHeader: ri === 0, children: r.map((c, i) => mk(c, i, ri === 0, ri % 2 === 0 && ri > 0 ? "F2F2F2" : null)) });
    }),
  });
}
function hr() { return new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "AAAAAA", space: 1 } }, spacing: { after: 200 } }); }

// ---------- parse spec ----------
const meta = {};
const sections = [{ landscape: false, children: [] }];
const cur = () => sections[sections.length - 1];
function push(el, landscape = false) {
  if (cur().landscape !== landscape) sections.push({ landscape, children: [] });
  cur().children.push(el);
}
let tableBuf = [];
function flushTable() {
  if (!tableBuf.length) return;
  const rows = tableBuf.map(l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
  const ncol = Math.max(...rows.map(r => r.length));
  const land = ncol >= 5;
  push(makeTable(rows, land ? LANDSCAPE_W : PORTRAIT_W), land);
  push(new Paragraph({ text: "" }), land);
  tableBuf = [];
}

const lines = specBuf.toString("utf8").split(/\r?\n/);
const body = [];
for (const raw of lines) {
  const st = raw.trim();
  if (!st.startsWith("|")) flushTable();
  if (!st || st.startsWith("//")) continue;
  if (st.startsWith("meta:")) { const m = st.slice(5).match(/^\s*(\w+)\s*=\s*(.*)$/); if (m) meta[m[1]] = m[2]; continue; }
  const indent = raw.match(/^ */)[0].length;
  const [txt, cite] = stripCite(st);
  let m;
  if ((m = txt.match(/^(#{1,4}) (.*)$/))) push(heading(m[1].length, m[2], cite));
  else if (txt.startsWith("|")) tableBuf.push(txt);
  else if (txt.startsWith("! ")) push(callout("⚠", "Not reproduced from source", txt.slice(2), "FFF4CE", "C99A00"));
  else if (txt.startsWith("? ")) push(callout("✎", "Left blank in lecture notes", txt.slice(2), "EDEDED", "7F7F7F"));
  else if (txt.startsWith("[] ")) push(check(txt.slice(3)));
  else if (txt.startsWith("> ")) push(quote(txt.slice(2)));
  else if (txt.startsWith("= ")) push(equation(txt.slice(2)));
  else if (txt.startsWith("- ")) push(bullet(txt.slice(2), indent >= 2 ? 1 : 0));
  else push(para(txt));
}
flushTable();

// ---------- title page + fidelity statement ----------
const sourceName = meta.source || report.source;
const title = [
  new Paragraph({ children: [new TextRun({ text: meta.course || "H2 Chemistry (9476)", bold: true, size: 32 })], alignment: AlignmentType.CENTER, spacing: { before: 400, after: 100 } }),
  new Paragraph({ children: runs(meta.title || "Study Notes", { bold: true, size: 40, color: "2E5395" }), alignment: AlignmentType.CENTER, spacing: { after: 100 } }),
  new Paragraph({ children: runs(meta.subtitle || "Comprehensive Study Notes", { size: 26, italics: true }), alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
  new Paragraph({ children: [new TextRun({ text: `Compiled from: ${sourceName}`, italics: true, size: 20, color: "555555" })], alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
  new Paragraph({ children: [new TextRun({ text: "How to read these notes", bold: true, size: 22 })], spacing: { after: 80 } }),
  bullet("Every line was machine-checked against the lecture notes text; [src L…] tags give the line range of the source text it came from.", 0),
  bullet("Amber ⚠ boxes mark diagrams, structures, graphs or garbled formulae that could not be reproduced faithfully from the text — look them up in the original PDF.", 0),
  bullet("Numbers, equations and data are reproduced exactly as they appear in the lecture notes, even where they look unusual — they are never \"corrected\" from outside knowledge. Where the notes seem internally inconsistent, an ⚠ box says so.", 0),
  bullet("Grey ✎ boxes mark answers the lecture notes leave blank for you to fill in. They are deliberately NOT answered here.", 0),
  new Paragraph({ children: [new PageBreak()] }),
];
sections[0].children.unshift(...title);
const fidelity = [
  hr(),
  new Paragraph({ children: [new TextRun({ text: "Source-fidelity statement", bold: true })], spacing: { after: 80 } }),
  new Paragraph({ children: [new TextRun({ italics: true, size: 20, text:
    `Compiled entirely from "${sourceName}". No external content has been added. ` +
    `Automated verification: ${report.checked_lines} content lines checked against the source text, 0 failures ` +
    `(every number, formula and ≥85% of content words traced to the cited source lines); ` +
    `${report.gaps} items flagged as not reproducible from text; ${report.blanks} lecture blanks left unanswered. ` +
    `Source text SHA-256 ${report.source_sha256.slice(0, 12)}…, notes spec SHA-256 ${report.spec_sha256.slice(0, 12)}….` })] }),
];
if (cur().landscape) sections.push({ landscape: false, children: [] });
cur().children.push(...fidelity);

const doc = new Document({
  creator: "H2 Chemistry study-notes builder",
  title: meta.title || "Study Notes",
  numbering: { config: [
    { reference: "bullet-list", levels: [
      { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } },
      { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 260 } } } } ] },
    { reference: "checkbox-list", levels: [
      { level: 0, format: LevelFormat.BULLET, text: "☐", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } } ] },
  ] },
  styles: {
    default: { document: { run: { font: "Calibri", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, color: "1F3864", font: "Calibri" },
        paragraph: { spacing: { before: 300, after: 150 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1F3864", space: 4 } } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, color: "2E5395", font: "Calibri" }, paragraph: { spacing: { before: 240, after: 120 } } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 23, bold: true, italics: true, color: "44546A", font: "Calibri" }, paragraph: { spacing: { before: 200, after: 100 } } },
      { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, color: "595959", font: "Calibri" }, paragraph: { spacing: { before: 160, after: 80 } } },
    ],
  },
  sections: sections.filter(s => s.children.length).map(s => ({
    properties: { page: {
      size: { width: 11906, height: 16838, orientation: s.landscape ? "landscape" : "portrait" },
      margin: s.landscape ? { top: 1080, bottom: 1080, left: 1080, right: 1080 } : { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    children: s.children,
  })),
});
Packer.toBuffer(doc).then(buf => { fs.writeFileSync(outPath, buf); console.log(`built ${outPath} (${buf.length} bytes)`); });
