# Ludicomix — Area Gestione Pass

Ludicomix-Pass è un sistema web di gestione pass, accreditamenti e logistica eventi, pensato specificamente per Ludicomix (verosimilmente una fiera/convention di fumetti e giochi). È deployata su Railway.app tramite un server Node.js con Express + SQLite, ed è già in produzione (ultimo push: 3 maggio 2026).

🏗️ Stack Tecnologico
Layer	Tecnologia
Runtime	Node.js
Framework	Express.js 4.x
Database	SQLite (via sqlite3 + connect-sqlite3 per le sessioni)
Template engine	EJS
Auth	express-session + bcryptjs
PDF	pdf-lib
Barcode/QR	bwip-js
Email	nodemailer
Import dati	xlsx (CSV/Excel)
Security	helmet + express-rate-limit
Deploy	Railway.app (+ render.yaml presente)
🗃️ Schema Database (SQLite)
Le tabelle principali sono:

participants — partecipanti/esposti con nome, email, stand, zona, gruppo

pass_types — tipi di pass con template PDF e coordinate di stampa

passes — pass generati con QR code, status e storico

assignment_groups — stand/gruppi con portale token, gestione limiti, mappa, edizione

users — utenti interni con ruoli

zones — zone dell'evento con immagine di sfondo

auto_passes — pass autonomi (senza partecipante nominato)

scan_attempts — log di ogni scansione badge

visitor_counts — contatore visitatori per area/gate

notifications / action_logs / announcements — notifiche, log azioni, bacheca comunicazioni

editions — supporto multi-edizione dell'evento

👥 Sistema di Ruoli (5 livelli)
Ruolo	Accesso
admin	Totale: impostazioni, utenti, backup
organizer	Operativo completo: stand, pass, import — no impostazioni sistema
operator	Crea/modifica partecipanti e pass, può scansionare
scanner	Solo pagina /scan
viewer	Sola lettura, nessuna modifica
🔧 Funzionalità Principali
L'app copre un ciclo operativo completo:

Gestione pass — creazione, download PDF con QR code, cambio status, storico, batch PDF

Portale espository — ogni stand ha un token univoco per accedere al proprio portale autonomo (/portale/:token)

Scansione badge — pagina scan in tempo reale con validazione pass

Mappa fiera — visualizzazione stand su mappa con posizionamento drag-and-drop

Contatore visitatori — conteggio IN/OUT per area/gate con reset manuale

Accreditamenti — form pubblici per espositori, media, volontari; workflow di approvazione/rifiuto

Agenda — modulo separato in agenda_routes.js

CRM — modulo separato in routes/crm.js

Logistica materiali — richieste materiali (corrente, gazebo, tavoli, ecc.) per stand

Bacheca comunicazioni — annunci con pin e notifiche non lette

Import massivo — upload CSV/Excel per importare partecipanti

Report & export — CSV per pass, senza-pass, stato-gruppi

Backup/Restore — backup e ripristino del database SQLite

Multi-edizione — supporto a più edizioni dell'evento con edizione corrente
