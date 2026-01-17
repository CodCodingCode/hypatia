# Hypatia Agent

A manager agent that orchestrates email campaign execution by delegating to three specialized sub-agents.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    ManagerAgent                          │
│                                                          │
│  Inputs:                                                 │
│  - campaign_id (from Supabase)                          │
│  - OR: cta, people_target, style (manual)               │
│                                                          │
│  Orchestration:                                          │
│  1. Load campaign data from Supabase                    │
│  2. Delegate to PeopleFinderAgent                       │
│  3. Delegate to WriterAgent (for each contact)          │
│  4. Delegate to FollowupAgent                           │
│  5. Return aggregated results                           │
└─────────────────────────────────────────────────────────┘
         │                │                │
         ▼                ▼                ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ PeopleFinder│  │   Writer    │  │  Followup   │
│    Agent    │  │   Agent     │  │   Agent     │
├─────────────┤  ├─────────────┤  ├─────────────┤
│ Finds       │  │ Writes      │  │ Creates     │
│ contacts    │  │ personalized│  │ follow-up   │
│ from        │  │ emails      │  │ sequences   │
│ enrichments │  │ using style │  │ (3,7,14 day)│
└─────────────┘  └─────────────┘  └─────────────┘
```

## File Structure

```
hypatia_agent/
├── __init__.py
├── README.md
├── manager.py              # Main orchestrator
├── base_agent.py           # Abstract base class
├── agents/
│   ├── __init__.py
│   ├── people_finder_agent.py
│   ├── writer_agent.py
│   └── followup_agent.py
└── services/
    ├── __init__.py
    └── supabase_client.py  # Database access
```

## Usage

### Using an existing campaign from Supabase

```python
import asyncio
from hypatia_agent import ManagerAgent

async def main():
    manager = ManagerAgent()

    result = await manager.execute_from_campaign(
        user_id="d83a4c43-4103-4b16-acc0-2f353e610282",
        campaign_id="05286d03-d676-4b4a-b3fc-2f1ce90c9257"
    )

    print(result["contacts"])      # Found contacts
    print(result["emails"])        # Generated emails
    print(result["followup_plan"]) # Follow-up schedule

asyncio.run(main())
```

### Using custom inputs

```python
result = await manager.execute(
    user_id="your-user-id",
    cta="Schedule a 30-minute demo call",
    people_target="VCs at seed-stage firms in San Francisco",
    style="Professional but friendly, concise emails"
)
```

### Running from command line

```bash
python -m hypatia_agent.manager
```

This will automatically load the first user and their first campaign from Supabase.

## Data Flow

### Inputs (from Supabase)

| Table | Field | Used By |
|-------|-------|---------|
| `campaign_ctas` | `cta_description` | WriterAgent, FollowupAgent |
| `campaign_email_styles` | `style_analysis_prompt` | WriterAgent |
| `campaign_contacts` | `contact_description` | PeopleFinderAgent |
| `contact_enrichments` | `raw_json` | PeopleFinderAgent |

### Outputs

```python
{
    "contacts": [
        {
            "email": "john@company.com",
            "name": "John Smith",
            "title": "VP Engineering",
            "company": "Acme Corp"
        }
    ],
    "emails": [
        {
            "to": "john@company.com",
            "recipient_name": "John Smith",
            "subject": "Quick question",
            "body": "Hi John, ...",
            "style_used": "...",
            "personalization": {...}
        }
    ],
    "followup_plan": [
        {
            "email_index": 0,
            "recipient": "john@company.com",
            "followups": [
                {"sequence_number": 3, "type": "gentle_reminder", ...},
                {"sequence_number": 7, "type": "add_value", ...},
                {"sequence_number": 14, "type": "final_attempt", ...}
            ]
        }
    ]
}
```

## Sub-Agents

### PeopleFinderAgent

Finds contacts to email based on target criteria.

- **Input**: `user_id`, `target_description`
- **Source**: `contact_enrichments` table (Aviato API data)
- **Output**: List of contacts with email, name, title, company

### WriterAgent

Writes personalized emails matching the user's style.

- **Input**: `contact`, `cta`, `style`, `sample_emails`
- **Source**: `campaign_email_styles` table
- **Output**: Email with subject, body, personalization metadata

### FollowupAgent

Creates follow-up sequences with escalating urgency.

- **Input**: `emails`, `cta`
- **Output**: Follow-up plans scheduled at days 3, 7, and 14
- **Types**: `gentle_reminder` → `add_value` → `final_attempt`

## Environment Variables

Required in `.env`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

## Future Improvements

- [ ] LLM integration for WriterAgent (use Backboard/OpenRouter)
- [ ] Actual people search in PeopleFinderAgent (not just cached enrichments)
- [ ] Store generated emails to `generated_emails` table
- [ ] Schedule follow-ups to `scheduled_followups` table
- [ ] Background worker to execute scheduled follow-ups
