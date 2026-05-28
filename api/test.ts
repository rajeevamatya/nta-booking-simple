import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.json({
    ok: true,
    supabaseUrl: !!process.env.SUPABASE_URL,
    supabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    openaiKey: !!process.env.OPENAI_API_KEY,
    twilioSid: !!process.env.TWILIO_ACCOUNT_SID,
    twilioToken: !!process.env.TWILIO_AUTH_TOKEN,
  });
}
