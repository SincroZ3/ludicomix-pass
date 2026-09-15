# Ruoli, permessi ed edizioni

## Cos'è un'edizione
Un'**edizione** rappresenta una singola manifestazione (es. "Ludicomix 2026"). Quasi tutti i dati operativi del sistema sono agganciati a un'edizione specifica e vengono filtrati automaticamente su quella impostata come **attiva/corrente**:
- Pass e assegnatari (stand, gruppi, nominativi)
- Agenda, eventi e programma pubblico
- Mappa pubblica
- Volontari e turni
- Richieste di accreditamento e bacheca
- Logistica (richieste servizi, attrezzature)

Quando cambi l'edizione corrente, tutte queste sezioni "ripartono da zero" mostrando solo i dati della nuova edizione: i dati delle edizioni precedenti non vengono cancellati, restano archiviati e consultabili tramite gli strumenti di storico/importazione dedicati (es. importazione volontari da edizioni precedenti, importazione contatti da espositori di edizioni passate).

**Cambia l'edizione corrente solo quando sei pronto a iniziare operativamente una nuova manifestazione**: farlo per errore durante l'evento in corso nasconderebbe temporaneamente pass, stand e turni della manifestazione ancora in svolgimento.

## Cosa NON dipende dall'edizione
- **Note personali, rubrica e checklist** dell'Area Personale sono sempre visibili, indipendentemente dall'edizione corrente: sono legate all'utente, non alla manifestazione.
- **Le spese** restano consultabili anche tra tutte le edizioni diverse tramite un selettore multi-edizione dedicato nella pagina Spese, ma le richieste di rimborso vengono comunque generate nel contesto dell'edizione in cui la spesa è stata inserita.

## Ruoli disponibili e cosa possono fare

| Ruolo | Capacità principali | Limiti |
|---|---|---|
| **Admin** | Accesso totale: utenti, ruoli, impostazioni di sistema, log, gestione edizioni, tutte le sezioni operative | Nessuno |
| **Organizzatore** | Operatività completa: stand/pass, partecipanti, bacheca, logistica, agenda, volontari, accreditamenti | Non accede a impostazioni di sistema riservate (SMTP, gestione utenti, log) |
| **Amministrazione contabile** | Stessi poteri dell'Organizzatore **più** l'accesso alle Richieste rimborso (approvazione/rifiuto) | Non gestisce impostazioni di sistema o utenti |
| **Operatore** | Crea e modifica partecipanti e pass, può usare lo scanner e il contatore ingressi | Non gestisce logistica, accreditamenti, bacheca, impostazioni |
| **Scanner** | Accesso confinato alla sola pagina di scansione QR (ingresso/steward) | Nessun'altra sezione è raggiungibile, nemmeno tramite URL diretto |
| **Visualizzatore** | Sola lettura su tutte le sezioni a cui ha visibilità | Non può creare, modificare o eliminare nulla: ogni pulsante di scrittura è disabilitato o nascosto |
| **Custom** | Vede solo le funzioni singolarmente abilitate dall'admin in fase di creazione/modifica utente | Il set di permessi va configurato manualmente utente per utente |

Nota operativa: sia l'Operatore sia lo Scanner possono materialmente usare la pagina di scansione, ma solo lo Scanner viene "confinato" ad essa: un Operatore che effettua login vede comunque il menu completo delle sue funzioni (pass e partecipanti), mentre uno Scanner viene reindirizzato sempre e solo alla pagina scan, qualunque URL provi a raggiungere.

## Il ruolo Custom e i permessi granulari
Quando crei o modifichi un utente e scegli il ruolo **Custom**, compare un elenco di funzioni selezionabili singolarmente (es. gestione pass, gestione logistica, accesso alla bacheca, ecc.). L'utente custom vedrà in interfaccia solo le voci di menu corrispondenti alle funzioni spuntate. Usa questo ruolo per collaboratori con responsabilità molto specifiche che non rientrano perfettamente in uno dei ruoli standard (es. un volontario che deve solo gestire la bacheca ma non toccare i pass).

