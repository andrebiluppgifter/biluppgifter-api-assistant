# Biluppgifter API Assistant

Webbapp som svarar på frågor om Biluppgifters API och Xevatos partner-API, anpassad efter målgrupp (utvecklare/säljare/beslutsfattare) och språk (svenska/engelska).

## Filer

| Fil | Roll |
|---|---|
| `index.html` | Frontend — chat-UI. Anropar `/api/chat` (proxy). Ingen API-nyckel exponeras till klienten. |
| `api/chat.js` | Vercel Edge Function. Tar emot meddelandena, lägger på system prompt + API-spec, anropar Anthropic, streamar tillbaka SSE. |
| `vercel.json` | Vercel-config (memory + timeout för functionen). |
| `.env.example` | Mall för miljövariabler. |
| `biluppgifter-api-assistant.html` | Frist&aring;ende BYO-key-version (kr&auml;ver ej deploy). Ignoreras av Vercel. |

## Deploy till Vercel

### Steg 1 — Sätt miljövariabel

Antingen via dashboarden (Settings → Environment Variables) eller med CLI:

```bash
vercel env add ANTHROPIC_API_KEY production
# klistra in din sk-ant-... nyckel när den frågar
```

Skaffa nyckel på [console.anthropic.com](https://console.anthropic.com/).

### Steg 2 — Deploya

**Via CLI:**

```bash
npm i -g vercel
cd ~/Documents/Claude/Projects/Bot
vercel              # preview-deploy
vercel --prod       # produktion
```

**Eller via dashboarden:** gå till [vercel.com/new](https://vercel.com/new), Import `Bot`-mappen (eller koppla GitHub-repo), och tryck Deploy.

### Steg 3 — Testa

Öppna prod-URL:en. Skriv en fråga, t.ex. "Vilka endpoints finns för Sverige?". Du ska få ett strömmat svar inom någon sekund.

## Utveckla lokalt

```bash
cp .env.example .env.local
# lägg in din ANTHROPIC_API_KEY i .env.local
vercel dev
# → http://localhost:3000
```

## Säkerhet & kostnad

- API-nyckeln lever bara som env-variabel i Vercel — den syns aldrig i frontend.
- Functionen `api/chat.js` har en model-whitelist (Sonnet 4.5 / Opus 4.5 / Haiku 4.5) och cappar input-meddelanden på 20 000 tecken vardera, så missbruk är begränsat.
- Anthropic debiterar per token. Vill du lägga på fler skyddsåtgärder är naturliga nästa steg: rate-limiting per IP (Vercel KV eller Upstash), bot-skydd, eller en hemlig header som frontend skickar med och functionen verifierar.

## Uppdatera kunskapsbasen

Kunskapen om API:erna ligger som en stor template-string i `api/chat.js` (`SYSTEM_PROMPT`). Lägg till endpoints, fält eller segmentcase där och redeploya — frontend behöver inte ändras.

## Kontakt

För nya API-frågor: info@biluppgifter.se
