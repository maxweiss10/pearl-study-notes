// Pearl — frontend logic
// Modes:
//   polished-single, raw-single, each, merge-polished, merge-raw, paper

const cfg = window.PEARL_CONFIG || {};
const WORKER = cfg.WORKER_URL || "";
const TOKEN  = cfg.CLIENT_TOKEN || "";
const DOC    = cfg.DOC_URL || "";

// ── Elements ─────────────────────────────────────────────────────────────────
const el = {
  mode:        document.getElementById("mode"),
  fileField:   document.getElementById("fileField"),
  files:       document.getElementById("files"),
  fileList:    document.getElementById("fileList"),
  urlField:    document.getElementById("urlField"),
  urlInput:    document.getElementById("urlInput"),
  preview:     document.getElementById("preview"),
  previewSec:  document.getElementById("previewSection"),
  title:       document.getElementById("titleInput"),
  keywords:    document.getElementById("keywordsInput"),
  bodyField:   document.getElementById("bodyField"),
  bodyInput:   document.getElementById("bodyInput"),
  generateBtn: document.getElementById("generateBtn"),
  submitBtn:   document.getElementById("submitBtn"),
  regenerate:  document.getElementById("regenerateBtn"),
  status:      document.getElementById("status"),
  openDoc:     document.getElementById("openDoc"),
  cfgNotice:   document.getElementById("config-notice"),
};

// ── State ────────────────────────────────────────────────────────────────────
let state = {
  selectedFiles: [],
  // The prepared artifacts for submission, keyed by mode behavior
  artifacts: null, // { type: "polished" | "raw" | "stacked-raw" | "paper" | "each", ... }
};

// ── Init ─────────────────────────────────────────────────────────────────────
if (DOC) el.openDoc.href = DOC;
if (!WORKER || !TOKEN) {
  el.cfgNotice.textContent = "⚠️ config.js not loaded — set WORKER_URL and CLIENT_TOKEN.";
  el.cfgNotice.style.color = "#8b2a2a";
}

el.mode.addEventListener("change", onModeChange);
el.files.addEventListener("change", onFilesChange);
el.generateBtn.addEventListener("click", onGenerate);
el.submitBtn.addEventListener("click", onSubmit);
el.regenerate.addEventListener("click", onGenerate);

// Drag-and-drop wiring on the .filedrop label
const dropZone = document.querySelector(".filedrop");
if (dropZone) {
  ["dragenter", "dragover"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("dragover");
    })
  );
  ["dragleave", "dragend"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("dragover");
    })
  );
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("dragover");
    const files = Array.from(e.dataTransfer?.files || []).filter(
      (f) => f.type.startsWith("image/") || /\.heic$/i.test(f.name)
    );
    if (!files.length) return;

    // Assign to the hidden <input> via DataTransfer so onFilesChange() works
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    el.files.files = dt.files;
    el.files.dispatchEvent(new Event("change"));
  });
}

// Also allow dropping anywhere on the page for convenience (prevents browser
// from navigating to the image if you miss the drop target)
["dragover", "drop"].forEach((evt) =>
  window.addEventListener(evt, (e) => e.preventDefault())
);

onModeChange();

// ── Mode switching ───────────────────────────────────────────────────────────
function onModeChange() {
  const mode = el.mode.value;
  const needsFiles = mode !== "paper";
  const needsUrl   = mode === "paper";

  el.fileField.classList.toggle("hidden", !needsFiles);
  el.urlField.classList.toggle("hidden", !needsUrl);
  // Always allow multiple files — the mode decides what to do with them at Generate time
  el.files.setAttribute("multiple", "");

  // Reset preview when mode changes
  resetPreview();
}

function onFilesChange() {
  state.selectedFiles = Array.from(el.files.files || []);
  el.fileList.innerHTML = "";
  for (const f of state.selectedFiles) {
    if (!f.type.startsWith("image/") && !/\.heic$/i.test(f.name)) continue;
    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = f.name;
    const reader = new FileReader();
    reader.onload = (e) => (img.src = e.target.result);
    reader.readAsDataURL(f);
    el.fileList.appendChild(img);
  }
  resetPreview();
}

