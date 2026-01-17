# learn_user_email_style.py

Analyzes email writing style for each campaign using OpenAI to generate style replication prompts.

## Purpose

Learns how the user writes emails so the system can later generate emails that match their personal style. Creates both a quick summary and a detailed "style guide" prompt.

## How It Works

1. **Fetches qualifying campaigns** - Gets campaigns with >= 2 emails that don't already have style analysis
2. **Samples emails** - Randomly samples 2-5 emails from each campaign
3. **Analyzes with OpenAI** - Uses GPT-4.1-nano to generate:
   - **One-sentence description** - Quick summary of writing style
   - **Style analysis prompt** - Detailed 400-600 word guide covering:
     - Opening style (greetings, first lines)
     - Sentence structure (length, complexity)
     - Tone & formality (contractions, directness)
     - Vocabulary patterns (phrases, jargon)
     - Request style (how they ask for things)
     - Closing style (sign-offs, CTAs)
     - Unique quirks (punctuation, formatting)
4. **Saves to database** - Stores in `campaign_email_styles` table

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MIN_CAMPAIGN_SIZE` | 2 | Minimum emails for campaign to qualify |
| `MAX_CAMPAIGNS` | 5 | Max campaigns to analyze per run |
| `MIN_SAMPLE` | 2 | Minimum emails to sample per campaign |
| `MAX_SAMPLE` | 5 | Maximum emails to sample per campaign |

## Database Tables

**Reads from:**
- `users` - Get user list
- `campaigns` - Get qualifying campaigns
- `campaign_email_styles` - Check for existing analysis
- `email_campaigns` + `sent_emails` - Get email content

**Writes to:**
- `campaign_email_styles` - Stores style analysis results

## Output

```
Campaign #1: Investor outreach...
    Total emails: 15
    Analyzing 5 sample emails...
    Style: Direct and professional with short paragraphs, uses "I'd love to..." phrasing...
```

## Usage

```bash
python learn_user_email_style.py
```

Requires environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`

## Notes

- Uses `response_format={"type": "json_object"}` to ensure valid JSON output
- Skips campaigns that already have style analysis (idempotent)
- Truncates email bodies to 1500 chars to fit context window
