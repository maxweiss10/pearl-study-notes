// Pearl — frontend logic (V5.1 reliability hardening)
// Modes: polished-single, raw-single, each, merge-polished, merge-raw, paper

const cfg = window.PEARL_CONFIG || {};
const WORKER = cfg.WORKER_URL || "";
const TOKEN  = cfg.CLIENT_TOKEN || "";
const DOC    = cfg.DOC_URL || "";
const BUILD  = window.PEARL_BUILD || "dev";

// ── Diagnostics ring buffer ──────────────────────────────────────────────────
const diag = {
  errors: [],
  events: [],
  log(msg, data) {
    const entry = `${new Date().toISOString().slice(11,23)}  ${msg}` + (data ? `  ${JSON.stringify(data)}` : "");
    this.events.push(entry);
    if (this.events.length > 60) this.events.shift();
  },
  error(label, err) {
    const entry = `${new Date().toISOString().slice(11,23)}  ${label}: ${err?.message || err}\n${err?.stack || ""}`;
    this.errors.push(entry);
    if (this.errors.length > 20) this.errors.shift();
    console.error(label, err);
  },
  snapshot() {
    const lines = [];
    lines.push("PEARL diagnostics");
    lines.push(`Build:   ${BUILD}`);
    lines.push(`Worker:  ${WORKER || "(unset)"}`);
    lines.push(`Doc:     ${DOC || "(unset)"}`);
    lines.push(`UA:      ${navigator.userAgent}`);
    lines.push(`heic2any loaded:   ${typeof window.heic2any === "function"}`);
    lines.push(`html2canvas loaded: ${typeof window.html2canvas === "function"}`);
    lines.push(`Selected files (${state.selectedFiles.length}):`);
    for (const f of state.selectedFiles) {
      const det = state.fileMeta.get(f) || {};
      lines.push(`  - ${f.name || "(no name)"} [${f.type || "no mime"}] ${f.size}B  heicName=${det.heicName} heicMime=${det.heicMime} heicSniff=${det.heicSniff ?? "?"} sniffHex=${det.sniffHex ?? "?"}  status=${det.status ?? "-"}${det.error ? " err=" + det.error : ""}`);
    }
    lines.push("");
    lines.push("Events (most recent last):");
    for (const e of this.events) lines.push("  " + e);
    lines.push("");
    lines.push("Errors:");
    for (const e of this.errors) lines.push("  " + e.split("\n").join("\n    "));
    return lines.join("\n");
  },
};

window.addEventListener("error", (e) => diag.error("window.error", e.error || new Error(e.message)));
window.addEventListener("unhandledrejection", (e) => diag.error("unhandledrejection", e.reason));

// ── Elements ─────────────────────────────────────────────────────────────────
const el = {
  mode:        document.getElementById("mode"),
  fileField:   document.getElementById("fileField"),
  files:       document.getElementById("files"),
  dropZone:    document.getElementById("dropZone"),
  pasteZone:   document.getElementById("pasteZone"),
  fileList:    document.getElementById("fileList"),
  urlField:    document.getElementById("urlField"),
  urlInput:    document.getElementById("urlInput"),
  paperNotesField: document.getElementById("paperNotesField"),
  paperNotesInput: document.getElementById("paperNotesInput"),
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
  build:       document.getElementById("buildVersion"),
  diagPanel:   document.getElementById("diagPanel"),
  diagBody:    document.getElementById("diagBody"),
  diagCopy:    document.getElementById("diagCopy"),
  diagClose:   document.getElementById("diagClose"),
  clearBtn:    document.getElementById("clearFilesBtn"),
};

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  selectedFiles: [],
  fileMeta: new Map(),   // File → { heicName, heicMime, heicSniff, sniffHex, status, error }
  artifacts: null,
  isHandlingDrop: false,
};

// ── Init ─────────────────────────────────────────────────────────────────────
if (DOC) el.openDoc.href = DOC;
if (!WORKER || !TOKEN) {
  el.cfgNotice.textContent = "⚠️ config.js not loaded — set WORKER_URL and CLIENT_TOKEN.";
  el.cfgNotice.style.color = "#8b2a2a";
}
el.build.textContent = "v" + BUILD;

