# FRAME

**Hidden stories worth shooting.**
Strumento di scouting per fotografi documentaristi: scansiona le notizie del mondo da GDELT (monitor globale dei media, aggiornato ogni 15 minuti), poi Claude legge quel flusso e seleziona le storie con il più forte potenziale fotografico — quelle dietro i titoloni, non i titoloni.

Per ogni storia: luogo geocodato sulla mappa, score visivo, e su un click una **scheda scouting** (stagione migliore, accesso, permessi, contatti locali, safety, approccio visivo, gear).

---

## Cosa serve per pubblicarla online

Una sola cosa: una chiave API di **Anthropic**. Tutto il resto è gratis.

1. **Chiave Anthropic** — vai su https://console.anthropic.com/settings/keys, "Create Key", copia la stringa che inizia con `sk-ant-…`. Tienila a portata di mano: tra poco la incolli su Vercel.
   *Costo:* su Opus 4.8 (il modello che FRAME usa) le tue scansioni costano circa **5–15 centesimi a scansione canale** e **2–4 centesimi a scheda scouting**. Una giornata di esplorazione intensa = pochi euro.

2. **Account Vercel** — già ce l'hai. Useremo il piano Hobby (gratuito).

3. **GDELT** — non serve nessuna registrazione, è una sorgente pubblica gratuita.

---

## Pubblicare la prima volta — 10 minuti

Ci sono tre strade, dalla più semplice alla più tecnica. **La A non richiede di installare nulla sul Mac.**

### Strada A — solo browser (più semplice)

1. Comprimi la cartella `frame` in un `.zip` (click destro → "Comprimi").
2. Vai su **github.com**, crea un nuovo repository (può essere privato), chiamato `frame`.
3. Sulla pagina del repo appena creato, clicca "uploading an existing file" e trascina dentro **tutti i contenuti della cartella frame** (estrai prima lo zip e seleziona file + sottocartelle). Conferma "Commit changes".
4. Vai su **vercel.com/new**, accedi col tuo account, "Import" → seleziona il repo `frame`.
5. **Prima di cliccare Deploy**, espandi *Environment Variables* e aggiungi:
   - Nome: `ANTHROPIC_API_KEY`
   - Valore: la chiave `sk-ant-…` che hai copiato.
6. "Deploy". In 1 minuto FRAME è online a `https://frame-tuonome.vercel.app`.

Per gli aggiornamenti futuri: modifichi un file nel repo (anche dal web GitHub), Vercel ridepoya da solo.

### Strada B — via Vercel CLI (serve Node.js)

Se hai installato Node.js (`node -v` in Terminale risponde con un numero, altrimenti scaricalo da nodejs.org):

```bash
npm install -g vercel
cd "/Users/irobtz/Documents/Claude/app per fotografi/frame"
vercel login
vercel              # primo deploy preview
vercel env add ANTHROPIC_API_KEY production   # incolla la chiave quando te la chiede
vercel --prod       # deploy definitivo
```

L'URL finale è quello che stampa l'ultimo comando.

### Strada C — via Git/GitHub da Terminale

```bash
cd "/Users/irobtz/Documents/Claude/app per fotografi/frame"
git init && git add . && git commit -m "FRAME v4"
git branch -M main
git remote add origin https://github.com/TUO_UTENTE/frame.git
git push -u origin main
```

Poi importa il repo da vercel.com/new come nella Strada A dal punto 4.

---

## Provarla in locale prima di pubblicare (opzionale, serve Node.js)

```bash
cd "/Users/irobtz/Documents/Claude/app per fotografi/frame"
npm install
cp .env.local.example .env.local
# apri .env.local con TextEdit e incolla la chiave Anthropic
npx vercel dev
```

Si apre su `http://localhost:3000`. Se non hai Node installato, salta questo passo — Vercel testa in cloud al momento del deploy.

---

## Come usarla

1. Clicca un canale in alto (Social, Environment, Vanishing, Women, ecc.).
2. Aspetta 10–20 secondi: FRAME interroga GDELT e Claude cura le 6–9 storie più fotografiche.
3. Passa tra **Contact sheet** (griglia di schede) e **Map** (mappa mondiale con marker pulsanti).
4. Clicca una scheda → si apre la **scouting card** con stagione, accesso, permessi, contatti, safety, approccio visivo, gear.
5. Tap sulla **☆** per salvare nel *Roll* (la tua shortlist). Il Roll persiste sul tuo browser tra una sessione e l'altra.
6. **Export shortlist** scarica un `.txt` con tutto il dossier — pronto per il taccuino di viaggio.

Il campo "Search" affina dentro il canale selezionato (es. canale Vanishing + ricerca "fishermen Mediterranean").

---

## Architettura

```
frame/
├── public/
│   └── index.html      ← UI (estetica fotografica, vanilla JS + Leaflet)
├── api/
│   ├── scan.js         ← GDELT → Claude curation → JSON storie
│   └── scout.js        ← Claude → JSON scouting report
├── package.json
└── vercel.json
```

- **GDELT** (gratis, mondiale, geocodato) è la spina dorsale delle news.
- **Claude Opus 4.8** con adaptive thinking e structured outputs fa la curation editoriale e lo scouting.
- Il **Roll** vive su `localStorage` — niente database, niente account, niente da gestire.

---

## Aggiornamenti

Ogni modifica che fai ai file → `git push` (strada A) o `vercel --prod` (strada B) → online in pochi secondi.

---

## Idee per dopo

- Persistenza del Roll su Supabase (cross-device, sincronizzato col tuo iPad in viaggio).
- Memoria delle storie già scoutate, per non riproporle.
- Filtro per regione del mondo direttamente sulla mappa.
- Esportazione in PDF illustrato della shortlist.
