# Ludicomix — Area Gestione Pass

## Deploy su Railway

1. Crea un nuovo progetto su [railway.app](https://railway.app)
2. Collega questo repository GitHub
3. Aggiungi un **Volume** al servizio:
   - Mount path: `/data`
4. Aggiungi le variabili d'ambiente:
   - `DATA_DIR` = `/data`
   - `SESSION_SECRET` = (stringa casuale lunga, es. genera con `openssl rand -hex 32`)
   - `PORT` = `3000` (Railway lo imposta automaticamente)
5. Deploy!

## Avvio locale

```bash
npm install
npm start
```

Credenziali iniziali: `admin` / `admin123`
