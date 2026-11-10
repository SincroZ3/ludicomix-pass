/* ludi-participants-mobile.js — Assegnatari Pass: marca le celle vuote o duplicate delle righe
   (usato solo dal layout a schede su telefono). Non modifica dati, form o funzioni. */
(function () {
  'use strict';
  function tag() {
    document.querySelectorAll('section.category-panel tr.group-row').forEach(function (tr) {
      var tds = tr.children;
      if (tds.length < 5) return;
      var name = (tds[0].textContent || '').trim().toLowerCase();
      var stand = (tds[1].textContent || '').trim().toLowerCase();
      if (!stand || stand === name) tds[1].classList.add('lgm-hide');
      [2, 3].forEach(function (i) {
        var t = (tds[i].textContent || '').replace(/[\s\u2014\u2013-]/g, '');
        if (!t) tds[i].classList.add('lgm-hide');
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tag);
  else tag();
})();
