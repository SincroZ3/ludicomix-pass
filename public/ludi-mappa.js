/* ludi-mappa.js — Mappa Stand (gestionale): testata, riepilogo della zona attiva e ricerca stand.
   Non tocca la logica della pagina (trascinamento, forme, salvataggio): aggiunge solo elementi di contorno.
   In caso di errore la pagina resta com'e'. */
(function () {
  'use strict';
  try { init(); } catch (e) { if (window.console) console.error('[ludi-mappa]', e); }

  function init() {
    var tabs = document.querySelector('.zone-tabs');
    if (!tabs || document.body.classList.contains('mp-on')) return;
    document.body.classList.add('mp-on');

    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function kpi(n, label, warn) {
      var k = el('span', 'mp-k' + (warn ? ' warn' : ''));
      k.appendChild(el('b', '', String(n)));
      k.appendChild(document.createTextNode(label));
      return k;
    }
    function count(sel, root) { return (root || document).querySelectorAll(sel).length; }

    /* Testata con totali */
    var hero = el('section', 'mp-hero');
    var left = el('div', '');
    left.appendChild(el('h1', '', 'Mappa Stand'));
    left.appendChild(el('p', '', 'Posizionamento degli stand sulle planimetrie, zona per zona'));
    var stats = el('div', 'mp-hero-stats');
    hero.appendChild(left);
    hero.appendChild(stats);
    tabs.parentNode.insertBefore(hero, tabs);

    function updateHero() {
      var zones = count('.ztab:not([data-zone="0"])');
      var placed = count('.zone-panel .map-area .stand-box');
      var unp = count('.zone-panel .unp-chips .chip-box');
      stats.innerHTML = '';
      stats.appendChild(kpi(zones, ' zone'));
      stats.appendChild(kpi(placed, ' stand in pianta'));
      stats.appendChild(kpi(unp, ' da posizionare', unp > 0));
    }

    /* Riepilogo della zona attiva + ricerca */
    var strip = el('div', 'mp-strip');
    var kpis = el('div', 'mp-kpis');
    var sb = el('label', 'mp-search');
    sb.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>';
    var inp = document.createElement('input');
    inp.type = 'search';
    inp.placeholder = 'Cerca stand nella zona\u2026';
    sb.appendChild(inp);
    strip.appendChild(kpis);
    strip.appendChild(sb);
    tabs.parentNode.insertBefore(strip, tabs.nextSibling);

    function activePanel() { return document.querySelector('.zone-panel.active'); }
    function updateStrip() {
      var p = activePanel();
      kpis.innerHTML = '';
      if (!p) return;
      var placed = count('.map-area .stand-box', p);
      var unp = count('.unp-chips .chip-box', p);
      var oob = count('.oob-chip', p);
      var pc = 0, cs = 0;
      [].forEach.call(p.querySelectorAll('.map-area .stand-box'), function (b) {
        pc += parseInt(b.getAttribute('data-pc'), 10) || 0;
        cs += parseInt(b.getAttribute('data-cs'), 10) || 0;
      });
      kpis.appendChild(kpi(placed, ' in pianta'));
      kpis.appendChild(kpi(unp, ' da posizionare', unp > 0));
      if (oob) kpis.appendChild(kpi(oob, ' fuori mappa', true));
      kpis.appendChild(kpi(cs + '/' + pc, ' pass consegnati'));
    }
    function applySearch() {
      var q = inp.value.trim().toLowerCase();
      [].forEach.call(document.querySelectorAll('.zone-panel .stand-box, .zone-panel .chip-box'), function (b) {
        var nm = (b.getAttribute('data-name') || '').toLowerCase();
        if (!nm) { var n = b.querySelector('.sn, .chip-name'); nm = n ? n.textContent.toLowerCase() : ''; }
        var hit = q && nm.indexOf(q) > -1;
        b.classList.toggle('mp-hit', !!hit);
        b.classList.toggle('mp-dim', !!q && !hit);
      });
    }
    inp.addEventListener('input', applySearch);

    /* Aggiornamenti: cambio zona e modifiche alla mappa */
    var orig = window.switchZone;
    if (typeof orig === 'function') {
      window.switchZone = function (z) { orig.apply(this, arguments); updateStrip(); applySearch(); };
    }
    var timer = null;
    function later() { clearTimeout(timer); timer = setTimeout(function () { updateHero(); updateStrip(); applySearch(); }, 150); }
    if (window.MutationObserver) {
      var mo = new MutationObserver(later);
      [].forEach.call(document.querySelectorAll('.zone-panel'), function (p) { mo.observe(p, { childList: true, subtree: true }); });
    }

    /* Legenda */
    [].forEach.call(document.querySelectorAll('.leg'), function (l) {
      var box = l.parentNode;
      if (box && !box.classList.contains('mp-legend')) box.classList.add('mp-legend');
    });

    updateHero();
    updateStrip();
  }
})();
