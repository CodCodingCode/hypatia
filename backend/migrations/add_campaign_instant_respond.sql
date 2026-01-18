-- Add instant_respond_enabled column to campaigns table
-- This enables auto-responses for all emails sent in this campaign

ALTER TABLE campaigns
ADD COLUMN IF NOT EXISTS instant_respond_enabled BOOLEAN DEFAULT FALSE;

-- Create index for fast lookups when checking if a campaign should trigger instant response
CREATE INDEX IF NOT EXISTS idx_campaigns_instant_respond
ON campaigns(id, instant_respond_enabled)
WHERE instant_respond_enabled = TRUE;

-- Add comment to document the column
COMMENT ON COLUMN campaigns.instant_respond_enabled IS 'When true, AI will automatically generate and send responses when recipients reply to ANY email in this campaign';
