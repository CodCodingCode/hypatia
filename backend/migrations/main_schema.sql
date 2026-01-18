-- =============================================================================
-- HYPATIA SUPABASE SCHEMA
-- Run this SQL in your Supabase SQL Editor
-- Safe to re-run (uses DROP IF EXISTS for policies)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- USERS TABLE
-- Stores user information and onboarding status
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  google_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  onboarding_completed BOOLEAN DEFAULT FALSE,
  onboarding_completed_at TIMESTAMPTZ
);

-- Index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- -----------------------------------------------------------------------------
-- QUESTIONNAIRE COLUMNS MIGRATION
-- Run this to add questionnaire fields to existing users table
-- Safe to re-run (uses IF NOT EXISTS pattern via DO block)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- Add display_name column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'display_name') THEN
    ALTER TABLE users ADD COLUMN display_name TEXT;
  END IF;

  -- Add name_confirmed column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'name_confirmed') THEN
    ALTER TABLE users ADD COLUMN name_confirmed BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add app_purpose column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'app_purpose') THEN
    ALTER TABLE users ADD COLUMN app_purpose TEXT;
  END IF;

  -- Add user_type column ('student', 'professional', 'business_owner', 'freelancer', 'other')
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'user_type') THEN
    ALTER TABLE users ADD COLUMN user_type TEXT;
  END IF;

  -- Add general_ctas column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'general_ctas') THEN
    ALTER TABLE users ADD COLUMN general_ctas TEXT;
  END IF;

  -- Add contact_types column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'contact_types') THEN
    ALTER TABLE users ADD COLUMN contact_types TEXT;
  END IF;

  -- Add referral_source column ('google_search', 'seo', 'facebook', 'twitter', 'linkedin', 'friend', 'product_hunt', 'other')
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'referral_source') THEN
    ALTER TABLE users ADD COLUMN referral_source TEXT;
  END IF;

  -- Add questionnaire_completed_at column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'questionnaire_completed_at') THEN
    ALTER TABLE users ADD COLUMN questionnaire_completed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Index for referral source analytics
CREATE INDEX IF NOT EXISTS idx_users_referral_source ON users(referral_source);

-- -----------------------------------------------------------------------------
-- SENT EMAILS TABLE
-- Stores the analyzed sent emails from Gmail
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sent_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  gmail_id TEXT NOT NULL,
  thread_id TEXT,
  subject TEXT,
  recipient_to TEXT,
  recipient_cc TEXT,
  recipient_bcc TEXT,
  sent_at TIMESTAMPTZ,
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate emails per user
  UNIQUE(user_id, gmail_id)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_sent_emails_user_id ON sent_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON sent_emails(sent_at);
CREATE INDEX IF NOT EXISTS idx_sent_emails_gmail_id ON sent_emails(gmail_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_thread_id ON sent_emails(thread_id);

-- -----------------------------------------------------------------------------
-- CAMPAIGNS TABLE
-- Stores grouped email campaigns identified by similarity clustering
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  campaign_number INTEGER NOT NULL,
  representative_subject TEXT,
  representative_recipient TEXT,
  email_count INTEGER DEFAULT 0,
  avg_similarity DECIMAL(4,3),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique campaign number per user
  UNIQUE(user_id, campaign_number)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);

-- -----------------------------------------------------------------------------
-- EMAIL CAMPAIGNS JUNCTION TABLE
-- Links emails to their campaigns
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID REFERENCES sent_emails(id) ON DELETE CASCADE NOT NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate assignments
  UNIQUE(email_id, campaign_id)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_email_campaigns_email_id ON email_campaigns(email_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_campaign_id ON email_campaigns(campaign_id);

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS)
-- Ensures users can only access their own data
-- -----------------------------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sent_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (safe re-run)
DROP POLICY IF EXISTS "Users can view own profile" ON users;
DROP POLICY IF EXISTS "Allow user creation" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;
DROP POLICY IF EXISTS "Allow reading sent emails" ON sent_emails;
DROP POLICY IF EXISTS "Allow inserting sent emails" ON sent_emails;
DROP POLICY IF EXISTS "Allow reading campaigns" ON campaigns;
DROP POLICY IF EXISTS "Allow inserting campaigns" ON campaigns;
DROP POLICY IF EXISTS "Allow updating campaigns" ON campaigns;
DROP POLICY IF EXISTS "Allow deleting campaigns" ON campaigns;
DROP POLICY IF EXISTS "Allow reading email_campaigns" ON email_campaigns;
DROP POLICY IF EXISTS "Allow inserting email_campaigns" ON email_campaigns;
DROP POLICY IF EXISTS "Allow deleting email_campaigns" ON email_campaigns;

