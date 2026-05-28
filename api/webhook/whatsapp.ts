import type { VercelRequest, VercelResponse } from '@vercel/node';
import { processMessage } from '../../src/bot';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function twiml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(text)}</Message></Response>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const body = req.body as Record<string, string>;
  const from = body.From ?? '';
  const text = body.Body ?? '';
  const numMedia = parseInt(body.NumMedia ?? '0', 10);
  const mediaUrl = numMedia > 0 ? (body.MediaUrl0 ?? null) : null;

  res.setHeader('Content-Type', 'application/xml');

  try {
    const reply = await processMessage(text, from, mediaUrl);
    res.send(twiml(reply));
  } catch (err) {
    console.error('Webhook error:', err);
    res.send(twiml('Sorry, something went wrong. Please try again.'));
  }
}
