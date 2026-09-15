"use strict";
const fs=require('fs');
const path=require('path');

// Vocabolario di dominio: impedisce che parole generiche come "creare" o
// "nuovo" prevalgano su concetti operativi forti come stand/espositore.
const DOMAIN_FILES=[
 {file:'guida-pass.md',terms:['pass','badge','stand','espositore','fumetteria','assegnatario','nominativo','partecipante','ristampa','invalidato']},
 {file:'guida-agenda.md',terms:['agenda','evento','relatore','speaker','ospite','palinsesto','programma','sala','conflitto']},
 {file:'guida-volontari.md',terms:['volontario','volontari','turno','turni','candidatura','candidature']},
 {file:'guida-logistica.md',terms:['logistica','attrezzatura','prestito','restituzione','bacheca','accreditamento','materiale']},
 {file:'guida-area-personale.md',terms:['rimborso','rimborsi','spesa','spese','scontrino','fattura','rubrica','firma','iban','nota','checklist']},
 {file:'guida-ruoli-edizioni.md',terms:['ruolo','ruoli','permesso','permessi','edizione','edizioni','scanner','visualizzatore','custom']},
 {file:'guida-mappe.md',terms:['mappa','mappe','planimetria','zona','zone','posizione']}
];

function normalise(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();}
function tokens(s){return normalise(s).split(' ').filter(w=>w.length>=3);}
function editDistance(a,b){
 if(Math.abs(a.length-b.length)>1)return 2;
 let prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const cur=[i];
  for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
  prev=cur;
 }
 return prev[b.length];
}
function isNear(a,b){
 if(a===b)return true;
 if(a.length>=5&&b.length>=5&&(a.startsWith(b)||b.startsWith(a)||editDistance(a,b)<=1))return true;
 // Refusi con trasposizione di due lettere adiacenti: espositroe → espositore.
 if(a.length===b.length&&a.length>=5){
  const diffs=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i])diffs.push(i);
  return diffs.length===2&&diffs[1]===diffs[0]+1&&a[diffs[0]]===b[diffs[1]]&&a[diffs[1]]===b[diffs[0]];
 }
 return false;
}
function stripRules(raw){return raw.replace(/<!--\s*regola[\s\S]*?-->([\s\S]*?)(?=\n<!--\s*regola|\n##|\s*$)/gi,'');}
function chunk(raw){return stripRules(raw).split(/(?=^##\s+)/m).map(x=>x.trim()).filter(Boolean);}
function detectDomain(question){
 const q=tokens(question);
 let best=null;
 DOMAIN_FILES.forEach(domain=>{
  let n=0;
  q.forEach(word=>domain.terms.forEach(term=>{if(isNear(word,normalise(term)))n++;}));
  if(n&&(!best||n>best.n))best={file:domain.file,n};
 });
 return best;
}
function score(question,text,file,domain){
 const q=tokens(question),t=tokens(text);let n=0;
 q.forEach(a=>t.forEach(b=>{if(a===b)n+=8;else if(isNear(a,b))n+=3;}));
 if(domain&&file===domain.file)n+=100*domain.n;
 return n;
}
function retrieve({knowledgeDir,guides,question,maxChunks=4,maxChars=7000}){
 const domain=detectDomain(question),hits=[];
 guides.forEach(g=>{
  let raw='';try{raw=fs.readFileSync(path.join(knowledgeDir,g.file),'utf8');}catch(_){return;}
  chunk(raw).forEach(text=>{const n=score(question,text,g.file,domain);if(n>0)hits.push({file:g.file,text,score:n});});
 });
 hits.sort((a,b)=>b.score-a.score);
 // Se il dominio è evidente e la sua guida ha contenuto rilevante, la fonte
 // primaria resta quella guida: evita suggerimenti operativi contraddittori.
 const pool=domain&&hits.some(h=>h.file===domain.file)?hits.filter(h=>h.file===domain.file):hits;
 const selected=[];let chars=0;
 for(const hit of pool){
  if(chars+hit.text.length>maxChars)continue;
  selected.push(hit);chars+=hit.text.length;
  if(selected.length>=maxChunks)break;
 }
 return selected;
}
module.exports={retrieve};
