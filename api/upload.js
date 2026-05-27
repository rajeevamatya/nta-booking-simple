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
    // Step 1: probe to get the real execution URL behind Google's 302 redirect
    const probe = await fetch(SCRIPT_URL, { method: 'GET', redirect: 'manual' });
    const execUrl = probe.headers.get('location') || SCRIPT_URL;

    // Step 2: POST directly to the execution URL — no redirect, doPost is called
    const upstream = await fetch(execUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(req.body)
    });

    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
