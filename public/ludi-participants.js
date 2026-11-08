/* ludi-participants.js — pagina Assegnatari Pass: colonne Pass, Stato e Azioni.
   Lavora solo sulle tabelle table[id^="table-cat-"]. Le colonne originali (max pass,
   note, gestione pass, cancella) restano nel DOM ma nascoste, cosi' gli script della
   pagina (ordinamento, filtri, finestra di cancellazione) continuano a funzionare. */
(function () {
  'use strict';

  var ICON_NOTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M8 2v4M16 2v4M8 10h8M8 14h8M8 18h5"/></svg>';
  var ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  var ICON_DEL  = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
  var STATE_LABEL = { attivo: 'Attivo', disattivato: 'Disattivato', inattivo: 'Inattivo' };

  function hide(el) { if (el) el.classList.add('ui-col-hidden'); }

  function makeBtn(extraClass, title, svg) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ui-act ' + extraClass;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = svg;
    return b;
  }

  /* Popup con le note del gruppo (testo inserito con textContent: nessun HTML) */
  function showNote(groupName, text) {
    var overlay = document.createElement('div');
    overlay.className = 'ui-note-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var box = document.createElement('div');
    box.className = 'ui-note-box';

    var title = document.createElement('h3');
    title.textContent = groupName;

    var body = document.createElement('p');
    body.className = text ? 'ui-note-text' : 'ui-note-empty';
    body.textContent = text || 'Nessuna nota presente';

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'ui-note-close';
    close.textContent = 'Chiudi';

    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(close);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    close.focus();

    function closeAll() {
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('show');
      setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 220);
    }
    function onKey(e) { if (e.key === 'Escape') closeAll(); }

    close.addEventListener('click', closeAll);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeAll(); });
    document.addEventListener('keydown', onKey);
  }

  function setBadge(cell, state) {
    cell.textContent = '';
    var s = document.createElement('span');
    s.className = 'ui-state ui-state--' + (STATE_LABEL[state] ? state : 'inattivo');
    s.textContent = STATE_LABEL[state] || 'Inattivo';
    cell.appendChild(s);
  }

  function restructure(table) {
    if (table.getAttribute('data-ui-cols')) return;
    table.setAttribute('data-ui-cols', '1');

    var headRow = table.querySelector('thead tr');
    if (!headRow) return;
    var ths = headRow.children;

    /* Intestazioni: "N. assegnatari" diventa "Pass"; max pass, note, gestione, cancella nascoste */
    var passTh = ths[4];
    if (passTh && passTh.firstChild && passTh.firstChild.nodeType === 3) passTh.firstChild.nodeValue = 'Pass ';
    for (var i = 5; i < ths.length; i++) hide(ths[i]);

    var thState = document.createElement('th');
    thState.textContent = 'Stato';
    headRow.appendChild(thState);
    var thAct = document.createElement('th');
    thAct.textContent = 'Azioni';
    thAct.className = 'ui-th-actions';
    headRow.appendChild(thAct);

    table.querySelectorAll('tbody tr.group-row').forEach(function (tr) {
      var tds = tr.children;
      var strong = tr.querySelector('td:first-child strong');
      var name = ((strong || tds[0] || {}).textContent || '').trim();
      var maxTxt = tds[5] ? tds[5].textContent.trim() : '';
      var note = tds[6] ? tds[6].textContent.trim() : '';
      var link = tds[7] ? tds[7].querySelector('a') : null;
      var delBtn = tds[8] ? tds[8].querySelector('button') : null;

      /* Pass: "usati / massimo" nella pillola gia' presente */
      var chip = tds[4] ? tds[4].querySelector('.chip') : null;
      if (chip) chip.textContent = chip.textContent.trim() + ' / ' + (/^\d+$/.test(maxTxt) ? maxTxt : '\u221e');

      for (var j = 5; j < tds.length; j++) hide(tds[j]);

      var href = link ? link.getAttribute('href') : '';
      var m = href && href.match(/\/assignment-groups\/(\d+)/);
      tr.setAttribute('data-gid', m ? m[1] : '');

      /* Colonna Stato (riempita dopo la risposta dell'API) */
      var tdState = document.createElement('td');
      tdState.className = 'ui-td-state';
      tdState.textContent = '\u2026';
      tr.appendChild(tdState);

      /* Colonna Azioni: note, gestione pass (matita), cancella (cestino) */
      var tdAct = document.createElement('td');
      var wrap = document.createElement('div');
      wrap.className = 'ui-actions';

      var bNote = makeBtn('ui-act-note' + (note ? ' has-note' : ''), note ? 'Note' : 'Note (nessuna)', ICON_NOTE);
      bNote.addEventListener('click', function () { showNote(name, note); });
      wrap.appendChild(bNote);

      if (href) {
        var a = document.createElement('a');
        a.className = 'ui-act ui-act-edit';
        a.href = href;
        a.title = 'Gestione pass';
        a.setAttribute('aria-label', 'Gestione pass');
        a.innerHTML = ICON_EDIT;
        wrap.appendChild(a);
      }

      if (delBtn) {
        var bDel = makeBtn('ui-act-del', 'Cancella', ICON_DEL);
        bDel.addEventListener('click', function () { delBtn.click(); });
        wrap.appendChild(bDel);
      }

      tdAct.appendChild(wrap);
      tr.appendChild(tdAct);
    });
  }

  function loadStates() {
    fetch('/api/assignment-groups/portal-status', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('stato non disponibile')); })
      .then(function (list) {
        var map = {};
        list.forEach(function (x) { map[x.id] = x.state; });
        document.querySelectorAll('tr.group-row').forEach(function (tr) {
          var cell = tr.querySelector('td.ui-td-state');
          if (cell) setBadge(cell, map[tr.getAttribute('data-gid')] || 'inattivo');
        });
      })
      .catch(function () {
        document.querySelectorAll('td.ui-td-state').forEach(function (c) { c.textContent = '\u2014'; });
      });
  }

  function init() {
    var tables = document.querySelectorAll('table[id^="table-cat-"]');
    if (!tables.length) return;
    tables.forEach(restructure);
    loadStates();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
