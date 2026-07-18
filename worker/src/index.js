// Pearl Study Notes — Cloudflare Worker
// Proxies requests from the static frontend to Anthropic API + Google Apps Script.
// Secrets (ANTHROPIC_API_KEY, STUDY_NOTES_SECRET, STUDY_NOTES_WEBAPP_URL, CLIENT_TOKEN)
// are set via `wrangler secret put`.

// Opus for polished-recreation calls (best vision + design quality).
// Sonnet for paper-URL summaries (cheaper, quality is fine for text extraction).
const MODEL_POLISH = "claude-opus-4-8";
const MODEL_PAPER  = "claude-sonnet-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const POLISH_SYSTEM_PROMPT = `You are building a polished medical study-notes entry from chalktalk/slide photos. The output image gets squeezed into a 6.5-inch Google Doc column, so the design goal is MAXIMUM TEXT SIZE with MINIMUM dead space — every horizontal pixel spent on words, not padding.

Given one or more images, produce a JSON object with exactly these fields and nothing else:

{
  "title":    string,   // 2-6 words, standard medical terminology
  "html":     string,   // self-contained HTML (a <style> block + content <div>), NO <html>/<head>/<body>
  "keywords": string    // flat, comma-separated, lowercase tokens
}

=== TITLE ===
Concise, standard medical phrasing. Examples: "WHO Analgesic Ladder", "Inpatient Sleep Management", "AF Rate vs Rhythm Control", "Sepsis 6 Bundle", "Beta Blocker Comparison".

=== HTML (the recreation) ===

This is NOT a description of the image. It faithfully carries every drug, dose, label, arrow, caveat, category, and case from the original — set in huge type.

Start your html with EXACTLY this <style> block, then a <div class="pearl">...</div>:

