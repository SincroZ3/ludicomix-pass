'use strict';
const fs=require('fs');
const path=require('path');
const {askGroq}=require('../helpers/ai-client');
const {retrieve}=require('../helpers/ai-knowledge');
const {buildMessages}=require('../helpers/ai-safety');

module.exports=function registerAiAssistant(app,db,{requireAuth}){
 const K=path.join(__dirname,'..','knowledge');

 db.run(`CREATE TABLE IF NOT EXISTS assistente_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userid INTEGER,
  role TEXT,
  question TEXT,
  source TEXT,
  link TEXT,
  useful INTEGER,
  createdat TEXT DEFAULT (datetime('now','localtime'))
 )`,(err)=>{if(err)console.error('migrazione assistente_feedback',err.message);});

 db.run(`CREATE TABLE IF NOT EXISTS assistente_irrisolte (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userid INTEGER,
  role TEXT,
  question TEXT,
  path TEXT,
  createdat TEXT DEFAULT (datetime('now','localtime'))
 )`,(err)=>{if(err)console.error('migrazione assistente_irrisolte',err.message);});

 const guides=[
  {file:'guida-pass.md',keys:['pass','badge','nominativo','partecipante','stand','assegnatario','ristampa','invalid'],roles:['admin','organizer','accountant','operator','custom']},
  {file:'guida-agenda.md',keys:['agenda','evento','programma','sala','relatore','mappa pubblica','conflitto'],roles:['admin','organizer','accountant','operator','custom']},
  {file:'guida-volontari.md',keys:['volont','turno','turni','candidatur','calendario'],roles:['admin','organizer','accountant','operator','custom']},
  {file:'guida-area-personale.md',keys:['nota','rubrica','contatt','spesa','rimborso','scontrino','fattura','firma','iban','checklist'],roles:['admin','organizer','accountant','operator','custom']},
  {file:'guida-logistica.md',keys:['logistica','servizio','attrezz','prestito','accredit','bacheca','material'],roles:['admin','organizer','accountant','custom']},
  {file:'guida-ruoli-edizioni.md',keys:['edizion','ruolo','permess','custom','admin','scanner','visualizz'],roles:['admin','organizer','accountant','operator','scanner','viewer','custom']},
  {file:'guida-mappe.md',keys:['mappa','mappe','zona','zone','planimetria','posizione','stand map','mappa pubblica'],roles:['admin','organizer','accountant','operator','custom']}
 ];

 const suggestions=['Spiegami passo per passo','Dove trovo questa funzione?','Ho un problema con questa operazione'];
 const has=(q,a)=>a.some(x=>q.includes(x));
 const out=(answer,href,label,source)=>({answer,source:source||'guida operativa',link:href?{href,label:label||'Apri sezione correlata →'}:null,suggestions});

 // Limite prudenziale per proteggere il piano gratuito Groq: 20 richieste AI/ora per utente.
 // Le risposte locali (guide, query SQL, diagnostiche) non consumano questo limite.
 const aiUsage=new Map();
 function canUseGroq(userId){
  const now=Date.now(),hour=60*60*1000;
  const recent=(aiUsage.get(userId)||[]).filter(t=>now-t<hour);
  if(recent.length>=20){aiUsage.set(userId,recent);return false;}
  recent.push(now);aiUsage.set(userId,recent);return true;
 }

 function requireAdminInline(req,res,next){
  const u=req.session&&req.session.user;
  if(!u||(u.role!=='admin'&&u.role!=='organizer'))return res.status(403).send('Solo amministratori e organizzatori possono consultare i log del Ciuchino.');
  next();
 }

 function escHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

 function renderLogPage(title,rows,columns){
  const head=columns.map(c=>'<th style="text-align:left;padding:.4rem .6rem;border-bottom:1px solid #ddd;">'+escHtml(c.label)+'</th>').join('');
  const body=rows.map(r=>{
   const cells=columns.map(c=>'<td style="padding:.35rem .6rem;border-bottom:1px solid #eee;vertical-align:top;">'+escHtml(typeof c.value==='function'?c.value(r):r[c.key])+'</td>').join('');
   return '<tr>'+cells+'</tr>';
  }).join('');
  return '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>'+escHtml(title)+'</title>'+
   '<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;margin:1.5rem;color:#222;}h1{font-size:1.3rem;}table{border-collapse:collapse;width:100%;font-size:.85rem;}a{color:#1d6fa4;}</style></head><body>'+
   '<p><a href="/home">← Torna alla Home</a></p>'+
   '<h1>'+escHtml(title)+'</h1>'+
   '<p>Voci totali: '+rows.length+'. Le più recenti sono in alto.</p>'+
   '<table><thead><tr>'+head+'</tr></thead><tbody>'+(body||'<tr><td style="padding:.6rem;">Nessuna voce registrata.</td></tr>')+'</tbody></table>'+
   '</body></html>';
 }

 // ---- Regole editabili nei file Markdown -----------------------------
 const RULE_RE=/<!--\s*regola([\s\S]*?)-->\s*([\s\S]*?)(?=\n<!--\s*regola|\n##|\s*$)/g;

 function parseRules(raw,fileName){
  const rules=[];
  let m;
  while((m=RULE_RE.exec(raw))!==null){
   const metaBlock=m[1],answer=m[2].trim();
   if(!answer)continue;
   const meta={};
   metaBlock.split('\n').forEach(line=>{
    const idx=line.indexOf(':');
    if(idx===-1)return;
    const key=line.slice(0,idx).trim().toLowerCase();
    const val=line.slice(idx+1).trim();
    if(key)meta[key]=val;
   });
   const keywords=(meta.keywords||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
   if(!keywords.length)continue;
   rules.push({keywords,link:meta.link||null,label:meta.label||null,answer,file:fileName});
  }
  return rules;
 }

 function stripRuleBlocks(raw){return raw.replace(RULE_RE,'');}
 function stripMd(text){return text.replace(/^#.*$/gm,'').replace(/\*\*/g,'').trim();}
 function canRead(user,g){return user.role!=='custom'||g.roles.includes('custom');}
 function chunks(text){return text.split(/\n\n+/).filter(Boolean).map(stripMd).filter(Boolean);}

 function safetyNet(q){
  if(has(q,['genera un pass','generare un pass','crea un pass','creare un pass']))return out('Per generare un pass usa sempre Pass → Assegnatari pass. Apri lo stand interessato, aggiungi o apri il nominativo e genera il pass dalla sua scheda. Non usare Nuovo pass singolo e non usare Pass generati: sono funzioni di backup, non il flusso operativo ordinario.','/participants','Apri Assegnatari pass →','guida-pass.md (rete di sicurezza, da sostituire con regola Markdown)');
  if(has(q,['ristampa','ristampare','invalida','invalidare','scarica pass','stampare pass','consegna pass','riconsegna']))return out('Per ristampare, invalidare, scaricare, consegnare o riconsegnare un pass, apri Pass → Assegnatari pass, entra nello stand e individua il nominativo. Esegui l’operazione dalla sua scheda. Pass generati è solo una sezione di backup tecnico e non va usata né insegnata come procedura ordinaria.','/participants','Apri Assegnatari pass →','guida-pass.md (rete di sicurezza, da sostituire con regola Markdown)');
  if(has(q,['stand','assegnatari','assegnatario','gruppo espositore']))return out('Per creare un nuovo stand apri Pass → Assegnatari pass e premi Nuovo stand. Scegli il raggruppamento e compila almeno il nome; puoi poi aggiungere nome stand, zona, codice, limite pass, email e note. Salva, apri la scheda dello stand, aggiungi i nominativi e genera i loro pass. Non usare Nuovo pass singolo.','/participants','Apri Assegnatari pass →','guida-pass.md (rete di sicurezza, da sostituire con regola Markdown)');
  if(has(q,['spesa','scontrino','fattura','ricevuta','ricevute']))return out('Per inserire una spesa apri Area personale → Le mie spese e premi Nuova spesa. Inserisci descrizione, importo e data, scegli la categoria e allega eventuali ricevute; poi salva. La spesa potrà essere selezionata in una successiva richiesta di rimborso.','/area-personale/spese','Apri Le mie spese →','guida-area-personale.md (rete di sicurezza, da sostituire con regola Markdown)');
  if(has(q,['rimborso','rimborsi']))return out('Inserisci prima le singole voci in Area personale → Le mie spese. Poi apri Richieste rimborso, seleziona le spese non associate, completa i dati e invia la richiesta.','/area-personale/richieste-rimborso','Apri Richieste rimborso →','guida-area-personale.md (rete di sicurezza, da sostituire con regola Markdown)');
  if(has(q,['rubrica','contatto','contatti']))return out('Apri Area personale → Rubrica per creare un contatto personale. Con Importa da espositori puoi cercare un espositore in tutte le edizioni e aprire una scheda precompilata da verificare e salvare.','/area-personale/rubrica','Apri Rubrica →','guida-area-personale.md (rete di sicurezza, da sostituire con regola Markdown)');
  if(has(q,['edizione','edizioni']))return out('Per gestire le edizioni apri Impostazioni e seleziona la scheda Edizioni. Da qui crei o modifichi un’edizione e imposti quella corrente.','/admin/settings#edizioni','Apri Impostazioni: Edizioni →','guida-ruoli-edizioni.md (rete di sicurezza, da sostituire con regola Markdown)');
  return null;
 }

 // ── FASE 4: diagnostica dati "perché non riesco a generare questo pass?" ──
 const DIAG_PASS_RE = /(perch[eèé]|come mai|non riesco|non funziona|non genero|non genera|non si genera|problema con|blocca).*pass|\bpass\b.*(non si genera|non funziona|bloccato)/i;

 // Parole che NON possono mai essere scambiate per un nome proprio o un codice
 // nel meccanismo di "risposta breve dopo chiarimento". Senza questo filtro,
 // una domanda normale come "come creo uno stand?" veniva erroneamente
 // interpretata come il nome di un partecipante quando il Ciuchino era in
 // attesa di un chiarimento diagnostico rimasto aperto da prima.
 const NON_NAME_WORDS = new Set(['come','cosa','quando','dove','chi','quanto','quanti','quante',
  'perche','perché','qual','quali','posso','devo','serve','funziona','vorrei','voglio','crea',
  'creo','genera','genero','stand','pass','edizione','edizioni','spesa','spese','rimborso',
  'rimborsi','turno','turni','nota','note','rubrica','volontari','logistica','agenda','evento',
  'inserisco','aggiungo','sono','sistema','oggi','ieri']);

 function looksLikeRealName(candidate) {
  if (!candidate) return false;
  const words = candidate.toLowerCase().split(/\s+/);
  return !words.some(w => NON_NAME_WORDS.has(w));
 }

 function extractGroupIdFromPath(currentPath) {
  if (!currentPath) return null;
  const m = currentPath.match(/\/assignment-groups\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
 }
 function extractNameFromQuestion(q) {
  const m = q.match(/(?:per|di)\s+([a-zàèéìòù]+(?:\s+[a-zàèéìòù]+){0,2})\s*[?.]?\s*$/i);
  if (m) return looksLikeRealName(m[1].trim()) ? m[1].trim() : null;
  const bare = q.replace(/[?.!]/g, '').trim();
  if (/^[a-zàèéìòù' -]{3,40}$/i.test(bare) && bare.split(/\s+/).length <= 4 && !/\bpass\b|\bperch[eèé]\b|\bnon\b/.test(bare) && looksLikeRealName(bare)) return bare;
  return null;
 }
 function extractCodeFromQuestion(q) {
  const afterKeyword = q.match(/(?:codice|code)\s*[:\s]?\s*([a-z0-9]{4,20})/i);
  if (afterKeyword) return afterKeyword[1].toUpperCase();
  const tokens = q.match(/\b[a-z0-9]{4,20}\b/ig) || [];
  const candidate = tokens.find(t => /[0-9]/.test(t) && /[a-z]/i.test(t));
  return candidate ? candidate.toUpperCase() : null;
 }

 async function findParticipantCandidates(nameGuess, codeGuess, groupIdHint) {
  const clauses = [];
  const params = [];
  if (codeGuess) {
   clauses.push(`(p.ref_code = ? OR p.id IN (SELECT participant_id FROM passes WHERE code = ?))`);
   params.push(codeGuess, codeGuess);
  }
  if (nameGuess) {
   const like = '%' + nameGuess.replace(/\s+/g, '%') + '%';
   clauses.push(`(p.first_name || ' ' || p.last_name LIKE ? OR p.last_name || ' ' || p.first_name LIKE ?)`);
   params.push(like, like);
  }
  if (!clauses.length && groupIdHint) {
   clauses.push('p.assignment_group_id = ?');
   params.push(groupIdHint);
  }
  if (!clauses.length) return [];
  const sql = `SELECT p.id, p.first_name, p.last_name, p.assignment_group_id, ag.id AS groupid, ag.name AS groupname, ag.stand_name, ag.max_passes, ag.edition_id AS groupeditionid
   FROM participants p LEFT JOIN assignment_groups ag ON ag.id = p.assignment_group_id
   WHERE ${clauses.join(' OR ')} LIMIT 8`;
  return await new Promise((resolve) => db.all(sql, params, (err, rows) => {
   if (err) console.error('findParticipantCandidates SQL error:', err.message, '| sql:', sql, '| params:', params);
   resolve(err ? [] : (rows || []));
  }));
 }

 async function diagnosePassGeneration(req, q, currentPath) {
  const groupIdHint = extractGroupIdFromPath(currentPath);
  const nameGuess = extractNameFromQuestion(q);
  const codeGuess = extractCodeFromQuestion(q);
  const candidates = await findParticipantCandidates(nameGuess, codeGuess, groupIdHint);

  if (!candidates.length) {
   req.session.pendingDiagFollowUp = true;
   return out('Per capire perché non riesci a generare il pass, dimmi il nome e cognome del partecipante oppure il codice del pass o del nominativo. In alternativa apri la scheda dello stand interessato in Assegnatari pass e ripeti la domanda da lì.', '/participants', 'Apri Assegnatari pass →', 'diagnostica pass (dati mancanti)');
  }
  if (candidates.length > 1) {
   req.session.pendingDiagFollowUp = true;
   const names = candidates.slice(0, 5).map(c => `${c.first_name} ${c.last_name}${c.groupname ? ' (' + c.groupname + ')' : ''}`).join(', ');
   return out(`Ho trovato più nominativi che corrispondono: ${names}. Specifica meglio il nome completo o il codice del pass per farti una diagnosi precisa.`, null, null, 'diagnostica pass (ambiguo)');
  }
  req.session.pendingDiagFollowUp = false;

  const participant = candidates[0];
  const activePass = await new Promise((resolve) => db.get(
   `SELECT id, code, status FROM passes WHERE participant_id = ? AND status != 'INVALIDATO' ORDER BY id DESC LIMIT 1`,
   [participant.id], (err, row) => resolve(err ? null : row)
  ));
  if (activePass) {
   return out(`${participant.first_name} ${participant.last_name} ha già un pass attivo (codice ${activePass.code || activePass.id}, stato ${activePass.status}). È per questo che il sistema mostra un avviso e blocca una nuova generazione: per evitare duplicati devi prima invalidare quello esistente da Pass → Assegnatari pass, oppure usare "Sostituisci pass" se disponibile.`, participant.groupid ? `/assignment-groups/${participant.groupid}` : '/participants', 'Apri la scheda dello stand →', 'diagnostica pass (già presente)');
  }

  if (participant.groupid && participant.max_passes != null) {
   const activeCount = await new Promise((resolve) => db.get(
    `SELECT COUNT(DISTINCT pa.id) AS n FROM participants pa JOIN passes ps ON ps.participant_id = pa.id WHERE pa.assignment_group_id = ? AND ps.status != 'INVALIDATO'`,
    [participant.groupid], (err, row) => resolve(err ? 0 : (row ? row.n : 0))
   ));
   if (activeCount >= participant.max_passes) {
    return out(`Lo stand "${participant.groupname || participant.stand_name || ''}" ha raggiunto il limite massimo di ${participant.max_passes} pass (attualmente ${activeCount} generati). Per generarne altri, un amministratore deve prima alzare il limite dalla scheda dello stand, sezione Limite pass.`, `/assignment-groups/${participant.groupid}`, 'Apri la scheda dello stand →', 'diagnostica pass (limite raggiunto)');
   }
  }

  const anyPassType = await new Promise((resolve) => db.get(`SELECT COUNT(*) AS n FROM pass_types`, [], (err, row) => resolve(err ? 0 : (row ? row.n : 0))));
  if (!anyPassType) {
   return out('Nel sistema non è ancora presente nessuna tipologia di pass (la "matrice pass"). Senza almeno una tipologia configurata, la generazione è sempre bloccata. Un amministratore deve crearne una in Impostazioni → Tipologie pass, caricando anche il modello PDF.', '/admin/settings?tab=tipologie', 'Apri Impostazioni: Tipologie →', 'diagnostica pass (matrice mancante)');
  }

  const currentEdition = await new Promise((resolve) => db.get(`SELECT id FROM editions WHERE is_current = 1 LIMIT 1`, [], (err, row) => resolve(err ? null : row)));
  if (currentEdition && participant.groupeditionid && participant.groupeditionid !== currentEdition.id) {
   return out(`Lo stand di ${participant.first_name} ${participant.last_name} appartiene a un'altra edizione, diversa da quella attualmente attiva sul portale. Cambia l'edizione corrente da Impostazioni, oppure verifica di essere nello stand giusto.`, '/admin/settings#edizioni', 'Apri Impostazioni: Edizioni →', 'diagnostica pass (edizione errata)');
  }

  return out(`Non ho trovato blocchi evidenti per ${participant.first_name} ${participant.last_name}: nessun pass già attivo, il limite dello stand non è stato raggiunto e la matrice pass è configurata. Se il problema persiste, assicurati di aver selezionato una tipologia di pass dal menu a tendina prima di premere "Genera", oppure segnala l'errore esatto mostrato a schermo.`, participant.groupid ? `/assignment-groups/${participant.groupid}` : '/participants', 'Apri la scheda dello stand →', 'diagnostica pass (nessun blocco rilevato)');
 }


 // ── FASE 4: statistiche live su pass e nominativi ─────────────────
 const LIVE_STATS_RE=/\b(quanti|quante|numero|totale)\b.*\b(pass|nominativi|partecipanti)\b|\b(pass|nominativi|partecipanti)\b.*\b(quanti|quante)\b/i;
 function dbOne(sql,params){return new Promise(resolve=>db.get(sql,params,(err,row)=>resolve(err?null:row)));}
  // ── FASE 4bis: quanti pass ha uno stand/espositore? ─────────────────
 // La regex richiede esplicitamente "stand"/"espositore"/"gruppo" per non
 // intercettare domande generiche di sistema come "quanti pass ha generato
 // oggi il sistema?", che restano di competenza di LIVE_STATS_RE più sotto.
 const DIAG_GROUP_PASS_RE=/quant[ei]\s+pass.*\b(ha|hanno)\b.*\b(stand|espositore|gruppo)\b/i;
 const DIAG_GROUP_PASS_INVALID_RE=/(invalidat|sostitui)/i;
 const GROUP_STOP_WORDS=new Set(['quanti','quante','pass','ha','hanno','lo','la','il','gli','le','stand','espositore','gruppo','di','del','della','dello','ci','sono','quello','quella']);

 function extractGroupNameQuery(q){
  const m=q.match(/(?:stand|espositore|gruppo)\s+([a-zà-ù0-9\s'\.\-]{2,60})/i)
    ||q.match(/\bha(?:nno)?\s+(?:lo\s+stand\s+|l['’]\s*espositore\s+|il\s+gruppo\s+)?([a-zà-ù0-9\s'\.\-]{2,60})$/i);
  if(!m)return null;
  const v=m[1].trim().replace(/[?.!]+$/,'').trim();
  if(!v)return null;
  const words=v.toLowerCase().split(/\s+/);
  if(words.every(w=>GROUP_STOP_WORDS.has(w)))return null;
  return v;
 }

 async function findAssignmentGroupByName(nameGuess){
  if(!nameGuess)return null;
  const like='%'+nameGuess.replace(/%/g,'')+'%';
  return await new Promise(resolve=>db.get(
   `SELECT id,name,stand_name FROM assignment_groups WHERE name LIKE ? OR stand_name LIKE ? ORDER BY id LIMIT 1`,
   [like,like],(err,row)=>resolve(err?null:row)
  ));
 }

 
// ── Memoria breve Ludi AI: ultimo stand/espositore citato ───────────
const LUDI_CONTEXT_TTL_MS=30*60*1000;
function getLudiContext(req){
 const ctx=req.session&&req.session.ludiAiContext;
 if(!ctx||!ctx.updatedAt||Date.now()-ctx.updatedAt>LUDI_CONTEXT_TTL_MS){
  if(req.session)delete req.session.ludiAiContext;
  return null;
 }
 return ctx;
}
function rememberGroup(req,group){
 if(!req.session)return;
 req.session.ludiAiContext={
  lastTopic:'group_pass_count',
  lastGroupId:group.id,
  lastGroupName:group.name,
  lastStandName:group.stand_name||null,
  updatedAt:Date.now()
 };
}
function isGroupFollowUp(text){
 return /^(?:e\s+)?(?:gli|i|quelli|quelle)?\s*(?:pass\s+)?(?:invalidati|sostituiti|attivi)?[!?.\s]*$/i.test(String(text||'').trim());
}
async function findAssignmentGroupById(id){
 if(!id)return null;
 return await new Promise(resolve=>db.get(
  `SELECT id,name,stand_name FROM assignment_groups WHERE id=?`,[id],(err,row)=>resolve(err?null:row)
 ));
}
async function diagnoseGroupPassFollowUp(req,original){
 const ctx=getLudiContext(req);
 if(!ctx||!isGroupFollowUp(original))return null;
 const group=await findAssignmentGroupById(ctx.lastGroupId);
 if(!group)return null;
 const label=group.stand_name?`${group.name} (${group.stand_name})`:group.name;
 const q=String(original||'').toLowerCase();
 const wantsInvalid=/(invalidat|sostitui)/.test(q);
 const status=wantsInvalid?`p.status='INVALIDATO'`:`p.status!='INVALIDATO'`;
 const row=await new Promise(resolve=>db.get(
  `SELECT COUNT(*) AS n FROM passes p JOIN participants pa ON pa.id=p.participant_id WHERE pa.assignment_group_id=? AND ${status}`,
  [group.id],(err,r)=>resolve(err?null:r)
 ));
 const n=row?row.n||0:0;
 const what=wantsInvalid?'pass invalidati o sostituiti nello storico':'pass attivi (non invalidati)';
 return out(`Per lo stand ${label} risultano ${n} ${what}.`,`/assignment-groups/${group.id}`,'Apri la scheda dello stand →','memoria conversazionale · conteggio pass per stand');
}

async function diagnoseGroupPassCount(req,q){
  if(!DIAG_GROUP_PASS_RE.test(q))return null;
  const nameGuess=extractGroupNameQuery(q);
  if(!nameGuess){
   return out('Per dirti quanti pass ha uno stand, indicami il nome dello stand o dell’espositore.','/participants','Apri Assegnatari pass →','statistiche live (conteggio pass per stand)');
  }
  const group=await findAssignmentGroupByName(nameGuess);
  if(!group){
   return out(`Non trovo uno stand o un espositore corrispondente a "${nameGuess}".`,'/participants','Apri Assegnatari pass →','statistiche live (stand non trovato)');
  }
  rememberGroup(req,group);
  const label=group.stand_name?`${group.name} (${group.stand_name})`:group.name;
  const wantsInvalid=DIAG_GROUP_PASS_INVALID_RE.test(q);
  if(wantsInvalid){
   const row=await new Promise(resolve=>db.get(
    `SELECT COUNT(*) AS n FROM passes p JOIN participants pa ON pa.id=p.participant_id WHERE pa.assignment_group_id=? AND p.status='INVALIDATO'`,
    [group.id],(err,r)=>resolve(err?null:r)
   ));
   const n=row?row.n||0:0;
   return out(`Lo stand ${label} ha ${n} pass invalidati o sostituiti nello storico.`,`/assignment-groups/${group.id}`,'Apri la scheda dello stand →','statistiche live (pass invalidati per stand)');
  }
  const row=await new Promise(resolve=>db.get(
   `SELECT COUNT(*) AS n FROM passes p JOIN participants pa ON pa.id=p.participant_id WHERE pa.assignment_group_id=? AND p.status!='INVALIDATO'`,
   [group.id],(err,r)=>resolve(err?null:r)
  ));
  const n=row?row.n||0:0;
  return out(`Lo stand ${label} ha attualmente ${n} pass attivi (non invalidati).`,`/assignment-groups/${group.id}`,'Apri la scheda dello stand →','statistiche live (pass attivi per stand)');
 }


 async function liveStats(q){
  if(!LIVE_STATS_RE.test(q))return null;
  const cur=await dbOne(`SELECT id,name FROM editions WHERE is_current=1 LIMIT 1`,[]);
  if(!cur)return out('Non trovo un’edizione corrente: non posso calcolare statistiche affidabili finché non ne viene selezionata una.','/admin/settings#edizioni','Apri Impostazioni: Edizioni →','statistiche live');
  const ed=[cur.id];
  const isParticipants=/\b(nominativi|partecipanti)\b/i.test(q)||/pass\s+(sono\s+)?inseriti/i.test(q);
  const isToday=/\b(oggi|odierno|odierna)\b/i.test(q);
  const isWithoutPass=/senza\s+pass/i.test(q);
  const isValidPdf=/pdf\s+(valid|generat)|pass\s+(pdf\s+)?valid|pass\s+sono\s+generati/i.test(q);
  if(isParticipants){
   if(isToday){
    const row=await dbOne(`SELECT COUNT(*) AS total, SUM(CASE WHEN EXISTS (SELECT 1 FROM passes ps WHERE ps.participant_id=p.id AND ps.status!='INVALIDATO' AND ps.pdf_file IS NOT NULL AND TRIM(ps.pdf_file)!='') THEN 1 ELSE 0 END) AS with_pdf FROM participants p WHERE p.edition_id=? AND date(p.created_at)=date('now','localtime')`,ed);
    if(!row)return out('Non riesco a leggere i nominativi inseriti oggi in questo momento.',null,null,'statistiche live');
    const total=row.total||0,withPdf=row.with_pdf||0;
    return out(`Oggi sono stati inseriti ${total} nominativi nell’edizione ${cur.name}. ${withPdf} hanno già almeno un pass PDF valido; ${total-withPdf} sono ancora senza un pass PDF valido e possono essere in attesa di generazione.`,'/participants','Apri Assegnatari pass →','statistiche live: nominativi inseriti oggi');
   }
   if(isWithoutPass){
    const row=await dbOne(`SELECT COUNT(*) AS total FROM participants p WHERE p.edition_id=? AND NOT EXISTS (SELECT 1 FROM passes ps WHERE ps.participant_id=p.id AND ps.status!='INVALIDATO' AND ps.pdf_file IS NOT NULL AND TRIM(ps.pdf_file)!='')`,ed);
    if(!row)return out('Non riesco a calcolare i nominativi senza pass in questo momento.',null,null,'statistiche live');
    return out(`Nell’edizione ${cur.name} ci sono ${row.total||0} nominativi senza un pass PDF valido.`, '/participants','Apri Assegnatari pass →','statistiche live: nominativi senza pass');
   }
   return out('Posso dirti quanti nominativi sono stati inseriti oggi oppure quanti sono senza pass PDF valido. Prova, ad esempio: “quanti nominativi sono stati inseriti oggi?” o “quanti nominativi sono senza pass?”.','/participants','Apri Assegnatari pass →','statistiche live');
  }
  if(isToday){
   const row=await dbOne(`SELECT COUNT(*) AS created_today, SUM(CASE WHEN status!='INVALIDATO' AND pdf_file IS NOT NULL AND TRIM(pdf_file)!='' THEN 1 ELSE 0 END) AS valid_pdf_today, SUM(CASE WHEN status='GENERATO' THEN 1 ELSE 0 END) AS still_generated, SUM(CASE WHEN status='SCARICATO' THEN 1 ELSE 0 END) AS downloaded, SUM(CASE WHEN status='STAMPATO' THEN 1 ELSE 0 END) AS printed, SUM(CASE WHEN status IN ('CONSEGNATO','RICONSEGNATO') THEN 1 ELSE 0 END) AS delivered, SUM(CASE WHEN status='INVALIDATO' THEN 1 ELSE 0 END) AS invalidated FROM passes WHERE edition_id=? AND date(created_at)=date('now','localtime')`,ed);
   if(!row)return out('Non riesco a calcolare i pass generati oggi in questo momento.',null,null,'statistiche live');
   return out(`Oggi sono stati creati ${row.created_today||0} pass nell’edizione ${cur.name}. Di questi, ${row.valid_pdf_today||0} hanno un PDF valido. Stato attuale: ${(row.still_generated||0)} generati, ${(row.downloaded||0)} scaricati, ${(row.printed||0)} stampati, ${(row.delivered||0)} consegnati o riconsegnati, ${(row.invalidated||0)} invalidati.`,'/participants','Apri Assegnatari pass →','statistiche live: pass creati oggi');
  }
  if(isValidPdf){
   const row=await dbOne(`SELECT COUNT(*) AS total FROM passes WHERE edition_id=? AND status!='INVALIDATO' AND pdf_file IS NOT NULL AND TRIM(pdf_file)!=''`,ed);
   if(!row)return out('Non riesco a calcolare i pass PDF validi in questo momento.',null,null,'statistiche live');
   return out(`Nell’edizione ${cur.name} ci sono ${row.total||0} pass con PDF generato e valido.`, '/participants','Apri Assegnatari pass →','statistiche live: PDF validi');
  }
  return out('Posso calcolare i pass creati oggi oppure i pass PDF validi. Prova: “quanti pass ha generato oggi il sistema?” oppure “quanti pass PDF validi ci sono?”.','/participants','Apri Assegnatari pass →','statistiche live');
 }

 // ── FASE 4: diagnostica accreditamenti ────────────────────────────
 const DIAG_ACCREDIT_RE=/(che\s+cosa\s+manca|cosa\s+manca|manca\s+a).*(accredit|richiesta)|(accredit|richiesta).*(incomplet|complet|manca|non riesco|problema|rifiutat|approvat)|rifiutat.*(accredit|richiesta)|approvat.*(accredit|richiesta)/i;
 const ACCREDIT_STOP_WORDS=new Set(['questo','questa','accreditamento','accredito','richiesta','domanda','manca','cosa','che','azienda','espositore','stampa','media','autore','content','creator']);
 function extractAccredQuery(q){
  const m=q.match(/(?:accreditamento|accredito|richiesta)\s+(?:di|per)\s+(.+?)(?:\s+(?:è|e)\s+(?:complet[ao]|rifiutat[ao]|approvat[ao])|\s*[?.]?\s*$)/i)||q.match(/(?:di|per)\s+(.+?)(?:\s+(?:è|e)\s+(?:complet[ao]|rifiutat[ao]|approvat[ao])|\s*[?.]?\s*$)/i);
  if(!m)return null;
  const v=m[1].trim();
  return v&& !v.split(/\s+/).some(w=>ACCREDIT_STOP_WORDS.has(w.toLowerCase())) ? v : null;
 }
 function missingLabels(r){
  const missing=[];
  if(!r.company_name)missing.push('azienda/organizzazione');
  if(!r.contact_name)missing.push('nome del referente');
  if(!r.email)missing.push('email');
  const type=(r.accreditation_type||'espositore').toLowerCase();
  if(['espositore','associazione'].includes(type)){
   if(!r.stand_type)missing.push('tipologia di stand');
   if(!r.stand_size)missing.push('dimensione dello stand');
  }else if(['stampa','media'].includes(type)){
   if(!r.media_outlet)missing.push('testata/mezzo');
   if(!r.press_role)missing.push('ruolo nella testata');
  }else if(type==='autore'){
   if(!r.publisher)missing.push('editore');
   if(!r.genre)missing.push('genere');
  }else if(['contentcreator','content_creator'].includes(type)){
   if(!r.channel_url)missing.push('link del canale');
   if(!r.platform)missing.push('piattaforma');
   if(!r.subscribers)missing.push('numero iscritti/follower');
  }
  return missing;
 }
 async function diagnoseAccreditation(q,currentPath){
  const idMatch=(q.match(/(?:accreditamento|accredito|richiesta)\s*(?:n\.?|numero|#)?\s*(\d+)/i)||[])[1];
  const term=extractAccredQuery(q);
  let rows=[];
  if(idMatch){
   rows=await new Promise(resolve=>db.all(`SELECT ar.*,ag.name AS linked_group_name,ag.stand_name AS linked_stand_name FROM accreditation_requests ar LEFT JOIN assignment_groups ag ON ag.id=ar.assignment_group_id WHERE ar.id=?`,[parseInt(idMatch,10)],(e,r)=>resolve(e?[]:(r||[]))));
  }else if(term){
   const like='%'+term.replace(/\s+/g,'%')+'%';
   rows=await new Promise(resolve=>db.all(`SELECT ar.*,ag.name AS linked_group_name,ag.stand_name AS linked_stand_name FROM accreditation_requests ar LEFT JOIN assignment_groups ag ON ag.id=ar.assignment_group_id WHERE ar.company_name LIKE ? OR ar.contact_name LIKE ? OR ar.email LIKE ? ORDER BY ar.created_at DESC LIMIT 8`,[like,like,like],(e,r)=>resolve(e?[]:(r||[]))));
  }else if(currentPath&&/\/admin\/accreditamento/.test(currentPath)){
   return out('Per verificare che cosa manca, indicami il nome dell’azienda, il nome del referente, l’email oppure il numero della richiesta di accreditamento.', '/admin/accreditamento','Apri Accreditamenti →','diagnostica accreditamenti (dati mancanti)');
  }else return null;
  if(!rows.length)return out('Non trovo una richiesta di accreditamento corrispondente. Indicami il nome dell’azienda, il referente, l’email oppure il numero della richiesta.', '/admin/accreditamento','Apri Accreditamenti →','diagnostica accreditamenti (non trovato)');
  if(rows.length>1){
   const names=rows.slice(0,5).map(r=>`${r.company_name||'Senza azienda'} — ${r.contact_name||'senza referente'} (richiesta #${r.id})`).join(', ');
   return out(`Ho trovato più richieste: ${names}. Specifica il numero della richiesta oppure un riferimento più preciso.`,null,null,'diagnostica accreditamenti (ambiguo)');
  }
  const r=rows[0],type=(r.accreditation_type||'espositore').toLowerCase(),missing=missingLabels(r);
  if(r.status==='rifiutato')return out(`La richiesta #${r.id} di ${r.company_name||r.contact_name} è stata rifiutata.${r.rejection_reason?' Motivo registrato: '+r.rejection_reason+'.':' Non è stata registrata una motivazione.'}`, '/admin/accreditamento','Apri Accreditamenti →','diagnostica accreditamenti (rifiutato)');
  if(r.status==='portale_attivato')return out(`La richiesta #${r.id} di ${r.company_name||r.contact_name} è già approvata e il portale espositore è attivato.${r.linked_group_name?' È collegata al gruppo '+r.linked_group_name+(r.linked_stand_name?' / stand '+r.linked_stand_name:'')+'.':''}`, r.assignment_group_id?`/assignment-groups/${r.assignment_group_id}`:'/admin/accreditamento','Apri sezione correlata →','diagnostica accreditamenti (approvato)');
  const extra=type==='espositore'||type==='associazione'?' Per approvarla dovrai inoltre scegliere nel modulo di approvazione raggruppamento, zona, nome stand e limite pass.':'';
  if(missing.length)return out(`La richiesta #${r.id} di ${r.company_name||r.contact_name} è in attesa e risulta incompleta: mancano ${missing.join(', ')}.${extra}`, '/admin/accreditamento','Apri Accreditamenti →','diagnostica accreditamenti (campi mancanti)');
  return out(`La richiesta #${r.id} di ${r.company_name||r.contact_name} è completa nei dati richiesti per la tipologia “${r.accreditation_type||'espositore'}” ed è ancora in attesa.${extra}`, '/admin/accreditamento','Apri Accreditamenti →','diagnostica accreditamenti (completa)');
 }
  // ── FASE 5: diagnostica "perché non posso annullare questo rimborso?" ──
 // Regola di business reale (routes/area-personale.js, POST .../richieste-rimborso/:id/annulla):
 // l'annullamento è permesso SOLO se status === 'in_attesa'. Owner-only: la query
 // filtra sempre per user_id, quindi una richiesta di un altro utente risulta "non trovata".
 const DIAG_REFUND_RE=/(perch[eé]|come mai).*(annull|cancell).*(rimbors)|(rimbors).*(annull|cancell)|annull.*(rimbors)/i;
 function extractRefundId(q){
  const m=q.match(/(?:rimborso|richiesta)\s*(?:n\.?|numero|#)?\s*(\d+)/i);
  return m?parseInt(m[1],10):null;
 }
 async function diagnoseRefundCancel(req,q,currentPath){
  const uid=req.session&&req.session.user&&req.session.user.id;
  const isAccounting=req.session&&req.session.user&&(req.session.user.role==='admin'||req.session.user.role==='accountant');
  const id=extractRefundId(q);
  if(!id){
   if(currentPath&&/richieste-rimborso/.test(currentPath)){
    return out('Per dirti perché non riesci ad annullare, indicami il numero della richiesta di rimborso.', '/area-personale/richieste-rimborso','Apri le mie richieste di rimborso →','diagnostica rimborsi (dati mancanti)');
   }
   return null;
  }
  const r=await new Promise(resolve=>db.get(`SELECT rr.*,u.username FROM refund_requests rr LEFT JOIN users u ON u.id=rr.user_id WHERE rr.id=?`,[id],(e,row)=>resolve(e?null:row)));
  if(!r){
   return out(`Non trovo una richiesta di rimborso con il numero #${id}.`, '/area-personale/richieste-rimborso','Apri le mie richieste di rimborso →','diagnostica rimborsi (non trovata)');
  }
  if(r.user_id!==uid&&!isAccounting){
   return out(`Non riesci ad annullare la richiesta #${id} perché non è associata al tuo account: puoi annullare solo le tue richieste di rimborso.`, '/area-personale/richieste-rimborso','Apri le mie richieste di rimborso →','diagnostica rimborsi (non proprietario)');
  }
  if(r.status==='in_attesa'){
   return out(`La richiesta #${id} è ancora in attesa: puoi annullarla dal pulsante Annulla nella pagina delle tue richieste di rimborso. Le spese collegate torneranno disponibili per una nuova richiesta.`, '/area-personale/richieste-rimborso','Apri le mie richieste di rimborso →','diagnostica rimborsi (annullabile)');
  }
  if(r.status==='approvata'){
   return out(`Non puoi annullare la richiesta #${id} perché è già stata approvata: le richieste valutate (approvate o rifiutate) non sono più annullabili dal richiedente.`, '/area-personale/richieste-rimborso','Apri le mie richieste di rimborso →','diagnostica rimborsi (già approvata)');
  }
  if(r.status==='rifiutata'){
   return out(`Non puoi annullare la richiesta #${id} perché è già stata rifiutata.${r.review_notes?' Motivo registrato: '+r.review_notes+'.':' Non è stata registrata una motivazione.'} Le richieste già valutate non sono più annullabili dal richiedente.`, '/area-personale/richieste-rimborso','Apri le mie richieste di rimborso →','diagnostica rimborsi (già rifiutata)');
  }
  return out(`La richiesta #${id} ha uno stato non riconosciuto (${r.status}); contatta un amministratore per verificarla.`, '/area-personale/richieste-rimborso','Apri le mie richieste di rimborso →','diagnostica rimborsi (stato sconosciuto)');
 }

  // ── FASE 6: "quali turni volontari sono ancora scoperti?" ──
 // Schema reale (db.js): shifts(id,name,zone_id,role_label,start_at,end_at,
 // max_volunteers,notes,active) + shift_assignments(id,shift_id,volunteer_id,
 // status,checkin_at,checkin_code,notes). Il conteggio "assegnati" nel codice
 // esistente (routes/volunteers.js) conta TUTTE le righe di shift_assignments
 // per shift_id, senza filtrare per status: replichiamo lo stesso criterio.
 const DIAG_SHIFTS_RE=/turni?.*(scopert|liber|manca|coper)|(scopert|liber).*turni?|turni?\s+volontari/i;
 async function diagnoseOpenShifts(q){
  const rows=await new Promise(resolve=>db.all(
   `SELECT s.*, z.name AS zone_name,
           (SELECT COUNT(*) FROM shift_assignments sa WHERE sa.shift_id=s.id) AS assigned_count
    FROM shifts s LEFT JOIN zones z ON z.id=s.zone_id
    WHERE s.active=1
    ORDER BY s.start_at, s.name`,
   [],(e,r)=>resolve(e?[]:(r||[]))
  ));
  if(!rows.length)return out('Non risultano turni attivi configurati per i volontari.', '/volunteers','Apri Volontari →','diagnostica turni (nessun turno)');
  const open=rows.filter(s=>(s.assigned_count||0)<s.max_volunteers);
  if(!open.length)return out('Tutti i turni attivi risultano coperti: nessun posto libero al momento.', '/volunteers','Apri Volontari →','diagnostica turni (tutti coperti)');
  const list=open.slice(0,10).map(s=>{
   const missing=s.max_volunteers-(s.assigned_count||0);
   const when=s.start_at?String(s.start_at).replace('T',' ').slice(0,16):'orario non impostato';
   const zone=s.zone_name?` (${s.zone_name})`:'';
   return `${s.name}${zone} — ${when}: mancano ${missing} volontari su ${s.max_volunteers}`;
  }).join('; ');
  return out(`Turni ancora scoperti: ${list}.${open.length>10?' (mostro i primi 10)':''}`, '/volunteers','Apri Volontari →','diagnostica turni (scoperti)');
 }

  // ── FASE 7: "quali richieste logistica sono ancora in attesa?" ──
 // Schema reale (db.js): service_requests(id, assignment_group_id, type,
 // service_type, quantity, notes, status, requested_at, updated_at,
 // edition_id) + assignment_groups(id, name, ...). Stati reali confermati
 // in views/admin-logistica.ejs: in_attesa, approvato, consegnato, annullato.
 const DIAG_LOGISTICA_RE=/(richiest[ae]|servizi).*(logistic|material|attrezzatur).*(attesa|scopert|pendent)|(logistic|material|attrezzatur).*(richiest[ae]).*(attesa)|richiest[ae]\s+(di\s+)?(servizio|servizi|material|attrezzatur).*(attesa)/i;
 async function diagnoseLogisticaPending(){
  const rows=await new Promise(resolve=>db.all(
   `SELECT sr.*, sr.service_type AS type, ag.name AS group_name
    FROM service_requests sr
    LEFT JOIN assignment_groups ag ON ag.id = sr.assignment_group_id
    WHERE sr.status='in_attesa'
    ORDER BY sr.requested_at ASC`,
   [],(e,r)=>resolve(e?[]:(r||[]))
  ));
  if(!rows.length)return out('Non risultano richieste di servizi/materiale logistica in attesa al momento.', '/admin/logistica','Apri Logistica →','diagnostica logistica (nessuna in attesa)');
  const list=rows.slice(0,10).map(r=>{
   const group=r.group_name||'gruppo non specificato';
   const type=r.type||r.service_type||'tipo non specificato';
   const when=r.requested_at?String(r.requested_at).slice(0,16).replace('T',' '):'data non disponibile';
   return `${group} — ${type} (qtà ${r.quantity||1}), richiesta il ${when}`;
  }).join('; ');
  return out(`Richieste di logistica ancora in attesa (${rows.length}): ${list}.${rows.length>10?' (mostro le prime 10, in ordine dalla più vecchia)':''}`, '/admin/logistica','Apri Logistica →','diagnostica logistica (in attesa)');
 }



 // ── Ludi AI: saluti e presentazione locale (mai inviati a Groq) ──────
 const GREETING_RE=/^(ciao|ehi|hey|salve|buongiorno|buonasera|buonanotte)(?:\s+(?:ciuchino|ciuco|ludi|ludi ai))?[!?.\s]*$/i;
 const CAPABILITIES_RE=/^(?:cosa|che cosa)\s+(?:puoi|sai)\s+fare[!?.\s]*$|^(?:in cosa|come)\s+mi\s+puoi\s+aiutare[!?.\s]*$|^(?:aiuto|help)[!?.\s]*$/i;

 function ludiIntro(role,currentPath,kind){
  const roleName={admin:'Admin',organizer:'Organizzatore',accountant:'Amministrazione contabile',operator:'Operatore',scanner:'Scanner',viewer:'Visualizzatore',custom:'utente con permessi personalizzati'}[role]||'utente';
  const allowed={
   scanner:[
    '“Come uso lo scanner QR?”',
    '“Cosa significa questo stato del pass?”',
    '“Come uso il contatore ingressi?”'
   ],
   viewer:[
    '“Dove trovo uno stand o un pass?”',
    '“Come funziona questa pagina?”',
    '“Cosa significa lo stato di questo pass?”'
   ],
   operator:[
    '“Come creo uno stand?”',
    '“Come genero o ristampo un pass?”',
    '“Cerca Mario Rossi”',
    '“Come uso lo scanner QR?”'
   ],
   accountant:[
    '“Come inserisco una spesa?”',
    '“Come gestisco una richiesta rimborso?”',
    '“Quanti pass ha lo stand AREA LEGO?”',
    '“Come creo un evento o un turno?”'
   ],
   organizer:[
    '“Come creo uno stand o un evento?”',
    '“Quali turni sono scoperti?”',
    '“Quali richieste logistica sono in attesa?”',
    '“Come approvo un accreditamento?”'
   ],
   admin:[
    '“Come creo uno stand o un evento?”',
    '“Quali turni sono scoperti?”',
    '“Come gestisco ruoli ed edizioni?”',
    '“Quanti pass ha lo stand AREA LEGO?”'
   ],
   custom:[
    '“Come funziona questa pagina?”',
    '“Dove trovo la funzione che mi serve?”',
    '“Cerca un nominativo, stand o evento”'
   ]
  }[role]||[];
  const pageHint=currentPath?` Sei nella pagina ${currentPath}.`:'';
  if(kind==='greeting'){
   return {answer:`Ciao! Sono Ludi AI, il Ciuchino Assistente del portale.${pageHint} Posso guidarti passo passo nelle funzioni a cui hai accesso come ${roleName}. Scrivi “cosa puoi fare?” per vedere alcuni esempi.`,source:'Ludi AI · presentazione',link:null,suggestions:['Cosa puoi fare?','Dove trovo questa funzione?','Spiegami passo per passo']};
  }
  return {answer:`Posso aiutarti a usare il portale, cercare informazioni e spiegare le procedure passo passo. In base al tuo ruolo (${roleName}) puoi provare, ad esempio:

${allowed.map((x,i)=>`${i+1}. ${x}`).join('\n')}

Puoi anche scrivere una domanda libera: se serve, cercherò nelle guide interne del portale.${pageHint}`,source:'Ludi AI · cosa posso fare',link:null,suggestions:allowed.slice(0,3).map(x=>x.replace(/[“”]/g,''))};
 }
 app.post('/api/assistente/guida',requireAuth,async (req,res)=>{
  const original=String(req.body&&req.body.question||'').trim();
  if(original.length<2)return res.json({answer:'Scrivi una domanda un po’ più dettagliata.',suggestions:[]});
  const history=Array.isArray(req.body&&req.body.history)?req.body.history:[];
  const currentPath=req.body&&req.body.currentPath||null;

  // Saluti e richiesta capacità: risposta locale, senza storico e senza Groq.
  if(GREETING_RE.test(original))return res.json(ludiIntro(req.session.user.role,currentPath,'greeting'));
  if(CAPABILITIES_RE.test(original))return res.json(ludiIntro(req.session.user.role,currentPath,'capabilities'));
  const follow=/^(spiegami|spiega|dimmi|fammi vedere|come faccio|dove trovo|e poi|continua|passo per passo|pi[uù] dettagli|approfondisci)/i.test(original);
  const prev=history.slice().reverse().find(m=>m&&m.kind==='user'&&m.text&&m.text!==original);
  const q=((follow&&prev?prev.text+' ':'')+original).toLowerCase();

  // 0) Memoria conversazionale: follow-up sullo stand citato poco prima.
  try{
   const groupFollowUp=await diagnoseGroupPassFollowUp(req,original);
   if(groupFollowUp)return res.json(groupFollowUp);
  }catch(e){console.error('diagnoseGroupPassFollowUp',e.message);}

  // 0bis) Quanti pass ha uno stand/espositore (conteggio live per gruppo).
  // Precede le statistiche generiche: la regex di questa funzione richiede
  // esplicitamente stand/espositore/gruppo, quindi non intercetta domande
  // generiche come "quanti pass ha generato oggi il sistema?".
  try{
   const groupPassCount=await diagnoseGroupPassCount(req,q);
   if(groupPassCount)return res.json(groupPassCount);
  }catch(e){console.error('diagnoseGroupPassCount',e.message);}

  // 0bis) Statistiche live di sistema (Fase 4), prima di guide e diagnosi testuali.
  try{
   const stats=await liveStats(q);
   if(stats)return res.json(stats);
  }catch(e){console.error('liveStats',e.message);}

  // 1) Diagnostica accreditamenti in tempo reale.
  if(DIAG_ACCREDIT_RE.test(q)){
   try{
    const accred=await diagnoseAccreditation(q,currentPath);
    if(accred)return res.json(accred);
   }catch(e){console.error('diagnoseAccreditation',e.message);}
  }

  // 1bis) Diagnostica annullamento rimborsi in tempo reale.
  if(DIAG_REFUND_RE.test(q)){
   try{
    const refund=await diagnoseRefundCancel(req,q,currentPath);
    if(refund)return res.json(refund);
   }catch(e){console.error('diagnoseRefundCancel',e.message);}
  }

  // 1ter) Diagnostica turni volontari scoperti.
  if(DIAG_SHIFTS_RE.test(q)){
   try{
    const shiftsGap=await diagnoseOpenShifts(q);
    if(shiftsGap)return res.json(shiftsGap);
   }catch(e){console.error('diagnoseOpenShifts',e.message);}
  }

  // 1quater) Diagnostica richieste logistica in attesa.
  if(DIAG_LOGISTICA_RE.test(q)){
   try{
    const logisticaPending=await diagnoseLogisticaPending();
    if(logisticaPending)return res.json(logisticaPending);
   }catch(e){console.error('diagnoseLogisticaPending',e.message);}
  }

  // 2) Domande diagnostiche ESPLICITE hanno sempre la priorità assoluta.
  if(DIAG_PASS_RE.test(q)){
   try{
    const diag=await diagnosePassGeneration(req,q,currentPath);
    if(diag)return res.json(diag);
   }catch(e){console.error('diagnosePassGeneration',e.message);}
  }

  const allowedGuides=guides.filter(g=>canRead(req.session.user,g));
  const tokens=q.match(/[a-zàèéìòù]{3,}/g)||[];

  // 1) Regole Markdown esplicite (priorità alta, editabili senza JS)
  let bestRule={score:0,rule:null};
  allowedGuides.forEach(g=>{
   let raw='';try{raw=fs.readFileSync(path.join(K,g.file),'utf8');}catch(_){return;}
   parseRules(raw,g.file).forEach(rule=>{
    const score=rule.keywords.reduce((n,k)=>n+(q.includes(k)?10:0),0);
    if(score>bestRule.score)bestRule={score,rule};
   });
  });
  if(bestRule.score>0){
   const r=bestRule.rule;
   return res.json(out(r.answer,r.link,r.label,r.file));
  }

  // 2) Rete di sicurezza silenziosa
  const fixed=safetyNet(q);
  if(fixed)return res.json(fixed);

  // 3) FIX: solo ORA, se nessuna guida/regola normale ha risposto, proviamo
  // a interpretare un messaggio breve come continuazione di una diagnosi
  // rimasta in sospeso. In questo modo una domanda normale come
  // "come creo uno stand?" viene sempre gestita correttamente dai passi 1-2
  // qui sopra, e non può mai essere "rubata" da un chiarimento diagnostico
  // dimenticato in sessione.
  const wasPending=!!req.session.pendingDiagFollowUp;
  if(wasPending&&(extractNameFromQuestion(q)||extractCodeFromQuestion(q))){
   try{
    const diag=await diagnosePassGeneration(req,q,currentPath);
    if(diag)return res.json(diag);
   }catch(e){console.error('diagnosePassGeneration (follow-up)',e.message);}
  }

  // 4) Ludi AI: comprensione libera con Groq + estratti RAG locali.
  // Arriva solo dopo risposte SQL/diagnostiche e regole rapide deterministiche.
  // Se Groq è assente, esaurito o non risponde, il flusso prosegue con il fallback locale.
  if(process.env.GROQ_API_KEY&&canUseGroq(req.session.user.id)){
   try{
    const contexts=retrieve({knowledgeDir:K,guides:allowedGuides,question:q});
    if(contexts.length){
     const answer=await askGroq(buildMessages({
      question:original,role:req.session.user.role,currentPath,history,contexts
     }));
     if(answer){
      const links={'guida-pass.md':'/participants','guida-agenda.md':'/agenda','guida-volontari.md':'/volunteers','guida-area-personale.md':'/area-personale','guida-logistica.md':'/admin/logistica','guida-ruoli-edizioni.md':'/admin/settings#edizioni','guida-mappe.md':'/mappa'};
      const sourceFiles=[...new Set(contexts.map(c=>c.file))];
      const firstFile=sourceFiles[0];
      return res.json(out(answer,links[firstFile]||'/home','Apri sezione correlata →','Ludi AI · '+sourceFiles.join(', ')));
     }
    }
   }catch(e){console.error('Ludi AI Groq fallback',e.message);}
  }

  // 4) Ricerca generica nei paragrafi delle guide, con soglia minima di
  // attendibilità: un punteggio troppo basso (es. una sola parola chiave
  // debole come "pass" in una domanda statistica) NON deve produrre una
  // risposta sicura ma sbagliata. Meglio ammettere di non saperlo.
  const MIN_CONFIDENT_SCORE = 6;
  let best={score:0,text:'',file:''};
  allowedGuides.forEach(g=>{
   let raw='';try{raw=fs.readFileSync(path.join(K,g.file),'utf8');}catch(_){return;}
   chunks(stripRuleBlocks(raw)).forEach(chunk=>{
    const lower=chunk.toLowerCase();
    const score=g.keys.reduce((n,k)=>n+(q.includes(k)?4:0),0)+tokens.reduce((n,t)=>n+(lower.includes(t)?1:0),0);
    if(score>best.score)best={score,text:chunk,file:g.file};
   });
  });

  if(!best.score||best.score<MIN_CONFIDENT_SCORE){
   db.run('INSERT INTO assistente_irrisolte (userid, role, question, path) VALUES (?,?,?,?)',
    [req.session.user.id, req.session.user.role, original, currentPath],
    (err)=>{if(err)console.error('log domanda irrisolta',err.message);});
   return res.json({answer:'Non ho ancora una guida affidabile per questa domanda. Prova a citare una sezione: assegnatari pass, agenda, volontari, logistica, spese, rimborsi, rubrica, ruoli o edizioni.',suggestions:['Come creo uno stand?','Come inserisco una spesa?','Come gestisco i volontari?']});
  }
  const links={'guida-pass.md':'/participants','guida-agenda.md':'/agenda','guida-volontari.md':'/volunteers','guida-area-personale.md':'/area-personale','guida-logistica.md':'/admin/logistica','guida-ruoli-edizioni.md':'/admin/settings#edizioni'};
  res.json(out(best.text,links[best.file]||'/home','Apri sezione correlata →',best.file));
 });

 app.post('/api/assistente/feedback',requireAuth,(req,res)=>{
  const {question,source,link,useful}=req.body||{};
  if(typeof useful!=='boolean')return res.status(400).json({error:'Campo useful mancante'});
  db.run('INSERT INTO assistente_feedback (userid, role, question, source, link, useful) VALUES (?,?,?,?,?,?)',
   [req.session.user.id, req.session.user.role, question||null, source||null, link||null, useful?1:0],
   (err)=>{
    if(err){console.error('log feedback',err.message);return res.status(500).json({error:'Errore salvataggio feedback'});}
    res.json({ok:true});
   });
 });

 app.get('/admin/assistente/feedback',requireAuth,requireAdminInline,(req,res)=>{
  db.all('SELECT af.*, u.username FROM assistente_feedback af LEFT JOIN users u ON u.id=af.userid ORDER BY af.id DESC LIMIT 500',(err,rows)=>{
   if(err)return res.status(500).send('Errore lettura feedback: '+err.message);
   res.send(renderLogPage('Feedback Ciuchino',rows||[],[
    {label:'Data/ora',value:r=>r.createdat},
    {label:'Utile?',value:r=>r.useful?'✅ Sì':'❌ No'},
    {label:'Domanda',key:'question'},
    {label:'Guida usata',key:'source'},
    {label:'Link mostrato',key:'link'},
    {label:'Utente',value:r=>r.username||('id '+r.userid)},
    {label:'Ruolo',key:'role'}
   ]));
  });
 });

 app.get('/admin/assistente/irrisolte',requireAuth,requireAdminInline,(req,res)=>{
  db.all('SELECT ai.*, u.username FROM assistente_irrisolte ai LEFT JOIN users u ON u.id=ai.userid ORDER BY ai.id DESC LIMIT 500',(err,rows)=>{
   if(err)return res.status(500).send('Errore lettura domande irrisolte: '+err.message);
   res.send(renderLogPage('Domande senza risposta del Ciuchino',rows||[],[
    {label:'Data/ora',value:r=>r.createdat},
    {label:'Domanda',key:'question'},
    {label:'Pagina',key:'path'},
    {label:'Utente',value:r=>r.username||('id '+r.userid)},
    {label:'Ruolo',key:'role'}
   ]));
  });
 });

 // ---- Endpoint di diagnosi diretta (solo admin/organizer) --------------
 app.get('/admin/assistente/debug-diag',requireAuth,requireAdminInline,(req,res)=>{
  const qRaw=String(req.query.q||'').trim();

  db.all(`PRAGMA database_list`,[],(errDbList,dbListRows)=>{
   db.all(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,[],(errTables,tableRows)=>{
    const dbInfo={
     percorsoDatabase:(dbListRows||[]).map(r=>r.file),
     tabellePresenti:(tableRows||[]).map(r=>r.name),
     erroreListaTabelle:errTables?errTables.message:null
    };

    if(!qRaw){
     return res.type('json').send(JSON.stringify({
      istruzioni:'Usa ?q=perché non riesco a generare il pass di Nome Cognome. Aggiungi &path=/assignment-groups/3 per simulare il contesto pagina.',
      infoDatabase:dbInfo
     },null,2));
    }

    const q=qRaw.toLowerCase();
    const nameGuess=extractNameFromQuestion(q);
    const codeGuess=extractCodeFromQuestion(q);
    const groupIdHint=extractGroupIdFromPath(req.query.path||null);
    const diagMatch=DIAG_PASS_RE.test(q);

    const clauses=[];const params=[];
    if(codeGuess){clauses.push(`(p.ref_code = ? OR p.id IN (SELECT participant_id FROM passes WHERE code = ?))`);params.push(codeGuess,codeGuess);}
    if(nameGuess){const like='%'+nameGuess.replace(/\s+/g,'%')+'%';clauses.push(`(p.first_name || ' ' || p.last_name LIKE ? OR p.last_name || ' ' || p.first_name LIKE ?)`);params.push(like,like);}
    if(!clauses.length&&groupIdHint){clauses.push('p.assignment_group_id = ?');params.push(groupIdHint);}

    const sql=clauses.length?`SELECT p.id, p.first_name, p.last_name, p.assignment_group_id, ag.id AS groupid, ag.name AS groupname, ag.stand_name, ag.max_passes, ag.edition_id AS groupeditionid
     FROM participants p LEFT JOIN assignment_groups ag ON ag.id = p.assignment_group_id
     WHERE ${clauses.join(' OR ')} LIMIT 8`:null;

    db.all(sql||'SELECT 1 AS dummy',sql?params:[],(err,rows)=>{
     res.type('json').send(JSON.stringify({
      domandaRicevuta:qRaw,
      domandaNormalizzata:q,
      diagMatchRegex:diagMatch,
      nomeEstratto:nameGuess,
      codiceEstratto:codeGuess,
      groupIdDaPath:groupIdHint,
      sqlEseguita:sql,
      parametriSql:params,
      erroreDb:err?err.message:null,
      righeTrovate:rows||[],
      infoDatabase:dbInfo
     },null,2));
    });
   });
  });
 });

 app.get('/admin/assistente/debug-schema',requireAuth,requireAdminInline,(req,res)=>{
  const tables=['participants','assignment_groups','passes','pass_types','editions','groups'];
  const results={};
  let remaining=tables.length;
  tables.forEach(t=>{
   db.all(`PRAGMA table_info(${t})`,[],(err,cols)=>{
    results[t]={errore:err?err.message:null,colonne:(cols||[]).map(c=>c.name)};
    remaining--;
    if(remaining===0){
     res.type('json').send(JSON.stringify(results,null,2));
    }
   });
  });
 });
};
