'use strict';
const fs=require('fs');
const path=require('path');

module.exports=function registerAiAssistant(app,{requireAuth}){
 const K=path.join(__dirname,'..','knowledge');
 const DATADIR=process.env.DATADIR||path.join(__dirname,'..');
 const FEEDBACK_LOG=path.join(DATADIR,'assistente-feedback.jsonl');
 const UNRESOLVED_LOG=path.join(DATADIR,'assistente-domande-irrisolte.jsonl');

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

 function appendLog(file,entry){
  try{
   fs.mkdirSync(path.dirname(file),{recursive:true});
   fs.appendFileSync(file,JSON.stringify(entry)+'\n','utf8');
  }catch(e){console.error('assistente log',e.message);}
 }

 // ---- Regole editabili nei file Markdown -----------------------------
 // Convenzione: un blocco regola inizia con un commento HTML come questo:
 // <!-- regola
 // link: /participants
 // label: Apri Assegnatari pass →
 // keywords: stand, assegnatari, assegnatario, gruppo espositore
 // -->
 // seguito dal testo della risposta (fino alla regola successiva, a un
 // titolo ## o alla fine del file). Si può modificare senza toccare JS.
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

 // ---- Rete di sicurezza per le domande più critiche -------------------
 // Resta attiva SOLO se nessuna regola Markdown corrispondente è stata
 // ancora aggiunta ai file in knowledge/. Appena una regola equivalente
 // esiste in Markdown, questa rete di sicurezza viene ignorata perché il
 // matching Markdown ha priorità.
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

  // 1) Regole Markdown esplicite (priorità massima, editabili senza JS)
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

  // 2) Rete di sicurezza per le operazioni più delicate
  const fixed=safetyNet(q);
  if(fixed)return res.json(fixed);

  // 3) Ricerca generica nei paragrafi delle guide
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
   appendLog(UNRESOLVED_LOG,{ts:new Date().toISOString(),userId:req.session.user.id,role:req.session.user.role,path:req.body.currentPath||null,question:original});
   return res.json({answer:'Non ho ancora una guida affidabile per questa domanda. Prova a citare una sezione: assegnatari pass, agenda, volontari, logistica, spese, rimborsi, rubrica, ruoli o edizioni.',suggestions:['Come creo uno stand?','Come inserisco una spesa?','Come gestisco i volontari?']});
  }
  const links={'guida-pass.md':'/participants','guida-agenda.md':'/agenda','guida-volontari.md':'/volunteers','guida-area-personale.md':'/area-personale','guida-logistica.md':'/admin/logistica','guida-ruoli-edizioni.md':'/admin/settings#edizioni'};
  res.json(out(best.text,links[best.file]||'/home','Apri sezione correlata →',best.file));
 });

 app.post('/api/assistente/feedback',requireAuth,(req,res)=>{
  const {question,source,link,useful}=req.body||{};
  if(typeof useful!=='boolean')return res.status(400).json({error:'Campo useful mancante'});
  appendLog(FEEDBACK_LOG,{ts:new Date().toISOString(),userId:req.session.user.id,role:req.session.user.role,question:question||null,source:source||null,link:link||null,useful});
  res.json({ok:true});
 });
};
