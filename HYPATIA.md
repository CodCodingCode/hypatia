# Hypatia - AI-Powered Email Intelligence Platform

Hypatia is an intelligent email outreach automation system that learns your communication style and helps you craft personalized, high-converting cold emails with automated follow-up sequences.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHROME EXTENSION                              │
│  (Gmail Integration - content.js, background.js, onboarding.js) │
└───────────────────────────┬─────────────────────────────────────┘
                            │ REST API
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FASTAPI BACKEND (app.py)                      │
│  • Campaign clustering    • Lead generation                      │
│  • Template generation    • Email sending                        │
│  • Follow-up scheduling   • Gmail push notifications             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│   SUPABASE    │  │  HYPATIA      │  │   EXTERNAL    │
│   DATABASE    │  │  AGENTS       │  │   APIS        │
│               │  │               │  │               │
│ • users       │  │ • Manager     │  │ • Gmail API   │
│ • campaigns   │  │ • PeopleFinder│  │ • OpenRouter  │
│ • emails      │  │ • Writer      │  │ • Aviato      │
│ • followups   │  │ • Followup    │  │ • Clado AI    │
│ • templates   │  │ • Debate      │  │ • Pub/Sub     │
└───────────────┘  └───────────────┘  └───────────────┘
```

---

## Backend (`/backend`)

### Core Files

| File | Lines | Description |
|------|-------|-------------|
| `app.py` | 1,262 | FastAPI server with all API endpoints |
| `async_supabase.py` | 407 | Async HTTP client for parallel Supabase operations |
| `parallel_clustering.py` | 173 | Email similarity computation using ThreadPoolExecutor |

### API Endpoints

#### User Management
- `POST /users` - Create or get user
- `GET /users/{user_id}` - Get user by ID
- `PATCH /users/{user_id}/onboarding` - Mark onboarding complete

#### Email Operations
- `POST /emails` - Store batch of emails
- `GET /emails/{user_id}` - Get user's emails (paginated)
- `POST /emails/send-batch` - Send emails via Gmail API

#### Campaign Clustering
- `POST /campaigns/cluster` - AI-powered email clustering (60% similarity threshold)
- `GET /campaigns/{user_id}` - Get all campaigns
- `POST /campaigns/analyze` - Analyze CTA, style, contacts

#### Lead Generation
- `POST /leads/generate` - Find contacts via PeopleFinderAgent
- `GET /leads/{user_id}` - Get saved leads

#### Template Generation
- `POST /templates/generate` - Generate via multi-agent debate
- `GET /templates/{campaign_id}` - Get campaign template

#### Cadence Management
- `POST /cadence/generate` - Create 4-email sequence
- `GET /cadence/{campaign_id}` - Get campaign cadence
- `PATCH /cadence/{cadence_id}` - Update single email
- `POST /cadence/{cadence_id}/regenerate` - AI regenerate

#### Follow-up Scheduling
- `POST /followups/plan` - Create follow-up plans
- `GET /followups/{user_id}` - Get all followups
- `POST /followups/{followup_id}/cancel` - Cancel followup

### Background Workers

| Worker | File | Purpose |
|--------|------|---------|
| Reply Detector | `workers/reply_detector.py` | Monitors Gmail via Pub/Sub, cancels follow-ups when replies detected |
| Followup Scheduler | `workers/followup_scheduler.py` | Sends due follow-ups every 60 seconds |

---

## Chrome Extension (`/extension`)

### Manifest V3 Permissions
- `identity` - Google OAuth
- `storage` - Local settings
- `activeTab` - Gmail access
- Host: `mail.google.com/*`, `googleapis.com/*`

### Core Files

| File | Lines | Description |
|------|-------|-------------|
| `background.js` | 1,430 | OAuth, API gateway, message routing |
| `content.js` | 4,432 | UI rendering, state management |
| `onboarding.js` | 888 | Onboarding flow and questionnaire |
| `campaign.js` | 294 | Campaign detail screen |
| `leads.js` | 298 | Lead generation UI |
| `template.js` | 449 | Email template editor |
| `sent.js` | 577 | Email tracking dashboard |

### Key Features

1. **Gmail Integration** - Injects UI directly into Gmail
2. **Onboarding Flow** - 6-question questionnaire + email fetching
3. **Campaign Management** - Grid view of clustered campaigns
4. **Lead Generation** - Natural language contact search
5. **Template Editor** - Live preview with placeholders
6. **Email Tracking** - Delivery, opens, replies, bounces

### Navigation Routes
```
#hypatia                    → Campaigns grid
#hypatia/campaign/{id}      → Campaign detail
#hypatia/leads              → Lead generation
#hypatia/templates          → Template library
#hypatia/dashboard          → Analytics
```

---

## AI Agent System (`/hypatia_agent`)

### Multi-Agent Architecture

```
                    ┌─────────────────┐
                    │  ManagerAgent   │
                    │ (Orchestrator)  │
                    └────────┬────────┘
           ┌─────────────────┼─────────────────┐
           ▼                 ▼                 ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│ PeopleFinderAgent│ │ WriterAgent  │ │  FollowupAgent   │
│                  │ │              │ │                  │
│ • Aviato DSL     │ │ • Templates  │ │ • 3-email cadence│
│ • Clado fallback │ │ • Debate     │ │ • Day 3, 7, 14   │
│ • LLM extraction │ │ • Placeholders│ │ • Persistence   │
└──────────────────┘ └──────┬───────┘ └──────────────────┘
                            │
                    ┌───────▼───────┐
                    │    DEBATE     │
                    │ ORCHESTRATOR  │
                    └───────┬───────┘
           ┌────────────────┼────────────────┐
           ▼                ▼                ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│  StyleAgent      │ │  CTAAgent    │ │BestPracticeAgent │
│                  │ │              │ │                  │
│ • Drafts template│ │ • CTA clarity│ │ • Subject lines  │
│ • Revises based  │ │ • Placement  │ │ • Spam signals   │
│   on feedback    │ │ • Friction   │ │ • Length/format  │
└──────────────────┘ └──────────────┘ └──────────────────┘
```

### Debate Flow (Round-Robin)
```
StyleAgent → Initial draft
CTAAgent → Critique CTA effectiveness
StyleAgent → Revise for CTA
BestPracticeAgent → Critique best practices
StyleAgent → Revise for best practices
→ Final template with placeholders
```

### Services Layer

| Service | Purpose |
|---------|---------|
| `LLMClient` | OpenRouter API (Google Gemini 3 Flash) |
| `GmailService` | OAuth, send emails, push notifications |
| `SupabaseClient` | Database operations |
| `FollowupService` | Schedule/cancel/track follow-ups |

---

## LangGraph Integration (Multi-Agent Orchestration)

Hypatia uses **LangGraph** for explicit multi-agent orchestration, providing:
- State management via TypedDict
- Visible communication logs between agents
- Conditional routing and looping

### LangGraph Manager Workflow

```
    ┌──────────────────┐
    │  load_campaign   │ (DataLoaderAgent - loads from Supabase)
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │   find_people    │ (PeopleFinderAgent - Aviato/Clado)
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │  write_emails    │ (WriterAgent + DebateOrchestrator)
    │  ┌────────────┐  │
    │  │ 3-Agent    │  │
    │  │ Debate     │  │
    │  └────────────┘  │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ plan_followups   │ (FollowupAgent - Day 3, 7, 14)
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ generate_output  │ → END
    └──────────────────┘
```

### LangGraph Debate Flow (Sub-graph)

```
    draft_initial → critique_cta → revise_for_cta → critique_bp → revise_for_bp
                                                                        │
                                    (loop if rounds remaining) ←────────┘
                                                                        │
                                                              parse_template → END
```

### Agent Communication Log

Each agent handoff is logged with:
- Timestamp
- From/To agents
- Action type (draft, critique, revision, handoff)
- Summary and metadata

Example log entry:
```json
{
  "timestamp": "2026-01-17T14:32:01",
  "from": "CTAAgent",
  "to": "StyleAgent",
  "action": "critique",
  "summary": "CTA needs to be more specific about next steps",
  "metadata": {
    "round": 1,
    "critique_type": "cta_effectiveness"
  }
}
```

### Usage

```python
from hypatia_agent import LangGraphManagerAgent

# Initialize
manager = LangGraphManagerAgent()

# Execute with full communication logging
result = await manager.execute(
    user_id="user-123",
    campaign_id="campaign-456",
    verbose=True
)

# Access results
print(f"Found {len(result['contacts'])} contacts")
print(f"Wrote {len(result['emails'])} emails")
print(f"Communication log: {len(result['communication_log'])} messages")

# Print formatted communication log
print(manager.get_communication_log_summary(result["communication_log"]))
```

---

## Database Schema (Supabase)

### Core Tables
- `users` - User accounts with onboarding state
- `sent_emails` - Stored Gmail messages
- `campaigns` - Clustered email groups
- `email_campaigns` - Email-to-campaign mapping

### AI-Generated Content
- `generated_leads` - Contacts from PeopleFinderAgent
- `generated_templates` - Templates from debate system
- `generated_cadence` - 4-email sequences

### Scheduling
- `scheduled_followups` - Pending follow-ups with status
- `gmail_tokens` - OAuth token storage
- `followup_configs` - Per-campaign timing settings

---

## External Integrations

| Service | Purpose |
|---------|---------|
| **Gmail API** | Read sent emails, send messages, push notifications |
| **Google Pub/Sub** | Real-time reply detection |
| **OpenRouter** | LLM completions (Gemini 3 Flash) |
| **Aviato** | DSL-based contact search API |
| **Clado AI** | Fallback text-based contact search |
| **Supabase** | PostgreSQL database + Auth |

---

## Key Workflows

### 1. Email Clustering
```
User's sent emails → Filter replies →
First email per thread → Parallel similarity computation →
60% threshold clustering → Save campaigns
```

### 2. Template Generation (Multi-Agent Debate)
```
CTA + Style + Samples → StyleAgent draft →
CTAAgent critique → Revision →
BestPracticeAgent critique → Final revision →
Extract placeholders → Save template
```

### 3. Follow-up Automation
```
Sent email → Generate 3 follow-ups (Day 3, 7, 14) →
Schedule in database → Worker sends when due →
Reply detected via Pub/Sub → Cancel remaining
```

---

## Environment Variables

```env
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# LLM
OPENROUTER_API_KEY=sk-or-...

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# Contact APIs
AVIATO_API_KEY=xxx
AVIATO_BASE_URL=https://api.aviato.co
CLADO_API_KEY=xxx

# Google Cloud (for Pub/Sub)
GOOGLE_CLOUD_PROJECT=your-project-id
```

---

## Running the Project

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

### Workers
```bash
# Follow-up scheduler (continuous)
python -m backend.workers.followup_scheduler --interval 60

# Reply detector (Pub/Sub)
python -m backend.workers.reply_detector --project $PROJECT_ID --subscription $SUB_NAME
```

### Extension
1. Open Chrome → `chrome://extensions/`
2. Enable Developer Mode
3. Load unpacked → select `/extension` folder
4. Navigate to Gmail
