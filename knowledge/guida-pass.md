# Pass e assegnatari

## La sezione principale: Assegnatari Pass
**Assegnatari Pass** (`/participants`) è la sezione da usare per **ogni** operazione ordinaria su stand, nominativi e pass. La gerarchia dei dati è:

**Categoria (raggruppamento)** → **Stand/Gruppo** → **Nominativo/Partecipante** → **Pass**

Nel portale, i termini **nominativo**, **partecipante** e **assegnatario** indicano la stessa persona registrata sotto uno stand; questa guida usa soprattutto “nominativo” per semplicità.

Ogni stand appartiene a una categoria, può avere una zona assegnata, un codice stand identificativo, un limite massimo di pass emettibili, un'email di riferimento, note libere e materiali logistici collegati (visibili anche dalla scheda del gruppo).

## Creare uno stand o gruppo
1. Apri **Assegnatari Pass**.
2. Seleziona la **categoria** appropriata (o creane una se manca).
3. Premi **Crea nuovo stand**.
4. Compila almeno il **riferimento/nome dello stand**; poi, se disponibili, aggiungi **zona**, **codice stand**, **email**, **limite massimo pass** e **note**.
5. Salva.

Il nuovo gruppo viene automaticamente associato all'**edizione corrente**: se lo stand serve per una manifestazione diversa, controlla prima di crearlo che l'edizione corretta sia impostata come corrente.

## Aggiungere un nominativo a uno stand
1. Apri Assegnatari Pass e individua il gruppo/stand di interesse.
2. Apri i **dettagli** dello stand.
3. Aggiungi il partecipante: **nome e cognome sono obbligatori**, gli altri campi (email, ruolo, note) sono facoltativi ma consigliati per la tracciabilità.
4. Il nominativo creato appartiene alla stessa edizione corrente dello stand che lo ospita.

### Importazione multipla di nominativi
Se devi inserire molti nominativi contemporaneamente per uno stesso stand, usa la funzione di **importazione in blocco** (bulk import): incolla l'elenco dei nomi in un'unica textarea, seleziona lo stand/gruppo di destinazione e conferma. Se il numero di nominativi supera il limite massimo pass impostato per lo stand, il sistema segnala il superamento: puoi comunque forzare l'inserimento (tipicamente richiede una password amministrativa) oppure alzare preventivamente il limite massimo pass dello stand prima di importare.

## Generare un pass per un nominativo
**Il flusso operativo corretto è sempre lo stesso**: apri lo stand da Assegnatari Pass, apri (o aggiungi) il nominativo, e genera il pass direttamente dalla sua scheda scegliendo la **tipologia di pass** appropriata (es. Espositore, Staff, Stampa — le tipologie sono configurabili in amministrazione).

**Non usare** "Nuovo pass singolo" né "Pass generati" come procedura ordinaria: sono strumenti di **backup tecnico**, pensati per casi eccezionali (es. correzioni manuali, recupero dati), non il percorso standard da seguire o da insegnare a un nuovo utente.

### Duplicati
Se provi a generare un pass per un nominativo che ne ha già uno attivo, il sistema segnala il potenziale **duplicato**. Puoi confermare comunque la creazione (opzione di "forza duplicato") solo se sei certo che serva davvero un secondo pass per la stessa persona (es. sostituzione di un pass danneggiato, ruolo aggiuntivo).

## Ristampare, scaricare, consegnare o invalidare un pass
Tutte queste azioni si eseguono **dalla scheda del nominativo**, raggiungibile da Assegnatari Pass → stand → nominativo, oppure tramite la **ricerca unificata** (icona lente/tab di ricerca, richiamabile anche da tastiera) cercando direttamente il nome della persona.