## Permessi mancanti: come diagnosticare il problema
Se un utente segnala che "non vede" una funzione o una voce di menu, verifica in quest'ordine:
1. **Ruolo assegnato**: apri Gestione utenti (solo admin) e controlla il ruolo attuale dell'utente.
2. **Se il ruolo è Custom**: controlla quali permessi specifici sono spuntati nella sua scheda.
3. **Se il ruolo è Visualizzatore**: ricorda che è per design a sola lettura, quindi l'assenza di pulsanti di modifica è corretta e non un errore.
4. **Se il ruolo è Scanner**: ricorda che l'accesso è volutamente limitato alla sola pagina scan; non è un bug, è il comportamento previsto.

## Regole rapide (assistente)

Queste regole vengono lette dal Ciuchino con priorità massima: se la domanda dell'utente contiene una delle parole chiave elencate, risponde SEMPRE con il testo qui sotto, indipendentemente dal resto della guida. Per modificare una risposta, cambia il testo della regola corrispondente: non serve toccare codice.

<!-- regola
link: /admin/settings#edizioni
label: Apri Impostazioni: Edizioni →
keywords: come funzionano le edizioni, cambio edizione, cambiare edizione, creo una edizione, creare una edizione, nuova edizione
-->
Per gestire le edizioni apri Impostazioni e seleziona la scheda Edizioni. Da qui puoi creare o modificare un'edizione e impostare quella corrente: i dati operativi del portale (stand, pass, volontari, agenda, logistica, accreditamenti) vengono filtrati sull'edizione corrente. Cambia l'edizione corrente solo quando sei pronto a iniziare operativamente una nuova manifestazione: i dati delle edizioni precedenti restano archiviati e consultabili, ma spariscono dalle viste operative correnti. Solo gli admin hanno questi poteri di gestione.

<!-- regola
link: /admin/users
label: Apri Gestione utenti →
keywords: differenza tra i ruoli, che ruoli esistono, quali ruoli ci sono, quale ruolo scegliere, ruoli disponibili
-->
I ruoli disponibili sono: Admin (accesso totale, incluse impostazioni e utenti), Organizzatore (operatività completa su stand, pass, bacheca, logistica, agenda e volontari), Amministrazione contabile (come Organizzatore più la gestione delle richieste di rimborso), Operatore (crea/modifica pass e partecipanti, può scansionare), Scanner (confinato alla sola pagina di scansione ingresso), Visualizzatore (sola lettura su tutto) e Custom (permessi selezionabili singolarmente). Scegli il ruolo più vicino alla responsabilità reale della persona; usa Custom solo per casi che non rientrano in nessuno degli altri ruoli.

<!-- regola
link: /admin/users
label: Apri Gestione utenti →
keywords: permessi custom, ruolo custom, permessi personalizzati, configurare permessi
-->
Il ruolo Custom permette di abilitare singole funzioni per un utente che non rientra nei ruoli standard. Apri Gestione utenti, crea o modifica l'utente, seleziona Custom come ruolo e spunta solo le funzioni che deve poter usare (es. solo bacheca, solo logistica). L'utente vedrà in interfaccia esclusivamente le voci di menu corrispondenti ai permessi attivati.

<!-- regola
link: /admin/users
label: Apri Gestione utenti →
keywords: non vedo una funzione, funzione non visibile, non ho i permessi, manca una voce di menu, non riesco ad accedere a una sezione
-->
Se una funzione non è visibile, il problema è quasi sempre il ruolo assegnato. Verifica in Gestione utenti (serve un admin) il ruolo dell'utente: se è Visualizzatore, l'assenza di pulsanti di modifica è corretta perché è un ruolo di sola lettura; se è Scanner, l'accesso è volutamente limitato alla sola pagina di scansione; se è Custom, controlla quali permessi specifici sono stati spuntati nella sua scheda e attiva quello mancante.

<!-- regola
link: /scan
label: Apri Scanner →
keywords: ruolo scanner, cos'è lo scanner, utente scanner, permessi scanner
-->
Il ruolo Scanner è pensato per steward e personale d'ingresso: chi ha questo ruolo viene automaticamente confinato alla sola pagina di scansione QR, qualunque altro indirizzo provi a raggiungere. Non ha accesso a pass, partecipanti o altre sezioni gestionali. Se serve anche la possibilità di creare/modificare pass, valuta invece il ruolo Operatore, che può scansionare ma ha anche accesso alla gestione di pass e partecipanti.
