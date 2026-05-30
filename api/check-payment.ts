import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

function getSupabase() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

type CheckDetails = {
  amount: { ok: boolean; extracted: number | null; expected: number };
  date: { ok: boolean; extracted: string | null; bookingCreated: string };
  receiver: { ok: boolean; extracted: string | null };
  sender: { ok: boolean; extracted: string | null; member: string };
};

type CheckResult = {
  aiChecked: boolean;
  aiCheckDetails: CheckDetails;
  paymentMethod: string;
  detectedAmount: number | null;
};

const EXTRACTION_PROMPT = [
  'Extract payment info from this receipt screenshot. Return JSON only, no markdown:',
  '{',
  '  "amount": number | null,',
  '  "transactionId": string | null,',
  '  "paymentMethod": "esewa" | "fonepay" | "khalti" | "bank" | "unknown",',
  '  "senderPhone": string | null,',
  '  "receiverName": string | null,',
  '  "transactionDate": "YYYY-MM-DD" | null',
  '}',
  "Notes: senderPhone is the payer's number. receiverName may be partially starred (e.g. \"***** Association\").",
].join('\n');

async function runPaymentCheck(
  imageBuffer: Buffer,
  mimeType: string,
  expectedAmount: number,
  bookingCreatedAt: string,
  memberPhone: string,
): Promise<CheckResult> {
  const { text: raw } = await generateText({
    model: openai('gpt-4.1-mini'),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: EXTRACTION_PROMPT },
          { type: 'image', image: imageBuffer, mimeType },
        ],
      },
    ],
  });

  type Extracted = {
    amount: number | null;
    transactionId: string | null;
    paymentMethod: string;
    senderPhone: string | null;
    receiverName: string | null;
    transactionDate: string | null;
  };

  let extracted: Extracted = {
    amount: null,
    transactionId: null,
    paymentMethod: 'unknown',
    senderPhone: null,
    receiverName: null,
    transactionDate: null,
  };
  try {
    const json = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
    extracted = { ...extracted, ...JSON.parse(json) };
  } catch {
    // continue with defaults
  }

  const amountOk =
    extracted.amount !== null &&
    extracted.amount >= expectedAmount &&
    extracted.amount <= expectedAmount + 50;

  const dateOk =
    extracted.transactionDate !== null &&
    extracted.transactionDate >= bookingCreatedAt;

  const receiverRaw = (extracted.receiverName ?? '').toLowerCase();
  const receiverOk =
    receiverRaw.includes('tennis') ||
    receiverRaw.includes('association') ||
    receiverRaw.includes('nta');

  const normalizedSender = extracted.senderPhone
    ? extracted.senderPhone.replace(/\D/g, '').slice(-10)
    : null;
  const normalizedMember = memberPhone.replace(/\D/g, '').slice(-10);
  const senderOk = normalizedSender !== null && normalizedSender === normalizedMember;

  return {
    aiChecked: amountOk && dateOk,
    aiCheckDetails: {
      amount: { ok: amountOk, extracted: extracted.amount, expected: expectedAmount },
      date: { ok: dateOk, extracted: extracted.transactionDate, bookingCreated: bookingCreatedAt },
      receiver: { ok: receiverOk, extracted: extracted.receiverName },
      sender: { ok: senderOk, extracted: extracted.senderPhone, member: memberPhone },
    },
    paymentMethod: extracted.paymentMethod,
    detectedAmount: extracted.amount,
  };
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