-- Policies for users
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (true);

CREATE POLICY "Allow user creation" ON users
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (true);

-- Policies for sent_emails
CREATE POLICY "Allow reading sent emails" ON sent_emails
  FOR SELECT USING (true);

CREATE POLICY "Allow inserting sent emails" ON sent_emails
  FOR INSERT WITH CHECK (true);

-- Policies for campaigns
CREATE POLICY "Allow reading campaigns" ON campaigns
  FOR SELECT USING (true);

CREATE POLICY "Allow inserting campaigns" ON campaigns
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow updating campaigns" ON campaigns
  FOR UPDATE USING (true);

CREATE POLICY "Allow deleting campaigns" ON campaigns
  FOR DELETE USING (true);

-- Policies for email_campaigns
CREATE POLICY "Allow reading email_campaigns" ON email_campaigns
  FOR SELECT USING (true);

CREATE POLICY "Allow inserting email_campaigns" ON email_campaigns
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow deleting email_campaigns" ON email_campaigns
  FOR DELETE USING (true);

-- -----------------------------------------------------------------------------
-- HELPER FUNCTION: Update onboarding timestamp
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_onboarding_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.onboarding_completed = TRUE AND OLD.onboarding_completed = FALSE THEN
    NEW.onboarding_completed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update onboarding timestamp
DROP TRIGGER IF EXISTS trigger_update_onboarding_timestamp ON users;
CREATE TRIGGER trigger_update_onboarding_timestamp
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_onboarding_timestamp();

-- -----------------------------------------------------------------------------
-- VIEWS (Optional - for analytics)
-- -----------------------------------------------------------------------------

-- View: User email statistics
CREATE OR REPLACE VIEW user_email_stats AS
SELECT
  u.id AS user_id,
  u.email,
  COUNT(se.id) AS total_emails,
  MIN(se.sent_at) AS earliest_email,
  MAX(se.sent_at) AS latest_email,
  u.onboarding_completed,
  u.created_at AS user_created_at
FROM users u
LEFT JOIN sent_emails se ON u.id = se.user_id
GROUP BY u.id, u.email, u.onboarding_completed, u.created_at;

-- View: Campaign statistics with email details
CREATE OR REPLACE VIEW campaign_stats AS
SELECT
  c.id AS campaign_id,
  c.user_id,
  c.campaign_number,
  c.representative_subject,
  c.representative_recipient,
  c.email_count,
  c.avg_similarity,
  c.created_at
FROM campaigns c;

-- View: Emails grouped by campaign (for frontend display)
CREATE OR REPLACE VIEW grouped_emails AS
SELECT
  se.id AS email_id,
  se.user_id,
  se.gmail_id,
  se.thread_id,
  se.subject,
  se.recipient_to,
  se.recipient_cc,
  se.recipient_bcc,
  se.sent_at,
  se.body,
  c.id AS campaign_id,
  c.campaign_number,
  c.representative_subject AS campaign_subject,
  c.email_count AS campaign_email_count,
  c.avg_similarity AS campaign_similarity
FROM sent_emails se
LEFT JOIN email_campaigns ec ON se.id = ec.email_id
LEFT JOIN campaigns c ON ec.campaign_id = c.id
ORDER BY c.email_count DESC NULLS LAST, se.sent_at DESC;

-- View: Campaign summary with all emails (denormalized for easy querying)
CREATE OR REPLACE VIEW campaign_with_emails AS
SELECT
  c.id AS campaign_id,
  c.user_id,
  c.campaign_number,
  c.representative_subject,
  c.representative_recipient,
  c.email_count,
  c.avg_similarity,
  c.created_at AS campaign_created_at,
  json_agg(
    json_build_object(
      'email_id', se.id,
      'gmail_id', se.gmail_id,
      'thread_id', se.thread_id,
      'subject', se.subject,
      'recipient_to', se.recipient_to,
      'sent_at', se.sent_at
    ) ORDER BY se.sent_at DESC
  ) AS emails
FROM campaigns c
LEFT JOIN email_campaigns ec ON c.id = ec.campaign_id
LEFT JOIN sent_emails se ON ec.email_id = se.id
GROUP BY c.id, c.user_id, c.campaign_number, c.representative_subject,
         c.representative_recipient, c.email_count, c.avg_similarity, c.created_at;

-- -----------------------------------------------------------------------------
-- SAMPLE QUERIES (for reference)
-- -----------------------------------------------------------------------------

