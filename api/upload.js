// Vercel serverless function — proxies payment proof upload to Apps Script
// Bypasses the browser POST→GET redirect issue with Google's infrastructure

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  const SCRIPT_URL = process.env.SCRIPT_URL;
  if (!SCRIPT_URL) return res.status(500).json({ error: 'SCRIPT_URL not configured' });

  try {
    // Step 1: POST to the exec URL — this executes doPost on Google's side
    // Google returns a 302 redirect to an echo URL where the response is stored
    const post = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(req.body),
      redirect: 'manual'
    });
    const echoUrl = post.headers.get('location') || SCRIPT_URL;

    // Step 2: GET the echo URL to retrieve the doPost response
    const upstream = await fetch(echoUrl, { method: 'GET' });

    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
