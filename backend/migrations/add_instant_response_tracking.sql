-- Add instant_respond_enabled column to sent_emails table
-- This tracks which emails should trigger instant AI auto-responses when recipients reply

ALTER TABLE sent_emails
ADD COLUMN IF NOT EXISTS instant_respond_enabled BOOLEAN DEFAULT FALSE;

-- Create index for fast lookups when checking if a thread should trigger instant response
-- Using thread_id instead of recipient_to since that's what we'll query on
CREATE INDEX IF NOT EXISTS idx_sent_emails_instant_respond
ON sent_emails(thread_id, instant_respond_enabled)
WHERE instant_respond_enabled = TRUE;

-- Add comment to document the column
COMMENT ON COLUMN sent_emails.instant_respond_enabled IS 'When true, AI will automatically generate and send a response when the recipient replies to this email';
