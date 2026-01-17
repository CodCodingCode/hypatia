-- Migration: Replace generated_ctas with generated_cadence
-- Run this in Supabase SQL Editor AFTER create_ai_generated_tables.sql

-- ============================================================================
-- DROP GENERATED_CTAS TABLE
-- ============================================================================

-- First drop policies
DROP POLICY IF EXISTS "Users can view their own CTAs" ON generated_ctas;
DROP POLICY IF EXISTS "Users can insert their own CTAs" ON generated_ctas;
DROP POLICY IF EXISTS "Users can update their own CTAs" ON generated_ctas;
DROP POLICY IF EXISTS "Users can delete their own CTAs" ON generated_ctas;

-- Drop indexes
DROP INDEX IF EXISTS idx_generated_ctas_user_id;
DROP INDEX IF EXISTS idx_generated_ctas_campaign_id;

-- Revoke permissions
REVOKE ALL ON generated_ctas FROM anon;

-- Drop the table
DROP TABLE IF EXISTS generated_ctas;


-- ============================================================================
-- GENERATED CADENCE TABLE
-- Stores AI-generated email sequences (initial + follow-ups)
-- ============================================================================

CREATE TABLE IF NOT EXISTS generated_cadence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- References
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

    -- Cadence data
    day_number INTEGER NOT NULL,          -- 1, 3, 7, 14 (or custom)
    email_type TEXT NOT NULL,             -- 'initial', 'followup_1', 'followup_2', 'followup_3'
    subject TEXT NOT NULL,
    body TEXT NOT NULL,

    -- Metadata
    tone_guidance TEXT,                   -- e.g., "Gentle reminder", "Add value", "Final attempt"

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One entry per day per campaign
    UNIQUE(campaign_id, day_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_generated_cadence_user_id ON generated_cadence(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_cadence_campaign_id ON generated_cadence(campaign_id);

-- Enable RLS
ALTER TABLE generated_cadence ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own cadence"
    ON generated_cadence FOR SELECT
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can insert their own cadence"
    ON generated_cadence FOR INSERT
    WITH CHECK (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can update their own cadence"
    ON generated_cadence FOR UPDATE
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can delete their own cadence"
    ON generated_cadence FOR DELETE
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_generated_cadence_updated_at ON generated_cadence;
CREATE TRIGGER update_generated_cadence_updated_at
    BEFORE UPDATE ON generated_cadence
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON generated_cadence TO anon;
