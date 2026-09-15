"use strict";
const fs=require('fs');
const path=require('path');

function normalise(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();}
function tokens(s){return normalise(s).split(' ').filter(w=>w.length>=3);}
function editDistance(a,b){
 if(Math.abs(a.length-b.length)>1)return 2;
 let prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const cur=[i];for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;
 }
 return prev[b.length];
}
function stripRules(raw){return raw.replace(/<!--\s*regola[\s\S]*?-->([\s\S]*?)(?=\n<!--\s*regola|\n##|\s*$)/gi,'');}
function chunk(raw){
 const clean=stripRules(raw);const parts=clean.split(/(?=^##\s+)/m);return parts.map(x=>x.trim()).filter(Boolean);
}
function score(question, text){
 const q=tokens(question), t=tokens(text);let n=0;
 q.forEach(a=>t.forEach(b=>{if(a===b)n+=8;else if(a.length>=5&&b.length>=5&&(a.startsWith(b)||b.startsWith(a)||editDistance(a,b)<=1))n+=3;}));
 return n;
}
function retrieve({knowledgeDir,guides,question,maxChunks=4,maxChars=7000}){
 const hits=[];
 guides.forEach(g=>{
  let raw='';try{raw=fs.readFileSync(path.join(knowledgeDir,g.file),'utf8');}catch(_){return;}
  chunk(raw).forEach(text=>{const n=score(question,text);if(n>0)hits.push({file:g.file,text,score:n});});
 });
 hits.sort((a,b)=>b.score-a.score);const selected=[];let chars=0;
 for(const hit of hits){if(selected.some(x=>x.file===hit.file&&x.text===hit.text))continue;if(chars+hit.text.length>maxChars)continue;selected.push(hit);chars+=hit.text.length;if(selected.length>=maxChunks)break;}
 return selected;
}
module.exports={retrieve};
