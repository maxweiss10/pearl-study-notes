# Pearl Worker

Three endpoints, all POST, all require `X-Client-Token` header matching `CLIENT_TOKEN` secret.

| Endpoint | Purpose |
|----------|---------|
| `/polish` | Anthropic vision call — `{ images: [{base64, mimeType}, ...] }` → `{ title, html, keywords }` |
| `/paper`  | Fetch URL + Anthropic summarize — `{ url }` → `{ title, bodyText, keywords }` |
| `/submit` | Inject `STUDY_NOTES_SECRET`, forward to Apps Script — accepts `{ title, imageBase64?, mimeType?, bodyText?, keywords?, sourceUrl? }` |

## Secrets

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put STUDY_NOTES_SECRET
wrangler secret put STUDY_NOTES_WEBAPP_URL
wrangler secret put CLIENT_TOKEN
```

## Deploy

```bash
wrangler deploy
```

## Local dev

```bash
# Put non-secret dev values in .dev.vars (gitignored):
cat > .dev.vars <<'EOF'
ANTHROPIC_API_KEY=sk-ant-...
STUDY_NOTES_SECRET=...
STUDY_NOTES_WEBAPP_URL=https://script.google.com/...
CLIENT_TOKEN=dev-token
EOF

wrangler dev
```
