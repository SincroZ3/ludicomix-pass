/**
 * helpers/editions.js
 * ──────────────────────────────────────────────────────────────────
 * Cache dell'edizione corrente e helper per filtri SQL multi-edizione.
 * Inizializzato una volta sola all'avvio; aggiornato da /admin/editions.
 * ──────────────────────────────────────────────────────────────────
 */

let _currentEdition = null;

function init(db) {
  refreshCurrentEdition(db);
}

function refreshCurrentEdition(db, cb) {
  db.get('SELECT * FROM editions WHERE is_current=1 LIMIT 1', [], function (err, row) {
    _currentEdition = row || null;
    if (cb) cb();
  });
}

function getCurrent() {
  return _currentEdition;
}

// Restituisce un frammento SQL da appendere a query con alias "ag"
// Es: "AND ag.edition_id = 3"  oppure "" se nessuna edizione attiva
function edFilter() {
  return _currentEdition ? `AND ag.edition_id = ${_currentEdition.id}` : '';
}

// Restituisce l'id dell'edizione corrente, o null
function edVal() {
  return _currentEdition ? _currentEdition.id : null;
}

module.exports = { init, refreshCurrentEdition, getCurrent, edFilter, edVal };
