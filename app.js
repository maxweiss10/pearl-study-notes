/* Pearl — loads manifest.json + entry fragments, renders section-grouped cards
   with a table of contents, instant search with highlighting. */
(function () {
  'use strict';

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const TYPE_TOKENS = ['chalktalk', 'slide', 'paper', 'photo', 'note', 'video'];
  const SECTION_DOTS = ['#c2452d','#7c3aed','#ad2d51','#0e7490','#0f766e','#b45309','#4f46e5','#15803d','#a21caf','#374151'];
  const WHITEBOOK_URL = 'https://maxweiss10.github.io/whitebook/pdfjs/web/viewer.html?file=../../whitebook.pdf';

  const $list = document.getElementById('list');
  const $q = document.getElementById('q');
  const $chips = document.getElementById('chips');
  const $count = document.getElementById('count');
  const $empty = document.getElementById('empty');
  const $toc = document.getElementById('toc');
  const $tocm = document.getElementById('tocm');
  const $tocmList = document.getElementById('tocm-list');

  let entries = [];       // {meta, card, bodyEl, titleEl, originalBody, haystack}
  let sectionHeads = [];  // {name, el, entries: [entry refs]}

  function fmtDate(iso) {
    const p = iso.split('-').map(Number);
    return MONTHS[p[1] - 1] + ' ' + p[2] + ', ' + p[0];
  }

  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

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
    const time = document.createElement('time');
    time.dateTime = meta.date;
    time.textContent = fmtDate(meta.date);
    header.appendChild(h2);
    header.appendChild(time);
    card.appendChild(header);

    const tags = document.createElement('p');
    tags.className = 'tags';
    tags.textContent = meta.keywords;
    card.appendChild(tags);

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
    card.appendChild(body);
    return { card: card, bodyEl: body, titleEl: a };
  }

  function textOf(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').toLowerCase();
  }

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
        while ((i = lower.indexOf(t, i)) !== -1) {
          hits.push([i, i + t.length]);
          i += 1;
        }
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

  function applySearch() {
    const q = $q.value.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    let shown = 0;

    entries.forEach(function (e) {
      e.bodyEl.innerHTML = e.originalBody;
      e.titleEl.textContent = e.meta.title;

      const match = terms.every(function (t) { return e.haystack.indexOf(t) !== -1; });
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
      const any = s.entries.some(function (e) { return !e.card.hidden; });
      s.el.hidden = !any;
    });

    $count.textContent = terms.length
      ? shown + ' / ' + entries.length + ' entries'
      : entries.length + ' entries';
    $empty.hidden = shown !== 0;

    document.querySelectorAll('.chip').forEach(function (c) {
      c.classList.toggle('on', c.dataset.kw === q);
    });
  }

  let debounceTimer = null;
  function onInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applySearch, 90);
  }

  function buildChips(entryMetas) {
    const freq = Object.create(null);
    entryMetas.forEach(function (m) {
      m.keywords.split(',').forEach(function (k) {
        k = k.trim().toLowerCase();
        if (k) freq[k] = (freq[k] || 0) + 1;
      });
    });
    const types = TYPE_TOKENS.filter(function (t) { return freq[t]; });
    const rest = Object.keys(freq)
      .filter(function (k) { return TYPE_TOKENS.indexOf(k) === -1 && freq[k] > 1; })
      .sort(function (a, b) { return freq[b] - freq[a] || a.localeCompare(b); })
      .slice(0, 10);
    types.concat(rest).forEach(function (kw) {
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

  function tocHtml(orderedSections, byDate) {
    let h = '';
    if (byDate.length) {
      h += '<p class="toc-title">Recently added</p><ul class="toc-recent">';
      byDate.slice(0, 3).forEach(function (m) {
        h += '<li><a href="#' + m.id + '">' + m.title + '</a></li>';
      });
      h += '</ul>';
    }
    h += '<p class="toc-title">Contents</p>';
    orderedSections.forEach(function (s, i) {
      if (!s.metas.length) return;
      const dot = SECTION_DOTS[i % SECTION_DOTS.length];
      h += '<div class="toc-sec"><a class="toc-sec-link" href="#sec-' + slugify(s.name) + '">' +
           '<span class="dot" style="background:' + dot + '"></span>' + s.name +
           ' <span class="toc-n">' + s.metas.length + '</span></a><ul>';
      s.metas.forEach(function (m) {
        h += '<li><a href="#' + m.id + '">' + m.title + '</a></li>';
      });
      h += '</ul></div>';
    });
    h += '<p class="toc-foot"><a href="' + WHITEBOOK_URL + '" target="_blank" rel="noopener">White Book ↗</a></p>';
    return h;
  }

  function init(manifest, fragMap) {
    const metas = manifest.entries;

    // section order: manifest.sections first, then any stragglers in appearance order
    const names = (manifest.sections || []).slice();
    metas.forEach(function (m) {
      if (names.indexOf(m.section) === -1) names.push(m.section || 'Unsorted');
    });
    const ordered = names.map(function (name) {
      return { name: name, metas: metas.filter(function (m) { return (m.section || 'Unsorted') === name; }) };
    });

    ordered.forEach(function (s, i) {
      if (!s.metas.length) return;
      const head = document.createElement('h2');
      head.className = 'sechead';
      head.id = 'sec-' + slugify(s.name);
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = SECTION_DOTS[i % SECTION_DOTS.length];
      head.appendChild(dot);
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
          originalBody: built.bodyEl.innerHTML,
          haystack: (meta.title + ' ' + meta.section + ' ' + meta.keywords + ' ' + textOf(built.bodyEl)).toLowerCase()
        };
        entries.push(e);
        rec.entries.push(e);
      });
    });

    const byDate = metas.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    const toc = tocHtml(ordered, byDate);
    if ($toc) $toc.innerHTML = toc;
    if ($tocmList) $tocmList.innerHTML = toc;
    if ($tocm) {
      $tocmList.addEventListener('click', function (ev) {
        if (ev.target.closest('a[href^="#"]')) $tocm.open = false;
      });
      document.addEventListener('click', function (ev) {
        if ($tocm.open && !$tocm.contains(ev.target)) $tocm.open = false;
      });
    }

    buildChips(metas);
    applySearch();

    if (location.hash) {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
  }

  $q.addEventListener('input', onInput);
  $q.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { $q.value = ''; applySearch(); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === '/' && document.activeElement !== $q) { ev.preventDefault(); $q.focus(); }
    if (ev.key === 'Escape' && $tocm && $tocm.open) $tocm.open = false;
  });

  fetch('manifest.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (manifest) {
      return Promise.all(
        manifest.entries.map(function (m) {
          return fetch('entries/' + m.id + '.html').then(function (r) {
            if (!r.ok) throw new Error(m.id);
            return r.text();
          }).catch(function () {
            return '<div class="pearl"><p class="ptext mut">⚠ This entry failed to load.</p></div>';
          }).then(function (html) { return [m.id, html]; });
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