- **Scaricare/Stampare**: genera o riscarica il PDF del pass già emesso.
- **Consegnare**: segna il pass come fisicamente consegnato al titolare (utile per il controllo logistico all'ingresso).
- **Ristampare**: rigenera il PDF (es. in caso di smarrimento) senza invalidare il pass originale, a meno che tu non lo invalidi esplicitamente.
- **Invalidare**: disattiva definitivamente un pass compromesso o errato. **Un pass invalidato non deve mai essere consegnato**: se qualcuno si presenta con un pass invalidato, va considerato non valido ai fini dell'accesso, anche se la stampa appare regolare.

Anche in questo caso, evita di usare "Pass generati" come punto di accesso abituale a queste azioni: è solo una vista tecnica di backup, non la procedura da seguire o insegnare.

## Stampa collettiva (batch)
Per stampare in un'unica operazione i pass di **tutti i nominativi di uno stesso stand**, usa la funzione di stampa collettiva/batch disponibile dalla scheda del gruppo: genera un unico PDF con tutti i pass del gruppo, utile per consegne massive prima dell'evento. È disponibile anche una modalità che permette di selezionare manualmente un sottoinsieme di pass da più stand per una stampa combinata.

## Storico di un pass
Ogni pass mantiene uno **storico eventi** (creazione, ristampe, consegne, eventuali invalidazioni) consultabile dalla sua scheda dettaglio. Usalo per ricostruire cosa è successo a un pass in caso di contestazioni o dubbi (es. "il pass risulta già consegnato ma la persona dice di non averlo ricevuto").

## Ricerca pass
Usa **Ricerca Pass** oppure la **lente di ricerca fluttuante** presente nell'interfaccia per trovare rapidamente un nominativo o un pass per nome, stand o codice. I risultati sono sempre limitati all'**edizione corrente**: se non trovi qualcosa che dovrebbe esserci, verifica di essere nell'edizione corretta.

## Errori comuni
- **"Ho creato lo stand ma non lo trovo"** → probabilmente è stato creato in un'altra edizione o categoria: controlla il filtro edizione corrente.
- **"Il pass duplicato non si crea"** → serve confermare esplicitamente l'opzione di forzatura duplicato, altrimenti il sistema blocca la creazione per sicurezza.
- **"Ho superato il limite massimo pass dello stand"** → alza il limite dalla scheda dello stand oppure forza l'inserimento con password admin durante l'importazione in blocco.

## Regole rapide (assistente)

Queste regole vengono lette dal Ciuchino con priorità massima: se la domanda dell'utente contiene una delle parole chiave elencate, risponde SEMPRE con il testo qui sotto, indipendentemente dal resto della guida. Per modificare una risposta, cambia il testo della regola corrispondente: non serve toccare codice.

<!-- regola
link: /participants
label: Apri Assegnatari pass →
keywords: creo uno stand, creo un nuovo stand, creare uno stand, nuovo stand, aggiungo uno stand
-->
Per creare un nuovo stand apri Assegnatari pass e premi Nuovo stand. Scegli il raggruppamento/categoria e compila almeno il nome; puoi poi aggiungere zona, codice stand, limite pass, email e note. Salva, apri la scheda dello stand, aggiungi i nominativi e genera i loro pass. Ricorda che lo stand viene sempre associato all'edizione corrente.

<!-- regola
link: /participants
label: Apri Assegnatari pass →
keywords: genero un pass, generare un pass, genero pass, creo un pass, creare un pass
-->
Per generare un pass usa sempre Assegnatari pass. Apri lo stand interessato, aggiungi o apri il nominativo (nome e cognome sono obbligatori) e genera il pass dalla sua scheda scegliendo la tipologia. Non usare Nuovo pass singolo e non usare Pass generati: sono funzioni di backup tecnico, non il flusso operativo ordinario. Se il sistema segnala un possibile duplicato, conferma solo se sei certo che serva davvero un secondo pass per la stessa persona.

<!-- regola
link: /participants
label: Apri Assegnatari pass →
keywords: ristampo un pass, ristampare un pass, invalido un pass, invalidare un pass, scarico un pass, stampo un pass, consegno un pass, riconsegno un pass
-->
Per ristampare, invalidare, scaricare, consegnare o riconsegnare un pass, apri Assegnatari pass, entra nello stand e individua il nominativo. Esegui l'operazione dalla sua scheda. In alternativa puoi cercare il nominativo dalla ricerca unificata nel tab dedicato o richiamandola da tastiera. Un pass invalidato non va mai consegnato, anche se la stampa sembra ancora regolare. Non usare Pass generati: è solo una sezione di backup tecnico e non va usata né insegnata come procedura ordinaria.

<!-- regola
link: /participants
label: Apri Assegnatari pass →
keywords: assegnatari pass, gruppo espositore, gestisco gli assegnatari
-->
Gli Assegnatari pass sono la sezione principale per gestire stand, nominativi e pass. Ogni stand è collegato a un raggruppamento (categoria) e può avere un limite massimo di pass, una zona, un codice stand e materiali associati. Da qui generi, ristampi, invalidi e gestisci i pass dei singoli nominativi.

<!-- regola
link: /participants
label: Apri Assegnatari pass →
keywords: importo nominativi, importazione in blocco, bulk import, inserisco tanti nomi insieme, elenco nominativi
-->
Per inserire molti nominativi insieme su uno stesso stand usa l'importazione in blocco: apri lo stand da Assegnatari pass, incolla l'elenco dei nomi nella textarea dedicata e conferma. Se superi il limite massimo pass dello stand, il sistema segnala il superamento: puoi forzare l'inserimento con password amministrativa oppure alzare prima il limite massimo pass dalla scheda dello stand.

<!-- regola
link: /participants
label: Apri Assegnatari pass →
keywords: stampa collettiva, batch pdf, stampo tutti i pass, pdf di gruppo, stampa multipla
-->
Per stampare in un'unica operazione tutti i pass di uno stand usa la funzione di stampa collettiva/batch disponibile dalla scheda del gruppo: genera un unico PDF con tutti i pass emessi per quello stand. È disponibile anche una modalità di selezione manuale per combinare pass provenienti da stand diversi in un'unica stampa.

<!-- regola
link: /participants
label: Apri Assegnatari pass →
keywords: storico di un pass, cronologia pass, chi ha ritirato il pass, quando è stato consegnato il pass
-->
Ogni pass ha uno storico eventi (creazione, ristampe, consegne, invalidazioni) consultabile dalla sua scheda dettaglio in Assegnatari pass. Usalo per verificare cosa è successo a un pass specifico, ad esempio in caso di contestazioni sulla consegna.

<!-- regola
link: /participants
label: Apri Assegnatari pass →
keywords: limite massimo pass superato, ho superato il limite, non riesco ad aggiungere altri pass allo stand
-->
Se hai raggiunto il limite massimo di pass previsto per uno stand, apri la scheda dello stand in Assegnatari pass e aumenta il valore del limite massimo pass, oppure, in fase di importazione in blocco, usa l'opzione per forzare il superamento con password amministrativa.
