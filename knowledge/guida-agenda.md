# Agenda, eventi e programma pubblico

## Creare un evento
Apri **Agenda → Gestione Eventi → Nuovo evento**. Il modulo richiede:
- **Titolo** dell'evento (obbligatorio, comparirà nel programma pubblico).
- **Sala/Location**: puoi scegliere una location interna (sala fisica della struttura), oppure impostare `location_type` su "espositore" o "associazione" — in questo caso compila anche il campo di testo libero della location, che indica lo spazio o lo stand ospitante.
- **Data** e **orario di inizio/fine**: definiscono la fascia oraria dell'evento nel calendario del palinsesto.
- **Descrizione**: testo libero mostrato nella scheda pubblica dell'evento.
- **Relatori/Ospiti**: seleziona uno o più ospiti già censiti in Agenda → Ospiti, assegnando a ciascuno un ruolo specifico nell'evento: `speaker`, `moderatore`, `ospite`, `autore` o `giurato`. Un ospite può comparire in più eventi con ruoli diversi.
- **Ingresso libero / area a pagamento**: due flag indipendenti (`free_entry`, `ticketed_area`) che determinano se l'evento richiede un biglietto o accesso a un'area riservata; usali insieme se l'evento è gratuito ma richiede comunque accesso a un'area con pass.
- **Visibilità pubblica**: un evento creato non pubblicato resta visibile solo in amministrazione. Attiva la spunta "pubblico"/"pubblicato" solo dopo aver controllato tutti i dati, perché la pubblicazione lo rende immediatamente visibile nel programma pubblico.

Prima di salvare definitivamente, rileggi sempre sala, data e orario: sono i tre campi più soggetti a errore e generano i conflitti descritti più sotto.

## Modificare o duplicare un evento
Dalla lista di Gestione Eventi puoi aprire un evento esistente per modificarne qualsiasi campo (titolo, orario, relatori, visibilità). Se devi creare più eventi molto simili (stesso format ricorrente in giorni diversi), è più veloce aprire l'evento originale, cambiarne data/orario e salvarlo come nuovo piuttosto che ricompilare tutto da zero.

## Programma pubblico
Il **programma pubblico** (`/agenda` lato pubblico) mostra soltanto gli eventi che soddisfano contemporaneamente due condizioni: appartengono all'**edizione corrente** e hanno la visibilità impostata su pubblico/pubblicato. Se un evento non appare nel programma pubblico, controlla in ordine:
1. Che sia stato effettivamente pubblicato (non basta averlo salvato).
2. Che sia associato all'edizione corrente e non a un'edizione passata.
3. Che data e orario non lo facciano risultare già concluso rispetto alla vista corrente del programma.

## Conflitti di sala e orario
Il sistema segnala un **conflitto** quando due eventi condividono la stessa sala/location con fasce orarie sovrapposte anche parzialmente (non serve che coincidano esattamente). In caso di conflitto:
- Verifica prima l'orario: spesso basta anticipare o posticipare di pochi minuti uno dei due eventi.
- In alternativa, cambia sala per uno dei due eventi.
- Se l'evento è ospitato presso uno stand/espositore, il conflitto si applica comunque se un altro evento nella stessa location e medesima fascia oraria è già registrato: non è un controllo esclusivo delle sale "interne".

## Ospiti del festival
Gli **Ospiti** (Agenda → Ospiti) sono profili pubblici indipendenti dagli eventi: nome, foto, biografia. Un ospite va creato una sola volta e poi collegato a uno o più eventi tramite il ruolo (speaker, moderatore, ospite, autore, giurato) al momento della creazione/modifica dell'evento. Se un ospite non compare nella lista selezionabile in un evento, verifica di averlo creato nell'edizione corretta.

## Mappa pubblica dell'evento
La **mappa pubblica** si gestisce da **Agenda → Mappa pubblica** ed è pensata per il pubblico esterno: mostra punti d'interesse categorizzati (es. trasporti pubblici, shop Ludicomix, palchi e incontri, ecc.) posizionati su una mappa interattiva. Le zone/punti di questa mappa appartengono sempre all'edizione corrente.

