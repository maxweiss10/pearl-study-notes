/* Pearl — loads manifest + entry fragments; renders section-grouped notes with
   metadata, collapsible sidebar (counts, pinned, recent), per-note subsection TOC,
   scroll-spy, reading progress, keyboard navigation, and synonym-aware search. */
(function () {
  'use strict';

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const TYPE_TOKENS = ['chalktalk', 'slide', 'paper', 'photo', 'note', 'video'];
  const WHITEBOOK_URL = 'https://maxweiss10.github.io/whitebook/pdfjs/web/viewer.html?file=../../whitebook.pdf';
  const WPM = 200;

  /* Lexical medical abbreviations → expansions, so "SVT" finds "supraventricular
     tachycardia" even when the note never spells the abbreviation. Purely
     terminological: no clinical claims encoded here. */
  const SYNONYMS = {
    svt: 'supraventricular tachycardia', vt: 'ventricular tachycardia',
    af: 'atrial fibrillation', afib: 'atrial fibrillation', aflutter: 'atrial flutter',
    hf: 'heart failure', hfref: 'heart failure reduced ejection fraction', chf: 'heart failure',
    mi: 'myocardial infarction', acs: 'acute coronary syndrome', cad: 'coronary artery disease',
    htn: 'hypertension', dm: 'diabetes mellitus', dka: 'diabetic ketoacidosis',
    ckd: 'chronic kidney disease', aki: 'acute kidney injury', esrd: 'end stage renal disease',
    copd: 'chronic obstructive pulmonary disease', pe: 'pulmonary embolism', dvt: 'deep vein thrombosis',
    ards: 'acute respiratory distress syndrome', osa: 'obstructive sleep apnea',
    uti: 'urinary tract infection', cap: 'community acquired pneumonia', hap: 'hospital acquired pneumonia',
    esbl: 'extended spectrum beta lactamase', mrsa: 'methicillin resistant staphylococcus aureus',
    gib: 'gastrointestinal bleed', gi: 'gastrointestinal', ams: 'altered mental status',
    icu: 'intensive care unit', micu: 'medical intensive care unit', ed: 'emergency department',
    cva: 'stroke cerebrovascular accident', tia: 'transient ischemic attack',
    oa: 'osteoarthritis', ra: 'rheumatoid arthritis', acl: 'anterior cruciate ligament',
    mcl: 'medial collateral ligament', lcl: 'lateral collateral ligament', pcl: 'posterior cruciate ligament',
    glp1: 'glp-1 semaglutide tirzepatide', bmi: 'body mass index',
    gcs: 'glasgow coma scale', tof: 'train of four', pris: 'propofol infusion syndrome',
    nsaid: 'nsaids ibuprofen ketorolac', ppi: 'proton pump inhibitor',
    bl: 'beta lactam', bli: 'beta lactamase inhibitor', abx: 'antibiotics',
    ldh: 'lactate dehydrogenase', bnp: 'brain natriuretic peptide',
    cxr: 'chest x-ray', ekg: 'electrocardiogram ecg', ecg: 'electrocardiogram ekg'
  };

  const $list = document.getElementById('list');
  const $q = document.getElementById('q');
  const $chips = document.getElementById('chips');
  const $count = document.getElementById('count');
  const $empty = document.getElementById('empty');
  const $toc = document.getElementById('toc');
  const $tocm = document.getElementById('tocm');
  const $tocmList = document.getElementById('tocm-list');
  const $prog = document.getElementById('prog');
  const $keys = document.getElementById('keys');

  let entries = [];
  let sectionHeads = [];
  let ordered = [];

  /* ---------- small persistence helpers ---------- */
  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem('pearl.' + key)) || fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem('pearl.' + key, JSON.stringify(val)); } catch (e) {}
  }
  let pinned = load('pinned', []);
  let recent = load('recent', []);
  let collapsed = load('collapsed', []);

  function fmtDate(iso) {
    const p = iso.split('-').map(Number);
    return MONTHS[p[1] - 1] + ' ' + p[2] + ', ' + p[0];
  }
  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- card construction ---------- */
  function buildCard(meta, fragmentHtml) {
    const card = document.createElement('article');
    card.className = 'card';
    card.id = meta.id;

    const header = document.createElement('header');
    const h2 = document.createElement('h2');
    const a = document.createElement('a');
    a.href = '#' + meta.id;
    a.textContent = meta.title;
    h2.appendChild(a);
    header.appendChild(h2);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = fragmentHtml;
    body.querySelectorAll('table').forEach(function (t) {
      if (t.closest('.tblwrap')) return;
      const w = document.createElement('div');
      w.className = 'tblwrap';
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    });

    // metadata: updated · category · reading time · pin
    const words = (body.textContent || '').trim().split(/\s+/).length;
    const mins = Math.max(1, Math.round(words / WPM));
    const metaEl = document.createElement('div');
    metaEl.className = 'meta';
    metaEl.innerHTML =
      '<time datetime="' + meta.date + '">' + fmtDate(meta.date) + '</time>' +
      '<span class="sep">·</span><span>' + esc(meta.section || '') + '</span>' +
      '<span class="sep">·</span><span>' + mins + ' min read</span>';
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'pin';
    pin.dataset.id = meta.id;
    metaEl.appendChild(pin);
    card.appendChild(metaEl);

    if (meta.source) {
      const src = document.createElement('p');
      src.className = 'src';
      const sa = document.createElement('a');
      sa.href = meta.source;
      sa.target = '_blank';
      sa.rel = 'noopener';
      sa.textContent = meta.source.replace(/^https?:\/\//, '');
      src.append('Source: ', sa);
      card.appendChild(src);
    }

    card.appendChild(body);
    return { card: card, bodyEl: body, titleEl: a, pinEl: pin, mins: mins };
  }

  function textOf(el) { return (el.textContent || '').replace(/\s+/g, ' ').toLowerCase(); }

  function highlight(root, terms) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      if (node.parentNode && node.parentNode.nodeName === 'STYLE') return;
      const text = node.nodeValue;
      const lower = text.toLowerCase();
      const hits = [];
      terms.forEach(function (t) {
        let i = 0;
        while ((i = lower.indexOf(t, i)) !== -1) { hits.push([i, i + t.length]); i += 1; }
      });
      if (!hits.length) return;
      hits.sort(function (a, b) { return a[0] - b[0]; });
      const merged = [];
      hits.forEach(function (h) {
        const last = merged[merged.length - 1];
        if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
        else merged.push(h.slice());
      });
      const frag = document.createDocumentFragment();
      let pos = 0;
      merged.forEach(function (se) {
        if (se[0] > pos) frag.appendChild(document.createTextNode(text.slice(pos, se[0])));
        const mark = document.createElement('mark');
        mark.textContent = text.slice(se[0], se[1]);
        frag.appendChild(mark);
        pos = se[1];
      });
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  /* ---------- search ---------- */
  function expand(term) {
    const out = [term];
    if (SYNONYMS[term]) out.push.apply(out, SYNONYMS[term].split(/\s+/));
    return out;
  }

  function applySearch() {
    const q = $q.value.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    let shown = 0;

    entries.forEach(function (e) {
      e.bodyEl.innerHTML = e.originalBody;
      e.titleEl.textContent = e.meta.title;

      const match = terms.every(function (t) {
        return expand(t).some(function (v) { return e.haystack.indexOf(v) !== -1; });
      });
      e.card.hidden = !match;
      if (match) {
        shown++;
        if (terms.length) {
          highlight(e.bodyEl, terms);
          highlight(e.titleEl, terms);
        }
      }
    });

    sectionHeads.forEach(function (s) {
      s.el.hidden = !s.entries.some(function (e) { return !e.card.hidden; });
    });

    $count.textContent = terms.length
      ? shown + ' / ' + entries.length + ' notes'
      : entries.length + ' notes';
    $empty.hidden = shown !== 0;

    document.querySelectorAll('.chip').forEach(function (c) {
      c.classList.toggle('on', c.dataset.kw === q);
    });
    onScroll();
  }

  let debounceTimer = null;
  function onInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applySearch, 80);
  }

  function buildChips(metas) {
    const freq = Object.create(null);
    metas.forEach(function (m) {
      m.keywords.split(',').forEach(function (k) {
        k = k.trim().toLowerCase();
        if (k) freq[k] = (freq[k] || 0) + 1;
      });
    });
    TYPE_TOKENS.filter(function (t) { return freq[t]; }).forEach(function (kw) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.dataset.kw = kw;
      b.textContent = kw;
      b.addEventListener('click', function () {
        $q.value = ($q.value.trim().toLowerCase() === kw) ? '' : kw;
        applySearch();
      });
      $chips.appendChild(b);
    });
  }

  /* ---------- sidebar ---------- */
  function pinLabel(id) { return pinned.indexOf(id) === -1 ? 'Pin' : 'Pinned'; }

  function renderPins() {
    entries.forEach(function (e) {
      const on = pinned.indexOf(e.meta.id) !== -1;
      e.pinEl.textContent = pinLabel(e.meta.id);
      e.pinEl.setAttribute('aria-pressed', on ? 'true' : 'false');
      e.pinEl.setAttribute('aria-label', (on ? 'Unpin ' : 'Pin ') + e.meta.title);
    });
    renderToc();
  }

  function listHtml(ids) {
    const byId = {};
    entries.forEach(function (e) { byId[e.meta.id] = e.meta; });
    return ids.map(function (id) {
      return byId[id] ? '<li><a href="#' + id + '">' + esc(byId[id].title) + '</a></li>' : '';
    }).join('');
  }

  function tocHtml() {
    let h = '';
    if (pinned.length) {
      h += '<p class="toc-title">Pinned</p><ul class="toc-recent">' + listHtml(pinned) + '</ul>';
    }
    if (recent.length) {
      h += '<p class="toc-title">Recently viewed</p><ul class="toc-recent">' + listHtml(recent.slice(0, 3)) + '</ul>';
    }
    h += '<p class="toc-title">Contents</p>';
    ordered.forEach(function (s) {
      if (!s.metas.length) return;
      const isClosed = collapsed.indexOf(s.name) !== -1;
      h += '<div class="toc-sec' + (isClosed ? ' closed' : '') + '" data-sec="' + esc(s.name) + '">' +
           '<button class="toc-sec-link" type="button" data-toggle="' + esc(s.name) + '" aria-expanded="' + (!isClosed) + '">' +
             '<span class="caret" aria-hidden="true">▾</span>' + esc(s.name) +
             '<span class="toc-n">' + s.metas.length + '</span>' +
           '</button><ul>';
      s.metas.forEach(function (m) {
        h += '<li data-id="' + m.id + '"><a href="#' + m.id + '">' + esc(m.title) + '</a></li>';
      });
      h += '</ul></div>';
    });
    h += '<p class="toc-foot"><a href="' + WHITEBOOK_URL + '" target="_blank" rel="noopener">White Book ↗</a></p>';
    return h;
  }

  function wireToc(root) {
    root.querySelectorAll('[data-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const name = btn.dataset.toggle;
        const box = btn.closest('.toc-sec');
        const nowClosed = !box.classList.contains('closed');
        box.classList.toggle('closed', nowClosed);
        btn.setAttribute('aria-expanded', String(!nowClosed));
        const i = collapsed.indexOf(name);
        if (nowClosed && i === -1) collapsed.push(name);
        if (!nowClosed && i !== -1) collapsed.splice(i, 1);
        save('collapsed', collapsed);
      });
    });
  }

  function renderToc() {
    const html = tocHtml();
    if ($toc) { $toc.innerHTML = html; wireToc($toc); }
    if ($tocmList) { $tocmList.innerHTML = html; wireToc($tocmList); }
    updateSpy();
  }

  /* ---------- scroll-spy · progress · subsection TOC ---------- */
  let spyTicking = false;
  let activeId = null;

  function updateSpy() {
    spyTicking = false;

    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    if ($prog) $prog.style.width = (max > 0 ? (doc.scrollTop / max) * 100 : 0) + '%';

    let cur = null;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.card.hidden) continue;
      if (e.card.getBoundingClientRect().top <= 140) cur = e;
    }

    document.querySelectorAll('#toc a.active').forEach(function (a) { a.classList.remove('active'); });
    document.querySelectorAll('#toc .subs').forEach(function (s) { s.remove(); });

    if (!cur) { activeId = null; return; }

    const li = $toc && $toc.querySelector('li[data-id="' + cur.meta.id + '"]');
    if (li) {
      const link = li.querySelector('a');
      if (link) link.classList.add('active');

      const secs = cur.bodyEl.querySelectorAll('.sec');
      if (secs.length > 1) {
        const ul = document.createElement('ul');
        ul.className = 'subs';
        secs.forEach(function (s, i) {
          if (!s.id) s.id = cur.meta.id + '-s' + i;
          const rect = s.getBoundingClientRect();
          const item = document.createElement('li');
          const a = document.createElement('a');
          a.href = '#' + s.id;
          a.textContent = s.textContent;
          if (rect.top <= 160) {
            document.querySelectorAll('#toc .subs a.active').forEach(function (x) { x.classList.remove('active'); });
            a.classList.add('active');
          }
          item.appendChild(a);
          ul.appendChild(item);
        });
        // keep only the last passed subsection marked active
        const actives = ul.querySelectorAll('a.active');
        for (let j = 0; j < actives.length - 1; j++) actives[j].classList.remove('active');
        li.appendChild(ul);
      }
    }

    if (cur.meta.id !== activeId) {
      activeId = cur.meta.id;
      const i = recent.indexOf(activeId);
      if (i !== -1) recent.splice(i, 1);
      recent.unshift(activeId);
      recent = recent.slice(0, 6);
      save('recent', recent);
    }
  }

  function onScroll() {
    if (!spyTicking) { spyTicking = true; requestAnimationFrame(updateSpy); }
  }

  /* ---------- keyboard ---------- */
  function visibleCards() {
    return entries.filter(function (e) { return !e.card.hidden; });
  }
  function jump(delta) {
    const vis = visibleCards();
    if (!vis.length) return;
    let idx = vis.findIndex(function (e) { return e.meta.id === activeId; });
    if (idx === -1) idx = 0;
    else idx = Math.min(vis.length - 1, Math.max(0, idx + delta));
    vis[idx].card.scrollIntoView({ block: 'start' });
  }

  let gPending = false;
  document.addEventListener('keydown', function (ev) {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (ev.key === 'Escape') {
      if ($keys && $keys.open) $keys.close();
      if ($tocm && $tocm.open) $tocm.open = false;
      if (typing) { $q.value = ''; applySearch(); $q.blur(); }
      return;
    }
    if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;

    if (ev.key === '/') { ev.preventDefault(); $q.focus(); return; }
    if (ev.key === '?') { ev.preventDefault(); if ($keys) ($keys.open ? $keys.close() : $keys.showModal()); return; }
    if (ev.key === 'j') { ev.preventDefault(); jump(1); return; }
    if (ev.key === 'k') { ev.preventDefault(); jump(-1); return; }
    if (ev.key === 'g') { gPending = true; setTimeout(function () { gPending = false; }, 700); return; }
    if (ev.key === 'h' && gPending) {
      gPending = false;
      window.scrollTo({ top: 0 });
    }
  });

  /* ---------- init ---------- */
  function init(manifest, fragMap) {
    const metas = manifest.entries;
    const names = (manifest.sections || []).slice();
    metas.forEach(function (m) {
      if (names.indexOf(m.section) === -1) names.push(m.section || 'Unsorted');
    });
    ordered = names.map(function (name) {
      return { name: name, metas: metas.filter(function (m) { return (m.section || 'Unsorted') === name; }) };
    });

    ordered.forEach(function (s) {
      if (!s.metas.length) return;
      const head = document.createElement('h2');
      head.className = 'sechead';
      head.id = 'sec-' + slugify(s.name);
      head.append(s.name);
      $list.appendChild(head);
      const rec = { name: s.name, el: head, entries: [] };
      sectionHeads.push(rec);

      s.metas.forEach(function (meta) {
        const built = buildCard(meta, fragMap[meta.id]);
        $list.appendChild(built.card);
        const e = {
          meta: meta,
          card: built.card,
          bodyEl: built.bodyEl,
          titleEl: built.titleEl,
          pinEl: built.pinEl,
          originalBody: built.bodyEl.innerHTML,
          haystack: (meta.title + ' ' + meta.section + ' ' + meta.keywords + ' ' +
                     (meta.aliases || '') + ' ' + textOf(built.bodyEl)).toLowerCase()
        };
        built.pinEl.addEventListener('click', function () {
          const i = pinned.indexOf(meta.id);
          if (i === -1) pinned.unshift(meta.id); else pinned.splice(i, 1);
          save('pinned', pinned);
          renderPins();
        });
        entries.push(e);
        rec.entries.push(e);
      });
    });

    buildChips(metas);
    renderPins();
    applySearch();

    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
    updateSpy();
  }

  $q.addEventListener('input', onInput);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  if ($tocm && $tocmList) {
    $tocmList.addEventListener('click', function (ev) {
      if (ev.target.closest('a[href^="#"]')) $tocm.open = false;
    });
    document.addEventListener('click', function (ev) {
      if ($tocm.open && !$tocm.contains(ev.target)) $tocm.open = false;
    });
  }
  if ($keys) {
    $keys.addEventListener('click', function (ev) { if (ev.target === $keys) $keys.close(); });
  }

  fetch('manifest.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (manifest) {
      return Promise.all(
        manifest.entries.map(function (m) {
          return fetch('entries/' + m.id + '.html')
            .then(function (r) { if (!r.ok) throw new Error(m.id); return r.text(); })
            .catch(function () { return '<p class="ptext mut">This note failed to load.</p>'; })
            .then(function (html) { return [m.id, html]; });
        })
      ).then(function (pairs) {
        const fragMap = {};
        pairs.forEach(function (p) { fragMap[p[0]] = p[1]; });
        init(manifest, fragMap);
      });
    })
    .catch(function () {
      $list.innerHTML = '<p class="empty">Could not load manifest.json — are you offline?</p>';
    });
})();
