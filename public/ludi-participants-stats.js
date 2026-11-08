/* ludi-participants-stats.js — pagina Assegnatari Pass:
   1) card riepilogo (Gruppi, Partecipanti, Senza pass) sotto il titolo;
   2) pannello Ricerca e filtri collassabile (stato ricordato nel browser).
   Non modifica gli elementi della ricerca: li sposta soltanto in un contenitore,
   quindi id, gestori e filtri restano quelli della pagina. */
(function () {
  'use strict';

  var ICON_GROUPS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  var ICON_PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  var ICON_ALERT  = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#e5322d" stroke="none"/><path d="M12 7v6" stroke="#fff"/><path d="M12 17h.01" stroke="#fff"/></svg>';
  var ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
  var ICON_CHEV   = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  function fmt(n) { return Number(n).toLocaleString('it-IT'); }

  function statCard(cls, icon, label, id) {
    return '<div class="ui-stat ' + cls + '"><span class="ui-stat-icon">' + icon + '</span>' +
           '<div><div class="ui-stat-label">' + label + '</div>' +
           '<div class="ui-stat-value" id="' + id + '">\u2013</div></div></div>';
  }

  function setStat(id, value, danger) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = fmt(value);
    if (danger !== undefined) el.classList.toggle('is-ok', !danger);
  }

  function buildStats(filterCard) {
    var box = document.createElement('div');
    box.className = 'ui-stats';
    box.innerHTML =
      statCard('', ICON_GROUPS, 'Gruppi', 'ui-stat-groups') +
      statCard('', ICON_PERSON, 'Partecipanti', 'ui-stat-participants') +
      statCard('ui-stat--danger', ICON_ALERT, 'Senza pass', 'ui-stat-nopass');
    filterCard.parentNode.insertBefore(box, filterCard);

    /* Valori immediati ricavati dalla tabella (stesso criterio della home) */
    var rows = document.querySelectorAll('tr.group-row');
    var people = 0;
    rows.forEach(function (tr) { people += parseInt(tr.getAttribute('data-participants'), 10) || 0; });
    setStat('ui-stat-groups', rows.length);
    setStat('ui-stat-participants', people);

    /* Valori esatti dal server (comprende "senza pass") */
    fetch('/api/participants/summary', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('riepilogo non disponibile')); })
      .then(function (d) {
        setStat('ui-stat-groups', d.groups);
        setStat('ui-stat-participants', d.participants);
        setStat('ui-stat-nopass', d.senzaPass, d.senzaPass > 0);
      })
      .catch(function () {});
  }

  function makeCollapsible(card) {
    var KEY = 'ludi.participants.filters.open';

    var body = document.createElement('div');
    body.className = 'ui-filter-body';
    while (card.firstChild) body.appendChild(card.firstChild);

    var head = document.createElement('button');
    head.type = 'button';
    head.className = 'ui-filter-toggle';
    head.setAttribute('aria-expanded', 'false');
    head.innerHTML =
      '<span class="ui-filter-title">' + ICON_SEARCH + 'Ricerca e filtri</span>' +
      '<span class="ui-filter-active" hidden>Filtri attivi</span>' +
      '<span class="ui-filter-chev">' + ICON_CHEV + '</span>';

    card.appendChild(head);
    card.appendChild(body);

    function setOpen(open) {
      card.classList.toggle('ui-open', open);
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (e) {}
    }
    head.addEventListener('click', function () { setOpen(!card.classList.contains('ui-open')); });

    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    setOpen(saved === '1');

    function updateActive() {
      var s = document.getElementById('search-input');
      var z = document.getElementById('zone-filter');
      var active = !!((s && s.value.trim()) || (z && z.value));
      head.querySelector('.ui-filter-active').hidden = !active;
    }
    ['input', 'change', 'click'].forEach(function (ev) {
      card.addEventListener(ev, function () { setTimeout(updateActive, 0); });
    });
    updateActive();
  }

  function init() {
    var input = document.getElementById('search-input');
    var card = input ? input.closest('.card') : null;
    if (!card || card.getAttribute('data-ui-stats')) return;
    card.setAttribute('data-ui-stats', '1');
    buildStats(card);
    makeCollapsible(card);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
