"use strict";
const https=require('https');

const API_HOST='api.groq.com';
const API_PATH='/openai/v1/chat/completions';
const TIMEOUT_MS=12000;
const MAX_RESPONSE_BYTES=150000;

function safeErrorMessage(raw){
 try{
  const parsed=JSON.parse(raw||'{}');
  const message=parsed&&parsed.error&&parsed.error.message;
  return message?String(message).replace(/[\r\n]/g,' ').slice(0,300):'nessun dettaglio restituito dal provider';
 }catch(_){return 'risposta non JSON dal provider';}
}

function askGroq(messages){
 const apiKey=String(process.env.GROQ_API_KEY||'').trim();
 const model=String(process.env.GROQ_MODEL||'openai/gpt-oss-20b').trim();

 if(!apiKey){
  console.warn('[Ludi AI][Groq] disattivato: GROQ_API_KEY assente nel runtime del servizio.');
  return Promise.resolve(null);
 }
 if(!model){
  console.warn('[Ludi AI][Groq] disattivato: GROQ_MODEL vuoto.');
  return Promise.resolve(null);
 }

 const body=JSON.stringify({model,messages,temperature:0.2,max_tokens:500});
 console.info(`[Ludi AI][Groq] richiesta inviata — modello: ${model}`);

 return new Promise(resolve=>{
  let settled=false;
  const finish=value=>{if(!settled){settled=true;resolve(value);}};
  const req=https.request({hostname:API_HOST,path:API_PATH,method:'POST',headers:{
   Authorization:`Bearer ${apiKey}`,
   'Content-Type':'application/json',
   'Content-Length':Buffer.byteLength(body)
  },timeout:TIMEOUT_MS},res=>{
   let raw='';
   res.setEncoding('utf8');
   res.on('data',chunk=>{
    raw+=chunk;
    if(raw.length>MAX_RESPONSE_BYTES){
     console.warn('[Ludi AI][Groq] risposta interrotta: supera il limite consentito.');
     req.destroy();
    }
   });
   res.on('end',()=>{
    if(res.statusCode<200||res.statusCode>=300){
     console.warn(`[Ludi AI][Groq] HTTP ${res.statusCode}: ${safeErrorMessage(raw)}`);
     return finish(null);
    }
    try{
     const parsed=JSON.parse(raw);
     const text=parsed&&parsed.choices&&parsed.choices[0]&&parsed.choices[0].message&&parsed.choices[0].message.content;
     if(typeof text==='string'&&text.trim()){
      console.info('[Ludi AI][Groq] risposta ricevuta correttamente.');
      return finish(text.trim());
     }
     console.warn('[Ludi AI][Groq] risposta valida ma senza testo utile.');
     finish(null);
    }catch(_){
     console.warn('[Ludi AI][Groq] risposta HTTP valida ma JSON non leggibile.');
     finish(null);
    }
   });
  });
  req.on('timeout',()=>{
   console.warn(`[Ludi AI][Groq] timeout dopo ${TIMEOUT_MS/1000} secondi.`);
   req.destroy();finish(null);
  });
  req.on('error',err=>{
   console.warn(`[Ludi AI][Groq] errore di rete: ${String(err&&err.message||'sconosciuto').slice(0,300)}`);
   finish(null);
  });
  req.write(body);req.end();
 });
}

module.exports={askGroq};
