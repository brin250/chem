---
name: h2-chemistry-study-notes
description: Create comprehensive H2 Chemistry study notes as a formatted Word (.docx) document from lecture notes the user has uploaded (Raffles Institution Year 5/6 H2 Chemistry lecture packs). Use whenever the user asks for study notes, revision notes, a study guide or "comprehensive study material" from uploaded H2 Chemistry lecture notes (PDF or PDF-converted .txt) — even if they don't say "Word document". Also use to update, extend or restyle previously generated H2 Chemistry notes. Do NOT use for other subjects (History/Physics/Math/GP) or for content not sourced from the user's own uploaded materials.
---

# H2 Chemistry Study Notes

Produces one consistently formatted .docx study guide per lecture topic, built ONLY from the
user's uploaded lecture notes, with an automated verification gate that blocks the build if any
line cannot be traced back to the source.

## Hard rule: source fidelity (zero outside knowledge)

Only use material explicitly present in the uploaded lecture notes. Never fill gaps from general
chemistry knowledge, however confident you are. If a fact, value, mechanism, explanation or
answer is not in the file, it does not go in the notes. If no relevant file is present, say so and
ask for it instead of proceeding.

## Anti-hallucination measures (all mandatory)

1. **Line-cited spec, not free prose.** Notes are written as a `.notes` spec (format below). Every
   heading carries an `@Lx-y` citation to the source-text line range it was compiled from; any line
   may override with its own `@L…`. Read the source with line numbers
   (`awk 'NF{print NR": "$0}' source.txt`) so citations are exact.
2. **Automated verification gate** — `scripts/verify_notes.py` checks every content line against
   its cited source lines (± 25 lines):
   - every number / formula / charge token must appear in the cited lines → stops invented data,
     "corrected" values (e.g. 22.4 vs the notes' 22.7), and computed answers;
   - ≥ 85 % of content words must appear in the cited lines → stops statements stitched together
     from elsewhere, and catches reversed meanings that use words from other sections;
   - more than one word that never occurs anywhere in the source → FAIL (imported terminology);
   - heavy paraphrase (low word-trigram overlap) → WARN, re-read the source for that line;
   - numbered source headings not represented in the notes → WARN (omission check).
3. **Build refuses unverified content.** `scripts/build_docx.js` only builds when a PASS report
   exists whose SHA-256 matches the exact spec file. Any edit after verification forces re-verification.
4. **Never answer the lecture's blanks.** Where the notes leave `____` / blank working for students,
   write a `? ` line ("… is left blank in the lecture notes"). Do not compute the answer — the number
   check will fail if you try. Answers that the notes *do* give (e.g. "option D is correct") may be kept.
5. **Flag what text extraction cannot carry.** Diagrams, graphs, skeletal/displayed structures,
   reaction-mechanism arrows, energy-level diagrams and formulae garbled by PDF extraction get a
   `! ` line ("… – see original PDF") instead of being reconstructed from memory. Never "repair" a
   garbled formula or equation by guessing; reproduce only what is unambiguous in the text.
6. **Prefer verbatim.** Definitions, laws and statements of principle go in `> ` blocks copied
   verbatim. Paraphrase only to compress, never to add explanation.
7. **Manual meaning check.** The verifier is necessary, not sufficient: before building, re-read
   every WARN line and every line containing a comparative or negation (more/less, higher/lower,
   increase/decrease, not, only) against the source — swaps like "endothermic"↔"exothermic" can use
   words that are all present in the cited lines.
8. **Fidelity statement in the document.** The builder appends the verification statistics
   (lines checked, gaps flagged, blanks left) and source/spec hashes, and the title page explains the
   ⚠ (not reproduced) and ✎ (left blank) callouts so the reader knows where to go back to the PDF.

## Standard document structure

Reorganise thematically where it helps, but keep the lecture's own numbering and sub-headings so
the student can cross-reference. Default skeleton (adapt to what the topic actually covers):

1. **Title page** — generated from `meta:` lines.
2. **0. Syllabus map & learning outcomes** — "Content" and "Learning Outcomes" copied verbatim from
   the lecture cover page; lecture outline.
3. **Core content** — one `#` per lecture section, `##`/`###`/`####` for sub-sections, each with:
   definitions (`>`), key equations (`=`), explanations/trends (`-`), comparison tables (`|`).
4. **Worked examples** — question text, the data/working the notes give, and `?` for blanks.
5. **Summary / comparison tables** — where the lecture has them (e.g. reagents & conditions,
   reaction summaries, summary of gas laws).
6. **Quick-revision checklist** (`[] Can you …?`) built from the learning outcomes; always last.
7. **Source-fidelity statement** — appended automatically.

## .notes spec format

```
meta: title = Lecture Notes 4 – The Gaseous State
meta: subtitle = Comprehensive Study Notes
meta: source = <source file / lecture name>
# 1. Heading @L37-58        h1 (also ## h2, ### h3, #### h4); @Lx-y = source lines; @L1-5,L90-99 allowed
- bullet                     (indent two spaces for a sub-bullet)
plain paragraph
> verbatim definition / law / conclusion (shaded box)
= equation line (centred)
| header | header |          table: first row is the header; ≥5 columns → landscape page
| cell // second line | cell |
! diagram/structure/garbled item not reproduced – see original PDF   (amber ⚠ callout, not checked)
? answer left blank in lecture notes                                   (grey ✎ callout)
[] Can you …?                checklist item
// comment (ignored)
```
Inline markup: `**bold**`, subscript `H_2O` / `C_{10}H_{22}`, superscript `mol^{−1}` / `Fe^{3+}` / `x^2`.
(The verifier flattens this markup, which matches how PDF text extraction flattens sub/superscripts.)

## Workflow

1. Convert PDFs to text if needed (`pdftotext -layout file.pdf file.txt`); keep the .txt — the
   verifier and its hashes refer to it.
2. Read the whole source with line numbers — don't skim.
3. Write `<NN>_<Topic>.notes`.
4. `python3 -I scripts/verify_notes.py <spec.notes> <source.txt>` → fix every FAIL by going back to the
   source (delete or correct the line; never weaken the check). Review WARNs (measure 7).
5. `node scripts/build_docx.js <spec.notes> <Topic>_Study_Notes.docx`
6. Visually check: `soffice --headless --convert-to pdf X.docx && pdftoppm -jpeg -r 70 X.pdf pg`
   (title page, a dense table page, any landscape page).
7. Deliver the .docx plus the `.verify.md` report.

## Style reference (inherited from the approved H2 History template — don't redesign)

Heading 1 navy `1F3864` bold with bottom border; Heading 2 mid-blue `2E5395`; Heading 3 slate
`44546A` bold italic; Calibri 11; tables with `2E5395` header row (white bold) and alternating
`F2F2F2` rows; checklists use ☐; A4 portrait, landscape sections only for ≥5-column tables.
Chemistry additions: centred Cambria Math equation lines, shaded definition boxes, amber ⚠ and
grey ✎ callouts, grey `[src L…]` tags on headings.

## Drill app (active recall)

After every spec passes, build the study app's card bank and publish it:

```bash
python3 -I scripts/build_app_data.py notes/ output/app/cards.js
cp app/index.html output/app/index.html
```

Publish `output/app/index.html` as an Artifact with `files: {"cards.js": "output/app/cards.js"}` and
`capabilities: {db: {}, user: {}}` (per-viewer progress). The builder takes only lines the verifier
marked PASS/WARN, keeps each point's source-line citation, shows ⚠ gaps and ✎ blanks as notes rather
than answers, and refuses any spec whose verify report is missing, failing or out of date.
