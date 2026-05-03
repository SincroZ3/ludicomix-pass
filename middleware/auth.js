/**
 * middleware/auth.js
 * ──────────────────────────────────────────────────────────────────
 * Gerarchia ruoli, middleware di autenticazione e utilità condivise.
 * Usato da tutti i moduli route.
 * ──────────────────────────────────────────────────────────────────
 */

const path = require('path');

const ROLES = {
  ADMIN:     'admin',
  ORGANIZER: 'organizer',
  OPERATOR:  'operator',
  SCANNER:   'scanner',
  VIEWER:    'viewer',
};

// Ruoli che possono FARE (scrivere) qualcosa
const CAN_WRITE     = [ROLES.ADMIN, ROLES.ORGANIZER, ROLES.OPERATOR];
// Ruoli che possono modificare la struttura (zone, tipologie, gruppi)
const CAN_STRUCTURE = [ROLES.ADMIN, ROLES.ORGANIZER];
// Ruoli che possono accedere alle impostazioni di sistema
const CAN_ADMIN     = [ROLES.ADMIN];
// Ruoli che possono scansionare (incluso viewer — sola lettura)
const CAN_SCAN      = [ROLES.ADMIN, ROLES.ORGANIZER, ROLES.OPERATOR, ROLES.SCANNER, ROLES.VIEWER];

function hasRole(user, ...roles) {
  return user && roles.includes(user.role);
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  // Lo scanner viene confinato alla sola pagina /scan
  if (
    req.session.user.role === ROLES.SCANNER &&
    !req.path.startsWith('/scan') &&
    !req.path.startsWith('/api/scan') &&
    !req.path.startsWith('/contatore') &&
    !req.path.startsWith('/api/visitors') &&
    !req.path.startsWith('/logout')
  ) {
    return res.redirect('/scan');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!hasRole(req.session.user, ...CAN_ADMIN)) {
    return res.status(403).sendFile(path.join(__dirname, '..', 'views', '403.html'));
  }
  next();
}

// Operazioni di struttura: admin + organizer
function requireOrganizer(req, res, next) {
  if (!hasRole(req.session.user, ...CAN_STRUCTURE)) {
    return res.status(403).sendFile(path.join(__dirname, '..', 'views', '403.html'));
  }
  next();
}

// Operazioni di scrittura: admin + organizer + operator
function requireNotViewer(req, res, next) {
  if (!hasRole(req.session.user, ...CAN_WRITE)) {
    return res.status(403).sendFile(path.join(__dirname, '..', 'views', '403.html'));
  }
  next();
}

// Ruoli che possono scansionare
function requireCanScan(req, res, next) {
  if (!hasRole(req.session.user, ...CAN_SCAN)) {
    return res.status(403).sendFile(path.join(__dirname, '..', 'views', '403.html'));
  }
  next();
}

module.exports = {
  ROLES,
  CAN_WRITE,
  CAN_STRUCTURE,
  CAN_ADMIN,
  CAN_SCAN,
  hasRole,
  requireAuth,
  requireAdmin,
  requireOrganizer,
  requireNotViewer,
  requireCanScan,
};
