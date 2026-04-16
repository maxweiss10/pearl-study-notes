// Pearl Study Notes — Cloudflare Worker
// Proxies requests from the static frontend to Anthropic API + Google Apps Script.
// Secrets (ANTHROPIC_API_KEY, STUDY_NOTES_SECRET, STUDY_NOTES_WEBAPP_URL, CLIENT_TOKEN)
// are set via `wrangler secret put`.

const ANTHROPIC_MODEL = "claude-sonnet-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const POLISH_SYSTEM_PROMPT = `You are helping build a medical study notes Google Doc entry from chalktalk/slide photos.

Given one or more images, produce a JSON object with exactly these fields:

{
  "title":    string (2-6 words, standard medical terminology, e.g. "WHO Analgesic Ladder", "Inpatient Sleep Management"),
  "html":     string (self-contained HTML — a <style> block plus a content <div>, NO <html>/<head>/<body>),
  "keywords": string (comma-separated, lowercase, 8-15 tight tokens — drug names generic+brand, conditions full+abbrev, core concepts, source type like "chalktalk")
}

HTML requirements:
- All CSS inline in a single <style> tag, no external resources
- White background, clean typography
- DO NOT include a title or subtitle at the top — the doc already renders the title above. Start the visual directly with the first content element.
- Dark colored header bars for section titles, light-background cards for side-by-side sections, styled tables with dark headers, colored accents (red for AVOID-type emphasis)
- System font stack: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
- max-width: 750px; min 14px body text, 18px+ headings
- Color reference: navy #1a3a5c, card fill #eef3f9, card border #c8d6e5, red text #8b2a2a, red bg #fceeee

Keyword rules:
- INCLUDE: drug names (generic + brand), diagnoses (full + abbrev), core concepts, central procedures, distinctive context, source type
- EXCLUDE: doses, long descriptive fragments, narrow abbreviations, image-caption paraphrases

If multiple images are provided, weave their content into a single polished visual (not just stacked).

Return ONLY valid JSON. No markdown fences, no commentary.`;

const PAPER_SYSTEM_PROMPT = `You are summarizing a medical journal article for a study notes Google Doc.

Given the article's full text or abstract, produce a JSON object with exactly these fields:

{
  "title":    string (short paper name or topic, e.g. "PARADIGM-HF: Sacubitril vs Enalapril", "CRASH-2: TXA in Trauma"),
  "bodyText": string (2-4 short paragraphs separated by blank lines — main finding, design, takeaway),
  "keywords": string (comma-separated, lowercase, 8-15 tight tokens including drug/device names, conditions, trial acronym, "paper")
}

bodyText format:
  Main finding: <one sentence>.
  <blank line>
  Design: <one sentence — n, setting, comparator, endpoint>.
  <blank line>
  Takeaway: <why it matters clinically, one sentence>.

Keep it terse. Return ONLY valid JSON. No markdown fences.`;

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
    model: ANTHROPIC_MODEL,
    max_tokens: 4000,
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

  const userContent = [
    { type: "text", text: `Source URL: ${sourceUrl}\n\nRaw page content:\n\n${pageText}` },
  ];

  const resp = await callAnthropic(env.ANTHROPIC_API_KEY, {
    model: ANTHROPIC_MODEL,
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