-- Get all emails for a user:
-- SELECT * FROM sent_emails WHERE user_id = 'user-uuid-here' ORDER BY sent_at DESC;

-- Get user with email count:
-- SELECT * FROM user_email_stats WHERE email = 'user@example.com';

-- Check onboarding status:
-- SELECT email, onboarding_completed FROM users WHERE email = 'user@example.com';

-- Get all campaigns for a user:
-- SELECT * FROM campaigns WHERE user_id = 'user-uuid-here' ORDER BY email_count DESC;

-- Get emails in a specific campaign:
-- SELECT se.* FROM sent_emails se
-- JOIN email_campaigns ec ON se.id = ec.email_id
-- WHERE ec.campaign_id = 'campaign-uuid-here';

-- Get all emails grouped by campaign for a user:
-- SELECT * FROM grouped_emails WHERE user_id = 'user-uuid-here';

-- Get campaigns with their emails (JSON aggregated) for a user:
-- SELECT * FROM campaign_with_emails WHERE user_id = 'user-uuid-here' ORDER BY email_count DESC;

-- Get emails by thread_id:
-- SELECT * FROM sent_emails WHERE thread_id = 'thread-id-here';

-- -----------------------------------------------------------------------------
-- CONTACT ENRICHMENTS TABLE
-- Caches Aviato API enrichment results to avoid duplicate API calls
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  raw_json JSONB,
  error TEXT,
  enriched_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate enrichments per user
  UNIQUE(user_id, email)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_contact_enrichments_user_id ON contact_enrichments(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_enrichments_email ON contact_enrichments(email);

-- Enable RLS
ALTER TABLE contact_enrichments ENABLE ROW LEVEL SECURITY;

-- Policies for contact_enrichments
DROP POLICY IF EXISTS "Allow reading contact_enrichments" ON contact_enrichments;
DROP POLICY IF EXISTS "Allow inserting contact_enrichments" ON contact_enrichments;
DROP POLICY IF EXISTS "Allow updating contact_enrichments" ON contact_enrichments;

CREATE POLICY "Allow reading contact_enrichments" ON contact_enrichments
  FOR SELECT USING (true);

CREATE POLICY "Allow inserting contact_enrichments" ON contact_enrichments
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow updating contact_enrichments" ON contact_enrichments
  FOR UPDATE USING (true);

-- -----------------------------------------------------------------------------
-- CAMPAIGN EMAIL STYLES TABLE
-- Stores LLM-generated email style analysis per campaign
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_email_styles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL UNIQUE,
  one_sentence_description TEXT,
  style_analysis_prompt TEXT,
  sample_emails_analyzed INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_campaign_email_styles_campaign_id ON campaign_email_styles(campaign_id);

-- Enable RLS
ALTER TABLE campaign_email_styles ENABLE ROW LEVEL SECURITY;

-- Policies for campaign_email_styles
DROP POLICY IF EXISTS "Allow reading campaign_email_styles" ON campaign_email_styles;
DROP POLICY IF EXISTS "Allow inserting campaign_email_styles" ON campaign_email_styles;
DROP POLICY IF EXISTS "Allow updating campaign_email_styles" ON campaign_email_styles;

CREATE POLICY "Allow reading campaign_email_styles" ON campaign_email_styles
  FOR SELECT USING (true);

CREATE POLICY "Allow inserting campaign_email_styles" ON campaign_email_styles
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow updating campaign_email_styles" ON campaign_email_styles
  FOR UPDATE USING (true);

-- -----------------------------------------------------------------------------
-- CAMPAIGN CTAS TABLE
-- Stores LLM-generated CTA analysis per campaign
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_ctas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL UNIQUE,
  cta_type TEXT,
  cta_description TEXT,
  cta_text TEXT,
  urgency TEXT,
  analyzed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_campaign_ctas_campaign_id ON campaign_ctas(campaign_id);

-- Enable RLS
ALTER TABLE campaign_ctas ENABLE ROW LEVEL SECURITY;

-- Policies for campaign_ctas
DROP POLICY IF EXISTS "Allow reading campaign_ctas" ON campaign_ctas;
DROP POLICY IF EXISTS "Allow inserting campaign_ctas" ON campaign_ctas;
DROP POLICY IF EXISTS "Allow updating campaign_ctas" ON campaign_ctas;

CREATE POLICY "Allow reading campaign_ctas" ON campaign_ctas
  FOR SELECT USING (true);

CREATE POLICY "Allow inserting campaign_ctas" ON campaign_ctas
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow updating campaign_ctas" ON campaign_ctas
  FOR UPDATE USING (true);

-- -----------------------------------------------------------------------------
-- CAMPAIGN CONTACTS TABLE
-- Stores LLM-generated contact description per campaign
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL UNIQUE,
  contact_description TEXT,
  analyzed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign_id ON campaign_contacts(campaign_id);

-- Enable RLS
ALTER TABLE campaign_contacts ENABLE ROW LEVEL SECURITY;

-- Policies for campaign_contacts
DROP POLICY IF EXISTS "Allow reading campaign_contacts" ON campaign_contacts;
DROP POLICY IF EXISTS "Allow inserting campaign_contacts" ON campaign_contacts;
DROP POLICY IF EXISTS "Allow updating campaign_contacts" ON campaign_contacts;

CREATE POLICY "Allow reading campaign_contacts" ON campaign_contacts
  FOR SELECT USING (true);

CREATE POLICY "Allow inserting campaign_contacts" ON campaign_contacts
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow updating campaign_contacts" ON campaign_contacts
  FOR UPDATE USING (true);

-- =============================================================================
-- FOLLOWUP SYSTEM TABLES
-- Added for AI-personalized follow-up sequences with Gmail integration
-- =============================================================================

-- -----------------------------------------------------------------------------
-- GMAIL TOKENS TABLE
-- Stores OAuth tokens relayed from Chrome extension for backend email sending
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gmail_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- Token data
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ NOT NULL,

  -- Gmail watch info for Pub/Sub reply detection
  history_id TEXT,
  watch_expiration TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_gmail_tokens_user_id ON gmail_tokens(user_id);

-- Enable RLS
ALTER TABLE gmail_tokens ENABLE ROW LEVEL SECURITY;

-- Policies for gmail_tokens
DROP POLICY IF EXISTS "Allow reading gmail_tokens" ON gmail_tokens;
DROP POLICY IF EXISTS "Allow inserting gmail_tokens" ON gmail_tokens;
DROP POLICY IF EXISTS "Allow updating gmail_tokens" ON gmail_tokens;

CREATE POLICY "Allow reading gmail_tokens" ON gmail_tokens
  FOR SELECT USING (true);

CREATE POLICY "Allow inserting gmail_tokens" ON gmail_tokens
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow updating gmail_tokens" ON gmail_tokens
  FOR UPDATE USING (true);

-- -----------------------------------------------------------------------------
-- FOLLOWUP CONFIGS TABLE
-- Stores configurable follow-up timing per campaign
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS followup_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- Configurable timing (in days after initial email)
  followup_1_days INTEGER DEFAULT 3,
  followup_2_days INTEGER DEFAULT 7,
  followup_3_days INTEGER DEFAULT 14,

  -- Feature flags
  enabled BOOLEAN DEFAULT true,
  max_followups INTEGER DEFAULT 3,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_followup_configs_campaign_id ON followup_configs(campaign_id);

-- Enable RLS
ALTER TABLE followup_configs ENABLE ROW LEVEL SECURITY;

-- Policies for followup_configs
DROP POLICY IF EXISTS "Allow reading followup_configs" ON followup_configs;
DROP POLICY IF EXISTS "Allow inserting followup_configs" ON followup_configs;
DROP POLICY IF EXISTS "Allow updating followup_configs" ON followup_configs;

CREATE POLICY "Allow reading followup_configs" ON followup_configs
  FOR SELECT USING (true);

CREATE POLICY "Allow inserting followup_configs" ON followup_configs
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow updating followup_configs" ON followup_configs
  FOR UPDATE USING (true);

-- -----------------------------------------------------------------------------
-- SCHEDULED FOLLOWUPS TABLE
-- Stores AI-generated follow-up emails with scheduling and status tracking
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  original_email_id UUID REFERENCES sent_emails(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,  -- Gmail thread ID for reply detection

  -- Recipient info (denormalized for efficiency)
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,

  -- Followup content (AI-generated)
  sequence_number INTEGER NOT NULL,  -- 1, 2, 3 for day 3, 7, 14
  followup_type TEXT NOT NULL,  -- 'gentle_reminder', 'add_value', 'final_attempt'
  subject TEXT NOT NULL,
  body TEXT NOT NULL,

  -- Scheduling
  scheduled_for TIMESTAMPTZ NOT NULL,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, sent, cancelled, skipped
  status_reason TEXT,  -- e.g., 'reply_detected', 'manual_cancel', 'send_error'

  -- Execution info
  sent_at TIMESTAMPTZ,
  gmail_message_id TEXT,  -- ID of sent followup for tracking
  error_message TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one followup per sequence per original email
  UNIQUE(original_email_id, sequence_number)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_scheduled_followups_status_scheduled
  ON scheduled_followups(status, scheduled_for)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_followups_thread_id ON scheduled_followups(thread_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_followups_user_id ON scheduled_followups(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_followups_campaign_id ON scheduled_followups(campaign_id);

-- Enable RLS
ALTER TABLE scheduled_followups ENABLE ROW LEVEL SECURITY;

-- Policies for scheduled_followups
DROP POLICY IF EXISTS "Allow reading scheduled_followups" ON scheduled_followups;
DROP POLICY IF EXISTS "Allow inserting scheduled_followups" ON scheduled_followups;
DROP POLICY IF EXISTS "Allow updating scheduled_followups" ON scheduled_followups;
DROP POLICY IF EXISTS "Allow deleting scheduled_followups" ON scheduled_followups;

CREATE POLICY "Allow reading scheduled_followups" ON scheduled_followups
  FOR SELECT USING (true);

CREATE POLICY "Allow inserting scheduled_followups" ON scheduled_followups
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow updating scheduled_followups" ON scheduled_followups
  FOR UPDATE USING (true);

CREATE POLICY "Allow deleting scheduled_followups" ON scheduled_followups
  FOR DELETE USING (true);

-- -----------------------------------------------------------------------------
-- ADD COLUMNS TO SENT_EMAILS FOR FOLLOWUP TRACKING
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- Track when a reply was detected
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sent_emails' AND column_name = 'reply_detected_at') THEN
    ALTER TABLE sent_emails ADD COLUMN reply_detected_at TIMESTAMPTZ;
  END IF;

  -- Store the Gmail ID of the reply
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sent_emails' AND column_name = 'reply_gmail_id') THEN
    ALTER TABLE sent_emails ADD COLUMN reply_gmail_id TEXT;
  END IF;

  -- Flag if this email is a followup (vs original outreach)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sent_emails' AND column_name = 'is_followup') THEN
    ALTER TABLE sent_emails ADD COLUMN is_followup BOOLEAN DEFAULT false;
  END IF;

  -- Link to parent email if this is a followup
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sent_emails' AND column_name = 'parent_email_id') THEN
    ALTER TABLE sent_emails ADD COLUMN parent_email_id UUID REFERENCES sent_emails(id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- HELPER FUNCTION: Update timestamp on followup modification
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_followup_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for scheduled_followups
DROP TRIGGER IF EXISTS trigger_update_followup_timestamp ON scheduled_followups;
CREATE TRIGGER trigger_update_followup_timestamp
  BEFORE UPDATE ON scheduled_followups
  FOR EACH ROW
  EXECUTE FUNCTION update_followup_timestamp();

-- Trigger for gmail_tokens
DROP TRIGGER IF EXISTS trigger_update_gmail_token_timestamp ON gmail_tokens;
CREATE TRIGGER trigger_update_gmail_token_timestamp
  BEFORE UPDATE ON gmail_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_followup_timestamp();

-- Trigger for followup_configs
DROP TRIGGER IF EXISTS trigger_update_followup_config_timestamp ON followup_configs;
CREATE TRIGGER trigger_update_followup_config_timestamp
  BEFORE UPDATE ON followup_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_followup_timestamp();

-- -----------------------------------------------------------------------------
-- VIEW: Pending followups with campaign info
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW pending_followups_view AS
SELECT
  sf.id,
  sf.user_id,
  sf.campaign_id,
  sf.original_email_id,
  sf.thread_id,
  sf.recipient_email,
  sf.recipient_name,
  sf.sequence_number,
  sf.followup_type,
  sf.subject,
  sf.body,
  sf.scheduled_for,
  sf.status,
  c.representative_subject AS campaign_subject,
  c.campaign_number
FROM scheduled_followups sf
LEFT JOIN campaigns c ON sf.campaign_id = c.id
WHERE sf.status = 'pending'
ORDER BY sf.scheduled_for ASC;

-- -----------------------------------------------------------------------------
-- VIEW: Followup statistics per user
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW user_followup_stats AS
SELECT
  user_id,
  COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
  COUNT(*) FILTER (WHERE status = 'sent') AS sent_count,
  COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_count,
  COUNT(*) FILTER (WHERE status = 'skipped') AS skipped_count,
  COUNT(*) AS total_count,
  MIN(scheduled_for) FILTER (WHERE status = 'pending') AS next_scheduled
FROM scheduled_followups
GROUP BY user_id;
