// Vercel Edge Function — POSTs a new API Assistant user (email + metadata)
// to a Google Apps Script Web App, which writes a row to a Google Sheet.
// Triggered by the frontend the first time a user passes the email gate.

export const config = {
  runtime: 'edge',
};

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const webhookUrl = (process.env.SHEET_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    return new Response(JSON.stringify({
      error: 'Server missing SHEET_WEBHOOK_URL env variable',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const email = (body && body.email) ? String(body.email).slice(0, 200) : '';
  const name = (body && body.name) ? String(body.name).slice(0, 200) : '';
  if (!isValidEmail(email)) {
    return new Response(JSON.stringify({ error: 'valid email required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!name || name.trim().length < 2) {
    return new Response(JSON.stringify({ error: 'name required (min 2 chars)' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = {
    name: name.trim(),
    email,
    user_agent: String(req.headers.get('user-agent') || '').slice(0, 500),
    referrer: String(req.headers.get('referer') || '').slice(0, 500),
    timestamp_iso: new Date().toISOString(),
    source: 'biluppgifter-api-assistant',
  };

  let sheetRes;
  try {
    sheetRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Sheet webhook fetch threw:', err);
    return new Response(JSON.stringify({
      error: 'Could not call Sheet webhook',
      detail: String(err && err.message ? err.message : err),
    }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  if (!sheetRes.ok) {
    let errText = '';
    try { errText = await sheetRes.text(); } catch {}
    console.error(`Sheet webhook ${sheetRes.status}:`, errText);
    return new Response(JSON.stringify({
      error: `Sheet webhook ${sheetRes.status}`,
      detail: errText,
    }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