function resetPreview() {
  state.artifacts = null;
  el.preview.innerHTML = "";
  el.previewSec.classList.add("hidden");
  el.submitBtn.classList.add("hidden");
  setStatus("");
}

// ── Generate (prepare artifacts) ─────────────────────────────────────────────
async function onGenerate() {
  const mode = el.mode.value;
  setStatus("Working…");
  el.generateBtn.disabled = true;

  try {
    switch (mode) {
      case "polished-single": await prepPolished(false); break;
      case "raw-single":      await prepRawSingle();     break;
      case "each":            await prepEach();          break;
      case "merge-polished":  await prepPolished(true);  break;
      case "merge-raw":       await prepMergeRaw();      break;
      case "paper":           await prepPaper();         break;
      default: throw new Error("Unknown mode");
    }
    el.previewSec.classList.remove("hidden");
    el.submitBtn.classList.remove("hidden");
    setStatus("");
  } catch (err) {
    setStatus("Error: " + err.message, "error");
  } finally {
    el.generateBtn.disabled = false;
  }
}

// ── Preparers by mode ────────────────────────────────────────────────────────

async function prepPolished(isMerge) {
  if (!state.selectedFiles.length) throw new Error("Pick at least one image");
  if (!isMerge && state.selectedFiles.length > 1) {
    // Auto-switch to a multi mode — ask the user which flavor
    const choice = confirm(
      `${state.selectedFiles.length} images selected. OK = merge into one polished entry, Cancel = one polished entry per image.`
    );
    el.mode.value = choice ? "merge-polished" : "each";
    onModeChange();
    // re-trigger generate with the new mode
    return choice ? prepPolished(true) : prepEach();
  }

  const images = await Promise.all(state.selectedFiles.map(async (f) => {
    const pngBlob = await convertToPngBlob(f);
    return { base64: await blobToBase64(pngBlob), mimeType: "image/png" };
  }));

  const res = await workerPost("/polish", { images });

  // Render HTML to PNG in the browser
  const pngBlob = await renderHtmlToPng(res.html);
  const pngB64  = await blobToBase64(pngBlob);

  // Populate preview with the rendered PNG
  el.preview.innerHTML = "";
  const img = document.createElement("img");
  img.src = "data:image/png;base64," + pngB64;
  el.preview.appendChild(img);

  el.title.value = res.title || "";
  el.keywords.value = res.keywords || "";
  el.bodyField.classList.add("hidden");

  state.artifacts = {
    type: "polished",
    imageBase64: pngB64,
    mimeType: "image/png",
  };
}

async function prepRawSingle() {
  if (state.selectedFiles.length === 0) throw new Error("Pick an image");
  if (state.selectedFiles.length > 1) {
    // Auto-switch to merge-raw (stacked) for multiple raw photos
    el.mode.value = "merge-raw";
    onModeChange();
    return prepMergeRaw();
  }
  const f = state.selectedFiles[0];
  const pngBlob = await convertToPngBlob(f);
  const pngB64  = await blobToBase64(pngBlob);

  el.preview.innerHTML = "";
  const img = document.createElement("img");
  img.src = "data:image/png;base64," + pngB64;
  el.preview.appendChild(img);

  // For raw modes, user types title + keywords manually (no AI)
  el.title.value = el.title.value || "";
  el.keywords.value = el.keywords.value || "";
  el.bodyField.classList.add("hidden");

  state.artifacts = { type: "raw", imageBase64: pngB64, mimeType: "image/png" };
}

