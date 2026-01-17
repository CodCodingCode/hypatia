-- Migration: Create tables for AI-generated content storage
-- Tables: generated_leads, generated_templates, generated_ctas
-- Run this in Supabase SQL Editor

-- ============================================================================
-- GENERATED LEADS TABLE
-- Stores AI-generated leads from PeopleFinderAgent
-- ============================================================================

CREATE TABLE IF NOT EXISTS generated_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- References
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,

    -- Query that generated this lead
    generation_query TEXT,

    -- Lead data
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    full_name TEXT,
    title TEXT,
    company TEXT,
    location TEXT,
    linkedin_url TEXT,

    -- Metadata
    source TEXT DEFAULT 'aviato',  -- 'aviato' | 'clado' | 'manual'
    raw_json JSONB,                -- Full API response for debugging

    -- Status tracking
    status TEXT DEFAULT 'new',     -- 'new' | 'contacted' | 'replied' | 'archived'
    contacted_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Prevent duplicate leads per user per campaign
    UNIQUE(user_id, email, campaign_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_generated_leads_user_id ON generated_leads(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_leads_campaign_id ON generated_leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_generated_leads_email ON generated_leads(email);
CREATE INDEX IF NOT EXISTS idx_generated_leads_status ON generated_leads(status);
CREATE INDEX IF NOT EXISTS idx_generated_leads_created_at ON generated_leads(created_at DESC);

-- Enable RLS
ALTER TABLE generated_leads ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own leads
CREATE POLICY "Users can view their own leads"
    ON generated_leads FOR SELECT
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can insert their own leads"
    ON generated_leads FOR INSERT
    WITH CHECK (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can update their own leads"
    ON generated_leads FOR UPDATE
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can delete their own leads"
    ON generated_leads FOR DELETE
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');


-- ============================================================================
-- GENERATED TEMPLATES TABLE
-- Stores AI-generated email templates from DebateOrchestrator
-- ============================================================================

CREATE TABLE IF NOT EXISTS generated_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- References
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

    -- Template content
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    placeholders JSONB DEFAULT '[]',  -- ["first_name", "company", etc.]

    -- Generation context (for debugging/iteration)
    cta_used TEXT,
    style_prompt_used TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- One template per campaign (upsert on regenerate)
    UNIQUE(campaign_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_generated_templates_user_id ON generated_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_templates_campaign_id ON generated_templates(campaign_id);

-- Enable RLS
ALTER TABLE generated_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own templates"
    ON generated_templates FOR SELECT
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can insert their own templates"
    ON generated_templates FOR INSERT
    WITH CHECK (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can update their own templates"
    ON generated_templates FOR UPDATE
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can delete their own templates"
    ON generated_templates FOR DELETE
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');


-- ============================================================================
-- GENERATED CTAS TABLE
-- Stores AI-generated CTA suggestions
-- ============================================================================

CREATE TABLE IF NOT EXISTS generated_ctas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- References
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

    -- CTA data
    cta_index INTEGER NOT NULL DEFAULT 0,  -- Order in the list (0, 1, 2)
    title TEXT NOT NULL,
    description TEXT NOT NULL,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Multiple CTAs per campaign, but unique by index
    UNIQUE(campaign_id, cta_index)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_generated_ctas_user_id ON generated_ctas(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_ctas_campaign_id ON generated_ctas(campaign_id);

-- Enable RLS
ALTER TABLE generated_ctas ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own CTAs"
    ON generated_ctas FOR SELECT
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can insert their own CTAs"
    ON generated_ctas FOR INSERT
    WITH CHECK (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can update their own CTAs"
    ON generated_ctas FOR UPDATE
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');

CREATE POLICY "Users can delete their own CTAs"
    ON generated_ctas FOR DELETE
    USING (auth.uid()::text = user_id::text OR auth.role() = 'service_role');


-- ============================================================================
-- UPDATE TRIGGER FOR updated_at
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for generated_leads
DROP TRIGGER IF EXISTS update_generated_leads_updated_at ON generated_leads;
CREATE TRIGGER update_generated_leads_updated_at
    BEFORE UPDATE ON generated_leads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for generated_templates
DROP TRIGGER IF EXISTS update_generated_templates_updated_at ON generated_templates;
CREATE TRIGGER update_generated_templates_updated_at
    BEFORE UPDATE ON generated_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================================
-- GRANT PERMISSIONS (for anon key access via REST API)
-- ============================================================================

-- Allow the anon role to access these tables via REST API
GRANT SELECT, INSERT, UPDATE, DELETE ON generated_leads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON generated_templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON generated_ctas TO anon;

-- Grant usage on sequences if any
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon;