<style>
.pearl{width:900px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111;background:#fff;padding:2px;}
.sec{background:#1a3a5c;color:#fff;font-size:33px;font-weight:700;letter-spacing:1.5px;padding:10px 16px;border-radius:6px;margin:0 0 14px;}
.sec.later{margin-top:26px;}
.strip{font-size:33px;line-height:1.3;margin:0 0 12px;}
.strip .lab{font-weight:700;color:#1a3a5c;}
.strip .mut{color:#5a6b80;}
table.cmp{width:100%;border-collapse:collapse;}
.cmp th{background:#1a3a5c;color:#fff;font-size:25px;padding:8px 12px;text-align:left;letter-spacing:.5px;}
.cmp td{font-size:33px;line-height:1.28;padding:11px 12px;border-bottom:1.5px solid #dfe6ee;vertical-align:top;}
.cmp tr:nth-child(even) td{background:#f6f8fb;}
.drug{font-weight:700;color:#1a3a5c;}
.brand{font-weight:400;color:#6b7c93;font-size:29px;}
.mech{color:#5a6b80;font-style:italic;}
.num{display:inline-block;width:40px;height:40px;border-radius:50%;background:#1a3a5c;color:#fff;font-size:25px;font-weight:700;text-align:center;line-height:40px;margin-right:8px;}
.dose{white-space:nowrap;font-variant-numeric:tabular-nums;background:#f1f4f8;border-radius:6px;padding:0 8px;font-size:31px;}
.pro{color:#1e6b3a;}
.con{color:#8b2a2a;}
.warn{color:#8b2a2a;background:#fceeee;border-radius:6px;padding:0 8px;font-size:31px;display:inline-block;}
.good{color:#1e6b3a;background:#e8f5ec;border-radius:6px;padding:0 8px;font-size:31px;display:inline-block;}
.banner{background:#eef3f9;border:2px solid #c8d6e5;border-radius:8px;padding:9px 14px;font-size:32px;margin-top:4px;}
.note{font-size:30px;font-style:italic;color:#5a6b80;margin:-4px 0 10px 2px;}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f1f4f8;color:#1a3a5c;font-weight:600;font-size:27px;padding:1px 9px;border-radius:6px;}
</style>

Layout rules (in priority order):
1. **Big text, no air.** Body text stays at the 33px sizes above — never shrink below 29px to fit more in. The width is spent on words: no card grids, no empty columns, no decorative padding.
2. **Inline flow beats boxes.** Short lists become ONE flowing line: a bold navy lead-in (.strip > .lab) then items separated by " · ". Example: "<div class=\\"strip\\"><span class=\\"lab\\">Day is Day:</span> lights on · blinds up · ↓ naps · OOB / mobilize</div>". Never render 5 one-word bullets as a tall vertical list or a padded card.
3. **Tables only for real comparisons** (drugs × attributes). One drug per ROW: first cell = .drug name + .brand + .dose chip; second cell = pearls with .warn / .good / .pro / .con coloring. 2–3 columns max.
4. **Section bars (.sec)** for major sections only; skip them for entries with one topic.
5. **Aspect ratio: aim for height ≤ 1.5× width.** If the content would run much taller, tighten by merging related lines — never by shrinking text.
6. DO NOT include a title or subtitle at the top — the Google Doc renders the title above the image. Do not repeat the title as a header.
7. **NEVER use rotated, vertical, or sideways text.** No transform: rotate(...), no writing-mode: vertical-*. Replace vertical axis labels with a horizontal .note line (e.g. "↓ increasing strength / intensity").
8. **No empty boxes or cells.** If a cell has no content in the original, use colspan to merge, or an em dash — never an empty box.
9. All CSS in the single <style> block above (you may append a few extra rules after it if truly needed); no external resources; no <html>/<head>/<body>.

Content fidelity:
- Transcribe every labeled item from the slide. If the slide shows 5 drugs and 3 attributes each, all 15 facts appear.
- Preserve original terminology (e.g. "Ok for L/K" means ok for liver/kidney — keep as written).
- Preserve units and dose ranges verbatim. Keep ↓ and ↑ arrows.
- Parentheticals become inline .mut spans, not separate lines.

Multi-image inputs: WEAVE them into one coherent visual (shared sections, unified tables) rather than stacking them side-by-side.

=== KEYWORDS (for Cmd+F search) ===

Flat, comma-separated, lowercase. 8-15 tokens. Think back-of-book index terms, not caption paraphrase.

Include:
- Drug names — generic AND brand (e.g. suvorexant, belsomra)
- Diagnoses — full name AND abbreviation (e.g. atrial fibrillation, afib)
- Core 1-2 word concepts (e.g. insomnia, rate control, sleep hygiene)
- Central procedures if relevant (e.g. ECG, echocardiogram)
- Distinctive context (e.g. inpatient, geriatrics, icu)
- Source type: one of chalktalk, slide, paper, diagram, mnemonic, flowchart, guideline

Exclude:
- Doses and dose ranges (belong in the image)
- Long descriptive fragments
- Narrow abbreviations (L/K, OOB, AMS)
- Image caption paraphrases
- Drug class descriptors unless the class IS the entry's topic

=== OUTPUT ===

Return ONLY the JSON object. No markdown fences. No commentary before or after.`;

const META_ONLY_SYSTEM_PROMPT = `You are labeling a medical study-notes image (chalktalk, slide, diagram) for a Google Doc entry. You do NOT redesign the image — the user is keeping the raw photo. You just supply a title and searchable keywords.

Given one or more images, return ONLY this JSON:

{
  "title":    string,   // 2-6 words, standard medical terminology
  "keywords": string    // flat, comma-separated, lowercase, 8-15 tokens
}

=== TITLE ===
Concise, standard medical phrasing. Examples: "WHO Analgesic Ladder", "Inpatient Sleep Management", "AF Rate vs Rhythm Control".

=== KEYWORDS (for Cmd+F search) ===
Flat, comma-separated, lowercase. 8-15 tokens. Think back-of-book index terms.

Include:
- Drug names — generic AND brand (e.g. suvorexant, belsomra)
- Diagnoses — full name AND abbreviation (e.g. atrial fibrillation, afib)
- Core 1-2 word concepts (e.g. insomnia, rate control, sleep hygiene)
- Central procedures if relevant (ECG, echocardiogram)
- Distinctive context (inpatient, geriatrics, icu)
- Source type: one of chalktalk, slide, paper, diagram, mnemonic, flowchart, guideline

Exclude:
- Doses (10 mg, 25-100 mg)
- Long descriptive fragments
- Narrow abbreviations (L/K, OOB, AMS)
- Drug class descriptors unless the class IS the entry's topic

Return ONLY the JSON object. No markdown fences, no commentary.`;

const PAPER_SYSTEM_PROMPT = `You are labeling a medical journal article for a study notes Google Doc.

Given the article's full text or abstract (and possibly the user's own takeaway note), produce a JSON object with exactly these fields:

{
  "title":    string (short paper name or topic, e.g. "PARADIGM-HF: Sacubitril vs Enalapril", "CRASH-2: TXA in Trauma"),
  "bodyText": string,
  "keywords": string (comma-separated, lowercase, 8-15 tight tokens including drug/device names, conditions, trial acronym, "paper")
}

=== bodyText rules ===

**If the user provided a takeaway note**: bodyText is EXACTLY their note, verbatim — nothing else. No Design paragraph. No Takeaway paragraph. No rewording, no additions, no introduction, no closing. Just their text. Period.

**If the user did NOT provide a takeaway note** (empty or missing): produce a concise 3-paragraph summary:
  Main finding: <one sentence>.
  <blank line>
  Design: <one sentence — n, setting, comparator, endpoint>.
  <blank line>
  Takeaway: <why it matters clinically, one sentence>.

Title and keywords are always AI-generated from the article regardless of whether a user note is provided.

Return ONLY valid JSON. No markdown fences.`;

// ── Handler ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Client-Token",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // Health check
    if (request.method === "GET" && url.pathname === "/") {
      return json({ status: "ok", message: "Pearl Worker up" }, cors);
    }

    // All POST endpoints require a client token
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, cors, 405);
    }

    const clientToken = request.headers.get("X-Client-Token") || "";
    if (clientToken !== env.CLIENT_TOKEN) {
      return json({ error: "Invalid client token" }, cors, 401);
    }

    try {
      switch (url.pathname) {
        case "/polish": return await handlePolish(request, env, cors);
        case "/paper":  return await handlePaper(request, env, cors);
        case "/submit": return await handleSubmit(request, env, cors);
        default:        return json({ error: "Unknown endpoint" }, cors, 404);
      }
    } catch (err) {
      return json({ error: err.message || String(err) }, cors, 500);
    }
  },
};

// ── /polish ───────────────────────────────────────────────────────────────────

async function handlePolish(request, env, cors) {
  const body = await request.json();
  const images = body.images || [];
  const metaOnly = body.metaOnly === true;
  if (!images.length) {
    return json({ error: "images required" }, cors, 400);
  }

  const userContent = [
    ...images.map((img) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mimeType || "image/png",
        data: img.base64,
      },
    })),
    {
      type: "text",
      text: metaOnly
        ? `Generate the JSON for ${images.length === 1 ? "this image" : "these images (treat them as one combined entry)"}.`
        : `Generate the JSON for ${images.length === 1 ? "this image" : "these images (merge into one combined visual)"}.`,
    },
  ];

  const payload = {
    // metaOnly uses Sonnet — it's cheaper and only needs to extract title + keywords, no design work
    model: metaOnly ? MODEL_PAPER : MODEL_POLISH,
    max_tokens: metaOnly ? 2000 : 16000,
    system: metaOnly ? META_ONLY_SYSTEM_PROMPT : POLISH_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  };
  if (!metaOnly) {
    // Opus 4.8: adaptive thinking improves layout planning; thinking is off when omitted
    payload.thinking = { type: "adaptive" };
  }
  const resp = await callAnthropic(env.ANTHROPIC_API_KEY, payload);

  const parsed = extractJson(resp);
  return json(parsed, cors);
}

// ── /paper ────────────────────────────────────────────────────────────────────

async function handlePaper(request, env, cors) {
  const body = await request.json();
  const sourceUrl = body.url;
  if (!sourceUrl) return json({ error: "url required" }, cors, 400);

  // Fetch the page (text only — we let the model do the extraction)
  let pageText = "";
  try {
    const pageResp = await fetch(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 PearlStudyNotes/1.0" },
    });
    const html = await pageResp.text();
    // Very lightweight strip — let the model handle HTML
    pageText = html.slice(0, 50000);
  } catch (err) {
    return json({ error: "Could not fetch URL: " + err.message }, cors, 400);
  }

  const userNotes = (body.userNotes || "").trim();
  const noteBlock = userNotes
    ? `\n\n===== USER'S TAKEAWAY (preserve verbatim as first paragraph of bodyText) =====\n${userNotes}\n===== END USER'S TAKEAWAY =====`
    : "";
  const userContent = [
    { type: "text", text: `Source URL: ${sourceUrl}${noteBlock}\n\nRaw page content:\n\n${pageText}` },
  ];

  const resp = await callAnthropic(env.ANTHROPIC_API_KEY, {
    // Sonnet 5 runs adaptive thinking by default; max_tokens covers thinking + output
    model: MODEL_PAPER,
    max_tokens: 4000,
    system: PAPER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const parsedResp = extractJson(resp);
  // Enforce: if user provided a note, bodyText is EXACTLY that note — no AI-generated paragraphs appended.
  if (userNotes) parsedResp.bodyText = userNotes;
  return json(parsedResp, cors);
}

// ── /submit ───────────────────────────────────────────────────────────────────

async function handleSubmit(request, env, cors) {
  const body = await request.json();
  if (!body.title) return json({ error: "title required" }, cors, 400);

  const payload = {
    secret: env.STUDY_NOTES_SECRET,
    title: body.title,
  };
  if (body.imageBase64) {
    payload.imageBase64 = body.imageBase64;
    payload.mimeType = body.mimeType || "image/png";
  }
  if (body.bodyText) payload.bodyText = body.bodyText;
  if (body.keywords) payload.keywords = body.keywords;
  if (body.sourceUrl) payload.sourceUrl = body.sourceUrl;

  const resp = await fetch(env.STUDY_NOTES_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "follow",
  });

  const text = await resp.text();
  try {
    return json(JSON.parse(text), cors);
  } catch {
    return json({ status: "error", message: text.slice(0, 200) }, cors, 502);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callAnthropic(apiKey, payload) {
  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${errText.slice(0, 300)}`);
  }
  return await resp.json();
}

function extractJson(anthropicResponse) {
  // Anthropic response: { content: [{ type: "text", text: "..." }, ...] }
  const textBlock = (anthropicResponse.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text content in Anthropic response");
  let raw = textBlock.text.trim();
  // Strip ```json fences if the model added them
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error("Model returned non-JSON: " + raw.slice(0, 200));
  }
}

function json(obj, cors, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