async function prepEach() {
  if (state.selectedFiles.length < 1) throw new Error("Pick at least one image");

  // Each image → its own polished entry. We prepare all now, submit them sequentially.
  const entries = [];
  for (const [i, f] of state.selectedFiles.entries()) {
    setStatus(`Generating ${i + 1} / ${state.selectedFiles.length}…`);
    const pngBlob = await convertToPngBlob(f);
    const b64 = await blobToBase64(pngBlob);
    const res = await workerPost("/polish", {
      images: [{ base64: b64, mimeType: "image/png" }],
    });
    const renderedPng = await renderHtmlToPng(res.html);
    const renderedB64 = await blobToBase64(renderedPng);
    entries.push({
      title: res.title || `Entry ${i + 1}`,
      keywords: res.keywords || "",
      imageBase64: renderedB64,
      mimeType: "image/png",
    });
  }

  // Preview: show all rendered previews stacked, disable editable title/keywords
  el.preview.innerHTML = "";
  for (const e of entries) {
    const block = document.createElement("div");
    block.style.marginBottom = "14px";
    block.innerHTML = `<div style="font-weight:600;color:#1a3a5c;margin-bottom:4px;">${escapeHtml(e.title)}</div>`;
    const img = document.createElement("img");
    img.src = "data:image/png;base64," + e.imageBase64;
    block.appendChild(img);
    const kws = document.createElement("div");
    kws.style.cssText = "font-size:12px;color:#888;font-style:italic;margin-top:4px;";
    kws.textContent = e.keywords;
    block.appendChild(kws);
    el.preview.appendChild(block);
  }

  el.title.value = `${entries.length} entries — titles auto-set per image`;
  el.title.disabled = true;
  el.keywords.value = "(auto per entry)";
  el.keywords.disabled = true;
  el.bodyField.classList.add("hidden");

  state.artifacts = { type: "each", entries };
}

async function prepMergeRaw() {
  if (state.selectedFiles.length < 1) throw new Error("Pick at least one image");

  // Convert each, stack vertically on a canvas
  const pngBlobs = await Promise.all(state.selectedFiles.map(convertToPngBlob));
  const imgs    = await Promise.all(pngBlobs.map(blobToImage));
  const W       = Math.max(...imgs.map((i) => i.naturalWidth));
  const GAP     = 18;
  const scaled  = imgs.map((i) => {
    if (i.naturalWidth === W) return { img: i, h: i.naturalHeight };
    const h = Math.round((i.naturalHeight * W) / i.naturalWidth);
    return { img: i, h };
  });
  const H = scaled.reduce((s, x) => s + x.h, 0) + GAP * (scaled.length - 1);

  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  let y = 0;
  for (const s of scaled) {
    ctx.drawImage(s.img, 0, y, W, s.h);
    y += s.h + GAP;
  }

  const pngB64 = canvas.toDataURL("image/png").split(",")[1];

  el.preview.innerHTML = "";
  const img = document.createElement("img");
  img.src = "data:image/png;base64," + pngB64;
  el.preview.appendChild(img);

  el.bodyField.classList.add("hidden");
  state.artifacts = { type: "raw", imageBase64: pngB64, mimeType: "image/png" };
}

async function prepPaper() {
  const url = el.urlInput.value.trim();
  if (!url) throw new Error("Paste a URL");

  const res = await workerPost("/paper", { url });

  el.preview.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "paper-preview";
  const paras = (res.bodyText || "").split(/\n\n+/);
  for (const p of paras) {
    if (!p.trim()) continue;
    const el2 = document.createElement("p");
    el2.textContent = p.trim();
    wrap.appendChild(el2);
  }
  el.preview.appendChild(wrap);

  el.title.value = res.title || "";
  el.title.disabled = false;
  el.keywords.value = res.keywords || "";
  el.keywords.disabled = false;
  el.bodyInput.value = res.bodyText || "";
  el.bodyField.classList.remove("hidden");

  state.artifacts = { type: "paper", sourceUrl: url };
}

