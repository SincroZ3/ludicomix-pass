"use strict";
function redact(s){return String(s||'')
 .replace(/\bIT\d{2}[A-Z0-9]{10,30}\b/gi,'[IBAN RIMOSSO]')
 .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi,'[CODICE SENSIBILE RIMOSSO]')
 .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[EMAIL RIMOSSA]')
 .replace(/\b[A-Z0-9]{18,}\b/gi,'[CODICE RIMOSSO]')
 .slice(0,1200);
}
function buildMessages({question,role,currentPath,history,contexts}){
 const sourceText=contexts.map((c,i)=>`[Fonte ${i+1}: ${c.file}]\n${c.text}`).join('\n\n');
 const recent=(Array.isArray(history)?history:[]).filter(m=>m&&m.kind==='user'&&m.text).slice(-2).map(m=>'- '+redact(m.text)).join('\n');
 const system=`Sei Ludi AI, l'assistente interno del portale Ludicomix Pass. Rispondi in italiano, con tono operativo, cordiale e conciso. Usa ESCLUSIVAMENTE le fonti interne fornite. Se le fonti non bastano, dillo chiaramente: non inventare pulsanti, percorsi, permessi, dati o funzioni. Non eseguire azioni e non chiedere password, token, codici QR, IBAN, ricevute o documenti. Rispetta il ruolo dell'utente (${role||'sconosciuto'}): non suggerire o linkare funzioni non disponibili. Se utile, dai passaggi numerati e chiudi con una domanda breve di follow-up.`;
 const user=`Pagina corrente: ${redact(currentPath||'non indicata')}\nRuolo: ${redact(role||'non indicato')}\nDomanda: ${redact(question)}${recent?'\nContesto recente:\n'+recent:''}\n\nFonti interne:\n${sourceText}`;
 return [{role:'system',content:system},{role:'user',content:user}];
}
module.exports={redact,buildMessages};
