# Hypatia Onboarding Plan

## Goal

Identify **mass outreach campaigns** from a user's sent emails to understand their communication patterns and help them write better emails faster.

## What We're Looking For

**Cold outreach campaigns** - when a user sends similar templated emails to multiple different recipients. Examples:
- Sales prospecting emails
- Networking/intro request emails
- Job application emails
- Newsletter-style updates to contacts

**NOT what we're looking for:**
- Reply chains (Re: emails) - these are conversations, not campaigns
- Follow-ups within the same thread - this is depth, not breadth
- Forwards (Fwd: emails)

## Onboarding Flow

### 1. User Authentication
- User clicks "Hypatia" button in Gmail
- OAuth flow authenticates with Google
- User account created/retrieved in Supabase

### 2. Parallel Processing
Two things happen simultaneously:
- **Frontend**: User fills out questionnaire (name, purpose, user type, referral source)
- **Backend**: Fetches and analyzes emails

### 3. Email Fetching
- Fetch up to **200 most recent sent emails** from Gmail API
- Store all emails in Supabase `sent_emails` table

### 4. Campaign Clustering
Filter emails to find only **original cold outreach**:
1. **Skip replies** - Remove emails with "Re:", "Fwd:", "Fw:" prefixes
2. **Skip thread duplicates** - Keep only the first email per thread_id (the original outreach)
3. **Cluster by similarity** - Group remaining emails by subject + body similarity (60% threshold)
4. **Filter single-email clusters** - Only keep campaigns with 2+ emails

### 5. Results
- Show user their identified campaigns
- Each campaign represents a type of outreach they do regularly
- Display: email count, representative subject, recipient, similarity score

## Data Model

```
users
  └── sent_emails (all 200 emails stored)
        └── email_campaigns (junction table)
              └── campaigns (grouped outreach patterns)
```

## Key Insight

The value is in finding **patterns of mass outreach**:
- "You sent 15 similar intro request emails"
- "You have a recurring sales pitch template"
- "Your networking emails follow this pattern"

This helps Hypatia learn the user's writing style for different contexts.
