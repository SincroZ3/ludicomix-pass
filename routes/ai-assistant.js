'use strict';
const fs=require('fs');
const path=require('path');

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
  {file:'guida-ruoli-edizioni.md',keys:['edizion','ruolo','permess','custom','admin','scanner','visualizz'],roles:['admin','organizer','accountant','operator','scanner','viewer','custom']}
 ];

 const suggestions=['Spiegami passo per passo','Dove trovo questa funzione?','Ho un problema con questa operazione'];
 const has=(q,a)=>a.some(x=>q.includes(x));
 const out=(answer,href,label,source)=>({answer,source:source||'guida operativa',link:href?{href,label:label||'Apri sezione correlata →'}:null,suggestions});

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

 function extractGroupIdFromPath(currentPath) {
  if (!currentPath) return null;
  const m = currentPath.match(/\/assignment-groups\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
 }
 function extractNameFromQuestion(q) {
  const m = q.match(/(?:per|di)\s+([a-zàèéìòù]+(?:\s+[a-zàèéìòù]+){0,2})\s*[?.]?\s*$/i);
  if (m) return m[1].trim();
  const bare = q.replace(/[?.!]/g, '').trim();
  if (/^[a-zàèéìòù' -]{3,40}$/i.test(bare) && bare.split(/\s+/).length <= 4 && !/\bpass\b|\bperch[eèé]\b|\bnon\b/.test(bare)) return bare;
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

  // FIX: il flag "in attesa di chiarimento" va mantenuto attivo sia quando
  // non troviamo NESSUN candidato, sia quando ne troviamo TROPPI (ambiguo).
  // Va disattivato solo quando la diagnosi può davvero procedere su UN solo nominativo.
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

 app.post('/api/assistente/guida',requireAuth,async (req,res)=>{
  const original=String(req.body&&req.body.question||'').trim();
  if(original.length<2)return res.json({answer:'Scrivi una domanda un po’ più dettagliata.',suggestions:[]});
  const history=Array.isArray(req.body&&req.body.history)?req.body.history:[];
  const currentPath=req.body&&req.body.currentPath||null;
  const follow=/^(spiegami|spiega|dimmi|fammi vedere|come faccio|dove trovo|e poi|continua|passo per passo|pi[uù] dettagli|approfondisci)/i.test(original);
  const prev=history.slice().reverse().find(m=>m&&m.kind==='user'&&m.text&&m.text!==original);
  const q=((follow&&prev?prev.text+' ':'')+original).toLowerCase();

  const wasPending=!!req.session.pendingDiagFollowUp;
  if(DIAG_PASS_RE.test(q)||(wasPending&&(extractNameFromQuestion(q)||extractCodeFromQuestion(q)))){
   try{
    const diag=await diagnosePassGeneration(req,q,currentPath);
    if(diag)return res.json(diag);
   }catch(e){console.error('diagnosePassGeneration',e.message);}
  }

  const allowedGuides=guides.filter(g=>canRead(req.session.user,g));
  const tokens=q.match(/[a-zàèéìòù]{3,}/g)||[];

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

  const fixed=safetyNet(q);
  if(fixed)return res.json(fixed);

  let best={score:0,text:'',file:''};
  allowedGuides.forEach(g=>{
   let raw='';try{raw=fs.readFileSync(path.join(K,g.file),'utf8');}catch(_){return;}
   chunks(stripRuleBlocks(raw)).forEach(chunk=>{
    const lower=chunk.toLowerCase();
    const score=g.keys.reduce((n,k)=>n+(q.includes(k)?4:0),0)+tokens.reduce((n,t)=>n+(lower.includes(t)?1:0),0);
    if(score>best.score)best={score,text:chunk,file:g.file};
   });
  });

  if(!best.score){
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
