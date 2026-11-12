/* ludi-portale-desk.js — Portale Espositore (desktop): icone nelle pillole, riquadri con avanzamento,
   card "Finestra inserimento nominativi" con conto alla rovescia.
   Lavora sul DOM costruito da ludi-portale.js; in caso di errore la pagina resta com'e'. */
(function () {
  'use strict';
  try { init(); } catch (e) { if (window.console) console.error('[ludi-portale-desk]', e); }

  function init() {
    if (!document.body.classList.contains('pt-on')) return;
    var home = document.getElementById('pt-home');
    var W = window.__PT_WINDOW || {};

    var P = {
      stand: '<path d="M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6"/>',
      pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
      check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
      cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/><path d="M19 8v6M16 11h6"/>'
    };
    function svg(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || '') + '</svg>'; }
    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function txt(e) { return (e.textContent || '').replace(/\s+/g, ' ').trim(); }
    function go(k) {
      var b = document.querySelector('.pt-tab[data-k="' + k + '"]');
      if (b) b.click();
    }

    /* 1 — Pillole con icona + pillola contratto */
    var kindByText = {};
    [].forEach.call(document.querySelectorAll('.info-strip .info-card'), function (c) {
      var lab = c.querySelector('.info-card-label');
      var val = c.querySelector('.info-card-value');
      if (!lab || !val) return;
      var l = txt(lab).toLowerCase();
      var v = txt(val);
      if (/zona/.test(l)) kindByText[v] = 'pin';
      else if (/categoria/.test(l)) kindByText[v] = 'user';
      else if (/codice stand/.test(l)) kindByText['Stand ' + v] = 'stand';
    });
    var pills = document.querySelector('.pt-hero .pt-pills');
    var hb = document.querySelector('.pt-hero .pt-hero-body');
    if (!pills && hb) { pills = el('div', 'pt-pills'); hb.appendChild(pills); }
    if (pills) {
      [].forEach.call(pills.querySelectorAll('.pt-pill'), function (p) {
        if (p.querySelector('svg')) return;
        var t = txt(p);
        var k = kindByText[t] || 'user';
        p.textContent = '';
        p.insertAdjacentHTML('beforeend', svg(k));
        p.appendChild(document.createTextNode(t));
      });
      var cs = String(W.contract || '').toLowerCase();
      if (cs === 'firmato' || cs === 'inviato') {
        var cp = el('span', 'pt-pill pt-pill-ok');
        cp.insertAdjacentHTML('beforeend', svg('check'));
        cp.appendChild(document.createTextNode('Contratto: ' + (cs === 'firmato' ? 'Firmato' : 'Inviato')));
        pills.appendChild(cp);
      }
    }

    /* 2 — Riquadri: descrizioni, avanzamento Nominativi, chip Documenti */
    var DESC = {
      'Nominativi': "Gestisci l'elenco dei nominativi del tuo stand.",
      'Mappa': 'Scopri dove si trova il tuo stand in fiera.',
      'Documenti e modulistica': "Carica e consulta i documenti richiesti dall'organizzazione.",
      'Assistenza': "Richiedi servizi o apri un ticket all'organizzazione."
    };
    [].forEach.call(document.querySelectorAll('.pt-tile'), function (t) {
      var h = t.querySelector('h3');
      var p = t.querySelector('p');
      var key = h ? txt(h) : '';
      if (p && DESC[key]) p.textContent = DESC[key];
      if (key === 'Documenti e modulistica' && !t.querySelector('.pt-tile-chip')) {
        var n = document.querySelectorAll('#documenti-section .item-card').length;
        if (n > 0) t.appendChild(el('span', 'pt-tile-chip', n + (n === 1 ? ' caricato' : ' caricati')));
      }
    });
    var nomTile = document.querySelector('.pt-tile-nom');
    if (nomTile) {
      [].forEach.call(nomTile.querySelectorAll('.pt-tile-chip, .pt-tile-bar'), function (x) { x.classList.add('pt-hide'); });
      var prog = el('div', 'pt-tile-prog');
      var bar = el('div', 'pt-tile-bar2');
      var fill = document.createElement('i');
      bar.appendChild(fill);
      var cnt = el('span', 'pt-tile-count', '');
      prog.appendChild(bar);
      prog.appendChild(cnt);
      nomTile.appendChild(prog);
      var updNom = function () {
        var sc = document.getElementById('slot-counter');
        var m = sc ? /(\d+)\s*\/\s*(\d+)\s*slot/.exec(txt(sc)) : null;
        var a = 0, b = 0;
        if (m) { a = parseInt(m[1], 10); b = parseInt(m[2], 10); }
        else {
          var pn = document.querySelector('.prog-num');
          var mm = pn ? /(\d+)\D+(\d+)/.exec(txt(pn)) : null;
          if (mm) { a = parseInt(mm[1], 10); b = parseInt(mm[2], 10); }
        }
        cnt.textContent = a + ' / ' + b;
        fill.style.width = (b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0) + '%';
      };
      updNom();
      if (window.MutationObserver) {
        var obs = new MutationObserver(updNom);
        var sc2 = document.getElementById('slot-counter');
        var pn2 = document.querySelector('.prog-num');
        var nl = document.getElementById('nom-list');
        if (sc2) obs.observe(sc2, { childList: true, characterData: true, subtree: true });
        if (pn2) obs.observe(pn2, { childList: true, characterData: true, subtree: true });
        if (nl) obs.observe(nl, { childList: true });
      }
    }

    /* 3 — Card "Finestra inserimento nominativi" con conto alla rovescia */
    if (!home) return;
    var target = document.querySelector('.pt-tab[data-k="nominativi"]') ? 'nominativi' : (document.querySelector('.pt-tab[data-k="documenti"]') ? 'documenti' : null);
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    function parse(s) {
      if (!s) return null;
      var d = new Date(String(s).replace(' ', 'T'));
      return isNaN(d.getTime()) ? null : d;
    }
    function fmt(d) {
      var m = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
      var y = d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '';
      return m + y + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    var from = parse(W.from);
    var until = parse(W.until);
    function state() {
      var n = Date.now();
      if (from && n < from.getTime()) return 'before';
      if (until && n > until.getTime()) return 'closed';
      return until ? 'open' : 'free';
    }

    var card = el('section', 'pt-win pt-desk-only');
    var hd = el('div', 'pt-win-hd');
    hd.innerHTML = svg('cal');
    hd.appendChild(el('h3', '', 'Finestra inserimento nominativi'));
    card.appendChild(hd);
    var body = el('div', 'pt-win-body');
    var status = el('div', 'pt-win-status');
    status.innerHTML = svg('clock');
    var statusTxt = el('span', '', '');
    status.appendChild(statusTxt);
    body.appendChild(status);
    var cd = el('div', 'pt-win-cd');
    var boxes = {};
    [['d', 'giorni'], ['h', 'ore'], ['m', 'minuti'], ['s', 'secondi']].forEach(function (u) {
      var box = document.createElement('div');
      var b = document.createElement('b');
      b.textContent = '00';
      var s = document.createElement('small');
      s.textContent = u[1];
      box.appendChild(b);
      box.appendChild(s);
      cd.appendChild(box);
      boxes[u[0]] = b;
    });
    body.appendChild(cd);
    var note = el('p', 'pt-win-note');
    var noteI = el('i', '', 'i');
    var noteTxt = el('span', '', '');
    note.appendChild(noteI);
    note.appendChild(noteTxt);
    body.appendChild(note);
    if (target) {
      var btn = el('button', 'pt-win-btn');
      btn.type = 'button';
      btn.innerHTML = svg('userplus');
      var btnTxt = el('em', '', '');
      btnTxt.style.fontStyle = 'normal';
      btn.appendChild(btnTxt);
      btn.appendChild(el('span', '', '\u203A'));
      btn.addEventListener('click', function () { go(target); });
      body.appendChild(btn);
    }
    card.appendChild(body);
    home.appendChild(card);

    var cur = null;
    function render() {
      cur = state();
      status.classList.toggle('closed', cur === 'closed');
      cd.style.display = (cur === 'before' || cur === 'open') ? '' : 'none';
      note.style.display = cur === 'free' ? 'none' : '';
      if (cur === 'before') {
        statusTxt.textContent = 'Apre il ' + fmt(from);
        noteTxt.textContent = "Potrai inserire i nominativi dall'apertura della finestra.";
      } else if (cur === 'open') {
        statusTxt.textContent = 'Aperta fino al ' + fmt(until);
        noteTxt.textContent = 'Dopo la scadenza non sar\u00e0 pi\u00f9 possibile inserire o modificare i nominativi.';
      } else if (cur === 'closed') {
        statusTxt.textContent = 'Chiusa dal ' + fmt(until);
        noteTxt.textContent = "Puoi ancora scaricare i tuoi pass e contattare l'organizzazione.";
      } else {
        statusTxt.textContent = 'Nessuna scadenza impostata';
      }
      if (btnTxt) btnTxt.textContent = cur === 'closed' ? 'Vai ai nominativi' : 'Vai alla gestione nominativi';
    }
    function tick() {
      if (cur !== state()) render();
      if (cur !== 'before' && cur !== 'open') return;
      var diff = Math.max(0, (cur === 'before' ? from : until).getTime() - Date.now());
      var s = Math.floor(diff / 1000);
      boxes.d.textContent = pad(Math.floor(s / 86400));
      boxes.h.textContent = pad(Math.floor(s % 86400 / 3600));
      boxes.m.textContent = pad(Math.floor(s % 3600 / 60));
      boxes.s.textContent = pad(s % 60);
    }
    render();
    tick();
    setInterval(tick, 1000);
  }
})();
