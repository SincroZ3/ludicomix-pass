'use strict';
const fs=require('fs');
const path=require('path');
module.exports=function registerAiAssistant(app,{requireAuth}){
 const K=path.join(__dirname,'..','knowledge');
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
 function operation(q){
  if(has(q,['genera un pass','generare un pass','crea un pass','creare un pass']))return out('Per generare un pass usa sempre Pass → Assegnatari pass. Apri lo stand interessato, aggiungi o apri il nominativo e genera il pass dalla sua scheda. Non usare Nuovo pass singolo e non usare Pass generati: sono funzioni di backup, non il flusso operativo ordinario.','/participants','Apri Assegnatari pass →','guida-pass.md');
  if(has(q,['ristampa','ristampare','invalida','invalidare','scarica pass','stampare pass','consegna pass','riconsegna']))return out('Per ristampare, invalidare, scaricare, consegnare o riconsegnare un pass, apri Pass → Assegnatari pass, entra nello stand e individua il nominativo. Esegui l’operazione dalla sua scheda. Pass generati è solo una sezione di backup tecnico e non va usata né insegnata come procedura ordinaria.','/participants','Apri Assegnatari pass →','guida-pass.md');
  if(has(q,['stand','assegnatari','assegnatario','gruppo espositore']))return out('Per creare un nuovo stand apri Pass → Assegnatari pass e premi Nuovo stand. Scegli il raggruppamento e compila almeno il nome; puoi poi aggiungere nome stand, zona, codice, limite pass, email e note. Salva, apri la scheda dello stand, aggiungi i nominativi e genera i loro pass. Non usare Nuovo pass singolo.','/participants','Apri Assegnatari pass →','guida-pass.md');
  if(has(q,['spesa','scontrino','fattura','ricevuta','ricevute']))return out('Per inserire una spesa apri Area personale → Le mie spese e premi Nuova spesa. Inserisci descrizione, importo e data, scegli la categoria e allega eventuali ricevute; poi salva. La spesa potrà essere selezionata in una successiva richiesta di rimborso.','/area-personale/spese','Apri Le mie spese →','guida-area-personale.md');
  if(has(q,['rimborso','rimborsi']))return out('Inserisci prima le singole voci in Area personale → Le mie spese. Poi apri Richieste rimborso, seleziona le spese non associate, completa i dati e invia la richiesta.','/area-personale/richieste-rimborso','Apri Richieste rimborso →','guida-area-personale.md');
  if(has(q,['rubrica','contatto','contatti']))return out('Apri Area personale → Rubrica per creare un contatto personale. Con Importa da espositori puoi cercare un espositore in tutte le edizioni e aprire una scheda precompilata da verificare e salvare.','/area-personale/rubrica','Apri Rubrica →','guida-area-personale.md');
  if(has(q,['edizione','edizioni']))return out('Per gestire le edizioni apri Impostazioni e seleziona la scheda Edizioni. Da qui crei o modifichi un’edizione e imposti quella corrente.','/admin/settings?tab=edizioni','Apri Impostazioni: Edizioni →','guida-ruoli-edizioni.md');
  return null;
 }
 app.post('/api/assistente/guida',requireAuth,(req,res)=>{
  const original=String(req.body&&req.body.question||'').trim();if(original.length<2)return res.json({answer:'Scrivi una domanda un po’ più dettagliata.',suggestions:[]});
  const history=Array.isArray(req.body&&req.body.history)?req.body.history:[];
  const follow=/^(spiegami|spiega|dimmi|fammi vedere|come faccio|dove trovo|e poi|continua|passo per passo|pi[uù] dettagli|approfondisci)/i.test(original);
  const prev=history.slice().reverse().find(m=>m&&m.kind==='user'&&m.text&&m.text!==original);
  const q=((follow&&prev?prev.text+' ':'')+original).toLowerCase();
  const fixed=operation(q);if(fixed)return res.json(fixed);
  const tokens=q.match(/[a-zàèéìòù]{3,}/g)||[];let best={score:0,text:'',file:''};
  guides.filter(g=>req.session.user.role!=='custom'||g.roles.includes('custom')).forEach(g=>{let raw='';try{raw=fs.readFileSync(path.join(K,g.file),'utf8');}catch(_){return;}raw.split(/\n\n+/).filter(Boolean).forEach(chunk=>{const text=chunk.replace(/^#.*$/gm,'').replace(/\*\*/g,'').trim(),lc=text.toLowerCase();const score=g.keys.reduce((n,k)=>n+(q.includes(k)?4:0),0)+tokens.reduce((n,t)=>n+(lc.includes(t)?1:0),0);if(score>best.score)best={score,text,file:g.file};});});
  if(!best.score)return res.json({answer:'Non ho ancora una guida affidabile per questa domanda. Prova a citare una sezione: assegnatari pass, agenda, volontari, logistica, spese, rimborsi, rubrica, ruoli o edizioni.',suggestions:['Come creo uno stand?','Come inserisco una spesa?','Come gestisco i volontari?']});
  const links={'guida-pass.md':'/participants','guida-agenda.md':'/agenda','guida-volontari.md':'/volunteers','guida-area-personale.md':'/area-personale','guida-logistica.md':'/admin/logistica','guida-ruoli-edizioni.md':'/admin/settings?tab=edizioni'};
  res.json(out(best.text,links[best.file]||'/home','Apri sezione correlata →',best.file));
 });
};
