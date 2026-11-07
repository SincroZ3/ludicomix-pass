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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markActiveNav);
  } else {
    markActiveNav();
  }
})();
