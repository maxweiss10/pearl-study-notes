# Pearl — Study Notes Web App

Phone/browser-first companion to the Pearl Google Doc. Six capture modes:

1. **Polished single image** — AI recreates the slide as a clean diagram, adds keywords
2. **Raw single image** — inserts the photo as-is with your title and keywords
3. **Multiple → separate entries** — each image becomes its own polished entry
4. **Multiple → one merged polished entry** — AI combines the slides into a single visual
5. **Multiple → one stacked raw entry** — photos stacked vertically, one entry
6. **Paper URL → text entry** — AI extracts key finding, saves title + summary + keywords + link

Static frontend + a tiny Cloudflare Worker that hides the Apps Script secret and Anthropic API key. The existing `/add-note` CLI in Claude Code keeps working against the same backend.

---

## Architecture

```
Browser (GitHub Pages)
   │
   │  POST /polish  (modes 1, 3, 4) → Worker calls Anthropic vision
   │  POST /paper   (mode 6)        → Worker fetches URL + Anthropic
   │  POST /submit  (all modes)     → Worker injects secret, forwards to Apps Script
   ▼
Cloudflare Worker (free tier)
   ▼
Google Apps Script (V5, already deployed)
   ▼
Google Doc
```

---

## Setup

### Prerequisites

- Node.js (for `wrangler`)
- An Anthropic API key (`sk-ant-...`) — note that API usage is billed separately from Claude Pro/Max
- The existing Apps Script already deployed (you have this)
- A GitHub account

### 1. Deploy the Cloudflare Worker

```bash
# One-time install
npm install -g wrangler

cd worker
wrangler login                     # opens browser to auth Cloudflare
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put STUDY_NOTES_SECRET          # same value as in your ~/.zshrc
wrangler secret put STUDY_NOTES_WEBAPP_URL      # the https://script.google.com/macros/s/.../exec URL
wrangler secret put CLIENT_TOKEN                # pick any string; you'll put it in config.js too
wrangler deploy
```

Wrangler prints the Worker URL, e.g. `https://pearl-study-notes.<your-subdomain>.workers.dev`. Copy it.

### 2. Configure the frontend

```bash
cd ..
cp config.example.js config.js
# Edit config.js — set WORKER_URL, CLIENT_TOKEN, DOC_URL
```

`config.js` is gitignored so your Worker URL and token stay local to each deployment.

### 3. Push to GitHub + enable Pages

```bash
gh repo create pearl-study-notes --public --source . --push
gh repo edit --enable-pages --pages-branch main --pages-path /
```

Or manually: push to any GitHub repo, then Settings → Pages → Source: `main` branch, `/` root.

Pages gives you a URL like `https://<user>.github.io/pearl-study-notes/`. Open on phone. Add to Home Screen.

### 4. (Optional) Tighten CORS

In `worker/src/index.js`, swap `"Access-Control-Allow-Origin": "*"` for your Pages origin. Works fine with `*` for personal use; the `CLIENT_TOKEN` check is the actual gate.

---

## Cost

- **Cloudflare Worker**: free tier (100k requests/day)
- **GitHub Pages**: free
- **Anthropic API**: pay-per-use. Polished entries use ~one vision call + one generation. Ballpark:
  - Polished single entry: ~$0.02
  - Paper URL: ~$0.005
  - Raw modes: $0 (no AI calls)

---

## Local development

```bash
cd worker
wrangler dev            # local Worker on http://localhost:8787
```

Open `index.html` in a browser with `config.js` pointing at `http://localhost:8787`.

---

## Files

```
study-notes-web/
├── index.html              main page
├── app.js                  frontend logic
├── style.css               mobile-first styles
├── config.example.js       template for config.js (gitignored)
├── .gitignore              excludes config.js
├── worker/
│   ├── src/index.js        Cloudflare Worker (/polish /paper /submit)
│   ├── wrangler.toml       Worker config
│   └── README.md           worker-specific notes (optional)
└── README.md               this file
```

---

## Relationship to `/add-note` CLI

Both hit the same Apps Script endpoint. The CLI uses `~/.claude/scripts/study-note-upload.sh` with three modes (`render` / `raw` / `text`); the Web app uses the Worker which ultimately posts the same JSON shape. Either can add entries at the top of the Pearl doc.
