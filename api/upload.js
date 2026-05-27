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
    // Step 1: POST to the exec URL — doPost(e) is called here with the body data.
    // Google processes the request and returns a 302 with a Location header.
    const post = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(req.body),
      redirect: 'manual',
    });

    // Step 2: GET the redirect URL — this delivers the JSON response back.
    // The Location endpoint only accepts GET; POSTing to it returns 405.
    const redirectUrl = post.headers.get('location');
    if (!redirectUrl) {
      const text = await post.text();
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(text);
    }

    const get = await fetch(redirectUrl, { method: 'GET' });
    const text = await get.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
