/** routes/ai-assistant.js — Fase 2: guida interna basata su knowledge/*.md */
'use strict';
const fs=require('fs');
const path=require('path');

module.exports=function registerAiAssistant(app,{requireAuth}){
  const KNOWLEDGE_DIR=path.join(__dirname,'..','knowledge');
  const guides=[
    {file:'guida-pass.md',keys:['pass','badge','nominativo','partecipante','stand','assegnatario','ristampa','invalid'],roles:['admin','organizer','accountant','operator','custom']},
    {file:'guida-agenda.md',keys:['agenda','evento','programma','sala','relatore','mappa pubblica','conflitto'],roles:['admin','organizer','accountant','operator','custom']},
    {file:'guida-volontari.md',keys:['volont','turno','turni','candidatur','calendario'],roles:['admin','organizer','accountant','operator','custom']},
    {file:'guida-area-personale.md',keys:['nota','rubrica','contatt','spesa','rimborso','scontrino','fattura','firma','iban','checklist'],roles:['admin','organizer','accountant','operator','custom']},
    {file:'guida-logistica.md',keys:['logistica','servizio','attrezz','prestito','accredit','bacheca','material'],roles:['admin','organizer','accountant','custom']},
    {file:'guida-ruoli-edizioni.md',keys:['edizion','ruolo','permess','custom','admin','scanner','visualizz'],roles:['admin','organizer','accountant','operator','scanner','viewer','custom']},
  ];
  function stripMd(text){return text.replace(/^#.*$/gm,'').replace(/\*\*/g,'').trim();}
  function canRead(user,g){return user.role!=='custom'||g.roles.includes('custom');}
  function chunks(text){return text.split(/\n\n+/).filter(Boolean).map(stripMd).filter(Boolean);}

  app.post('/api/assistente/guida',requireAuth,(req,res)=>{
    const q=String(req.body&&req.body.question||'').trim().toLowerCase();
    if(q.length<2)return res.json({answer:'Scrivi una domanda un po\' più dettagliata.',suggestions:[]});
    const tokens=q.match(/[a-zàèéìòù]{3,}/g)||[];
    let best={score:0,text:'',title:'',file:''};
    guides.filter(g=>canRead(req.session.user,g)).forEach(g=>{
      let raw='';try{raw=fs.readFileSync(path.join(KNOWLEDGE_DIR,g.file),'utf8');}catch(_){return;}
      chunks(raw).forEach(c=>{
        const lc=c.toLowerCase();
        let score=g.keys.reduce((n,k)=>n+(q.includes(k)?4:0),0)+tokens.reduce((n,t)=>n+(lc.includes(t)?1:0),0);
        if(score>best.score){best={score,text:c,title:g.file.replace('guida-','').replace('.md','').replace(/-/g,' '),file:g.file};}
      });
    });
    if(!best.score)return res.json({answer:'Non ho ancora una guida affidabile per questa domanda. Prova a citare una sezione: pass, agenda, volontari, logistica, rimborsi, rubrica, ruoli o edizioni.',suggestions:['Come creo un pass?','Come invio un rimborso?','Come gestisco i volontari?']});
    const linkMap={
      'pass':'/passes','agenda':'/agenda','volontari':'/volunteers','area personale':'/area-personale','logistica':'/admin/logistica','ruoli edizioni':'/admin/settings?tab=edizioni'
    };
    const href=linkMap[best.title]||'/home';
    res.json({answer:best.text,source:best.file,link:{href,label:'Apri sezione correlata →'},suggestions:['Spiegami passo per passo','Dove trovo questa funzione?','Ho un problema con questa operazione']});
  });
};
