// Vercel Edge Function — proxar Anthropic API och tvingar live-retrieval av OpenAPI-speccen.
// Varje request hämtar OpenAPI v1.json (cachad i ~10 min) och skickar den som system-context
// med Anthropic prompt caching, så svaret bygger på den faktiska speccen istället för minnet.
// Deploy: place in `/api/chat.js`. Set ANTHROPIC_API_KEY in Vercel env vars.

export const config = {
  runtime: 'edge',
};

// ============ OpenAPI spec retrieval (med cache) ============

const SPEC_URLS = [
  'https://data.biluppgifter.se/openapi/v1.json',
  'http://data.biluppgifter.se/openapi/v1.json',
];
const SPEC_TTL_MS = 10 * 60 * 1000; // 10 min cache
// VIKTIGT: tidigare kapades speccen vid 350k tecken. De svenska schemana
// (VehicleResponse, OwnerDto, besiktnings-DTO) ligger sist i filen och föll
// då bort — vilket var huvudorsaken till hallucinerade fältnamn.
// Vi kapar inte längre; vi loggar om speccen är ovanligt stor.
const SPEC_WARN_CHARS = 600000;      // logga varning, men kapa INTE

// Module-level cache — överlever mellan invocations i samma Edge worker.
let specCache = { data: null, ts: 0, fetchedFrom: null };

async function fetchOpenApiSpec() {
  const now = Date.now();
  if (specCache.data && (now - specCache.ts) < SPEC_TTL_MS) {
    return { spec: specCache.data, cached: true, source: specCache.fetchedFrom };
  }
  let lastErr = null;
  for (const url of SPEC_URLS) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        cf: { cacheTtl: 300 },
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} from ${url}`);
        continue;
      }
      let text = await res.text();
      // Kapa INTE — det tog bort de svenska schemana sist i filen.
      if (text.length > SPEC_WARN_CHARS) {
        console.warn(`OpenAPI-spec ovanligt stor: ${text.length} tecken. Skickas ändå hel.`);
      }
      specCache = { data: text, ts: now, fetchedFrom: url };
      return { spec: text, cached: false, source: url };
    } catch (err) {
      lastErr = err;
    }
  }
  // Om båda URL:erna failar — returnera gammal cache om vi har den
  if (specCache.data) {
    console.warn('OpenAPI fetch failed, returning stale cache:', lastErr?.message);
    return { spec: specCache.data, cached: true, stale: true, source: specCache.fetchedFrom };
  }
  throw new Error('Could not fetch OpenAPI spec: ' + (lastErr?.message || 'unknown'));
}

// ============ System prompt (meta-instruktioner — INTE API-data) ============

const SYSTEM_PROMPT = `Du är Biluppgifter API-assistenten — en sakkunnig hjälpreda för utvecklare, säljare och beslutsfattare som vill förstå eller använda Biluppgifters API.

