# Hypatia - How It Works

## Overview

Hypatia is an email analysis tool that learns your communication patterns from Gmail to help you write better emails faster. It identifies **mass outreach campaigns** from your sent emails.

---

## Current Implementation

### 1. Email Collection (`main.py`)

Authenticates with Gmail via OAuth and fetches sent emails.

**Flow:**
1. User authenticates via Google OAuth (requires `credentials.json` from Google Cloud Console)
2. Credentials stored in `token.json` for future sessions
3. Fetches up to **200 most recent sent emails** from Gmail
4. Extracts: subject, to/cc/bcc, date, body
5. Saves raw emails to `sent_emails.json`

### 2. Campaign Clustering (`group_user_convos.py`)

Groups similar emails into campaigns using text similarity.

**Filtering Logic:**
- Skips replies (`Re:`) and forwards (`Fwd:`, `Fw:`)
- Keeps only the **first email per thread** (the original outreach)
- Only original cold emails are analyzed

**Clustering Algorithm:**
- Uses `difflib.SequenceMatcher` for text similarity
- Compares subject + body (weighted equally)
- **60% similarity threshold** to group emails together
- Agglomerative clustering: if email is similar to any email in a cluster, it joins that cluster

**Output:**
- Campaigns with 2+ emails represent repeating outreach patterns
- Each campaign stores: representative subject, recipient, email count, average similarity

### 3. CTA Analysis (`learn_user_CTA.py`)

Extracts call-to-action patterns from campaign emails.

**Detects:**
- Scheduling links (cal.com, Calendly)
- Meeting links (Zoom, Google Meet)
- Forms (Google Forms, Typeform)
- Action phrases ("let's schedule a call", "would love to chat", etc.)

### 4. Contact Enrichment (`contact_analysis.py`)

Uses Aviato API to enrich contact information from email addresses.

---

## Database Schema (Supabase)

```
users
  - id, email, google_id
  - display_name, user_type, app_purpose
  - referral_source, onboarding_completed
  └── sent_emails
        - gmail_id, thread_id, subject
        - recipient_to/cc/bcc, body, sent_at
        └── email_campaigns (junction)
              └── campaigns
                    - campaign_number
                    - representative_subject
                    - email_count, avg_similarity
```

---

## Planned Onboarding Flow

### Step 1: Authentication
- User clicks "Hypatia" button in Gmail
- OAuth flow with Google
- User created/retrieved in Supabase

### Step 2: Parallel Processing
While user fills questionnaire, backend processes emails:

**Frontend (Questionnaire):**
- Name confirmation
- Purpose (sales, networking, job hunting, etc.)
- User type (student, professional, business owner, etc.)
- Referral source

**Backend (Email Analysis):**
- Fetch 200 sent emails
- Store in Supabase
- Run campaign clustering
- Identify outreach patterns

### Step 3: Results
Show user their identified campaigns:
- "You sent 15 similar intro request emails"
- "You have a recurring sales pitch template"
- "Your networking emails follow this pattern"

---

## What We're Looking For

**Cold outreach campaigns** - when a user sends similar templated emails to multiple different recipients:
- Sales prospecting emails
- Networking/intro request emails
- Job application emails
- Newsletter-style updates

**NOT looking for:**
- Reply chains (conversations, not campaigns)
- Follow-ups within same thread
- Forwards

---

## Key Value Proposition

By identifying patterns of mass outreach, Hypatia can:
1. Learn the user's writing style for different contexts
2. Suggest templates based on past successful emails
3. Auto-generate personalized emails matching their tone