Non confondere questa mappa con la **Mappa Stand** (legata agli assegnatari pass, vedi la guida "Pass e assegnatari"): quella è una mappa interna che localizza gli stand fisici collegati ai gruppi di partecipanti, mentre la Mappa pubblica dell'Agenda è rivolta ai visitatori e mostra servizi/punti generali dell'evento.

## Errori comuni
- Evento non visibile → manca la pubblicazione o l'edizione è sbagliata (vedi sopra).
- Conflitto segnalato ma sembra infondato → controlla se location testuale (stand/associazione) coincide per errore con un altro evento.
- Relatore non trovato in lista → l'ospite non è stato creato o appartiene a un'altra edizione.

## Regole rapide (assistente)

Queste regole vengono lette dal Ciuchino con priorità massima: se la domanda dell'utente contiene una delle parole chiave elencate, risponde SEMPRE con il testo qui sotto, indipendentemente dal resto della guida. Per modificare una risposta, cambia il testo della regola corrispondente: non serve toccare codice.

<!-- regola
link: /agenda
label: Apri Gestione Eventi →
keywords: creo un evento, creare un evento, nuovo evento, aggiungo un evento, inserisco un evento
-->
Per creare un evento apri Agenda → Gestione Eventi → Nuovo evento. Compila titolo, sala o location (interna, stand espositore o associazione), data, orario di inizio e fine, descrizione ed eventuali relatori/ospiti con il loro ruolo (speaker, moderatore, ospite, autore, giurato). Imposta anche ingresso libero e/o area a pagamento se pertinenti. Salva e controlla i dati prima di attivare la visibilità pubblica: solo a quel punto l'evento comparirà nel programma pubblico dell'edizione corrente.

<!-- regola
link: /agenda
label: Apri Gestione Eventi →
keywords: pubblico un evento, pubblicare un evento, rendere pubblico un evento, l'evento non appare, evento non visibile, evento non compare nel programma
-->
Se un evento non compare nel programma pubblico, controlla tre cose: 1) che sia stato pubblicato (il salvataggio da solo non basta, serve attivare l'opzione pubblico); 2) che sia associato all'edizione corrente e non a un'edizione passata; 3) che data e orario siano coerenti con la vista del programma che stai consultando. Apri Agenda → Gestione Eventi e correggi i campi mancanti.

<!-- regola
link: /agenda
label: Apri Gestione Eventi →
keywords: conflitto orario, conflitto sala, sovrapposizione eventi, sale sovrapposte, conflitto agenda
-->
Il sistema segnala un conflitto quando due eventi usano la stessa sala o location con orari anche solo parzialmente sovrapposti. Per risolverlo apri Agenda → Gestione Eventi, individua i due eventi coinvolti e modifica l'orario di uno dei due oppure assegnagli una sala diversa. Il controllo si applica anche alle location testuali di stand o associazioni, non solo alle sale interne.

<!-- regola
link: /agenda
label: Apri Ospiti →
keywords: aggiungo un ospite, creare un ospite, nuovo ospite, gestisco gli ospiti, relatore non trovato, speaker non in lista
-->
Gli ospiti si gestiscono in Agenda → Ospiti, indipendentemente dagli eventi: crea qui il profilo pubblico (nome, foto, biografia) prima di poterlo assegnare a un evento. Se un ospite non compare nella lista selezionabile durante la creazione di un evento, verifica che sia stato creato nella stessa edizione corrente dell'evento.

<!-- regola
link: /agenda
label: Apri Mappa pubblica →
keywords: mappa pubblica, mappa evento, punti di interesse, mappa stand differenza, differenza mappa pubblica e mappa stand
-->
La Mappa pubblica (Agenda → Mappa pubblica) mostra ai visitatori punti d'interesse generali dell'evento come trasporti, shop e palchi, organizzati per categoria e appartenenti all'edizione corrente. È diversa dalla Mappa Stand, che invece è una mappa interna legata agli assegnatari pass e serve a localizzare gli stand fisici collegati ai gruppi/partecipanti.
