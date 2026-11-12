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

    var ICON = {
      home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
      nominativi: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 5a3.5 3.5 0 0 1 0 7"/><path d="M18.5 14.5c1.9.8 3 2.7 3 5.5"/>',
      mappa: '<path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 7z"/><path d="M9 4v13M15 7v12.5"/>',
      documenti: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h6"/>',
      assistenza: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>'
    };
    function svg(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICON[n] || '') + '</svg>'; }
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function txt(e) { return (e.textContent || '').replace(/\s+/g, ' ').trim(); }

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
        pills.appendChild(el('span', 'pt-pill', /codice stand/.test(l) ? 'Stand ' + v : v));
        c.classList.add('pt-hide');
      });
    }
    var hero = el('section', 'pt-hero');
    hero.appendChild(el('div', 'pt-avatar', ini));
    var hb = el('div', 'pt-hero-body');
    if (h1) hb.appendChild(h1);
    hb.appendChild(el('p', 'pt-hero-sub', 'Portale Espositore \u00B7 Ludicomix Empoli'));
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
        var pn = wrap.querySelector('.prog-num');
        var pf = wrap.querySelector('.prog-bar-fill');
        if (pn) t.appendChild(el('span', 'pt-tile-chip', txt(pn).replace(/\s+/g, ' ') + ' pass'));
        if (pf && pf.style.width) { var bar = el('div', 'pt-tile-bar'); var i = document.createElement('i'); i.style.width = pf.style.width; bar.appendChild(i); t.appendChild(bar); }
      }
      if (d.k === 'assistenza') {
        var tb = document.querySelector('#ticket-section .sec-card-badge-blue');
        if (tb && txt(tb)) t.appendChild(el('span', 'pt-tile-chip', txt(tb) + ' aperti'));
      }
      t.addEventListener('click', function () { show(d.k, null, true); });
      tiles.appendChild(t);
    });
    if (tiles.children.length) homePanel.appendChild(tiles);

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

    /* 6 — Pallini di notifica (non lette, ticket aperti) */
    function setDot(k, n) {
      [].forEach.call(document.querySelectorAll('[data-k="' + k + '"] .pt-dot'), function (d) {
        d.textContent = n > 0 ? String(n) : '';
        d.classList.toggle('show', n > 0);
      });
    }
    function syncDots() {
      var ub = document.getElementById('unread-badge');
      var u = ub && ub.style.display !== 'none' ? parseInt(txt(ub), 10) || 0 : 0;
      setDot('home', u);
      var tb = document.querySelector('#ticket-section .sec-card-badge-blue');
      setDot('assistenza', tb ? parseInt(txt(tb), 10) || 0 : 0);
    }
    syncDots();
    setInterval(syncDots, 20000);

    /* 7 — Apertura iniziale (anche da link con #sezione) */
    var h = (location.hash || '').replace('#', '');
    if (h === 'servizi' || h === 'ticket') show('assistenza', h);
    else show(panelEls[h] ? h : 'home');
  }
})();
