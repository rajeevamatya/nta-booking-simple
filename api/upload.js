// Vercel serverless function — proxies payment proof upload to Apps Script
// Flow: POST to exec URL (doPost runs here) → GET the redirect to get the response

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwhLbsc_n26cmI6zFx7LyixMEKafxH8HMpasyMthlsgYX2hq8SaNvQppk9p-m8iirW0/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  try {
    // Step 1: POST with body — doPost(e) is called here, data is processed
    const post = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(req.body),
      redirect: 'manual',
    });

    // Step 2: GET the redirect URL to retrieve the JSON response
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