// Diagnostic panel wiring
el.build.addEventListener("click", () => {
  el.diagBody.textContent = diag.snapshot();
  el.diagPanel.classList.toggle("hidden");
});
el.diagClose.addEventListener("click", () => el.diagPanel.classList.add("hidden"));
el.diagCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(diag.snapshot());
    el.diagCopy.textContent = "✓";
    setTimeout(() => (el.diagCopy.textContent = "📋"), 1200);
  } catch (err) {
    diag.error("clipboard", err);
  }
});

// Library-ready gate. html2canvas is required; heic2any is only needed for HEIC fallback on desktop.
function librariesReady() {
  return typeof window.html2canvas === "function";
}
(function waitForLibs() {
  if (librariesReady()) {
    el.generateBtn.disabled = false;
    el.generateBtn.textContent = "Add to Pearl";
    diag.log("Libraries ready");
  } else {
    el.generateBtn.disabled = true;
    el.generateBtn.textContent = "Loading…";
    setTimeout(waitForLibs, 100);
  }
})();

el.mode.addEventListener("change", onModeChange);
el.files.addEventListener("change", onFilesChange);
el.generateBtn.addEventListener("click", onGenerate);
el.submitBtn.addEventListener("click", onSubmit);
el.regenerate.addEventListener("click", onGenerate);
el.dropZone.addEventListener("click", () => el.files.click());
el.dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.files.click(); }
});

el.clearBtn.addEventListener("click", () => {
  state.selectedFiles = [];
  state.fileMeta = new Map();
  el.files.value = "";
  el.fileList.innerHTML = "";
  el.clearBtn.classList.add("hidden");
  resetPreview();
});

// Drag-and-drop
["dragenter", "dragover"].forEach((evt) =>
  el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.dropZone.classList.add("dragover");
  })
);
["dragleave", "dragend"].forEach((evt) =>
  el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.dropZone.classList.remove("dragover");
  })
);
el.dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  el.dropZone.classList.remove("dragover");
  handleDroppedFiles(e.dataTransfer?.files);
});
["dragover", "drop"].forEach((evt) =>
  window.addEventListener(evt, (e) => {
    if (!el.dropZone.contains(e.target)) e.preventDefault();
  })
);

// Paste-zone focus feedback — gives user a clear target to click-then-paste
el.pasteZone.addEventListener("click", () => el.pasteZone.focus());
el.pasteZone.addEventListener("focus", () => el.pasteZone.classList.add("focused"));
el.pasteZone.addEventListener("blur",  () => el.pasteZone.classList.remove("focused"));

function extractImagesFromClipboard(clipboardData) {
  if (!clipboardData) return [];
  const files = [];
  // Path 1: clipboardData.files (Chromium, Firefox)
  for (const f of Array.from(clipboardData.files || [])) {
    if (f.type.startsWith("image/")) files.push(f);
  }
  // Path 2: clipboardData.items (Safari, fallback)
  if (!files.length) {
    for (const it of Array.from(clipboardData.items || [])) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
  }
  return files;
}

function handlePasteEvent(e) {
  const imageFiles = extractImagesFromClipboard(e.clipboardData);
  if (!imageFiles.length) {
    diag.log("paste event: no image in clipboard");
    return false;
  }
  e.preventDefault();
  diag.log("paste image(s) received", { count: imageFiles.length });
  handleDroppedFiles(imageFiles);
  return true;
}

// Dedicated paste zone catches Cmd+V when focused
el.pasteZone.addEventListener("paste", handlePasteEvent);

// Also catch paste anywhere on the page, unless typing in a text field
window.addEventListener("paste", (e) => {
  const t = e.target;
  const isTextInput = t && (t.tagName === "TEXTAREA" ||
    (t.tagName === "INPUT" && t.id !== "urlInput" && t.type !== "url"));
  if (isTextInput) return;  // let the field paste text normally
  handlePasteEvent(e);
});

onModeChange();

// ── Mode ──────────────────────────────────────────────────────────────────────
function onModeChange() {
  const mode = el.mode.value;
  el.fileField.classList.toggle("hidden", mode === "paper");
  el.urlField.classList.toggle("hidden", mode !== "paper");
  el.paperNotesField.classList.toggle("hidden", mode !== "paper");
  el.files.setAttribute("multiple", "");
  resetPreview();
}

