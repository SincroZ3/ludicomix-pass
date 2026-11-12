/* ludi-logistica-cat.js — Catalogo attrezzature a schede: riepilogo, ricerca, filtri per tipologia,
   raggruppamento per posizione, azioni Presta / Modifica / Elimina.
   Usa i dati passati dal server (window.__LG_EQ / __LG_CATS / __LG_LOCS) e le funzioni gia' presenti nella pagina
   (showTab, deleteEq). In caso di errore il catalogo originale resta visibile. */
(function () {
  'use strict';
  try { init(); } catch (e) { if (window.console) console.error('[ludi-logistica-cat]', e); }

  function init() {
    var panel = document.getElementById('panel-attrezzature');
    var data = window.__LG_EQ;
    if (!panel || !Array.isArray(data)) return;
    var cats = window.__LG_CATS || [], locs = window.__LG_LOCS || [];
    var catBy = {}, locBy = {};
    cats.forEach(function (c) { catBy[c.key] = c; });
    locs.forEach(function (l) { locBy[l.key] = l; });
    var items = data.slice();
    var q = '', catSel = '*';

    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function svg(p) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>'; }

    var ICONS = {
      box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
      layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
      swap: '<path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/>',
      warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
      play: '<path d="M6 4l14 8-14 8z"/>',
      speaker: '<rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="12" cy="8" r="2"/><circle cx="12" cy="15" r="3.5"/>',
      mixer: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 8v8M12 8v8M16 8v8"/><circle cx="8" cy="11" r="1"/><circle cx="12" cy="14" r="1"/><circle cx="16" cy="10" r="1"/>',
      cable: '<circle cx="14" cy="12" r="7"/><circle cx="14" cy="12" r="3"/><path d="M7 12H3M4 9v6"/>',
      tent: '<path d="M3 20L12 4l9 16z"/><path d="M12 4v16M7.5 12h9"/>',
      chair: '<path d="M7 3v8M17 3v8M6 11h12v3H6zM8 14v7M16 14v7"/>',
      table: '<path d="M3 8h18M5 8v12M19 8v12M3 8l2-4h14l2 4"/>',
      fence: '<path d="M3 6h18M3 12h18M6 4v16M12 4v16M18 4v16"/>',
      bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
      bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.700 1-2.500A6 6 0 0 0 12 3z"/>'
    };
    var ICON_RULES = [
      [/mixer|console|regia/, 'mixer'],
      [/cassa|audio|trasmett|microfon|altoparl|speaker|radio/, 'speaker'],
      [/cavo|cavi|jack|prolunga|xlr|hdmi/, 'cable'],
      [/gazebo|tenda|tendone/, 'tent'],
      [/sedia|sedie|sgabell|panca/, 'chair'],
      [/tavol|banco|scrivania/, 'table'],
      [/transenn|barrier|recinz/, 'fence'],
      [/luce|luci|faro|lamp|illumin/, 'bulb'],
      [/corrente|ciabatta|generator|elettric/, 'bolt']
    ];
    function iconFor(it) {
      var c = catBy[it.category];
      var hay = (it.name + ' ' + (c ? c.label : '')).toLowerCase();
      for (var i = 0; i < ICON_RULES.length; i++) { if (ICON_RULES[i][0].test(hay)) return ICONS[ICON_RULES[i][1]]; }
      return ICONS.box;
    }
    function avail(it) { return (it.total || 0) - (it.used || 0); }
    function locKeyOf(it) { return it.location === 'altro' ? 'altro:' + (it.location_custom || '') : (it.location || ''); }
    function locTitle(k) {
      if (k === '') return 'Posizione non specificata';
      if (k.indexOf('altro:') === 0) return k.slice(6) || 'Altra posizione';
      return locBy[k] ? locBy[k].label : k;
    }
    function match(it) {
      if (catSel !== '*' && (it.category || '') !== catSel) return false;
      if (!q) return true;
      var c = catBy[it.category];
      var hay = [it.name, it.notes, it.location_custom, c ? c.label : '', locTitle(locKeyOf(it))].join(' ').toLowerCase();
      return hay.indexOf(q) > -1;
    }

    /* Aggiungi: la scheda con il modulo originale va in una finestra */
    var addCard = null;
    for (var n = panel.firstElementChild; n; n = n.nextElementSibling) {
      if (n.classList.contains('log-card')) { addCard = n; break; }
    }
    var addOv = el('div', 'lgc-ov');
    var addBox = el('div', 'lgc-modal');
    var addHead = el('div', 'lgc-mh', 'Aggiungi attrezzatura');
    var addX = el('button', 'lgc-x', '\u00d7');
    addX.type = 'button';
    addHead.appendChild(addX);
    addBox.appendChild(addHead);
    if (addCard) {
      var oh = addCard.querySelector('.log-card-head');
      if (oh) oh.style.display = 'none';
      addBox.appendChild(addCard);
    }
    addOv.appendChild(addBox);
    document.body.appendChild(addOv);
    function openAdd() {
      addOv.classList.add('open');
      var inp = addBox.querySelector('input[name="name"]');
      if (inp) setTimeout(function () { inp.focus(); }, 30);
    }
    addX.addEventListener('click', function () { addOv.classList.remove('open'); });
    addOv.addEventListener('mousedown', function (e) { if (e.target === addOv) addOv.classList.remove('open'); });

    /* Modifica */
    var edOv = el('div', 'lgc-ov');
    var edBox = el('div', 'lgc-modal');
    var edHead = el('div', 'lgc-mh', 'Modifica attrezzatura');
    var edX = el('button', 'lgc-x', '\u00d7');
    edX.type = 'button';
    edHead.appendChild(edX);
    edBox.appendChild(edHead);
    var edBody = el('div', 'lgc-mb');
    edBox.appendChild(edBody);
    edOv.appendChild(edBox);
    document.body.appendChild(edOv);
    edX.addEventListener('click', function () { edOv.classList.remove('open'); });
    edOv.addEventListener('mousedown', function (e) { if (e.target === edOv) edOv.classList.remove('open'); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { addOv.classList.remove('open'); edOv.classList.remove('open'); }
    });

    function field(label, input, full) {
      var w = el('div', full ? 'full' : '');
      var l = el('label', '', label);
      l.appendChild(input);
      w.appendChild(l);
      return w;
    }
    function openEdit(it) {
      edBody.innerHTML = '';
      var f = el('div', 'lgc-f');
      var name = el('input'); name.type = 'text'; name.value = it.name;
      var cat = el('select');
      var o0 = el('option', '', '\u2014 nessuna \u2014'); o0.value = ''; cat.appendChild(o0);
      cats.forEach(function (c) { var o = el('option', '', c.label); o.value = c.key; cat.appendChild(o); });
      cat.value = it.category || '';
      var qty = el('input'); qty.type = 'number'; qty.min = '1'; qty.value = String(it.total || 1);
      var loc = el('select');
      var l0 = el('option', '', '\u2014 non specificata \u2014'); l0.value = ''; loc.appendChild(l0);
      locs.forEach(function (l) { var o = el('option', '', l.label); o.value = l.key; loc.appendChild(o); });
      loc.value = it.location || '';
      var custom = el('input'); custom.type = 'text'; custom.placeholder = 'Specificare posizione\u2026'; custom.value = it.location_custom || '';
      var notes = el('input'); notes.type = 'text'; notes.value = it.notes || '';
      f.appendChild(field('Nome', name, true));
      f.appendChild(field('Tipologia', cat));
      f.appendChild(field('Quantit\u00e0 totale', qty));
      var locField = field('Posizione', loc);
      f.appendChild(locField);
      var cField = field('Dettaglio posizione', custom);
      f.appendChild(cField);
      f.appendChild(field('Note', notes, true));
      function syncCustom() { cField.style.display = loc.value === 'altro' ? '' : 'none'; }
      loc.addEventListener('change', syncCustom);
      syncCustom();
      edBody.appendChild(f);
      var fa = el('div', 'lgc-fa');
      var cancel = el('button', 'lgc-btn', 'Annulla'); cancel.type = 'button';
      var save = el('button', 'lgc-btn pri', 'Salva'); save.type = 'button';
      fa.appendChild(cancel); fa.appendChild(save);
      edBody.appendChild(fa);
      cancel.addEventListener('click', function () { edOv.classList.remove('open'); });
      save.addEventListener('click', function () {
        var nm = name.value.trim();
        var total = parseInt(qty.value, 10) || 1;
        if (!nm) { alert('Il nome \u00e8 obbligatorio.'); return; }
        if (total < (it.used || 0)) { alert('La quantit\u00e0 totale non pu\u00f2 essere inferiore ai pezzi in prestito (' + it.used + ').'); return; }
        save.disabled = true;
        fetch('/admin/logistica/equipment/' + it.id + '/edit', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nm, category: cat.value, total_qty: total, notes: notes.value.trim(), location: loc.value, location_custom: custom.value.trim() })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.ok) { location.href = '/admin/logistica?tab=attrezzature'; }
          else { save.disabled = false; alert('Errore nel salvataggio.'); }
        }).catch(function () { save.disabled = false; alert('Errore di rete.'); });
      });
      edOv.classList.add('open');
      setTimeout(function () { name.focus(); }, 30);
    }

    /* Presta: apre la scheda Prestiti con l'attrezzatura gia' scelta */
    function lend(it) {
      var tabBtn = null;
      [].forEach.call(document.querySelectorAll('.log-tab'), function (b) {
        if ((b.getAttribute('onclick') || '').indexOf('prestiti') > -1) tabBtn = b;
      });
      if (window.showTab && tabBtn) window.showTab('prestiti', tabBtn);
      var sel = document.querySelector('#panel-prestiti select[name="equipment_id"]');
      if (sel) sel.value = String(it.id);
      var qty = document.querySelector('#panel-prestiti input[name="qty"]');
      if (qty) { qty.focus(); qty.select(); }
      var card = document.querySelector('#panel-prestiti .log-card');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* Struttura */
    panel.classList.add('lgc-on');
    var root = el('div', 'lgc');
    var head = el('div', 'lgc-head');
    var title = el('h2', 'lgc-title');
    title.innerHTML = svg(ICONS.box);
    title.appendChild(document.createTextNode('Catalogo attrezzature'));
    var addBtn = el('button', 'lgc-add');
    addBtn.type = 'button';
    addBtn.innerHTML = svg(ICONS.plus).replace('<svg', '<svg width="16" height="16" style="stroke:#fff;fill:none;stroke-width:2.4;stroke-linecap:round"');
    addBtn.appendChild(document.createTextNode('Aggiungi attrezzatura'));
    addBtn.addEventListener('click', openAdd);
    head.appendChild(title);
    head.appendChild(addBtn);
    root.appendChild(head);
    var kpiBox = el('div', 'lgc-kpis');
    root.appendChild(kpiBox);
    var tools = el('div', 'lgc-tools');
    var sbox = el('label', 'lgc-search');
    sbox.innerHTML = svg(ICONS.search);
    var sinp = el('input');
    sinp.type = 'search';
    sinp.placeholder = 'Cerca attrezzatura\u2026';
    sbox.appendChild(sinp);
    var chipsBox = el('div', 'lgc-chips');
    tools.appendChild(sbox);
    tools.appendChild(chipsBox);
    root.appendChild(tools);
    var listBox = el('div', 'lgc-list');
    root.appendChild(listBox);
    panel.insertBefore(root, addCard && addCard.parentNode === panel ? addCard.nextSibling : panel.firstChild);
    sinp.addEventListener('input', function () { q = sinp.value.trim().toLowerCase(); render(); });

    function kpi(icon, label, value) {
      var k = el('div', 'lgc-kpi');
      var ic = el('span', 'ic'); ic.innerHTML = svg(icon);
      var tx = el('div', '');
      tx.appendChild(el('div', 'lb', label));
      tx.appendChild(el('div', 'vl', String(value)));
      k.appendChild(ic); k.appendChild(tx);
      return k;
    }
    function chip(label, key, count) {
      var c = el('button', 'lgc-chip' + (catSel === key ? ' on' : ''), label);
      c.type = 'button';
      if (count != null) c.appendChild(el('small', '', String(count)));
      c.addEventListener('click', function () { catSel = key; render(); });
      return c;
    }

    function card(it) {
      var av = avail(it);
      var cls = av <= 0 ? 'out' : ((it.used || 0) > 0 ? 'warn' : '');
      var c = el('div', 'lgc-card');
      c.setAttribute('data-id', it.id);
      var ic = el('span', 'lgc-ico'); ic.innerHTML = svg(iconFor(it));
      var main = el('div', 'lgc-main');
      main.appendChild(el('div', 'lgc-name', it.name));
      var cat = catBy[it.category];
      if (cat) main.appendChild(el('div', 'lgc-meta', cat.label));
      var bar = el('div', 'lgc-bar ' + cls);
      var fill = document.createElement('i');
      fill.style.width = (it.total > 0 ? Math.max(0, Math.min(100, Math.round(av / it.total * 100))) : 0) + '%';
      bar.appendChild(fill);
      main.appendChild(bar);
      var avl = el('div', 'lgc-av ' + cls, 'Disponibili ' + Math.max(av, 0) + ' di ' + (it.total || 0));
      if ((it.used || 0) > 0) avl.appendChild(el('em', '', 'In prestito ' + it.used));
      main.appendChild(avl);
      if (it.notes) main.appendChild(el('div', 'lgc-note', it.notes));
      var acts = el('div', 'lgc-acts');
      var bLend = el('button', 'lgc-btn pri'); bLend.type = 'button';
      bLend.innerHTML = svg(ICONS.play);
      bLend.appendChild(document.createTextNode('Presta'));
      if (av <= 0) { bLend.disabled = true; bLend.title = 'Nessun pezzo disponibile'; }
      bLend.addEventListener('click', function () { lend(it); });
      var bEdit = el('button', 'lgc-btn'); bEdit.type = 'button';
      bEdit.innerHTML = svg(ICONS.pen);
      bEdit.appendChild(document.createTextNode('Modifica'));
      bEdit.addEventListener('click', function () { openEdit(it); });
      var more = el('div', 'lgc-more');
      var dots = el('button', 'lgc-dots', '\u22ee'); dots.type = 'button'; dots.title = 'Altre azioni';
      var pop = el('div', 'lgc-pop');
      var del = el('button', '', 'Elimina'); del.type = 'button';
      pop.appendChild(del);
      dots.addEventListener('click', function (e) {
        e.stopPropagation();
        var wasOpen = pop.classList.contains('open');
        [].forEach.call(document.querySelectorAll('.lgc-pop.open'), function (p) { p.classList.remove('open'); });
        if (!wasOpen) pop.classList.add('open');
      });
      del.addEventListener('click', function () {
        pop.classList.remove('open');
        if (window.deleteEq) window.deleteEq(it.id);
      });
      more.appendChild(dots); more.appendChild(pop);
      acts.appendChild(bLend); acts.appendChild(bEdit); acts.appendChild(more);
      main.appendChild(acts);
      c.appendChild(ic); c.appendChild(main);
      return c;
    }

    function render() {
      var totalQty = 0, used = 0, out = 0;
      items.forEach(function (it) { totalQty += it.total || 0; used += it.used || 0; if (avail(it) <= 0) out++; });
      kpiBox.innerHTML = '';
      kpiBox.appendChild(kpi(ICONS.box, 'Articoli', items.length));
      kpiBox.appendChild(kpi(ICONS.layers, 'Pezzi totali', totalQty));
      kpiBox.appendChild(kpi(ICONS.swap, 'In prestito', used));
      kpiBox.appendChild(kpi(ICONS.warn, 'Esauriti', out));

      chipsBox.innerHTML = '';
      chipsBox.appendChild(chip('Tutte', '*', items.length));
      cats.forEach(function (c) {
        var cnt = items.filter(function (it) { return it.category === c.key; }).length;
        if (cnt) chipsBox.appendChild(chip(c.label, c.key, cnt));
      });
      var none = items.filter(function (it) { return !it.category || !catBy[it.category]; }).length;
      if (none) chipsBox.appendChild(chip('Senza tipologia', '', none));

      listBox.innerHTML = '';
      var list = items.filter(function (it) {
        if (catSel === '' ) return (!it.category || !catBy[it.category]) && (!q || match({ name: it.name, notes: it.notes, location_custom: it.location_custom, category: '', location: it.location }));
        return match(it);
      });
      if (!list.length) {
        listBox.appendChild(el('div', 'lgc-empty', items.length ? 'Nessuna attrezzatura corrisponde alla ricerca.' : 'Nessuna attrezzatura in catalogo. Usa \u00abAggiungi attrezzatura\u00bb per inserirne una.'));
        return;
      }
      var groups = {}, order = [];
      list.forEach(function (it) {
        var k = locKeyOf(it);
        if (!groups[k]) { groups[k] = []; order.push(k); }
        groups[k].push(it);
      });
      var seq = [];
      locs.forEach(function (l) { if (groups[l.key]) seq.push(l.key); });
      if (groups['']) seq.push('');
      order.forEach(function (k) { if (seq.indexOf(k) < 0) seq.push(k); });
      seq.forEach(function (k) {
        var g = el('div', 'lgc-group');
        var gh = el('div', 'lgc-gh');
        gh.appendChild(el('b', '', locTitle(k)));
        gh.appendChild(el('span', '', '\u00b7 ' + groups[k].length + (groups[k].length === 1 ? ' articolo' : ' articoli')));
        g.appendChild(gh);
        var grid = el('div', 'lgc-grid');
        groups[k].forEach(function (it) { grid.appendChild(card(it)); });
        g.appendChild(grid);
        listBox.appendChild(g);
      });
    }
    render();

    document.addEventListener('click', function () {
      [].forEach.call(document.querySelectorAll('.lgc-pop.open'), function (p) { p.classList.remove('open'); });
    });

    /* Se deleteEq toglie la scheda originale, togli anche la mia */
    if (window.MutationObserver) {
      new MutationObserver(function () {
        var before = items.length;
        items = items.filter(function (it) { return !!document.getElementById('eq-' + it.id); });
        if (items.length !== before) render();
      }).observe(panel, { childList: true, subtree: true });
    }
  }
})();
