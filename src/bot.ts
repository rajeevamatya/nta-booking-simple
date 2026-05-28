import { generateText, tool, type CoreMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// ── Clients ───────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ── Settings (cached 5 min) ───────────────────────────────────────────────────

type Settings = {
  open_from: number;
  open_to: number;
  price_singles: number;
  price_doubles: number;
  whatsapp: string | null;
  qr_url: string | null;
};

let _settings: Settings | null = null;
let _settingsAt = 0;

async function getSettings(): Promise<Settings> {
  if (_settings && Date.now() - _settingsAt < 300_000) return _settings;
  const { data } = await supabase
    .from('settings')
    .select('open_from, open_to, price_singles, price_doubles, whatsapp, qr_url')
    .eq('id', 1)
    .single();
  _settings = (data ?? { open_from: 6, open_to: 19, price_singles: 400, price_doubles: 600, whatsapp: null, qr_url: null }) as Settings;
  _settingsAt = Date.now();
  return _settings;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRef(): string {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rand = (n: number) =>
    Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join('');
  return `NTA-${rand(4)}-${rand(3)}`;
}

function timeToSlots(time: string, durationHours: number): number[] {
  const h = parseInt(time.split(':')[0], 10);
  return Array.from({ length: durationHours }, (_, i) => h + i);
}

function formatTimeLabel(time: string, durationHours: number): string {
  const [hStr, mStr] = time.split(':');
  const sh = parseInt(hStr, 10);
  const sm = parseInt(mStr, 10);
  const eh = sh + durationHours;
  const fmt = (h: number, m: number) =>
    `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return `${fmt(sh, sm)} – ${fmt(eh, 0)}`;
}

async function upsertMember(phone: string, name?: string): Promise<void> {
  await supabase
    .from('members')
    .upsert({ phone, name: name ?? phone }, { onConflict: 'phone', ignoreDuplicates: true });
}

// ── Conversation history ──────────────────────────────────────────────────────

type HistoryRow = {
  role: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
};

function sanitizeHistory(msgs: CoreMessage[]): CoreMessage[] {
  const declared = new Set<string>();
  for (const m of msgs) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'tool-call') declared.add(p.toolCallId);
      }
    }
  }

  const resolved = new Set<string>();
  for (const m of msgs) {
    if (m.role === 'tool') {
      for (const p of m.content) {
        if (declared.has(p.toolCallId)) resolved.add(p.toolCallId);
      }
    }
  }

  return msgs.filter((m) => {
    if (m.role === 'tool') {
      return m.content.every((p) => declared.has(p.toolCallId));
    }
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const calls = m.content.filter((p) => p.type === 'tool-call');
      if (calls.length > 0) return calls.every((p) => resolved.has(p.toolCallId));
    }
    return true;
  });
}

async function getHistory(phone: string, limit = 10): Promise<CoreMessage[]> {
  const { data } = await supabase
    .from('conversation_history')
    .select('role, content, metadata')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!data?.length) return [];

  const rows = ([...data] as HistoryRow[]).reverse();
  const messages: CoreMessage[] = [];

  for (const { role, content, metadata } of rows) {
    if (role === 'assistant' && metadata?.toolCalls) {
      const calls = metadata.toolCalls as Array<{
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
      }>;
      messages.push({
        role: 'assistant',
        content: calls.map((tc) => ({
          type: 'tool-call' as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args,
        })),
      });
    } else if (role === 'tool' && metadata?.toolCallId) {
      let result: unknown;
      try {
        result = JSON.parse(content ?? '{}');
      } catch {
        result = content;
      }
      messages.push({
        role: 'tool',
        content: [{
          type: 'tool-result' as const,
          toolCallId: metadata.toolCallId as string,
          toolName: metadata.toolName as string,
          result,
        }],
      });
    } else {
      messages.push({ role: role as 'user' | 'assistant', content: content ?? '' });
    }
  }

  return sanitizeHistory(messages);
}

type StepLike = {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; args: unknown }>;
  toolResults: Array<{ toolCallId: string; toolName: string; result: unknown }>;
};

async function saveHistory(phone: string, steps: StepLike[], userContent: string): Promise<void> {
  const rows: Array<{
    phone: string;
    role: string;
    content: string | null;
    metadata?: Record<string, unknown>;
  }> = [{ phone, role: 'user', content: userContent }];

  for (const step of steps) {
    if (step.toolCalls.length > 0) {
      rows.push({
        phone,
        role: 'assistant',
        content: null,
        metadata: {
          toolCalls: step.toolCalls.map((tc) => ({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.args,
          })),
        },
      });
      for (const tr of step.toolResults) {
        rows.push({
          phone,
          role: 'tool',
          content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
          metadata: { toolCallId: tr.toolCallId, toolName: tr.toolName },
        });
      }
    } else if (step.text) {
      rows.push({ phone, role: 'assistant', content: step.text });
    }
  }

  await supabase.from('conversation_history').insert(rows);
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(s: Settings): string {
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Kathmandu',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return `You are a friendly tennis court booking assistant for Nepal Tennis Association (NTA) on WhatsApp.
Keep messages short and clear — this is a chat interface.

Today: ${now} (Nepal time)
Operating hours: ${s.open_from}:00–${s.open_to}:00 daily
Courts: 1 through 6
Pricing: NPR ${s.price_singles}/hr singles (2 people), NPR ${s.price_doubles}/hr doubles (4 people)
Payment: eSewa (${s.whatsapp ?? '9841044844'}) or FonePay (NTA)${s.qr_url ? `\nQR: ${s.qr_url}` : ''}

Rules:
1. Always call checkAvailability before createBooking.
2. Always confirm with the user before calling createBooking or cancelBooking.
3. "singles" = 2 people, "doubles" = 4 people. Default to singles if unclear.
4. If the time is outside operating hours, say so and suggest valid times.
5. After createBooking, share the booking ref (e.g. NTA-A1B2-C3D) and ask for a payment screenshot.
6. If the user sends an image, call processPayment immediately — do not ask first.
7. After processPayment, tell the user their payment is under review and an admin will confirm shortly.
8. Always use the booking ref (not UUID) when talking to the user.
9. On first greeting, include an example: "Book court 2 for singles tomorrow at 7am, 1 hour".`;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function processMessage(
  body: string,
  from: string,
  mediaUrl: string | null,
): Promise<string> {
  const phone = from.replace('whatsapp:', '');
  await upsertMember(phone);

  const settings = await getSettings();
  const history = await getHistory(phone);

  const userContent = mediaUrl
    ? body.trim()
      ? `[Payment screenshot attached]\n${body.trim()}`
      : '[Payment screenshot attached]'
    : body;

  // Tools are created here so they close over `phone` and `mediaUrl`

  const checkAvailability = tool({
    description: 'Check which courts are free for a given date, start time, and duration.',
    parameters: z.object({
      date: z.string().describe('YYYY-MM-DD'),
      time: z.string().describe('HH:MM 24-hour'),
      durationHours: z.number().int().min(1).max(2),
      numPeople: z.number().int().describe('2 = singles, 4 = doubles'),
    }),
    execute: async ({ date, time, durationHours, numPeople }) => {
      const s = await getSettings();
      const startHour = parseInt(time.split(':')[0], 10);
      if (startHour < s.open_from || startHour + durationHours > s.open_to) {
        return { available: false, reason: 'outside_hours', openFrom: s.open_from, openTo: s.open_to };
      }

      const slots = timeToSlots(time, durationHours);
      const price = (numPeople >= 4 ? s.price_doubles : s.price_singles) * durationHours;

      const { data: booked } = await supabase
        .from('bookings')
        .select('court')
        .eq('date', date)
        .overlaps('slots', slots)
        .neq('status', 'Cancelled');

      const bookedSet = new Set((booked ?? []).map((b: { court: number }) => b.court));
      const available = [1, 2, 3, 4, 5, 6].filter((c) => !bookedSet.has(c));

      if (available.length > 0) {
        return { available: true, date, time, durationHours, courts: available, totalPrice: price };
      }

      // Suggest up to 5 alternatives ±3 hours in 30-min increments
      const [y, mo, d] = date.split('-').map(Number);
      const preferred = new Date(y, mo - 1, d, startHour, 0);
      const alts: Array<{ date: string; time: string; courts: number[] }> = [];

      for (const off of [-180, -120, -60, -30, 30, 60, 120, 180]) {
        if (alts.length >= 5) break;
        const alt = new Date(preferred.getTime() + off * 60_000);
        const ah = alt.getHours();
        if (ah < s.open_from || ah + durationHours > s.open_to) continue;

        const altDate = alt.toISOString().slice(0, 10);
        const altTime = `${String(ah).padStart(2, '0')}:00`;
        const { data: altBooked } = await supabase
          .from('bookings')
          .select('court')
          .eq('date', altDate)
          .overlaps('slots', timeToSlots(altTime, durationHours))
          .neq('status', 'Cancelled');

        const altSet = new Set((altBooked ?? []).map((b: { court: number }) => b.court));
        const altCourts = [1, 2, 3, 4, 5, 6].filter((c) => !altSet.has(c));
        if (altCourts.length > 0) alts.push({ date: altDate, time: altTime, courts: altCourts });
      }

      return { available: false, reason: 'all_booked', alternatives: alts };
    },
  });

  const createBooking = tool({
    description: 'Create a booking after the user has confirmed. Always call checkAvailability first.',
    parameters: z.object({
      court: z.number().int().min(1).max(6),
      date: z.string().describe('YYYY-MM-DD'),
      time: z.string().describe('HH:MM 24-hour'),
      durationHours: z.number().int().min(1).max(2),
      numPeople: z.number().int().describe('2 = singles, 4 = doubles'),
      memberName: z.string().optional().describe("Member's name if known from conversation"),
    }),
    execute: async ({ court, date, time, durationHours, numPeople, memberName }) => {
      if (memberName) await upsertMember(phone, memberName);

      const s = await getSettings();
      const ref = generateRef();
      const slots = timeToSlots(time, durationHours);
      const timeLabel = formatTimeLabel(time, durationHours);
      const matchType = numPeople >= 4 ? 'doubles' : 'singles';
      const amount = (numPeople >= 4 ? s.price_doubles : s.price_singles) * durationHours;

      const { data: member } = await supabase
        .from('members')
        .select('name')
        .eq('phone', phone)
        .single();

      const { data, error } = await supabase
        .from('bookings')
        .insert({
          ref,
          phone,
          name: member?.name ?? phone,
          court,
          date,
          time_label: timeLabel,
          slots,
          match_type: matchType,
          amount,
          status: 'Awaiting Payment',
        })
        .select('ref')
        .single();

      if (error) return { error: error.message };

      return {
        ref: data.ref,
        court,
        date,
        timeLabel,
        matchType,
        amount,
        paymentNote: `Pay NPR ${amount} to eSewa (${s.whatsapp ?? '9841044844'}) or FonePay (NTA), then send a screenshot here.`,
      };
    },
  });

  const getUserBookings = tool({
    description: "Get the user's upcoming active bookings.",
    parameters: z.object({}),
    execute: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('bookings')
        .select('ref, court, date, time_label, match_type, amount, status')
        .eq('phone', phone)
        .gte('date', today)
        .neq('status', 'Cancelled')
        .order('date', { ascending: true });
      return { bookings: data ?? [] };
    },
  });

  const cancelBooking = tool({
    description: 'Cancel a booking by ref. Only call after the user has explicitly confirmed.',
    parameters: z.object({
      ref: z.string().describe('Booking ref, e.g. NTA-A1B2-C3D'),
    }),
    execute: async ({ ref }) => {
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'Cancelled' })
        .eq('ref', ref)
        .eq('phone', phone); // scoped to this user only
      return error ? { success: false, error: error.message } : { success: true };
    },
  });

  const getBookingStatus = tool({
    description: 'Get the current status of a booking by ref.',
    parameters: z.object({
      ref: z.string().describe('Booking ref, e.g. NTA-A1B2-C3D'),
    }),
    execute: async ({ ref }) => {
      const { data } = await supabase
        .from('bookings')
        .select('ref, court, date, time_label, match_type, amount, status, ai_checked')
        .eq('ref', ref)
        .single();

      if (!data) return { error: `Booking ${ref} not found.` };

      const summaries: Record<string, string> = {
        'Awaiting Payment': 'Booking created — waiting for your payment screenshot.',
        'Pending Verification': 'Payment received — admin will verify and confirm shortly.',
        'Confirmed': 'Booking confirmed and payment verified!',
        'Cancelled': 'Booking has been cancelled.',
      };

      return { ...data, summary: summaries[data.status] ?? data.status };
    },
  });

  const processPayment = tool({
    description: 'Process a payment screenshot sent by the user. Call this whenever the user sends an image.',
    parameters: z.object({
      ref: z.string().optional().describe('Booking ref — omit to auto-detect the latest awaiting-payment booking.'),
    }),
    execute: async ({ ref }) => {
      if (!mediaUrl) return { error: 'No payment image found in this message.' };

      // Resolve booking
      let bookingRef = ref;
      let expectedAmount: number;
      let bookingId: string;

      if (bookingRef) {
        const { data } = await supabase
          .from('bookings')
          .select('id, amount')
          .eq('ref', bookingRef)
          .eq('phone', phone)
          .single();
        if (!data) return { error: `Booking ${bookingRef} not found.` };
        bookingId = data.id as string;
        expectedAmount = data.amount as number;
      } else {
        const { data } = await supabase
          .from('bookings')
          .select('id, ref, amount')
          .eq('phone', phone)
          .eq('status', 'Awaiting Payment')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (!data) return { error: 'No pending booking found. Please create a booking first.' };
        bookingRef = data.ref as string;
        bookingId = data.id as string;
        expectedAmount = data.amount as number;
      }

      // Download image from Twilio (requires Basic auth)
      const auth =
        'Basic ' +
        Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const imgRes = await fetch(mediaUrl, { headers: { Authorization: auth } });
      if (!imgRes.ok) return { error: 'Failed to download payment image.' };

      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
      const mimeType = imgRes.headers.get('content-type') ?? 'image/jpeg';
      const ext = mimeType.includes('png') ? 'png' : 'jpg';

      // Upload to Supabase Storage so admin can view it in admin.html
      const fileName = `${bookingId}-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('payment-proofs')
        .upload(fileName, imgBuffer, { contentType: mimeType, upsert: true });
      if (uploadErr) return { error: 'Failed to store payment proof.' };

      const {
        data: { publicUrl },
      } = supabase.storage.from('payment-proofs').getPublicUrl(fileName);

      // Use vision to extract payment info for ai_checked flag
      const { text: raw } = await generateText({
        model: openai('gpt-4.1-mini'),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract payment info from this receipt. Return JSON only:\n{"amount":number|null,"transactionId":"string"|null,"paymentMethod":"esewa"|"fonepay"|"khalti"|"bank"|"unknown"}',
              },
              { type: 'image', image: imgBuffer, mimeType },
            ],
          },
        ],
      });

      let extracted: { amount: number | null; paymentMethod: string } = {
        amount: null,
        paymentMethod: 'unknown',
      };
      try {
        const json = raw.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
        extracted = JSON.parse(json);
      } catch {
        // continue with defaults
      }

      const amountOk =
        extracted.amount !== null && Math.abs(extracted.amount - expectedAmount) <= 10;

      await supabase
        .from('bookings')
        .update({ proof_url: publicUrl, ai_checked: amountOk, status: 'Pending Verification' })
        .eq('id', bookingId);

      return {
        ref: bookingRef,
        expectedAmount,
        detectedAmount: extracted.amount,
        paymentMethod: extracted.paymentMethod,
        status: 'Pending Verification',
      };
    },
  });

  const result = await generateText({
    model: openai('gpt-4.1-mini'),
    system: buildSystemPrompt(settings),
    messages: [
      ...history,
      { role: 'user' as const, content: userContent },
    ] as CoreMessage[],
    tools: {
      checkAvailability,
      createBooking,
      getUserBookings,
      cancelBooking,
      getBookingStatus,
      processPayment,
    },
    maxSteps: 7,
    temperature: 0.4,
  });

  await saveHistory(phone, result.steps as StepLike[], userContent);

  return result.text || 'Sorry, something went wrong. Please try again.';
}
