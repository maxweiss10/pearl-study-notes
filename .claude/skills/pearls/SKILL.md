---
name: pearls
description: Pearl — the user's supplementary White Book, a searchable real-text study-notes site at maxweiss10.github.io/pearl-study-notes. Turns anything — chalktalk/slide photos, screenshots, paper or article URLs, YouTube videos, blocks of text, quick facts — into individually-optimized visual entries organized by medical sub-discipline. Understands free-form requests, no fixed syntax ("put these images together as-is", "make this text into a visual", "turn this video into a concise guide", "move X to cardiology", "fix the pressors entry"). Use for /pearls, /pearl, "add a pearl", "add to my study notes", or any request to capture, edit, reorganize, or regenerate study-note entries.
argument-hint: <anything — images, URL, text, or an instruction in plain words>
---

You are working on **Pearl**, the user's supplementary White Book: UCSF-specific and rotation-acquired knowledge that is NOT already in the MGH White Book. Every entry is REAL TEXT (selectable, searchable, highlightable) — never a screenshot, never a rendered PNG.

**Repo**: on this Mac `/Users/home_mrw/Documents/Desktop/Claude Projects/study-notes-web` (clone of `maxweiss10/pearl-study-notes`); in a cloud/claude.ai session use the repo checkout root. Paths below are repo-relative.
**Live site**: https://maxweiss10.github.io/pearl-study-notes/ (rebuilds ~30-60 s after push).

## 1 · Understand the request — plain words, no fixed grammar

Interpret intent from whatever the user says:

| Intent (any phrasing) | Action |
|---|---|
| Photo(s) of a chalktalk / slide / whiteboard / handout | **Redesign** into an optimized visual entry (default) |
| "use these exact images", "as-is", "don't redesign", "just put them together" | **Raw** — insert photo(s) untouched (stacked if several), still auto-title/tag/section |
| Several images, combine-vs-separate unclear | One AskUserQuestion: separate entries / one merged redesign / one raw stack |
| "make this text/block into a visual" | **Text → visual** entry |
| Paper or article URL (± their takeaway) | **Paper** entry — takeaway used VERBATIM as body if given; else 3 short lines (Main finding / Design / Takeaway); source link |
| YouTube link, "make this video a concise guide" | **Video** entry — transcript (§2) → distill hard → visual guide; source link |
| A quick fact or mnemonic in a sentence | Small **text pearl** |
| "fix / retitle / regenerate / move to <section> / delete [entry]" | **Edit** `entries/*.html` and/or `manifest.json` in place — ids and filenames stay stable |

Legacy keywords (`raw`, `each`, `merge`, `merge-raw`, `paper`) still work but are never required. If the request is genuinely ambiguous, ask one short question; otherwise proceed.

## 2 · Gather content

- HEIC → `sips -s format png "<f>" --out /tmp/pearl-N.png`; Read every image with vision. Note every drug, dose, category, arrow, label.
- URLs → WebFetch: paper title, the one key finding, must-remember methods (n, design, endpoint).
- YouTube, try in order: ① open the video in the in-app browser, expand description → "Show transcript", then get_page_text; ② `yt-dlp --skip-download --write-auto-subs -o /tmp/pearl-vid "<url>"` if yt-dlp exists; ③ WebFetch the watch page for title + description; ④ ask the user to paste the transcript (YouTube → Show transcript → copy). Distill hard: a 20-minute video should become ONE screenful of high-yield content.
- **Never invent clinical content.** Compress and abbreviate like a resident would, but every fact must come from the source (or the user).

## 3 · Metadata

- **Title**: 2-6 words, medical terminology ("ICU Pressors & Inotropes").
- **id**: `YYYY-MM-DD-slug` (today + 2-4 word kebab slug) → file `entries/{id}.html`.
- **Section**: pick from `manifest.json → sections` (medical sub-disciplines, White-Book style). If none fits, CREATE one at discipline level (e.g. "Pulmonology", "Infectious Diseases", "GI & Hepatology", "Heme/Onc", "Neurology", "Outpatient & Prevention", "Procedures", "UCSF Systems & Epic") and insert it at a sensible position in the sections array. No near-duplicates, no over-narrow sections.
- **Keywords**: 8-15 flat lowercase comma-separated tokens — drugs (generic + brand), diagnoses (full + abbrev), core concepts, distinctive context, plus one source-type token (`chalktalk`/`slide`/`paper`/`photo`/`note`/`video`). No doses, no sentence fragments.

