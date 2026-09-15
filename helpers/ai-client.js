"use strict";
const https=require('https');

const API_HOST='api.groq.com';
const API_PATH='/openai/v1/chat/completions';
const TIMEOUT_MS=12000;

function askGroq(messages){
 const apiKey=String(process.env.GROQ_API_KEY||'').trim();
 if(!apiKey)return Promise.resolve(null);
 const body=JSON.stringify({
  model:process.env.GROQ_MODEL||'llama-3.3-70b-versatile',
  messages,
  temperature:0.2,
  max_tokens:500
 });
 return new Promise(resolve=>{
  const req=https.request({hostname:API_HOST,path:API_PATH,method:'POST',headers:{
   Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)
  },timeout:TIMEOUT_MS},res=>{
   let raw='';
   res.setEncoding('utf8');
   res.on('data',chunk=>{raw+=chunk;if(raw.length>150000)req.destroy();});
   res.on('end',()=>{
    if(res.statusCode<200||res.statusCode>=300)return resolve(null);
    try{
     const parsed=JSON.parse(raw);
     const text=parsed&&parsed.choices&&parsed.choices[0]&&parsed.choices[0].message&&parsed.choices[0].message.content;
     resolve(typeof text==='string'&&text.trim()?text.trim():null);
    }catch(_){resolve(null);}
   });
  });
  req.on('timeout',()=>req.destroy());
  req.on('error',()=>resolve(null));
  req.write(body);req.end();
 });
}
module.exports={askGroq};
