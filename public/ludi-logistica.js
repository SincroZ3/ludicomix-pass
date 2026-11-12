/* ludi-logistica.js — Logistica & Servizi: testata, tab con icone, richieste a colonne, Fabbisogni in sintesi.
   Non cambia i comandi della pagina: i pulsanti delle card azionano il select dello stato e il cestino gia' presenti
   nella tabella (updateStatus / deleteReq). Il pannello Fabbisogni ha due blocchi separati:
   - Richieste ricevute: calcolato dalle card, si aggiorna a ogni modifica;
   - Fabbisogni gruppi: dati del Resoconto (window.__LG_NEEDS), riletti dalla pagina stessa ogni 20 secondi.
   In caso di errore la pagina resta com'e'. */
(function () {
  'use strict';
  try { init(); } catch (e) { if (window.console) console.error('[ludi-logistica]', e); }

  function init() {
    var cont = document.querySelector('.container');
    if (!cont || document.body.classList.contains('lg-on')) return;
    document.body.classList.add('lg-on');

    var st0 = document.createElement('style');
    st0.textContent = '.lg-sub{margin:1.1rem 0 .7rem;padding-top:.9rem;border-top:1px solid #f0edf7;font-size:.72rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#6b5a8a}.lg-sub:first-of-type{margin-top:0;padding-top:0;border-top:0}.lg-sub small{display:block;margin-top:.15rem;font-size:.7rem;font-weight:600;letter-spacing:0;text-transform:none;color:#9a94ad}';
    document.head.appendChild(st0);

    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function svg(paths) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>'; }
    function stripEmoji(s) { return String(s || '').replace(/^[^A-Za-z\u00C0-\u00FF0-9]+/, '').trim(); }

    /* Testata */
    var hero = cont.firstElementChild;
    if (hero) hero.classList.add('lg-hero');

    /* Tab con icone */
    var TAB_ICON = {
      richieste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>',
      attrezzature: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
      checklist: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/>',
      catering: '<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10"/><path d="M17 21V3c-2.5 1.5-4 4.5-4 8h4"/>',
      fornitori: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
      impostazioni: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
      prestiti: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>'
    };
    [].forEach.call(cont.querySelectorAll('.log-tab'), function (b) {
      var m = /showTab\('(\w+)'/.exec(b.getAttribute('onclick') || '');
      var paths = m && TAB_ICON[m[1]];
      if (!paths) return;
      var first = b.firstChild;
      if (first && first.nodeType === 3) first.nodeValue = ' ' + stripEmoji(first.nodeValue) + ' ';
      var holder = el('span', '');
      holder.innerHTML = svg(paths);
      b.insertBefore(holder.firstChild, b.firstChild);
    });

    /* Richieste a colonne */
    var table = document.querySelector('#panel-richieste table.sr-table');
    if (!table) return;
    var card = table.closest('.log-card');
    var body = card.querySelector('.log-card-body');
    var head = card.querySelector('.log-card-head');
    var countEl = head.lastElementChild;
    var wrap = table.parentNode;
    wrap.classList.add('lg-table-wrap');

    var COLS = [
      { st: 'in_attesa', label: 'In attesa' },
      { st: 'approvato', label: 'Approvato' },
      { st: 'consegnato', label: 'Consegnato' },
      { st: 'annullato', label: 'Annullato' }
    ];
    var TYPE_ICON = {
      corrente: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
      sedi: '<path d="M7 3v8M17 3v8M6 11h12v3H6zM8 14v7M16 14v7"/>',
      tavol: '<path d="M3 8h18M5 8v12M19 8v12M3 8l2-4h14l2 4"/>',
      transenn: '<path d="M3 6h18M3 12h18M6 4v16M12 4v16M18 4v16"/>',
      gazebo: '<path d="M3 20L12 4l9 16zM12 4v16"/>',
      acqua: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
      wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/>',
      _: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'
    };
    function typeIcon(t) {
      var k = String(t || '').toLowerCase();
      for (var key in TYPE_ICON) { if (key !== '_' && k.indexOf(key) > -1) return TYPE_ICON[key]; }
      return TYPE_ICON._;
    }
    var ACT = {
      ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      no: '<path d="M6 6l12 12M18 6L6 18"/>',
      back: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
      del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
    };
    function fmtDate(s) {
      var m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(s || '');
      return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] : String(s || '').trim();
    }

    function setStatus(row, st) {
      var sel = row.querySelector('.status-sel');
      if (!sel) return;
      sel.value = st;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      rebuild();
    }
    function removeRow(row) {
      var b = row.querySelector('.btn-del');
      if (b) b.click();
    }
    function act(kind, title, fn) {
      var b = el('button', 'lg-act ' + (kind === 'del' ? 'del' : kind === 'no' ? 'no' : kind === 'back' ? 'adv' : 'ok'));
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = svg(ACT[kind]);
      b.addEventListener('click', fn);
      return b;
    }

    var board = el('div', 'lg-board');
    var layout = el('div', 'lg-layout');
    body.insertBefore(layout, wrap);
    layout.appendChild(board);

    /* Fabbisogni in sintesi: due blocchi separati */
    var needsBox = el('aside', 'lg-needs');
    var nh = el('h3', '');
    nh.innerHTML = svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>');
    nh.appendChild(document.createTextNode('Fabbisogni in sintesi'));
    needsBox.appendChild(nh);

    var subReq = el('div', 'lg-sub', 'Richieste ricevute');
    subReq.appendChild(el('small', '', 'Dalle card qui a sinistra, in tempo reale'));
    needsBox.appendChild(subReq);
    var reqList = el('div', 'lg-needs-list');
    needsBox.appendChild(reqList);

    var subGmr = el('div', 'lg-sub', 'Fabbisogni gruppi');
    var gmrWhen = el('small', '', 'Dal Resoconto fabbisogni');
    subGmr.appendChild(gmrWhen);
    needsBox.appendChild(subGmr);
    var gmrList = el('div', 'lg-needs-list');
    needsBox.appendChild(gmrList);

    var needsLink = el('a', 'lg-link', 'Apri resoconto completo');
    needsLink.href = '/admin/logistica/resoconto';
    needsBox.appendChild(needsLink);
    layout.appendChild(needsBox);

    function barRow(label, a, b, total, valText, title) {
      var row = el('div', 'lg-need');
      var top = el('div', 'lg-need-top');
      top.appendChild(el('strong', '', label));
      var val = el('span', '', valText);
      val.title = title;
      top.appendChild(val);
      row.appendChild(top);
      var bar = el('div', 'lg-need-bar');
      var c = document.createElement('i');
      c.className = 'c';
      c.style.width = Math.min(100, Math.round(a / total * 100)) + '%';
      var d = document.createElement('i');
      d.className = 'd';
      d.style.width = Math.min(100, Math.round(b / total * 100)) + '%';
      bar.appendChild(c);
      bar.appendChild(d);
      row.appendChild(bar);
      return row;
    }
    function legend(l1t, l2t) {
      var lg = el('div', 'lg-need-legend');
      var l1 = el('span', ''); var b1 = document.createElement('b'); b1.style.background = '#c9b5ea'; l1.appendChild(b1); l1.appendChild(document.createTextNode(l1t));
      var l2 = el('span', ''); var b2 = document.createElement('b'); b2.style.background = '#6b3fa0'; l2.appendChild(b2); l2.appendChild(document.createTextNode(l2t));
      lg.appendChild(l1);
      lg.appendChild(l2);
      return lg;
    }

    function updateNeeds(by) {
      var map = {}, order = [];
      COLS.forEach(function (c) {
        by[c.st].forEach(function (row) {
          var type = stripEmoji(row.cells[2].textContent) || 'Altro';
          var key = type.toLowerCase();
          var q = parseInt(row.cells[3].textContent, 10) || 0;
          if (!map[key]) { map[key] = { label: type, req: 0, app: 0, del: 0 }; order.push(key); }
          if (c.st === 'annullato') return;
          var m = map[key];
          m.req += q;
          if (c.st === 'approvato' || c.st === 'consegnato') m.app += q;
          if (c.st === 'consegnato') m.del += q;
        });
      });
      var list = order.map(function (k) { return map[k]; }).filter(function (m) { return m.req > 0; });
      list.sort(function (a, b) { return b.req - a.req; });
      reqList.innerHTML = '';
      if (!list.length) {
        reqList.appendChild(el('p', 'lg-needs-empty', 'Nessuna richiesta attiva da mostrare.'));
        return;
      }
      list.forEach(function (n) {
        reqList.appendChild(barRow(n.label, n.app, n.del, n.req, n.app + ' / ' + n.req,
          'Approvati ' + n.app + ' (consegnati ' + n.del + ') su ' + n.req + ' richiesti'));
      });
      reqList.appendChild(legend('Approvati', 'Consegnati'));
    }

    function renderGmr(data) {
      gmrList.innerHTML = '';
      var list = (data || []).filter(function (n) { return (Number(n.req) || 0) > 0; });
      if (!list.length) {
        gmrList.appendChild(el('p', 'lg-needs-empty', 'Nessun fabbisogno dei gruppi registrato. Usa \u00abSync richieste portale\u00bb per importarli.'));
        return;
      }
      list.forEach(function (n) {
        var req = Number(n.req) || 0, conf = Number(n.conf) || 0, del = Number(n.del) || 0;
        gmrList.appendChild(barRow(n.label, conf, del, req, del + ' / ' + req,
          'Confermati ' + conf + ', consegnati ' + del + ' su ' + req + ' richiesti'));
      });
      gmrList.appendChild(legend('Confermati', 'Consegnati'));
    }
    renderGmr(window.__LG_NEEDS);

    /* Riletture dei fabbisogni gruppi dalla pagina stessa (nessuna rotta nuova) */
    function refreshGmr() {
      if (document.hidden || !window.fetch) return;
      fetch(location.pathname, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .then(function (html) {
          var m = /window\.__LG_NEEDS=(\[[\s\S]*?\]);<\/script>/.exec(html || '');
          if (!m) return;
          renderGmr(JSON.parse(m[1]));
          var d = new Date();
          gmrWhen.textContent = 'Dal Resoconto fabbisogni \u00b7 aggiornato alle ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        })
        .catch(function () {});
    }
    setInterval(refreshGmr, 20000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshGmr(); });

    function updateCounters(by, total) {
      var pending = by.in_attesa.length;
      if (countEl && countEl.tagName === 'SPAN') countEl.textContent = total + ' totali, ' + pending + ' in attesa';
      var badge = document.getElementById('badge-req');
      if (badge) {
        badge.textContent = String(pending);
        badge.classList.toggle('alert', pending > 0);
      }
    }

    function rebuild() {
      var rows = [].slice.call(table.querySelectorAll('tbody tr[id^="sr-row-"]'));
      var by = { in_attesa: [], approvato: [], consegnato: [], annullato: [] };
      rows.forEach(function (row) {
        var sel = row.querySelector('.status-sel');
        var st = sel ? sel.value : 'in_attesa';
        if (!by[st]) st = 'in_attesa';
        by[st].push(row);
      });
      board.innerHTML = '';
      COLS.forEach(function (c) {
        var col = el('div', 'lg-col');
        col.setAttribute('data-st', c.st);
        col.appendChild(el('div', 'lg-col-hd', c.label + ' \u00b7 ' + by[c.st].length));
        var cb = el('div', 'lg-col-body');
        if (!by[c.st].length) cb.appendChild(el('div', 'lg-empty', 'Nessuna richiesta'));
        by[c.st].forEach(function (row) {
          var cells = row.cells;
          var group = (cells[1].textContent || '').trim() || '\u2014';
          var type = stripEmoji(cells[2].textContent);
          var qty = (cells[3].textContent || '').trim();
          var notes = (cells[4].textContent || '').trim();
          if (notes === '\u2014') notes = '';
          var cd = el('div', 'lg-card');
          var top = el('div', 'lg-card-top');
          var ic = el('span', 'lg-ico');
          ic.innerHTML = svg(typeIcon(type));
          top.appendChild(ic);
          top.appendChild(el('div', 'lg-grp', group));
          cd.appendChild(top);
          cd.appendChild(el('div', 'lg-type', type + ' \u00d7 ' + qty));
          if (notes) cd.appendChild(el('div', 'lg-note', notes));
          var ft = el('div', 'lg-card-ft');
          ft.appendChild(el('span', 'lg-date', fmtDate(cells[5].textContent)));
          if (c.st === 'in_attesa') {
            ft.appendChild(act('ok', 'Approva', function () { setStatus(row, 'approvato'); }));
            ft.appendChild(act('no', 'Annulla richiesta', function () { setStatus(row, 'annullato'); }));
          } else if (c.st === 'approvato') {
            ft.appendChild(act('ok', 'Segna come consegnata', function () { setStatus(row, 'consegnato'); }));
            ft.appendChild(act('no', 'Annulla richiesta', function () { setStatus(row, 'annullato'); }));
          } else if (c.st === 'consegnato') {
            ft.appendChild(act('back', 'Riporta ad approvata', function () { setStatus(row, 'approvato'); }));
          } else {
            ft.appendChild(act('back', 'Ripristina in attesa', function () { setStatus(row, 'in_attesa'); }));
          }
          ft.appendChild(act('del', 'Elimina', function () { removeRow(row); }));
          cd.appendChild(ft);
          cb.appendChild(cd);
        });
        col.appendChild(cb);
        board.appendChild(col);
      });
      updateNeeds(by);
      updateCounters(by, rows.length);
    }
    rebuild();

    /* Cambi di stato fatti anche dal menu della tabella */
    table.addEventListener('change', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('status-sel')) rebuild();
    });

    var tbody = table.querySelector('tbody');
    if (tbody && window.MutationObserver) {
      new MutationObserver(function () { rebuild(); }).observe(tbody, { childList: true });
    }

    /* Interruttore Colonne / Tabella */
    var sw = el('div', 'lg-view-sw');
    var bCols = el('button', '', 'Colonne');
    var bTab = el('button', '', 'Tabella');
    bCols.type = 'button';
    bTab.type = 'button';
    sw.appendChild(bCols);
    sw.appendChild(bTab);
    head.insertBefore(sw, head.lastElementChild);
    function setView(v) {
      card.classList.toggle('lg-board-on', v !== 'table');
      bCols.classList.toggle('on', v !== 'table');
      bTab.classList.toggle('on', v === 'table');
      try { localStorage.setItem('lgView', v); } catch (e) {}
    }
    bCols.addEventListener('click', function () { setView('cols'); });
    bTab.addEventListener('click', function () { setView('table'); });
    var saved = 'cols';
    try { saved = localStorage.getItem('lgView') || 'cols'; } catch (e) {}
    setView(saved);
  }
})();
