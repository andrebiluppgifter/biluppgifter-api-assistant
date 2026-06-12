// Vercel Edge Function — verifierar magic link-token via Apps Script.
// Anropas av frontend när användaren klickar magic link (?token=xxx i URL).
// Vi proxar anropet server-side eftersom Apps Script saknar CORS-headers.

export const config = {
  runtime: 'edge',
};

// Apps Script Web App URL — samma som SHEET_WEBHOOK_URL i frontend
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwBvJtuuFHRIGNDT3CcjeqIrgaDmYEfOPMifPWlzVRQToFFIAno6SQtpR5Fdo-ZzBzv/exec';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = (body && body.token) ? String(body.token).trim() : '';
  if (!token || token.length < 16) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid token format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Proxa till Apps Script (server-to-server, ingen CORS-issue)
  let scriptRes;
  try {
    scriptRes = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'verify_token',
        token: token,
      }),
      redirect: 'follow',
    });
  } catch (err) {
    console.error('Apps Script fetch failed:', err);
    return new Response(JSON.stringify({
      ok: false,
      error: 'Could not reach verification service',
      detail: String(err && err.message ? err.message : err),
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!scriptRes.ok) {
    let errText = '';
    try { errText = await scriptRes.text(); } catch {}
    return new Response(JSON.stringify({
      ok: false,
      error: 'Apps Script error',
      status: scriptRes.status,
      detail: errText.slice(0, 500),
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Apps Script returnerar JSON med { ok, email, name } eller { ok: false, error }
  let scriptData;
  try {
    const text = await scriptRes.text();
    scriptData = JSON.parse(text);
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Invalid response from verification service',
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Returnera till frontend
  return new Response(JSON.stringify(scriptData), {
    status: scriptData.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
}
