-- Members
CREATE TABLE public.members (
  phone         TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  nationality   TEXT NOT NULL DEFAULT 'np',
  is_ranked     BOOLEAN NOT NULL DEFAULT false,
  is_verified   BOOLEAN NOT NULL DEFAULT false,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bookings
CREATE TABLE public.bookings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref         TEXT UNIQUE NOT NULL,
  phone       TEXT NOT NULL,
  name        TEXT NOT NULL,
  court       INTEGER NOT NULL CHECK (court BETWEEN 1 AND 6),
  date        DATE NOT NULL,
  time_label  TEXT NOT NULL,
  slots       INTEGER[] NOT NULL,
  match_type  TEXT NOT NULL CHECK (match_type IN ('singles','doubles')),
  amount      INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'Pending Payment',
  proof_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookings_date   ON public.bookings(date);
CREATE INDEX idx_bookings_status ON public.bookings(status);
CREATE INDEX idx_bookings_ref    ON public.bookings(ref);

-- RLS (Edge Functions use service_role and bypass these, but useful for direct REST)
ALTER TABLE public.members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_members"  ON public.members  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select_bookings" ON public.bookings FOR SELECT TO anon USING (true);

-- Storage bucket for payment proofs
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('payment-proofs', 'payment-proofs', true, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "anon_upload_proofs" ON storage.objects
  FOR INSERT TO anon WITH CHECK (bucket_id = 'payment-proofs');

CREATE POLICY "public_read_proofs" ON storage.objects
  FOR SELECT TO anon USING (bucket_id = 'payment-proofs');
