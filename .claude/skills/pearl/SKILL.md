---
name: pearl
description: Add an entry to Pearl, the searchable study-notes site (maxweiss10.github.io/pearl-study-notes). Turns chalktalk photos, slides, paper URLs, or quick text pearls into real-text entries in the Pearl design system — selectable, searchable, no API cost. Use when the user runs /pearl, says "add a pearl", "add this to my study notes", "save this chalktalk / slide / paper", or wants to edit or remove an existing entry.
argument-hint: <image(s), URL, or text> [raw|each|merge|merge-raw|paper]
---

You are adding an entry to **Pearl**, the user's study-notes site. Entries are HTML fragments of REAL TEXT (selectable, Ctrl-F-able) in a shared design system — never screenshots or rendered PNGs.

**Repo**: on this Mac at `/Users/home_mrw/Documents/Desktop/Claude Projects/study-notes-web` (clone of `maxweiss10/pearl-study-notes`). In a cloud/claude.ai session, use the checkout root of that repo instead. All paths below are repo-relative.

**Live site**: https://maxweiss10.github.io/pearl-study-notes/ (GitHub Pages, rebuilds ~30-60 s after push).

## Step 0 — Pick a mode

Tokens are whitespace-separated. A "path" contains `/` or ends in `.png/.jpg/.jpeg/.gif/.webp/.pdf/.heic`. A "URL" starts with `http(s)://`.

| Input pattern | Mode |
|---|---|
| 1 image (path or pasted), nothing else | **Polished** (default) — recreate as real-text entry |
| First token `raw` + image(s) | **Raw** — insert the photo(s) as-is |
| First token `each` + images | **Each** — one polished entry per image |
| First token `merge` + images | **Merge** — ONE polished entry weaving all images together |
| First token `merge-raw`/`raw-merge` + images | **Raw stack** — one entry, photos stacked |
| 2+ images, no keyword | Ask with AskUserQuestion: separate / merged / raw stack |
| URL (± text after it) | **Paper** — text after the URL is the user's takeaway, used VERBATIM as the body |
| Plain text, no path/URL | **Text pearl** — a quick fact/mnemonic as its own entry |
| "edit/fix/update/delete the X entry" | **Edit** — modify `entries/*.html` and/or `manifest.json` directly |

## Step 1 — Gather content

- HEIC first: `sips -s format png "<file>" --out /tmp/pearl-input-N.png`, then Read the PNG.
- Read every image with the Read tool (vision — no OCR needed). Note every drug, dose, category, arrow, label.
- Paper mode: WebFetch the URL → paper title, the one key finding, must-remember methods detail (n, design, endpoint).

## Step 2 — Compose the entry

**Title**: 2-6 words, medical terminology ("ICU Pressors & Inotropes", "PARADIGM-HF: Sacubitril/Valsartan vs Enalapril").

**id**: `YYYY-MM-DD-slug` — today's date + 2-4 word kebab slug (e.g. `2026-08-08-af-rate-control`).

**Keywords**: flat, comma-separated, lowercase, 8-15 tight tokens. Include: drug names (generic + brand), diagnoses (full + abbrev), core concepts, distinctive context, and a source-type token (`chalktalk`/`slide`/`paper`/`photo`/`note`). Exclude: doses, descriptive fragments, drug-class descriptors.

**Fragment** → `entries/{id}.html`. Rules:

1. Root element is `<div class="pearl">`. No `<style>`, no `<html>/<head>/<body>`, no external resources, no scripts.
2. Use ONLY these design-system classes (defined in `pearl.css`):
   - `.sec` / `.sec.later` — navy section bar (major sections only)
   - `.strip` — one flowing line; bold lead-in `<span class="lab">`, items separated by ` · `
   - `.mut` — muted gray (parentheticals), `.mech` — italic mechanism, `.note` — italic caption line
   - `table.cmp` — real comparisons only, one drug per ROW: `<span class="drug">` + `<span class="brand">(Brand)</span>` + `<span class="dose">` chip in col 1, pearls in col 2. Max 2-3 columns. Set `<th>` widths in **percent**, never px.
   - `.num` — numbered circle, `.dose` — dose chip, `.code` — monospace chip (dot phrases, orders)
   - `.warn` (red chip) / `.good` (green chip) / `.pro` / `.con` — highlights
   - `.banner` — bordered callout, `.star` — gold star, `.avoid` + `td.cell-avoid` — red "avoid" styling, `.eyebrow` — small gray caps label, `.ptext` — plain paragraph (paper/text entries), `.photo` — raw images
3. **No inline colors** (use the classes — they carry light AND dark themes). Inline non-color styles only when necessary (`white-space:nowrap`, small margins, `th` percent widths).
4. **Inline flow beats boxes**: short lists become ONE `.strip` line, never a tall bullet list or card grid. Tables only for real drug × attribute comparisons.
5. No title inside the fragment (the site renders it), no rotated/vertical text, no empty cells (use `colspan` or an em dash), preserve doses/units/arrows verbatim, parentheticals become `.mut` spans.
6. A genuinely huge multi-topic chalktalk (4+ dense sections) → split into two entries with clear titles.

Idiom example:
```html
<div class="pearl">
  <div class="sec">RATE CONTROL</div>
  <div class="strip"><span class="lab">Metoprolol:</span> <span class="dose">2.5–5 mg IV q5min</span> · <span class="mech">β₁ selective</span> <span class="warn">⚠ Avoid in decompensated HF</span></div>
  <div class="banner"><strong>Pearl:</strong> digoxin adds control without dropping BP <span class="mut">(sick, hypotensive patients)</span></div>
</div>
```

**Raw mode**: convert/downscale each photo — `sips -s format jpeg -Z 1600 "<file>" --out entries/img/{id}-N.jpg` — and the fragment is `<div class="pearl"><img class="photo" src="entries/img/{id}-1.jpg" alt="short description">…</div>` (one `<img>` per photo, stacked; alt text = one-line content summary so it's still searchable). Title + keywords still AI-generated from vision.

**Paper mode body**: user takeaway present → body is EXACTLY their text in `<p class="ptext">` (no padding, no rewording). No takeaway → three `.ptext` paragraphs: `Main finding: …` / `Design: …` / `Takeaway: …`.

**Text pearl**: their fact, lightly structured with `.strip`/`.banner`/`.ptext` — keep it faithful, don't expand.

## Step 3 — Update the manifest

Prepend to the ARRAY in `manifest.json` (newest first; keep valid JSON):
```json
{ "id": "…", "title": "…", "date": "YYYY-MM-DD", "keywords": "…", "source": "https://… (paper mode only)" }
```

## Step 4 — Commit and push

```bash
cd <repo> && git pull --rebase && git add -A && git commit -m "Pearl: {TITLE}" && git push
```
Push rejected/offline → report that the entry is committed locally and needs a later push. Never force-push.

## Step 5 — Report

One line per entry: title + link `https://maxweiss10.github.io/pearl-study-notes/#{id}` (mention the ~1 min Pages rebuild). For `each` mode, list every title. On edit/delete, say what changed.
