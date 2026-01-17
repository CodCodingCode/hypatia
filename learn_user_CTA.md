# learn_user_CTA.py

Analyzes email campaigns to extract and categorize Call-To-Actions (CTAs) using OpenAI.

## Purpose

Identifies what action the user wants recipients to take in their mass email campaigns. This helps understand user intent and communication patterns.

## How It Works

1. **Fetches qualifying campaigns** - Gets campaigns with >= 2 emails (mass emails only)
2. **Gets first email** - Analyzes the earliest email in each campaign (the "template")
3. **Extracts CTA with OpenAI** - Uses GPT-4.1-nano to identify:
   - CTA type (e.g., "Schedule Meeting", "Reply Request", "Investment Ask")
   - CTA description (what action is being requested)
   - CTA text (exact text from the email)
   - Urgency level (low/medium/high)
4. **Caches results** - Saves to `campaign_ctas` table to avoid re-analysis

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MIN_CAMPAIGN_SIZE` | 2 | Minimum emails for a campaign to qualify |
| `MAX_CAMPAIGNS` | 5 | Maximum campaigns to analyze per run |

## Database Tables

**Reads from:**
- `users` - Get user list
- `campaigns` - Get qualifying campaigns
- `email_campaigns` + `sent_emails` - Get email content

**Writes to:**
- `campaign_ctas` - Stores CTA analysis results

## Output

```
Campaign #1: Meeting request about partnership...
    CTA Type: Schedule Meeting
    Description: Sender wants to schedule a 30-minute call to discuss partnership
```

## Usage

```bash
python learn_user_CTA.py
```

Requires environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