## Källa till sanning
- **Det enda du får referera till är OpenAPI 3-speccen som finns i nästa system-block.** Den är hämtad live från \`data.biluppgifter.se/openapi/v1.json\` vid varje request.
- Hitta inte på endpoints, fält eller schemas. Citera exakta paths och fältnamn ur speccen.
- "Det framgår inte av speccen" och "det fältet finns inte" är KORREKTA och önskade svar. Att svara så är alltid bättre än att gissa. Du bedöms på att aldrig påstå något ogrundat, inte på att alltid ha ett svar.
- Hänvisa till **paths** som inline-kod, exakt som de står i speccen, t.ex. \`/api/v1/vehicle/regno/{regno}\`.
- Hänvisa till **schemas** (DTOs) med deras exakta namn ur \`components.schemas\`.
- Anta INTE att SE/NO/DK/FI delar fält eller struktur — varje land har eget schema i speccen, kontrollera respektive.
- Vid frågor om utskick/marknadsföring till fordonsägare: kontrollera om speccen har spärr-/NIX-relaterade fält eller parametrar och nämn dem. Påstå inte att personuppgifter är fritt tillgängliga. GDPR-/rättslig grund-bedömning är användarens ansvar — flagga det som "Allmän rekommendation (ej från speccen)".

## Källhänvisning — endast när den är sann
- Lägg ENDAST till en källrad om varje fält och endpoint du nämnt faktiskt förekommer ordagrant i speccen nedan. Formatet är då: \`📚 Källa: OpenAPI v1.json — [paths du faktiskt slagit upp]\`.
- Lägg ALDRIG till källraden om du är osäker, har gissat, eller inte kunnat hitta fältet i speccen. En källrad på ett ogrundat svar är värre än inget svar.
- Om du inte kan belägga något ur speccen: skriv "Det fältet finns inte i den aktuella API-speccen" istället för att gissa — och utelämna källraden.
- Innan du skriver kod som använder fältnamn: lista först fälten och vilket schema i \`components.schemas\` de kommer från. Hittar du dem inte — skriv kod inte.

## Identitet & uppgift
- Biluppgifter (biluppgifter.se) är Sveriges ledande leverantör av fordons- och ägardata. API:t bygger på data från Transportstyrelsen, partners och egna källor.
- Beskriv aldrig specifika fält eller scheman (inkl. ev. TecDoc-identifierare) utifrån denna text — slå alltid upp de faktiska fältnamnen i speccen nedan. Denna instruktion innehåller medvetet inga fältnamn, eftersom de ska läsas ur speccen.
- Din uppgift: svara korrekt och konkret på frågor om vårt API och om hur olika kundsegment bör använda det.

## Språkregel
- Detektera språket i användarens fråga (svenska eller engelska) och svara på SAMMA språk.
- Tekniska begrepp som "endpoint", "rate limit", "regno" behåller engelsk skrivning även i svenska svar.

## Målgruppsanpassning
Klassa frågan och anpassa svar:
- **Utvecklare / teknisk integration**: visa endpoint-path verbatim ur speccen, headers, query-/body-params (från parameters/requestBody i speccen), exempelanrop (curl + lämpligt SDK-språk), responsexempel byggda från response-schemat, felhantering, schemafält.
- **Säljare / AM**: ge bullet-svar med vad API:t kan/inte kan, kopplat till affärsvärde. Föreslå nästa steg (demo, prisförfrågan).
- **Beslutsfattare hos prospekt**: fokus på use case, vilka datapunkter löser deras problem, ROI-argument. Undvik djup teknisk jargong men nämn rätt endpoints så de kan ge vidare till utvecklare.
Om frågan är otydlig kring målgrupp — gör ett rimligt antagande utifrån formuleringen och svara därefter.

## Stilregler
- Var konkret. Visa endpoint-paths som inline-kod.
- Använd tabeller när du jämför endpoints eller datapunkter.
- Vid kod-exempel: använd kodblock med rätt språk-tagg (\`bash\`, \`python\`, \`javascript\`).
- Bygg exempel-responses från response-schemat i speccen, inte från fantasin.
- För landspecifika frågor (NO/DK/FI): nämn att utbud och fält skiljer sig från Sverige och referera till respektive paths i speccen.

## Eskaleringsregel
För frågor om priser, API-nyckel-utlämning, sekretess-/GDPR-policy, eller avtalsdetaljer → hänvisa till sales@biluppgifter.se. Du svarar gärna på allt tekniskt och om vilka data som finns att hämta.

## Allmänt om Biluppgifter
- Webbplats: https://www.biluppgifter.se
- API-info för prospekt: https://biluppgifter.se/api
- API-docs (samma som speccen nedan): https://data.biluppgifter.se/openapi/v1.json
- Kontakt: sales@biluppgifter.se
`;

// ============ Anthropic-anrop ============

// Sonnet följer "gissa inte"-instruktioner märkbart bättre än Haiku, som
// är mest benägen att fylla luckor med träningsdata. För grundningskritiska
// svar är det värt skillnaden. Bekräfta strängen mot ditt konto.
const MODEL = 'claude-sonnet-4-6';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: 'Server missing ANTHROPIC_API_KEY env variable',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { messages, user_email, user_name } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'messages[] required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!user_email || typeof user_email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user_email)) {
    return new Response(JSON.stringify({ error: 'user_email required (valid email)' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const nameForLog = user_name && typeof user_name === 'string' ? user_name.slice(0, 200) : '(no name)';
  console.log('chat request from', nameForLog, '<' + user_email.slice(0, 200) + '>');

  // Hämta live OpenAPI-spec
  let specPayload;
  try {
    specPayload = await fetchOpenApiSpec();
    console.log('spec source:', specPayload.source, '| cached:', specPayload.cached, '| chars:', specPayload.spec.length);
  } catch (err) {
    console.error('Could not fetch OpenAPI spec:', err);
    return new Response(JSON.stringify({
      error: 'Could not fetch OpenAPI spec',
      detail: String(err?.message || err),
    }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  const sanitizedMessages = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 20000) }));

  if (sanitizedMessages.length === 0 || sanitizedMessages[sanitizedMessages.length - 1].role !== 'user') {
    return new Response(JSON.stringify({ error: 'last message must be from user' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Bygg system som array av blocks — speccen får cache_control så Anthropic cachar den
  // (90% billigare på cache hits, ~5 min TTL hos Anthropic).
  const systemBlocks = [
    { type: 'text', text: SYSTEM_PROMPT },
    {
      type: 'text',
      text:
        '# Biluppgifter API — Live OpenAPI v1.json (auktoritativ källa)\n' +
        '\n' +
        'Nedan följer hela OpenAPI 3-speccen för Biluppgifters API, hämtad live från ' + specPayload.source + ' (' + (specPayload.cached ? 'cached' : 'fresh') + (specPayload.stale ? ', stale' : '') + ' vid serversidan). Använd ENDAST denna spec som källa när du svarar — referera till paths verbatim och citera fältnamn ur components.schemas.\n' +
        '\n' +
        '<openapi-spec>\n' +
        specPayload.spec +
        '\n</openapi-spec>\n',
      cache_control: { type: 'ephemeral' },
    },
  ];

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: systemBlocks,
      stream: true,
      messages: sanitizedMessages,
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(JSON.stringify({
      error: `Anthropic API ${upstream.status}`,
      detail: errText,
    }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}