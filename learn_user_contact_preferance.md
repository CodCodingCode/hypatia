# learn_user_contact_preferance.py

Enriches contacts from email campaigns using Aviato API and generates descriptions of who the user is contacting.

## Purpose

Understands the types of people/roles the user contacts in their email campaigns. Uses contact enrichment data (job titles, companies) combined with email content to build a profile of target contacts.

## How It Works

1. **Fetches qualifying campaigns** - Gets campaigns with >= 2 emails
2. **Enriches contacts via Aviato API** - For each campaign:
   - Extracts recipient emails from campaign
   - Calls Aviato API to get professional info (name, title, company, LinkedIn)
   - Stops after 3 successful enrichments OR 5 consecutive failures
   - Caches all results (success or failure) to avoid duplicate API calls
3. **Generates contact description with GPT** - Two paths:
   - **Normal path**: If enrichments succeed, uses profile data + email content
   - **Fallback path**: If 5+ consecutive failures, infers from email subject/body + user's stated `contact_types`
4. **Returns structured analysis** - `CampaignContactAnalysis` dataclass with all data

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MIN_CAMPAIGN_SIZE` | 2 | Minimum emails for campaign to qualify |
| `MAX_CAMPAIGNS` | 5 | Max campaigns to analyze per run |
| `MAX_ENRICHMENTS_PER_CAMPAIGN` | 3 | Stop after this many successful enrichments |
| `API_RATE_LIMIT_DELAY` | 0.5s | Delay between Aviato API calls |
| `CONSECUTIVE_FAILURES_THRESHOLD` | 5 | Trigger fallback after this many failures in a row |

## Database Tables

**Reads from:**
- `users` - Get user list with `contact_types` preference
- `campaigns` - Get qualifying campaigns
- `email_campaigns` + `sent_emails` - Get recipients and email content
- `contact_enrichments` - Check cache before API calls

**Writes to:**
- `contact_enrichments` - Caches all enrichment results (success or failure)

## Key Features

### Enrichment Caching
All API results are cached in `contact_enrichments` table:
- Avoids duplicate API calls on re-runs
- Stores both successful enrichments and failures
- Uses upsert for idempotent updates

### Smart Failure Handling
After 5 consecutive failed enrichments:
1. Stops wasting API calls
2. Falls back to AI-based inference
3. Uses email subject + body as PRIMARY evidence
4. Considers user's stated `contact_types` as supporting context

### Fallback AI Analysis
When enrichment fails (common for academic/non-corporate emails), the fallback:
- Analyzes up to 5 emails from the campaign
- Weighs subject and body most heavily
- Infers role/industry from email content
- Example output: "Medical researchers and faculty at academic hospitals"

## Output

```
Campaign #1: Research collaboration inquiry
    Found 15 unique recipients
      [API] Enriching john@stanford.edu... Failed: Contact not found
      [API] Enriching jane@ucsf.edu... Failed: Contact not found
      ...
    [!] Hit 5 consecutive failures, stopping enrichment
    [FALLBACK] No enrichments succeeded - inferring from email content...
    Description (inferred): Medical researchers and faculty at academic hospitals
```

## Usage

```bash
python learn_user_contact_preferance.py
```

Requires environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
- `AVIATO_API_KEY`

## Data Structures

```python
@dataclass
class EnrichmentResult:
    email: str
    success: bool
    raw_json: Optional[dict]
    error: Optional[str]

@dataclass
class CampaignContactAnalysis:
    campaign_id: str
    campaign_subject: str
    email_count: int
    enrichments: list[EnrichmentResult]
    email_texts: list[dict]
    contact_description: Optional[str]
```
