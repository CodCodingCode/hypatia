-- Migration: Create tables for template edit tracking and user preferences persistence
-- Created: 2026-01-17
-- Purpose: Enable database persistence for feedback loop and full edit history tracking

-- Store user preferences learned from template edits
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Subject preferences (vote counts)
  subject_length_short INTEGER DEFAULT 0,
  subject_length_medium INTEGER DEFAULT 0,
  subject_length_long INTEGER DEFAULT 0,
  subject_use_questions INTEGER DEFAULT 0,
  subject_personalization_level INTEGER DEFAULT 0,

  -- Body preferences (vote counts)
  body_length_brief INTEGER DEFAULT 0,
  body_length_medium INTEGER DEFAULT 0,
  body_length_long INTEGER DEFAULT 0,
  body_tone_casual INTEGER DEFAULT 0,
  body_tone_professional INTEGER DEFAULT 0,
  body_tone_formal INTEGER DEFAULT 0,
  body_personalization_level INTEGER DEFAULT 0,
  body_use_bullets INTEGER DEFAULT 0,
  body_simple_language INTEGER DEFAULT 0,

  -- CTA preferences (vote counts)
  cta_strength_soft INTEGER DEFAULT 0,
  cta_strength_medium INTEGER DEFAULT 0,
  cta_strength_strong INTEGER DEFAULT 0,

  -- Metadata
  confidence_score FLOAT DEFAULT 0.0,
  total_edits_analyzed INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Store complete history of template edits
CREATE TABLE IF NOT EXISTS template_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT,

  -- Original template (before edit)
  original_subject TEXT,
  original_body TEXT,

  -- Edited template (after edit)
  edited_subject TEXT,
  edited_body TEXT,

  -- Edit analysis (full EditAnalysis JSON from feedback_loop.py)
  edit_analysis JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_template_edits_user_id ON template_edits(user_id);
CREATE INDEX IF NOT EXISTS idx_template_edits_template_id ON template_edits(template_id);
CREATE INDEX IF NOT EXISTS idx_template_edits_created_at ON template_edits(created_at);
CREATE INDEX IF NOT EXISTS idx_template_edits_campaign_id ON template_edits(campaign_id) WHERE campaign_id IS NOT NULL;

-- Comments for documentation
COMMENT ON TABLE user_preferences IS 'Stores learned user preferences from template edits. Used to personalize future template generation.';
COMMENT ON TABLE template_edits IS 'Complete audit trail of all template edits with before/after text and analysis.';
COMMENT ON COLUMN user_preferences.confidence_score IS 'Confidence level (0-1) based on number of edits analyzed. Calculated as min(total_edits_analyzed / 5, 1.0)';
COMMENT ON COLUMN template_edits.edit_analysis IS 'JSON object containing detailed analysis of what changed (length, tone, personalization, etc.)';