function onFilesChange() {
  handleDroppedFiles(el.files.files);
}

function handleDroppedFiles(fileList) {
  const raw = Array.from(fileList || []);
  diag.log("drop received", { count: raw.length, names: raw.map((f) => f.name) });

  // Loosened filter: keep anything that could plausibly be an image
  const accepted = raw.filter((f) => {
    if (f.type && f.type.startsWith("image/")) return true;
    if (/\.(heic|heif|png|jpe?g|gif|webp|bmp|tiff?|avif)$/i.test(f.name)) return true;
    if (!f.type && !/\./.test(f.name) && f.size > 1024) return true;
    return false;
  });

  if (!accepted.length) {
    diag.log("drop filtered to 0 files", { rawNames: raw.map((f) => f.name) });
    return;
  }

  // Additive: append to existing state, dedupe by name+size
  const keySet = new Set(state.selectedFiles.map((f) => `${f.name}::${f.size}`));
  const toAdd = accepted.filter((f) => !keySet.has(`${f.name}::${f.size}`));
  state.selectedFiles = state.selectedFiles.concat(toAdd);

  for (const f of toAdd) {
    state.fileMeta.set(f, {
      heicName: /\.(heic|heif)$/i.test(f.name || ""),
      heicMime: f.type === "image/heic" || f.type === "image/heif",
    });
    // Content-sniff in the background so the diag panel has full info
    sniffHeic(f).then((sniff) => {
      const meta = state.fileMeta.get(f);
      if (meta) { meta.heicSniff = sniff.isHeic; meta.sniffHex = sniff.hex; }
    });
  }

  diag.log("accepted files (additive)", {
    totalNow: state.selectedFiles.length,
    newlyAdded: toAdd.length,
    names: state.selectedFiles.map((f) => f.name),
  });

  renderThumbnails();
  el.clearBtn.classList.toggle("hidden", state.selectedFiles.length === 0);
  resetPreview();
}

// ── HEIC detection ────────────────────────────────────────────────────────────
function isHeicFast(file) {
  if (!file) return false;
  if (/\.(heic|heif)$/i.test(file.name || "")) return true;
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  return false;
}

async function sniffHeic(file) {
  // ISO BMFF HEIC/HEIF: bytes 4..8 = "ftyp", bytes 8..12 in {heic,heix,hevc,hevx,mif1,msf1,heim,heis,hevm,hevs}
  try {
    const slice = await file.slice(0, 12).arrayBuffer();
    const bytes = new Uint8Array(slice);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const brand = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    const major = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    const isHeic = brand === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|hevm|hevs)$/.test(major);
    return { isHeic, hex, major };
  } catch (err) {
    diag.error("sniffHeic", err);
    return { isHeic: false, hex: "", major: "" };
  }
}

async function isHeicAccurate(file) {
  if (isHeicFast(file)) return true;
  const s = await sniffHeic(file);
  return s.isHeic;
}

// ── Thumbnails ───────────────────────────────────────────────────────────────
function renderThumbnails() {
  el.fileList.innerHTML = "";
  for (const f of state.selectedFiles) {
    const wrap = document.createElement("div");
    wrap.className = "thumb-wrap";
    const label = document.createElement("div");
    label.className = "thumb-name";
    label.textContent = f.name.length > 18 ? f.name.slice(0, 15) + "…" : f.name;
    label.title = f.name;

    if (isHeicFast(f)) {
      // Show filename chip; browsers can't render HEIC natively
      const chip = document.createElement("div");
      chip.className = "thumb filename-chip";
      chip.textContent = "HEIC";
      wrap.appendChild(chip);
    } else {
      const img = document.createElement("img");
      img.className = "thumb";
      img.alt = f.name;
      img.onerror = () => {
        img.remove();
        const chip = document.createElement("div");
        chip.className = "thumb filename-chip";
        chip.textContent = "IMG";
        wrap.insertBefore(chip, label);
      };
      const reader = new FileReader();
      reader.onload = (e) => (img.src = e.target.result);
      reader.readAsDataURL(f);
      wrap.appendChild(img);
    }
    wrap.appendChild(label);
    state.fileMeta.get(f) && (state.fileMeta.get(f)._wrap = wrap);
    el.fileList.appendChild(wrap);
  }
}

