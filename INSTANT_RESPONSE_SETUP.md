# Instant Response Setup Guide

This guide explains how to set up and use the instant AI response feature for campaigns.

## Overview

When someone replies to an email in a campaign with instant responses enabled, Hypatia will automatically:
1. Detect the reply via Gmail push notifications
2. Check if the email is part of a campaign with `instant_respond_enabled=true`
3. Generate an AI response using the FollowupAgent
4. Send the response automatically via Gmail

## Setup Steps

### 1. Run Database Migrations

Run both migration files in your Supabase SQL Editor:

```sql
-- File: backend/migrations/add_instant_response_tracking.sql
-- Adds instant_respond_enabled to individual emails

-- File: backend/migrations/add_campaign_instant_respond.sql
-- Adds instant_respond_enabled to campaigns
```

### 2. Set Up Gmail Watch (Get Refresh Token)

First, add the redirect URI to Google Cloud Console:
1. Go to: https://console.cloud.google.com/apis/credentials?project=hypatia-484602
2. Click on your OAuth client ID
3. Add `http://localhost:8080/oauth/callback` to "Authorized redirect URIs"
4. Save and wait 10 seconds

Then run the setup script:
```bash
python setup_gmail_watch.py
```

This script will:
- Open browser for OAuth consent
- Get access + refresh tokens
- Store tokens in Supabase
- Set up Gmail Watch for push notifications

### 3. Start the Reply Detector Worker

The reply detector listens for Gmail notifications and triggers instant responses:

```bash
python -m backend.workers.reply_detector
```

Keep this running in the background (or deploy it as a service).

## How It Works

### Architecture

```
Gmail Reply
    ↓
Gmail Push Notification (Pub/Sub)
    ↓
Reply Detector Worker
    ↓
Check if email/campaign has instant_respond_enabled
    ↓
Generate AI Response (FollowupAgent)
    ↓
Send via Gmail API
    ↓
Track in sent_emails table
```

### Code Flow

1. **Reply Detection** ([backend/workers/reply_detector.py](backend/workers/reply_detector.py:168-196))
   - Receives Pub/Sub notification
   - Checks if thread has instant respond enabled (email-level OR campaign-level)
   - If enabled: generates and sends AI response
   - If not: cancels pending follow-ups (existing behavior)

2. **Campaign Check** ([backend/workers/reply_detector.py](backend/workers/reply_detector.py:218-245))
   ```python
   def _check_instant_respond_thread(self, user_id: str, thread_id: str):
       # First check email-level instant_respond_enabled
       # Then check if email is in a campaign with instant_respond_enabled
   ```

3. **Response Generation** ([backend/workers/reply_detector.py](backend/workers/reply_detector.py:234-290))
   ```python
   def _send_instant_response(self, user_id: str, original_email: dict, reply_message_id: str):
       # Get full reply message
       # Generate AI response using FollowupAgent
       # Send via Gmail
       # Track in database
   ```

## API Endpoints

### Enable/Disable Instant Responses for a Campaign

```bash
PATCH /campaigns/{campaign_id}/instant-respond
{
  "instant_respond_enabled": true
}
```

Response:
```json
{
  "success": true,
  "instant_respond_enabled": true
}
```

## Database Schema

### campaigns table
```sql
instant_respond_enabled BOOLEAN DEFAULT FALSE
-- When true, ALL emails sent in this campaign will trigger instant AI responses
```

### sent_emails table
```sql
instant_respond_enabled BOOLEAN DEFAULT FALSE
-- When true, THIS specific email will trigger instant AI responses
```

### Priority
Email-level setting takes precedence. The system checks:
1. First: Does this email have `instant_respond_enabled=true`?
2. If not: Is this email in a campaign with `instant_respond_enabled=true`?

## Testing

1. **Enable instant responses for a campaign:**
   ```bash
   curl -X PATCH http://localhost:8000/campaigns/{campaign_id}/instant-respond \
     -H "Content-Type: application/json" \
     -d '{"instant_respond_enabled": true}'
   ```

2. **Send an email in that campaign**

3. **Reply to that email**

4. **Check the reply detector logs:**
   ```
   Thread {thread_id} is in campaign with instant respond enabled
   Generating instant response to {email}
   ✅ Sent instant response to {email} in thread {thread_id}
   ```

5. **Verify the response was sent** by checking your Gmail sent folder

## Troubleshooting

### "No authorization code received" when running setup_gmail_watch.py
- Make sure you added `http://localhost:8080/oauth/callback` to authorized redirect URIs
- Wait 10-30 seconds after saving in Google Cloud Console
- Try in an incognito/private browser window

### Reply detector not receiving notifications
- Check if Gmail Watch is active: it expires after 7 days
- Re-run `setup_gmail_watch.py` to renew
- Check Pub/Sub subscription exists: `gmail-reply-detector`
- Verify `GOOGLE_CLOUD_PROJECT` environment variable is set

### Instant response not sending
- Check reply detector logs for errors
- Verify campaign has `instant_respond_enabled=true`
- Verify email is linked to campaign in `email_campaigns` table
- Check Gmail API quota (shouldn't be an issue for normal use)

## Environment Variables

Required in `.env`:
```bash
# Google Cloud
GOOGLE_CLOUD_PROJECT=hypatia-484602
GCP_PROJECT_ID=hypatia-484602
PUBSUB_SUBSCRIPTION=gmail-reply-detector
GOOGLE_APPLICATION_CREDENTIALS=/path/to/gcp-service-account.json

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Gmail Watch User (your test user)
GMAIL_WATCH_USER_ID=83ea2cfe-a198-421d-acc9-156c73e6a5ce
```
