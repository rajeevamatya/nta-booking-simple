import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export type CheckDetails = {
  amount: { ok: boolean; extracted: number | null; expected: number };
  date: { ok: boolean; extracted: string | null; bookingCreated: string };
  receiver: { ok: boolean; extracted: string | null };
  sender: { ok: boolean; extracted: string | null; member: string };
};

export type CheckResult = {
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

export async function runPaymentCheck(
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

  // Hard checks
  const amountOk =
    extracted.amount !== null &&
    extracted.amount >= expectedAmount &&
    extracted.amount <= expectedAmount + 50;

  const dateOk =
    extracted.transactionDate !== null &&
    extracted.transactionDate >= bookingCreatedAt;

  // Soft checks
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