## 4 · Design the entry — individually optimized, real text always

Each entry gets its OWN design chosen for maximum comprehension of THAT content. There is no house theme to match.

**Hard rules**
- Root: `<div class="pearl e-{short}">` where `{short}` is 3-4 letters for this entry.
- Optional `<style>` INSIDE that div; EVERY selector prefixed with `.e-{short}` (leakage into other entries is a bug).
- Colors as local CSS vars with dark-mode overrides:
  `.e-x{--a:#B; --abg:#T;} @media (prefers-color-scheme:dark){.e-x{--a:#L; --abg:#D;}}`
  Check contrast mentally in BOTH themes (body text ≥ 4.5:1).
- Real text only. No scripts, no iframes, no external resources (fonts, CDNs, remote images), no `<html>/<head>/<body>`, no entry title at top (the site renders it), no rotated/vertical text, no fixed pixel widths on containers — percent/auto only, and multi-column grids must stack below ~560px via a media query in the scoped style.
- Site base classes are available and encouraged where they fit: `.strip .lab .mut .mech .note .dose .code .warn .good .pro .con .banner .num .brand .star .avoid .cell-avoid .eyebrow .ptext .photo .sec` — plus site vars `--ink --mut --mut2 --line --zebra --paper --accent --bar-bg --chipbg`.
- Wrap every `<table>` in `<div class="tblwrap">` so it side-scrolls on phones.

**Choose the structure from what the content IS**
- Escalation / severity → ladder rows with graduated color (green→red) and numbered rungs
- Sequence / algorithm / exam flow → numbered steps on a vertical rail
- Agent comparison → table whose columns mean something (consider split “+ Pro | – Con” columns)
- Mnemonic → oversized key letters, side-by-side contrast panels
- Categorical pharmacology → color-coded category badges with a small key (e.g. receptor activity α / β / V₁)
- Checklist / environment → grouped panels, thematic when it aids memory (dark “night” panel vs light “day” panel)
- Reference directory (dot phrases, phone numbers) → aligned `code | description` grid
- Coverage / eligibility → status-striped rows (✓ green / ✗ red / $ neutral)
- Paper / video takeaway → small eyebrow label + emphatic one-liner or 3 tight strips

**Color doctrine**: 2-3 accents max; color must ENCODE something (severity, category, phase, yes/no) — never decoration; never hue alone (pair with a glyph/label/position: ✓ ✗ ⚠ ★ ☾ ☀ α β); prefer colorblind-safe pairs (blue/orange) when the pair itself carries the meaning.
**Density doctrine**: maximize signal per screen — inline flow lines beat bullet lists, merge related facts, no decorative padding, no empty boxes. A genuinely huge multi-topic source becomes 2 entries.

**Raw photos**: `sips -s format jpeg -Z 1600 "<f>" --out entries/img/{id}-N.jpg`; fragment is the photos stacked: `<div class="pearl e-x"><img class="photo" src="entries/img/{id}-1.jpg" alt="one-line content summary">…</div>` (alt text keeps it searchable).

## 5 · Manifest

Prepend to `manifest.json → entries` (valid JSON, newest first):
```json
{ "id": "…", "title": "…", "date": "YYYY-MM-DD", "section": "…", "keywords": "…", "source": "https://… (papers/videos only)" }
```
If the section is new, add it to the `sections` array in a sensible position.

## 6 · Commit + push

```bash
cd <repo> && git pull --rebase && git add -A && git commit -m "Pearl: {TITLE}" && git push
```
Never force-push. Push rejected / offline → say the entry is committed locally and needs a push later.

## 7 · Report

One line per entry: title + `https://maxweiss10.github.io/pearl-study-notes/#{id}` (mention the ~1 min rebuild). For edits, say exactly what changed.
