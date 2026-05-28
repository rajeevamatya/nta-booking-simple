import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { runPaymentCheck } from '../lib/checkPayment';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const { bookingId } = req.body as { bookingId?: string };
  if (!bookingId) { res.status(400).json({ error: 'bookingId required' }); return; }

  const sb = getSupabase();

  const { data: booking } = await sb
    .from('bookings')
    .select('id, phone, amount, proof_url, created_at')
    .eq('id', bookingId)
    .single();

  if (!booking) { res.status(404).json({ error: 'Booking not found' }); return; }
  if (!booking.proof_url) { res.status(422).json({ error: 'No proof uploaded yet' }); return; }

  const imgRes = await fetch(booking.proof_url as string);
  if (!imgRes.ok) { res.status(502).json({ error: 'Could not fetch proof image' }); return; }

  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  const mimeType = imgRes.headers.get('content-type') ?? 'image/jpeg';
  const bookingCreatedAt = (booking.created_at as string).slice(0, 10);

  const { aiChecked, aiCheckDetails, paymentMethod, detectedAmount } =
    await runPaymentCheck(imgBuffer, mimeType, booking.amount as number, bookingCreatedAt, booking.phone as string);

  await sb
    .from('bookings')
    .update({ ai_checked: aiChecked, ai_check_details: aiCheckDetails })
    .eq('id', bookingId);

  res.status(200).json({ aiChecked, aiCheckDetails, paymentMethod, detectedAmount });
}
