'use strict';
const fs=require('fs');
const path=require('path');

// registerAiAssistant(app, db, { requireAuth })
// I log di feedback e delle domande irrisolte sono ora salvati nel
// database SQLite condiviso (stessa connessione 'db' di tutto il resto
// del portale), NON più su file: così sopravvivono ai redeploy.
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
 // <!-- regola
 // link: /participants
 // label: Apri Assegnatari pass →
 // keywords: stand, assegnatari, assegnatario, gruppo espositore
 // -->
 // seguito dal testo della risposta.
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
  if(has(q,['genera un pass','generare un pass','crea un pass','creare un pass']))return out('Per generare un pass usa sempre Pass → Assegnatari pass. Apri lo stand interessato, aggiungi o apri il nominativo e genera il pass dalla sua scheda. Non usare Nuovo pass singolo e non usare Pass generati: sono funzioni di backup, non il flusso operativo ordinario.','/participants','Apri Assegnatari pass →','guida-pass.md (rete di sicurezza)');
  if(has(q,['ristampa','ristampare','invalida','invalidare','scarica pass','stampare pass','consegna pass','riconsegna']))return out('Per ristampare, invalidare, scaricare, consegnare o riconsegnare un pass, apri Pass → Assegnatari pass, entra nello stand e individua il nominativo. Esegui l’operazione dalla sua scheda. Pass generati è solo una sezione di backup tecnico e non va usata né insegnata come procedura ordinaria.','/participants','Apri Assegnatari pass →','guida-pass.md (rete di sicurezza)');
  if(has(q,['stand','assegnatari','assegnatario','gruppo espositore']))return out('Per creare un nuovo stand apri Pass → Assegnatari pass e premi Nuovo stand. Scegli il raggruppamento e compila almeno il nome; puoi poi aggiungere nome stand, zona, codice, limite pass, email e note. Salva, apri la scheda dello stand, aggiungi i nominativi e genera i loro pass. Non usare Nuovo pass singolo.','/participants','Apri Assegnatari pass →','guida-pass.md (rete di sicurezza)');
  if(has(q,['spesa','scontrino','fattura','ricevuta','ricevute']))return out('Per inserire una spesa apri Area personale → Le mie spese e premi Nuova spesa. Inserisci descrizione, importo e data, scegli la categoria e allega eventuali ricevute; poi salva. La spesa potrà essere selezionata in una successiva richiesta di rimborso.','/area-personale/spese','Apri Le mie spese →','guida-area-personale.md (rete di sicurezza)');
  if(has(q,['rimborso','rimborsi']))return out('Inserisci prima le singole voci in Area personale → Le mie spese. Poi apri Richieste rimborso, seleziona le spese non associate, completa i dati e invia la richiesta.','/area-personale/richieste-rimborso','Apri Richieste rimborso →','guida-area-personale.md (rete di sicurezza)');
  if(has(q,['rubrica','contatto','contatti']))return out('Apri Area personale → Rubrica per creare un contatto personale. Con Importa da espositori puoi cercare un espositore in tutte le edizioni e aprire una scheda precompilata da verificare e salvare.','/area-personale/rubrica','Apri Rubrica →','guida-area-personale.md (rete di sicurezza)');
  if(has(q,['edizione','edizioni']))return out('Per gestire le edizioni apri Impostazioni e seleziona la scheda Edizioni. Da qui crei o modifichi un’edizione e imposti quella corrente.','/admin/settings#edizioni','Apri Impostazioni: Edizioni →','guida-ruoli-edizioni.md (rete di sicurezza)');
  return null;
 }

 app.post('/api/assistente/guida',requireAuth,(req,res)=>{
  const original=String(req.body&&req.body.question||'').trim();
  if(original.length<2)return res.json({answer:'Scrivi una domanda un po’ più dettagliata.',suggestions:[]});
  const history=Array.isArray(req.body&&req.body.history)?req.body.history:[];
  const follow=/^(spiegami|spiega|dimmi|fammi vedere|come faccio|dove trovo|e poi|continua|passo per passo|pi[uù] dettagli|approfondisci)/i.test(original);
  const prev=history.slice().reverse().find(m=>m&&m.kind==='user'&&m.text&&m.text!==original);
  const q=((follow&&prev?prev.text+' ':'')+original).toLowerCase();

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
    [req.session.user.id, req.session.user.role, original, req.body.currentPath||null],
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

 // ---- Pagine di consultazione log, solo per admin/organizer -----------
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
};