// ── Submit (send artifacts to Apps Script) ───────────────────────────────────
async function onSubmit() {
  if (!state.artifacts) { setStatus("Generate first.", "error"); return; }
  el.submitBtn.disabled = true;
  setStatus("Uploading…");

  try {
    if (state.artifacts.type === "each") {
      let i = 0;
      for (const entry of state.artifacts.entries) {
        i++;
        setStatus(`Uploading ${i} / ${state.artifacts.entries.length}…`);
        await workerPost("/submit", entry);
      }
      setStatus(`Added ${state.artifacts.entries.length} entries to Pearl.`, "success");
    } else if (state.artifacts.type === "paper") {
      await workerPost("/submit", {
        title:     el.title.value.trim(),
        keywords:  el.keywords.value.trim(),
        bodyText:  el.bodyInput.value.trim(),
        sourceUrl: state.artifacts.sourceUrl,
      });
      setStatus(`Added "${el.title.value.trim()}" to Pearl.`, "success");
    } else {
      await workerPost("/submit", {
        title:       el.title.value.trim(),
        keywords:    el.keywords.value.trim(),
        imageBase64: state.artifacts.imageBase64,
        mimeType:    state.artifacts.mimeType,
      });
      setStatus(`Added "${el.title.value.trim()}" to Pearl.`, "success");
    }

    // Reset for next
    setTimeout(() => {
      resetPreview();
      state.selectedFiles = [];
      el.files.value = "";
      el.fileList.innerHTML = "";
      el.urlInput.value = "";
      el.title.disabled = false;
      el.keywords.disabled = false;
    }, 1500);

  } catch (err) {
    setStatus("Error: " + err.message, "error");
  } finally {
    el.submitBtn.disabled = false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function workerPost(path, body) {
  if (!WORKER) throw new Error("WORKER_URL not configured");
  const resp = await fetch(WORKER + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Token": TOKEN,
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.error) {
    throw new Error(json.error || `Worker ${resp.status}`);
  }
  return json;
}

// iOS Safari can't decode HEIC via <img>. Use a <canvas> path with createImageBitmap
// when possible; otherwise send original bytes as PNG fallback (HEIC → raw upload
// works because the browser side only needs to display a thumbnail, and the Apps Script
// path handles image bytes directly). For robust HEIC support, we rely on the browser
// to decode HEIC directly (iOS Safari does this since 17).
async function convertToPngBlob(file) {
  // If the file is already a web-friendly image, render through canvas to ensure PNG.
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    // Fallback: just return the raw file as-is (Apps Script may reject HEIC).
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width  = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  return await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(",")[1]); // strip data:...;base64,
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function renderHtmlToPng(htmlString) {
  // Create an offscreen iframe sized to 800px (matches CLI render width)
  const iframe = document.createElement("iframe");
  iframe.className = "polish-frame";
  iframe.style.cssText = "position:absolute;left:-9999px;top:0;width:800px;border:none;background:#fff;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#fff;">
    ${htmlString}
    </body></html>`);
  doc.close();

  // Wait for content to render
  await new Promise((r) => setTimeout(r, 200));

  const root = doc.body;
  const canvas = await html2canvas(root, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    logging: false,
    width: 800,
    windowWidth: 800,
  });

  // Trim trailing whitespace
  const trimmed = trimWhitespace(canvas);

  document.body.removeChild(iframe);
  return await new Promise((resolve) => trimmed.toBlob(resolve, "image/png", 0.95));
}

function trimWhitespace(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  let bottom = 0;
  for (let y = height - 1; y >= 0; y--) {
    let rowHasContent = false;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < 250 || g < 250 || b < 250) { rowHasContent = true; break; }
    }
    if (rowHasContent) { bottom = y + 1; break; }
  }

  const margin = 24;
  const newH = Math.min(height, bottom + margin);
  if (newH === height) return canvas;

  const out = document.createElement("canvas");
  out.width  = width;
  out.height = newH;
  out.getContext("2d").drawImage(canvas, 0, 0);
  return out;
}

function setStatus(text, cls = "") {
  el.status.textContent = text;
  el.status.className = "status" + (cls ? " " + cls : "");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