function markFileStatus(file, status, error) {
  const meta = state.fileMeta.get(file);
  if (!meta) return;
  meta.status = status;
  if (error) meta.error = error;
  const wrap = meta._wrap;
  if (wrap) {
    wrap.classList.remove("thumb-ok", "thumb-fail", "thumb-busy");
    if (status === "done") wrap.classList.add("thumb-ok");
    else if (status === "failed") { wrap.classList.add("thumb-fail"); wrap.title = error || "failed"; }
    else wrap.classList.add("thumb-busy");
  }
}

function resetPreview() {
  state.artifacts = null;
  el.preview.innerHTML = "";
  el.previewSec.classList.add("hidden");
  el.submitBtn.classList.add("hidden");
  setStatus("");
}

// ── Generate ─────────────────────────────────────────────────────────────────
async function onGenerate() {
  if (!librariesReady()) {
    setStatus("Converters still loading — try again in a moment.", "error");
    return;
  }
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
    // Auto-submit immediately after prep succeeds
    await onSubmit();
  } catch (err) {
    diag.error("onGenerate:" + mode, err);
    setStatus("Error: " + err.message, "error");
  } finally {
    el.generateBtn.disabled = false;
  }
}

// ── Mode preparers ───────────────────────────────────────────────────────────
async function prepPolished(isMerge) {
  if (!state.selectedFiles.length) throw new Error("Pick at least one image");
  if (!isMerge && state.selectedFiles.length > 1) {
    const choice = confirm(
      `${state.selectedFiles.length} images selected. OK = merge into one polished entry, Cancel = one polished entry per image.`
    );
    el.mode.value = choice ? "merge-polished" : "each";
    onModeChange();
    return choice ? prepPolished(true) : prepEach();
  }

  const images = [];
  for (let i = 0; i < state.selectedFiles.length; i++) {
    const f = state.selectedFiles[i];
    setStatus(`Converting ${i + 1}/${state.selectedFiles.length}…`);
    markFileStatus(f, "busy");
    try {
      const pngBlob = await convertToPngBlob(f);
      const b64 = await blobToBase64(pngBlob);
      images.push({ base64: b64, mimeType: "image/png" });
      markFileStatus(f, "done");
    } catch (err) {
      markFileStatus(f, "failed", err.message);
      throw new Error(`File "${f.name}": ${err.message}`);
    }
  }

  setStatus("Generating polished design with AI…");
  const res = await workerPost("/polish", { images });
  setStatus("Rendering preview…");
  const pngBlob = await renderHtmlToPng(res.html);
  const pngB64  = await blobToBase64(pngBlob);

  el.preview.innerHTML = "";
  const img = document.createElement("img");
  img.src = "data:image/png;base64," + pngB64;
  el.preview.appendChild(img);
  el.title.value = res.title || "";
  el.keywords.value = res.keywords || "";
  el.bodyField.classList.add("hidden");
  state.artifacts = { type: "polished", imageBase64: pngB64, mimeType: "image/png" };
}

async function prepRawSingle() {
  if (state.selectedFiles.length === 0) throw new Error("Pick an image");
  if (state.selectedFiles.length > 1) {
    el.mode.value = "merge-raw";
    onModeChange();
    return prepMergeRaw();
  }
  const f = state.selectedFiles[0];
  markFileStatus(f, "busy");
  try {
    setStatus("Converting…");
    const pngBlob = await convertToPngBlob(f);
    const pngB64  = await blobToBase64(pngBlob);

    // Ask AI for title + keywords (no HTML recreation)
    setStatus("Generating title + keywords…");
    const meta = await workerPost("/polish", {
      images: [{ base64: pngB64, mimeType: "image/png" }],
      metaOnly: true,
    });

    markFileStatus(f, "done");
    el.preview.innerHTML = "";
    const img = document.createElement("img");
    img.src = "data:image/png;base64," + pngB64;
    el.preview.appendChild(img);
    el.title.value = meta.title || "";
    el.keywords.value = meta.keywords || "";
    el.bodyField.classList.add("hidden");
    state.artifacts = { type: "raw", imageBase64: pngB64, mimeType: "image/png" };
  } catch (err) {
    markFileStatus(f, "failed", err.message);
    throw err;
  }
}

