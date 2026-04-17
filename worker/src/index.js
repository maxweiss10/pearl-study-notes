// Pearl Study Notes — Cloudflare Worker
// Proxies requests from the static frontend to Anthropic API + Google Apps Script.
// Secrets (ANTHROPIC_API_KEY, STUDY_NOTES_SECRET, STUDY_NOTES_WEBAPP_URL, CLIENT_TOKEN)
// are set via `wrangler secret put`.

// Opus for polished-recreation calls (best vision + design quality).
// Sonnet for paper-URL summaries (cheaper, quality is fine for text extraction).
const MODEL_POLISH = "claude-opus-4-5";
const MODEL_PAPER  = "claude-sonnet-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const POLISH_SYSTEM_PROMPT = `You are building a polished medical study-notes entry from chalktalk/slide photos. Think like an infographic designer who also writes a thorough back-of-book index.

Given one or more images, produce a JSON object with exactly these fields and nothing else:

{
  "title":    string,   // 2-6 words, standard medical terminology
  "html":     string,   // self-contained HTML (a <style> block + content <div>), NO <html>/<head>/<body>
  "keywords": string    // flat, comma-separated, lowercase tokens
}

=== TITLE ===
Concise, standard medical phrasing. Examples: "WHO Analgesic Ladder", "Inpatient Sleep Management", "AF Rate vs Rhythm Control", "Sepsis 6 Bundle", "Beta Blocker Comparison".

=== HTML (the recreation) ===

This is NOT a description of the image. This is a professionally designed infographic that faithfully represents every drug, dose, label, arrow, caveat, category, and case from the original. Design first, then transcribe content into that design.

Hard rules:
- All CSS inline in a single <style> tag, no external resources
- Start with a <style> block, then a content <div class="container">
- DO NOT include a title or subtitle at the top — the Google Doc renders the title above the image
- System font stack: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
- max-width: 750px; min 14px body text, 18px+ headings
- White background, clean typography, generous whitespace
- No <html>/<head>/<body> boilerplate

Design vocabulary to pick from:
- **Dark colored header bars** for section names (small caps label above a bar, or bar with white text inside)
- **Light-background card boxes** with subtle borders for side-by-side concepts
- **Structured tables** with dark header rows for comparisons (drugs, pros/cons, rate vs rhythm, etc.)
- **Colored emphasis cells**: red bg + red text for AVOID / danger, green for preferred, yellow for caution
- **Arrow flows** (→ ⟶ ↓) for algorithms and dose escalation ladders
- **Row labels** (Dose, Pro, Con, Mechanism) on the left of comparison tables
- **Hierarchy** via font weight and color — not by font size alone

Approved palette (use these, not other colors):
- Navy header:       #1a3a5c (text + backgrounds)
- Card fill:         #eef3f9
- Card border:       #c8d6e5
- Alt row:           #f8f9fb or #f5f7fa
- Red danger text:   #8b2a2a
- Red danger bg:     #fceeee
- Soft red bg:       #fcf5f5
- Muted text:        #6b7c93 or #888888
- Primary body:      #1a1a1a

Content fidelity:
- Transcribe every labeled item from the slide. If the slide shows 5 drugs and 3 rows of attributes, your table is 5×3.
- Preserve original terminology (e.g. "Ok for L/K" means ok for liver/kidney — keep as written).
- Preserve units and dose ranges verbatim.
- If the slide uses ↓ or ↑ arrows, keep them.

Multi-image inputs: WEAVE them into one coherent polished visual (shared sections, unified tables) rather than stacking them side-by-side.

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

const PAPER_SYSTEM_PROMPT = `You are summarizing a medical journal article for a study notes Google Doc.

Given the article's full text or abstract (and possibly the user's own takeaway note), produce a JSON object with exactly these fields:

{
  "title":    string (short paper name or topic, e.g. "PARADIGM-HF: Sacubitril vs Enalapril", "CRASH-2: TXA in Trauma"),
  "bodyText": string (2-4 short paragraphs separated by blank lines),
  "keywords": string (comma-separated, lowercase, 8-15 tight tokens including drug/device names, conditions, trial acronym, "paper")
}

=== bodyText rules ===

If the user provided their own takeaway note, preserve it VERBATIM as the first paragraph. Then add supporting paragraphs derived from the article:
  Design: <one sentence — n, setting, comparator, endpoint>.
  <blank line>
  Takeaway: <why it matters clinically, one sentence>.

If the user did NOT provide a takeaway note, use this default structure:
  Main finding: <one sentence>.
  <blank line>
  Design: <one sentence — n, setting, comparator, endpoint>.
  <blank line>
  Takeaway: <why it matters clinically, one sentence>.

Keep it terse. The user's personal note is sacred — do not paraphrase or "improve" it.

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
      text: `Generate the JSON for ${images.length === 1 ? "this image" : "these images (merge into one combined visual)"}.`,
    },
  ];

  const resp = await callAnthropic(env.ANTHROPIC_API_KEY, {
    model: MODEL_POLISH,
    max_tokens: 6000,
    system: POLISH_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

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
    model: MODEL_PAPER,
    max_tokens: 2000,
    system: PAPER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const parsed = extractJson(resp);
  return json(parsed, cors);
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
