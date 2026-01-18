-- Add tracking columns to sent_emails table for follow-up and reply detection
-- Migration: add_sent_emails_tracking_columns.sql

-- Add is_followup column to distinguish original emails from follow-ups
ALTER TABLE sent_emails
ADD COLUMN IF NOT EXISTS is_followup BOOLEAN DEFAULT false;

-- Add reply tracking columns
ALTER TABLE sent_emails
ADD COLUMN IF NOT EXISTS reply_detected_at TIMESTAMPTZ;

ALTER TABLE sent_emails
ADD COLUMN IF NOT EXISTS reply_gmail_id TEXT;

-- Add parent_email_id for linking follow-ups to original emails
ALTER TABLE sent_emails
ADD COLUMN IF NOT EXISTS parent_email_id UUID REFERENCES sent_emails(id) ON DELETE SET NULL;

-- Create index for faster follow-up queries
CREATE INDEX IF NOT EXISTS idx_sent_emails_is_followup ON sent_emails(is_followup);
CREATE INDEX IF NOT EXISTS idx_sent_emails_parent_email_id ON sent_emails(parent_email_id);

-- Comment the columns
COMMENT ON COLUMN sent_emails.is_followup IS 'True if this email is a follow-up, false if it is an original email';
COMMENT ON COLUMN sent_emails.reply_detected_at IS 'Timestamp when a reply was detected for this email';
COMMENT ON COLUMN sent_emails.reply_gmail_id IS 'Gmail message ID of the detected reply';
COMMENT ON COLUMN sent_emails.parent_email_id IS 'Reference to the original email if this is a follow-up';
