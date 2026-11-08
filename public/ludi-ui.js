/* ludi-ui.js — comportamenti leggeri condivisi (nessuna dipendenza) */
(function () {
  'use strict';

  function norm(p) {
    p = (p || '').split('?')[0].split('#')[0];
    p = p.replace(/\/+$/, '');
    return p || '/';
  }

  /* Evidenzia nella navbar la voce della pagina corrente.
     Vince il link con il percorso piu' lungo che corrisponde; se e' una
     voce del menu "Impostazioni", viene evidenziato il pulsante Impostazioni. */
  function markActiveNav() {
    var nav = document.getElementById('main-nav-bar');
    if (!nav) return;

    var path   = norm(location.pathname);
    var toggle = document.getElementById('settings-dropdown-toggle');
    var menu   = document.getElementById('settings-dropdown-menu');

    var cands = [];
    nav.querySelectorAll(':scope > a').forEach(function (a) {
      cands.push({ el: a, inMenu: false });
    });
    if (menu) {
      menu.querySelectorAll('a').forEach(function (a) {
        cands.push({ el: a, inMenu: true });
      });
    }

    var best = null;
    var bestLen = -1;
    cands.forEach(function (c) {
      var h = norm(c.el.getAttribute('href'));
      if (!h || h === '/') return;
      var ok = (path === h) || (path.indexOf(h + '/') === 0);
      if (ok && h.length > bestLen) { best = c; bestLen = h.length; }
    });

    if (!best) return;
    if (best.inMenu) {
      if (toggle) toggle.classList.add('nav-active');
    } else {
      best.el.classList.add('nav-active');
    }
  }

  /* Pagina Assegnatari Pass: avatar a iniziali e barra assegnatari/max pass.
     Aggiunge solo attributi (data-initials, data-bar, --av, --pct): il testo
     delle celle non cambia, quindi ricerca, filtri e ordinamento restano uguali. */
  function enhanceGroupRows() {
    var rows = document.querySelectorAll('tr.group-row');
    if (!rows.length) return;
    var palette = ['#8b5cc8', '#4f8fe6', '#2fae68', '#e5506a', '#1fbfb8', '#f08a24', '#6b3fa0', '#1d6fa4'];

    rows.forEach(function (tr) {
      var strong = tr.querySelector('td:first-child strong');
      if (strong && !strong.hasAttribute('data-initials')) {
        var name  = (strong.textContent || '').trim();
        var words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
        var first = words[0] || '?';
        var ini   = (first.charAt(0) + (words[1] ? words[1].charAt(0) : first.charAt(1))).toUpperCase();
        var h = 0;
        for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
        strong.setAttribute('data-initials', ini);
        strong.style.setProperty('--av', palette[h % palette.length]);
      }

      var count = parseInt(tr.getAttribute('data-participants'), 10) || 0;
      var max   = parseInt(tr.getAttribute('data-maxpass'), 10);
      var cell  = tr.children[4];
      if (cell && max > 0 && max < 999999) {
        cell.setAttribute('data-bar', '');
        cell.style.setProperty('--pct', Math.min(100, Math.round(count / max * 100)));
        if (count > max) cell.setAttribute('data-over', '');
      }
    });
  }

  function init() {
    markActiveNav();
    enhanceGroupRows();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
