/* ludi-portale.js — Portale Espositore: riorganizza i blocchi esistenti in sezioni (Home, Nominativi, Mappa,
   Documenti, Assistenza) con tab su desktop e barra in basso su telefono.
   Sposta i nodi gia' presenti senza ricrearli: script, form e mappa della pagina continuano a funzionare. */
(function () {
  'use strict';
  try { init(); } catch (e) { if (window.console) console.error('[ludi-portale]', e); }

  function init() {
    var wrap = document.querySelector('.wrap');
    var inner = document.querySelector('.hdr-stand .hdr-inner');
    if (!wrap || !inner || document.body.classList.contains('pt-on')) return;

    /* Limite posti letto dal contatore originale (es. "4 / 5 slot"); 0 = illimitati */
    var maxSlots = 0;
    var scEl = document.getElementById('slot-counter');
    if (scEl) {
      var mm = /\/\s*(\d+)/.exec(scEl.textContent || '');
      if (mm) maxSlots = parseInt(mm[1], 10) || 0;
    }

    var ICON = {
      home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
      nominativi: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 5a3.5 3.5 0 0 1 0 7"/><path d="M18.5 14.5c1.9.8 3 2.7 3 5.5"/>',
      mappa: '<path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 7z"/><path d="M9 4v13M15 7v12.5"/>',
      documenti: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
      assistenza: '<path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z"/><path d="M21 16v2a4 4 0 0 1-4 4h-5"/>',
      annuncio: '<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>'
    };
    function svg(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICON[n] || '') + '</svg>'; }
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function txt(e) { return (e.textContent || '').replace(/\s+/g, ' ').trim(); }

    /* Icona Comunicazioni: cerchio viola con badge (rosso = non lette, grigio = attive ma lette).
       La sezione compare/scompare toccando l'icona; si apre da sola solo se c'e' un messaggio importante non letto. */
    function setupBacheca() {
      var bach = document.getElementById('bacheca');
      if (!bach) return null;
      var cards = [].slice.call(bach.querySelectorAll('#bach-body .item-card'));
      var total = cards.length;
      if (!total) return null;
      function isUnread(c) { return !c.classList.contains('read') && !c.closest('#read-list'); }
      var unread = cards.filter(isUnread).length;
      var ub = document.getElementById('unread-badge');
      var ubn = ub ? (parseInt(txt(ub), 10) || 0) : 0;
      if (ubn > unread) unread = ubn;
      var important = cards.some(function (c) {
        return isUnread(c) && (/unread-(urgent|warning)/.test(c.className) || c.textContent.indexOf('\uD83D\uDCCC') > -1);
      });
      var open = important;
      var seen = false;
      var pending = null;
      var origFetch = window.fetch;

      /* La lettura viene registrata solo quando la sezione viene aperta */
      if (origFetch && unread > 0 && !important) {
        window.fetch = function (u, o) {
          var url = typeof u === 'string' ? u : ((u && u.url) || '');
          if (!open && /bacheca\/read/.test(url)) {
            pending = [u, o];
            return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          return origFetch.apply(this, arguments);
        };
      }

      var bell = el('button', 'pt-bell');
      bell.type = 'button';
      bell.setAttribute('aria-label', 'Comunicazioni');
      bell.innerHTML = svg('annuncio');
      var badge = el('span', 'pt-bell-badge');
      bell.appendChild(badge);

      function refresh() {
        var red = unread > 0 && !seen;
        badge.textContent = String(red ? unread : total);
        badge.className = 'pt-bell-badge ' + (red ? 'red' : 'grey');
        bell.classList.toggle('on', open);
        bach.classList.toggle('pt-bach-closed', !open);
      }
      function flush() {
        if (pending && origFetch) { var p = pending; pending = null; origFetch.apply(window, p); }
      }
      function setOpen(v) {
        open = v;
        if (v) { seen = true; flush(); }
        refresh();
      }
      bell.addEventListener('click', function () { setOpen(!open); });

      if (important) setTimeout(function () { seen = true; refresh(); }, 2200);

      /* Nuovi messaggi arrivati mentre il portale e' aperto */
      if (ub && window.MutationObserver) {
        new MutationObserver(function () {
          var n = parseInt(txt(ub), 10) || 0;
          if (n > 0 && (n !== unread || seen)) {
            unread = n;
            if (n > total) total = n;
            seen = open;
            refresh();
          }
        }).observe(ub, { childList: true, characterData: true, subtree: true, attributes: true });
      }
      refresh();
      return { bell: bell };
    }

    /* 1 — Classifica i blocchi figli di .wrap */
    var panels = { home: [], nominativi: [], mappa: [], documenti: [], servizi: [], ticket: [] };
    var cur = 'home';
    function titleText(e) {
      if (e.matches('.sec-title')) return txt(e);
      var t = e.querySelector('.sec-card-title');
      if (t) return txt(t);
      var s = e.querySelector('strong');
      if (s) return txt(s);
      return txt(e).slice(0, 140);
    }
    function byTitle(t) {
      if (/dove siete|mappa/i.test(t)) return 'mappa';
      if (/nominativ|pass|parchegg|prepar/i.test(t)) return 'nominativi';
      if (/document|modul/i.test(t)) return 'documenti';
      if (/serviz|richiest/i.test(t)) return 'servizi';
      if (/ticket|contatta|supporto|assisten/i.test(t)) return 'ticket';
      return null;
    }
    [].slice.call(wrap.children).forEach(function (e) {
      if (e.tagName === 'SCRIPT' || e.tagName === 'STYLE') return;
      if (e.matches('.footer')) return;
      if (e.matches('.dove-modal,.wc-modal-overlay')) { document.body.appendChild(e); return; }
      var k = null;
      if (e.id === 'bacheca' || e.matches('.info-strip,.prog-card')) k = 'home';
      else if (e.id === 'nom-section' || e.matches('.pass-grid,.nopass-grid')) k = 'nominativi';
      else if (e.id === 'documenti-section') k = 'documenti';
      else if (e.id === 'ticket-section') k = 'ticket';
      else if (e.matches('.dove-card')) k = 'mappa';
      else k = byTitle(titleText(e));
      if (k) cur = k;
      panels[cur].push(e);
    });
    ['dove-modal', 'wc-modal'].forEach(function (id) {
      var m = document.getElementById(id);
      if (m && m.parentNode !== document.body) document.body.appendChild(m);
    });

    /* 2 — Scheda di benvenuto con pillole */
    var h1 = inner.querySelector('.hdr-title');
    var nameEl = h1 && h1.querySelector('span');
    var name = nameEl ? txt(nameEl) : (h1 ? txt(h1) : '');
    var ini = name.split(/[^A-Za-z\u00C0-\u00FF0-9]+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?';
    var pills = el('div', 'pt-pills');
    var standPill = null;
    var strip = wrap.querySelector('.info-strip');
    if (strip) {
      [].forEach.call(strip.querySelectorAll('.info-card'), function (c) {
        var lab = c.querySelector('.info-card-label');
        var val = c.querySelector('.info-card-value');
        if (!lab || !val) return;
        var l = txt(lab).toLowerCase();
        if (/assegnatari|pass pronti/.test(l)) return;
        var v = txt(val);
        if (!v) return;
        var isStand = /codice stand/.test(l);
        var p = el('span', 'pt-pill' + (isStand ? ' pt-pill-stand' : ''), isStand ? 'Stand ' + v : v);
        if (isStand) standPill = p;
        pills.appendChild(p);
        c.classList.add('pt-hide');
      });
    }
    if (!standPill && pills.children.length) {
      standPill = pills.children[0];
      standPill.classList.add('pt-pill-stand');
    }
    var bachSetup = setupBacheca();
    if (bachSetup) {
      if (standPill && standPill.parentNode === pills) pills.insertBefore(bachSetup.bell, standPill.nextSibling);
      else pills.appendChild(bachSetup.bell);
    }
    var hero = el('section', 'pt-hero');
    hero.appendChild(el('div', 'pt-avatar', ini));
    var hb = el('div', 'pt-hero-body');
    if (h1) hb.appendChild(h1);
    hb.appendChild(el('p', 'pt-hero-sub', 'Il tuo spazio a Ludicomix ti aspetta!'));
    if (pills.children.length) hb.appendChild(pills);
    hero.appendChild(hb);
    inner.appendChild(hero);

    /* 3 — Pannelli */
    var panelEls = {};
    function mkPanel(k, nodes) {
      var p = el('div', 'pt-panel');
      p.id = 'pt-' + k;
      nodes.forEach(function (n) { p.appendChild(n); });
      panelEls[k] = p;
      return p;
    }
    var main = el('div', 'pt-main');
    var homeNodes = panels.home.slice();
    var homePanel = mkPanel('home', homeNodes);
    if (panels.nominativi.length) mkPanel('nominativi', panels.nominativi);
    if (panels.mappa.length) mkPanel('mappa', panels.mappa);
    if (panels.documenti.length) mkPanel('documenti', panels.documenti);

    var subs = {};
    var currentSub = 'servizi';
    var ticketSegDot = null;
    if (panels.servizi.length || panels.ticket.length) {
      var assist = el('div', 'pt-panel');
      assist.id = 'pt-assistenza';
      panelEls.assistenza = assist;
      ['servizi', 'ticket'].forEach(function (s) {
        if (!panels[s].length) return;
        var d = el('div', 'pt-subpanel');
        d.setAttribute('data-sub', s);
        panels[s].forEach(function (n) { d.appendChild(n); });
        subs[s] = d;
      });
      if (!subs.servizi) currentSub = 'ticket';
      if (subs.servizi && subs.ticket) {
        var seg = el('div', 'pt-seg');
        [['servizi', 'Servizi'], ['ticket', 'Ticket']].forEach(function (p) {
          var b = el('button', '', p[1]);
          b.type = 'button';
          b.setAttribute('data-sub-btn', p[0]);
          b.addEventListener('click', function () { showSub(p[0]); });
          if (p[0] === 'ticket') {
            ticketSegDot = el('span', 'pt-dot');
            b.appendChild(ticketSegDot);
          }
          seg.appendChild(b);
        });
        assist.appendChild(seg);
      }
      Object.keys(subs).forEach(function (s) { assist.appendChild(subs[s]); });
    }
    function showSub(s) {
      if (!subs[s]) s = subs.servizi ? 'servizi' : 'ticket';
      currentSub = s;
      Object.keys(subs).forEach(function (k) { subs[k].classList.toggle('on', k === s); });
      [].forEach.call(document.querySelectorAll('[data-sub-btn]'), function (b) { b.classList.toggle('on', b.getAttribute('data-sub-btn') === s); });
    }

    /* 4 — Riquadri scorciatoia in Home */
    var defs = [
      { k: 'home', label: 'Home' },
      { k: 'nominativi', label: 'Nominativi', d: 'Persone del tuo stand, pass e download PDF' },
      { k: 'mappa', label: 'Mappa', d: 'Dove si trova il tuo stand in fiera' },
      { k: 'documenti', label: 'Documenti', d: 'Carica e consulta i documenti richiesti' },
      { k: 'assistenza', label: 'Assistenza', d: 'Richiedi servizi o apri un ticket' }
    ];
    var avail = defs.filter(function (d) { return d.k === 'home' || panelEls[d.k]; });
    var tiles = el('div', 'pt-tiles');
    var nomTile = null, nomChip = null, nomBarFill = null;
    var asTile = null, asChip = null;
    avail.forEach(function (d) {
      if (d.k === 'home') return;
      var t = el('button', 'pt-tile');
      t.type = 'button';
      var ico = el('span', 'pt-tile-ico');
      ico.innerHTML = svg(d.k);
      t.appendChild(ico);
      t.appendChild(el('h3', '', d.k === 'documenti' ? 'Documenti e modulistica' : d.label));
      t.appendChild(el('p', '', d.d));
      if (d.k === 'nominativi') {
        nomTile = t;
        nomChip = el('span', 'pt-tile-chip', '');
        t.appendChild(nomChip);
        var bar = el('div', 'pt-tile-bar');
        nomBarFill = document.createElement('i');
        bar.appendChild(nomBarFill);
        t.appendChild(bar);
      }
      if (d.k === 'assistenza') asTile = t;
      t.addEventListener('click', function () { show(d.k, null, true); });
      tiles.appendChild(t);
    });
    if (tiles.children.length) homePanel.appendChild(tiles);

    /* 4b — Scheda Nominativi con anello (Home su telefono) */
    var nc = null;
    var RING_C = 2 * Math.PI * 52;
    if (panelEls.nominativi) {
      var root = el('section', 'pt-nomcard pt-mobile-only');
      var head = el('div', 'pt-nc-head');
      var hi = el('span', '');
      hi.innerHTML = svg('nominativi');
      head.appendChild(hi.firstChild);
      var hbox = el('div', '');
      hbox.appendChild(el('h3', '', 'Nominativi'));
      hbox.appendChild(el('p', '', 'Gestisci le persone del tuo stand e scarica i pass.'));
      head.appendChild(hbox);
      root.appendChild(head);
      var body = el('div', 'pt-nc-body');
      var ring = el('div', 'pt-ring');
      ring.innerHTML = '<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" cx="60" cy="60" r="52" stroke-dasharray="0 ' + RING_C.toFixed(1) + '"/></svg>';
      var rc = el('div', 'pt-ring-c');
      var big = el('b', '', '');
      var small = el('small', '', '');
      rc.appendChild(big);
      rc.appendChild(small);
      ring.appendChild(rc);
      body.appendChild(ring);
      var ul = el('ul', 'pt-legend');
      function li(color, label) {
        var l = document.createElement('li');
        var dot = document.createElement('i');
        dot.style.background = color;
        l.appendChild(dot);
        l.appendChild(document.createTextNode(label));
        var b = document.createElement('b');
        l.appendChild(b);
        ul.appendChild(l);
        return { li: l, b: b };
      }
      var lgReady = li('#2fae68', 'Pass pronti');
      var lgPrep = li('#f5c842', 'In preparazione');
      var lgFree = li('#b8b3c9', 'Posti liberi');
      body.appendChild(ul);
      root.appendChild(body);
      var addBtn = el('button', 'pt-nc-btn', '+ Aggiungi nominativi');
      addBtn.type = 'button';
      addBtn.addEventListener('click', function () {
        show('nominativi', null, true);
        var d = document.getElementById('add-nom-details');
        if (d) {
          d.open = true;
          setTimeout(function () { d.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 150);
        }
      });
      root.appendChild(addBtn);
      homePanel.insertBefore(root, tiles.children.length ? tiles : null);
      if (nomTile) nomTile.classList.add('pt-tile-nom');
      nc = { fg: ring.querySelector('.fg'), big: big, small: small, ready: lgReady.b, prep: lgPrep.b, free: lgFree.b, freeLi: lgFree.li };
    }

    /* 5 — Navigazione: tab desktop + barra mobile */
    var tabs = el('nav', 'pt-tabs');
    tabs.setAttribute('aria-label', 'Sezioni del portale');
    var bottom = el('nav', 'pt-bottom');
    bottom.setAttribute('aria-label', 'Sezioni del portale');
    avail.forEach(function (d) {
      [['pt-tab', tabs], ['pt-bitem', bottom]].forEach(function (c) {
        var b = el('button', c[0]);
        b.type = 'button';
        b.setAttribute('data-k', d.k);
        b.innerHTML = svg(d.k);
        b.appendChild(el('span', '', d.label));
        b.appendChild(el('span', 'pt-dot'));
        b.addEventListener('click', function () { show(d.k, null, true); });
        c[1].appendChild(b);
      });
    });

    wrap.insertBefore(main, wrap.firstChild);
    Object.keys(panelEls).forEach(function (k) { main.appendChild(panelEls[k]); });
    wrap.insertBefore(tabs, main);
    document.body.appendChild(bottom);
    document.body.classList.add('pt-on');

    if (standPill && panelEls.mappa) {
      standPill.classList.add('pt-pill-go');
      standPill.addEventListener('click', function () { show('mappa', null, true); });
    }

    /* 5b — Nominativi: ogni persona una sola volta (pass + gestione nominativi) */
    function normName(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
    function dedupePersone() {
      var passNames = {};
      [].forEach.call(document.querySelectorAll('.pass-card .pass-name'), function (n) { passNames[normName(n.textContent)] = true; });
      var rowNames = {};
      [].forEach.call(document.querySelectorAll('#nom-list .item-card'), function (r) {
        var box = r.children[1];
        var n = box && box.firstElementChild ? box.firstElementChild : box;
        var key = normName(n ? n.textContent : '');
        if (!key) return;
        if (passNames[key] && !r.querySelector('button')) r.classList.add('pt-hide');
        else rowNames[key] = true;
      });
      [].forEach.call(document.querySelectorAll('.nopass-card .nopass-name'), function (n) {
        if (rowNames[normName(n.textContent)]) {
          var c = n.closest('.nopass-card');
          if (c) c.classList.add('pt-hide');
        }
      });
    }
    dedupePersone();

    /* 5c — Contatori sempre aggiornati (aggiunta/rimozione nominativi senza ricaricare) */
    function counts() {
      var list = document.getElementById('nom-list');
      var ready = document.querySelectorAll('.pass-card').length;
      var total;
      if (list) {
        total = [].filter.call(list.children, function (c) {
          return c.classList.contains('item-card') && c.style.opacity !== '0';
        }).length;
      } else {
        total = ready + document.querySelectorAll('.nopass-card').length;
      }
      if (total < ready) total = ready;
      return { total: total, ready: ready };
    }
    function syncCounts() {
      var c = counts();
      var total = c.total, ready = c.ready;
      var pct = total > 0 ? Math.round(ready / total * 100) : 0;
      var prep = total - ready;

      var sc = document.getElementById('slot-counter');
      if (sc) {
        if (maxSlots > 0) {
          sc.textContent = total + ' / ' + maxSlots + ' slot';
          sc.classList.toggle('pill-red', total >= maxSlots);
          sc.classList.toggle('pill-green', total < maxSlots);
        } else {
          var su = document.getElementById('slot-used');
          if (su) su.textContent = String(total);
        }
      }
      [].forEach.call(document.querySelectorAll('.info-card'), function (card) {
        var lab = card.querySelector('.info-card-label');
        var val = card.querySelector('.info-card-value');
        if (!lab || !val) return;
        var l = txt(lab).toLowerCase();
        if (/assegnatari/.test(l)) val.textContent = String(total);
        else if (/pass pronti/.test(l)) {
          val.textContent = ready + ' / ' + total;
          val.style.color = pct === 100 ? 'var(--green)' : (pct > 0 ? 'var(--gold)' : 'var(--red)');
        }
      });
      var pn = document.querySelector('.prog-num');
      if (pn) pn.innerHTML = ready + '<span> / ' + total + '</span>';
      var pf = document.querySelector('.prog-bar-fill');
      if (pf) pf.style.width = pct + '%';
      var ps = document.querySelector('.prog-sub');
      if (ps) ps.textContent = (ready === total && total > 0) ? 'pass tutti pronti' : 'pass disponibili';
      var pp = document.querySelector('.prog-pct');
      if (pp) {
        if (pct === 100) pp.innerHTML = '<strong>\u2713 Tutti i pass sono pronti!</strong>';
        else if (pct === 0) pp.textContent = 'Nessun pass ancora generato';
        else pp.innerHTML = '<strong>' + pct + '%</strong> completato \u2014 ' + prep + ' in preparazione';
      }
      if (nomChip) nomChip.textContent = ready + ' / ' + total + ' pass';
      if (nomBarFill) nomBarFill.style.width = pct + '%';

      if (nc) {
        var frac = maxSlots > 0 ? Math.min(1, total / maxSlots) : (total > 0 ? ready / total : 0);
        nc.fg.setAttribute('stroke-dasharray', (frac * RING_C).toFixed(1) + ' ' + RING_C.toFixed(1));
        nc.big.innerHTML = '';
        nc.big.appendChild(document.createTextNode(maxSlots > 0 ? String(total) : String(ready)));
        var sp = document.createElement('span');
        sp.textContent = '/' + (maxSlots > 0 ? maxSlots : total);
        nc.big.appendChild(sp);
        nc.small.textContent = maxSlots > 0 ? 'NOMINATIVI INSERITI' : 'PASS PRONTI';
        nc.ready.textContent = String(ready);
        nc.prep.textContent = String(prep);
        if (maxSlots > 0) { nc.freeLi.style.display = ''; nc.free.textContent = String(Math.max(0, maxSlots - total)); }
        else nc.freeLi.style.display = 'none';
      }
    }
    var nomList = document.getElementById('nom-list');
    if (nomList && window.MutationObserver) {
      new MutationObserver(function () { syncCounts(); }).observe(nomList, { childList: true });
    }
    syncCounts();

    function show(k, sub, user) {
      if (!panelEls[k]) k = 'home';
      Object.keys(panelEls).forEach(function (x) { panelEls[x].classList.toggle('on', x === k); });
      [].forEach.call(document.querySelectorAll('[data-k]'), function (b) {
        var on = b.getAttribute('data-k') === k;
        b.classList.toggle('on', on);
        b.setAttribute('aria-current', on ? 'page' : 'false');
      });
      if (k === 'assistenza') showSub(sub || currentSub);
      try { history.replaceState(null, '', k === 'home' ? location.pathname + location.search : '#' + k); } catch (e) {}
      if (user) window.scrollTo({ top: 0, behavior: 'smooth' });
      if (k === 'mappa') setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 60);
    }

    /* 6 — Segnalazioni Assistenza: ticket aperti con ultima risposta dell'Organizzazione */
    function setDot(k, n) {
      [].forEach.call(document.querySelectorAll('[data-k="' + k + '"] .pt-dot'), function (d) {
        d.textContent = n > 0 ? String(n) : '';
        d.classList.toggle('show', n > 0);
      });
    }
    function answeredCount() {
      var n = 0;
      [].forEach.call(document.querySelectorAll('#ticket-section .item-card[id^="ticket-"]'), function (c) {
        if (!c.querySelector('.pill-green')) return;
        var b = c.querySelectorAll('.reply-bubble');
        if (b.length && b[b.length - 1].classList.contains('reply-admin')) n++;
      });
      return n;
    }
    function syncDots() {
      var tb = document.querySelector('#ticket-section .sec-card-badge-blue');
      var open = tb ? parseInt(txt(tb), 10) || 0 : 0;
      var ans = answeredCount();
      setDot('assistenza', ans > 0 ? ans : open);
      if (ticketSegDot) {
        ticketSegDot.textContent = ans > 0 ? String(ans) : '';
        ticketSegDot.classList.toggle('show', ans > 0);
      }
      if (asTile) {
        if (!asChip) { asChip = el('span', 'pt-tile-chip'); asTile.appendChild(asChip); }
        var label = '';
        if (ans > 0) label = ans + (ans === 1 ? ' risposta' : ' risposte');
        else if (open > 0) label = open + (open === 1 ? ' aperto' : ' aperti');
        asChip.textContent = label;
        asChip.classList.toggle('pt-hide', !label);
        asChip.classList.toggle('pt-chip-hot', ans > 0);
        asTile.classList.toggle('pt-has-chip', !!label);
      }
    }
    syncDots();
    setInterval(syncDots, 20000);

    /* 7 — Apertura iniziale (anche da link con #sezione) */
    var h = (location.hash || '').replace('#', '');
    if (h === 'servizi' || h === 'ticket') show('assistenza', h);
    else show(panelEls[h] ? h : 'home');
  }
})();