async function prepEach() {
  if (state.selectedFiles.length < 1) throw new Error("Pick at least one image");
  const entries = [];
  const failures = [];
  for (let i = 0; i < state.selectedFiles.length; i++) {
    const f = state.selectedFiles[i];
    const label = `${i + 1}/${state.selectedFiles.length}`;
    try {
      setStatus(`${label}: Converting…`);
      markFileStatus(f, "busy");
      const pngBlob = await convertToPngBlob(f);
      const b64 = await blobToBase64(pngBlob);
      setStatus(`${label}: AI analyzing…`);
      const res = await workerPost("/polish", { images: [{ base64: b64, mimeType: "image/png" }] });
      setStatus(`${label}: Rendering…`);
      const renderedPng = await renderHtmlToPng(res.html);
      const renderedB64 = await blobToBase64(renderedPng);
      entries.push({
        title: res.title || `Entry ${i + 1}`,
        keywords: res.keywords || "",
        imageBase64: renderedB64,
        mimeType: "image/png",
      });
      markFileStatus(f, "done");
    } catch (err) {
      diag.error(`prepEach file ${f.name}`, err);
      markFileStatus(f, "failed", err.message);
      failures.push({ name: f.name, error: err.message });
    }
  }

  if (!entries.length) throw new Error("All files failed: " + failures.map((f) => f.name).join(", "));

  // Preview: stacked mini-cards
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
  if (failures.length) {
    const warn = document.createElement("div");
    warn.style.cssText = "color:#8b2a2a;font-size:13px;margin-top:10px;";
    warn.textContent = `⚠️ ${failures.length} failed: ${failures.map((f) => f.name).join(", ")}`;
    el.preview.appendChild(warn);
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

  const pngBlobs = [];
  for (let i = 0; i < state.selectedFiles.length; i++) {
    const f = state.selectedFiles[i];
    setStatus(`Converting ${i + 1}/${state.selectedFiles.length}…`);
    markFileStatus(f, "busy");
    try {
      pngBlobs.push(await convertToPngBlob(f));
      markFileStatus(f, "done");
    } catch (err) {
      markFileStatus(f, "failed", err.message);
      throw new Error(`File "${f.name}": ${err.message}`);
    }
  }

  setStatus("Stacking images…");
  const imgs = await Promise.all(pngBlobs.map(blobToImage));
  const W = Math.max(...imgs.map((i) => i.naturalWidth));
  const GAP = 18;
  const scaled = imgs.map((i) => {
    if (i.naturalWidth === W) return { img: i, h: i.naturalHeight };
    return { img: i, h: Math.round((i.naturalHeight * W) / i.naturalWidth) };
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

  // Ask AI for title + keywords covering all stacked images (no HTML recreation)
  setStatus("Generating title + keywords…");
  const perImageB64 = await Promise.all(pngBlobs.map(blobToBase64));
  const meta = await workerPost("/polish", {
    images: perImageB64.map((b) => ({ base64: b, mimeType: "image/png" })),
    metaOnly: true,
  });

  el.preview.innerHTML = "";
  const img = document.createElement("img");
  img.src = "data:image/png;base64," + pngB64;
  el.preview.appendChild(img);
  el.title.value = meta.title || "";
  el.keywords.value = meta.keywords || "";
  el.bodyField.classList.add("hidden");
  state.artifacts = { type: "raw", imageBase64: pngB64, mimeType: "image/png" };
}

async function prepPaper() {
  const url = el.urlInput.value.trim();
  const userNotes = el.paperNotesInput.value.trim();
  if (!url) throw new Error("Paste a URL");
  setStatus("Fetching + summarizing…");
  const res = await workerPost("/paper", { url, userNotes });
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

// ── Submit ───────────────────────────────────────────────────────────────────
async function onSubmit() {
  if (!state.artifacts) { setStatus("Generate first.", "error"); return; }
  el.submitBtn.disabled = true;
  setStatus("Uploading…");
  try {
    if (state.artifacts.type === "each") {
      for (let i = 0; i < state.artifacts.entries.length; i++) {
        setStatus(`Uploading ${i + 1}/${state.artifacts.entries.length}…`);
        await workerPost("/submit", state.artifacts.entries[i]);
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
    setTimeout(() => {
      resetPreview();
      state.selectedFiles = [];
      state.fileMeta = new Map();
      el.files.value = "";
      el.fileList.innerHTML = "";
      el.urlInput.value = "";
      el.paperNotesInput.value = "";
      el.clearBtn.classList.add("hidden");
      el.title.disabled = false;
      el.keywords.disabled = false;
    }, 1500);
  } catch (err) {
    diag.error("onSubmit", err);
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
    headers: { "Content-Type": "application/json", "X-Client-Token": TOKEN },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.error) throw new Error(json.error || `Worker ${resp.status}`);
  return json;
}

const MAX_DIM = 1600;

async function decodeHeicFallback(file) {
  if (typeof window.heic2any !== "function") {
    throw new Error(
      "This browser can't decode HEIC. Easy fix: open in iPhone Safari (HEIC works natively), " +
      "or convert on macOS — in Finder, right-click the HEIC → Quick Actions → Convert Image → JPEG."
    );
  }
  try {
    const blob = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const out = Array.isArray(blob) ? blob[0] : blob;
    diag.log("heic2any converted", { inSize: file.size, outSize: out.size });
    return out;
  } catch (err) {
    diag.error("heic2any", err);
    throw new Error(
      "Could not decode this HEIC (desktop browsers have limited HEIC support). " +
      "Easiest fix: in Finder, right-click the HEIC → Quick Actions → Convert Image → JPEG, then retry. " +
      "Or use Pearl on your iPhone where HEIC works natively."
    );
  }
}

async function convertToPngBlob(originalFile) {
  diag.log("convertToPngBlob", { name: originalFile.name, size: originalFile.size, type: originalFile.type });
  let file = originalFile;
  let width, height, source;

  // Strategy 1: try native decode first. iPhone Safari decodes HEIC natively this way.
  try {
    const bitmap = await createImageBitmap(file);
    width  = bitmap.width;
    height = bitmap.height;
    source = bitmap;
    diag.log("native createImageBitmap succeeded");
  } catch (nativeErr) {
    diag.log("native decode failed", { error: nativeErr.message });

    // Strategy 2: if it's a HEIC, try heic2any fallback (desktop path)
    const isHeic = await isHeicAccurate(file);
    if (isHeic) {
      file = await decodeHeicFallback(file);
      try {
        const bitmap = await createImageBitmap(file);
        width  = bitmap.width;
        height = bitmap.height;
        source = bitmap;
      } catch (err2) {
        diag.error("post-heic-fallback createImageBitmap", err2);
        throw new Error("Decoded HEIC but still can't render it.");
      }
    } else {
      // Strategy 3: try <img> tag (can decode some formats createImageBitmap rejects)
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error("Could not decode image — try a JPG or PNG"));
          i.src = dataUrl;
        });
        width  = img.naturalWidth;
        height = img.naturalHeight;
        source = img;
      } catch (imgErr) {
        throw new Error("Could not decode image — try a JPG or PNG");
      }
    }
  }

  const longEdge = Math.max(width, height);
  if (longEdge > MAX_DIM) {
    const scale = MAX_DIM / longEdge;
    width  = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width  = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, 0, 0, width, height);
  return await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
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
    reader.onload  = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function renderHtmlToPng(htmlString) {
  const iframe = document.createElement("iframe");
  iframe.className = "polish-frame";
  iframe.style.cssText = "position:absolute;left:-9999px;top:0;width:800px;border:none;background:#fff;";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;padding:0;background:#fff;">${htmlString}</body></html>`);
  doc.close();
  await new Promise((r) => setTimeout(r, 200));

  const canvas = await html2canvas(doc.body, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    logging: false,
    width: 800,
    windowWidth: 800,
  });
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
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) { rowHasContent = true; break; }
    }
    if (rowHasContent) { bottom = y + 1; break; }
  }
  const newH = Math.min(height, bottom + 24);
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
