-- Migration 006: Add conversation_history table for WhatsApp bot context
-- Safe to re-run — uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS conversation_history (
  id         BIGSERIAL    PRIMARY KEY,
  phone      TEXT         NOT NULL,
  role       TEXT         NOT NULL,  -- 'user' | 'assistant' | 'tool'
  content    TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_history_phone
  ON conversation_history (phone, created_at DESC);

ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all_conv_history" ON conversation_history;

-- Only the service role (bot) can read/write conversation history
CREATE POLICY "service_all_conv_history" ON conversation_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);
