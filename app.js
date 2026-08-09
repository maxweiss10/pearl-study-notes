/* Pearl — loads manifest.json + entry fragments, renders cards, instant search with highlighting. */
(function () {
  'use strict';

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const TYPE_TOKENS = ['chalktalk', 'slide', 'paper', 'photo', 'note'];

  const $list = document.getElementById('list');
  const $q = document.getElementById('q');
  const $chips = document.getElementById('chips');
  const $count = document.getElementById('count');
  const $empty = document.getElementById('empty');

  let entries = []; // {meta, card, bodyEl, titleEl, originalBody, originalTitle, haystack}

  function fmtDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return MONTHS[m - 1] + ' ' + d + ', ' + y;
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
    // Tables scroll sideways on phones instead of squishing.
    body.querySelectorAll('table.cmp').forEach(function (t) {
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
      // reset any previous highlighting
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

  function buildChips(manifest) {
    const freq = Object.create(null);
    manifest.forEach(function (m) {
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

  function init(manifest, fragments) {
    manifest.forEach(function (meta, i) {
      const built = buildCard(meta, fragments[i]);
      $list.appendChild(built.card);
      entries.push({
        meta: meta,
        card: built.card,
        bodyEl: built.bodyEl,
        titleEl: built.titleEl,
        originalBody: built.bodyEl.innerHTML,
        haystack: (meta.title + ' ' + meta.keywords + ' ' + textOf(built.bodyEl)).toLowerCase()
      });
    });
    buildChips(manifest);
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
  });

  fetch('manifest.json', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (manifest) {
      return Promise.all(
        manifest.map(function (m) {
          return fetch('entries/' + m.id + '.html').then(function (r) {
            if (!r.ok) throw new Error(m.id);
            return r.text();
          }).catch(function () {
            return '<div class="pearl"><p class="ptext mut">⚠ This entry failed to load.</p></div>';
          });
        })
      ).then(function (fragments) { init(manifest, fragments); });
    })
    .catch(function () {
      $list.innerHTML = '<p class="empty">Could not load manifest.json — are you offline?</p>';
    });
})();
