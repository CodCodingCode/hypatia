# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hypatia is an AI-powered email intelligence Chrome extension that integrates with Gmail. It analyzes sent emails to identify outreach campaigns, then generates personalized email templates and automated follow-up sequences using a multi-agent LLM system.

## Python Environment

This project uses a virtual environment. Activate it before running any Python commands:

```bash
source .venv/bin/activate
```

When running the backend, set PYTHONPATH to include the project root (for hypatia_agent imports):

```bash
export PYTHONPATH="$PWD:$PYTHONPATH"
```

## Commands

```bash
# Backend server (from backend/ directory)
cd backend && uvicorn app:app --reload --port 8000

# Run tests
pytest test_*.py
python test_pipeline.py

# Run a single test
python test_name_parser.py

# Background workers
python -m backend.workers.followup_scheduler --interval 60
python -m backend.workers.reply_detector --project $PROJECT_ID --subscription $SUB_NAME
```

Chrome extension: Load unpacked from `/extension` folder at `chrome://extensions` (Developer mode required).

## Architecture

```
Chrome Extension (Manifest V3)
    │ REST API
    ▼
FastAPI Backend (backend/)
    │
    ├── Supabase PostgreSQL
    ├── AI Agent System (hypatia_agent/)
    └── External APIs (Gmail, Aviato, Clado, OpenRouter)
```

### Key Data Flow

1. **Email Clustering**: Gmail sent emails → 60% similarity threshold clustering → campaigns
2. **Template Generation**: Campaign data → TemplateGenerator (single LLM call with fact extraction)
3. **Follow-up Automation**: Sent email → generate 3 follow-ups (Day 3, 7, 14) → Pub/Sub reply detection → auto-cancel

---

## Backend Structure (backend/)

The backend uses a **modular router architecture** with FastAPI:

```
backend/
├── app.py                 # Entry point: lifespan management + router registration
├── backend_config.py      # Environment variables (SUPABASE_URL, keys, SIMILARITY_THRESHOLD)
├── dependencies.py        # Shared DB clients (async_supabase, agent_supabase)
│
├── schemas/               # Pydantic request/response models
│   ├── users.py           # UserCreate, GmailTokenUpdate
│   ├── emails.py          # EmailData, EmailBatch, EmailToSend, SendBatchRequest
│   ├── campaigns.py       # ClusterRequest, CreateCampaignRequest, FollowupConfigUpdate
│   ├── leads.py           # LeadGenerateRequest
│   ├── templates.py       # TemplateGenerateRequest
│   ├── cadence.py         # CadenceGenerateRequest, CadenceEmailUpdate
│   ├── feedback.py        # RecordEditRequest
│   └── followups.py       # CreateFollowupPlanRequest
│
├── routers/               # API endpoint modules (10 routers, 39 total endpoints)
│   ├── health.py          # GET /, GET /health
│   ├── users.py           # POST /users, GET /users/{id}, gmail-token, gmail-watch
│   ├── emails.py          # POST /emails, GET /emails/{user_id}, POST /emails/send-batch
│   ├── campaigns.py       # /campaigns/cluster, /campaigns/create, /campaigns/analyze
│   ├── followups.py       # /followups/plan, /followups/{user_id}, cancel, config
│   ├── leads.py           # POST /leads/generate, GET /leads/{user_id}
│   ├── templates.py       # POST /templates/generate, GET /templates/{campaign_id}
│   ├── cadence.py         # POST /cadence/generate, GET/PATCH /cadence/{id}
│   ├── sent.py            # GET /sent/user/{user_id}, GET /sent/thread/{thread_id}
│   └── feedback.py        # GET /feedback/{user_id}, POST /feedback/record-edit
│
├── utils/                 # Shared utilities
│   ├── supabase.py        # supabase_request() - sync HTTP helper for Supabase REST API
│   ├── clustering.py      # calculate_similarity(), cluster_emails(), identify_campaigns()
│   └── campaigns.py       # create_campaign_if_new() - ensures campaign exists before operations
│
├── parallel_clustering.py # ThreadPoolExecutor-based email similarity (difflib.SequenceMatcher)
├── async_supabase.py      # AsyncSupabaseClient for parallel Supabase operations
├── analytics.py           # Event tracking (Amplitude integration)
├── feedback_loop.py       # "Ever Improving" AI - learns from user edits
└── workers/               # Background tasks for reply detection and follow-up scheduling
```

### API Endpoint Summary (39 endpoints)

| Router | Prefix | Endpoints | Purpose |
|--------|--------|-----------|---------|
| health | / | 2 | Health checks, Supabase connectivity |
| users | /users | 5 | User CRUD, Gmail OAuth tokens, Pub/Sub watch |
| emails | /emails | 3 | Store emails, retrieve, send batches via Gmail API |
| campaigns | /campaigns | 5 | Clustering, analysis, saved content retrieval |
| followups | /followups | 6 | Plan AI follow-ups, schedule, cancel, configure |
| leads | /leads | 2 | Generate via PeopleFinderAgent (Aviato/Clado) |
| templates | /templates | 3 | Generate via TemplateGenerator with feedback loop |
| cadence | /cadence | 4 | Full email sequences (initial + 3 follow-ups) |
| sent | /sent | 2 | Track sent emails, thread timelines |
| feedback | /feedback | 3 | Learn from user edits to improve AI |

---

## AI Agent System (hypatia_agent/)

The `hypatia_agent/` module contains the AI agents and services that power lead generation, template creation, and follow-up automation:

```
hypatia_agent/
├── __init__.py            # Exports BaseAgent, SupabaseClient
├── base_agent.py          # Base class for all agents
│
├── agents/                # AI agents for specific tasks
│   ├── people_finder_agent.py  # Contact search via Aviato DSL API (Clado fallback)
│   ├── followup_agent.py       # Creates personalized follow-up email cadences
│   └── fact_extractor.py       # Extracts facts from contact data for personalization
│
├── services/              # Shared services used by agents
│   ├── supabase_client.py      # Sync Supabase client for agent operations
│   ├── gmail_service.py        # Gmail API wrapper (send, watch, token management)
│   ├── llm_client.py           # OpenRouter LLM client (GPT-4, Claude)
│   ├── template_generator.py   # Single-call template generation with fact extraction
│   └── followup_service.py     # Follow-up scheduling and management
│
├── models/                # Pydantic models for agent state
└── utils/                 # Agent utilities
```

### Key Agents

**PeopleFinderAgent** (`agents/people_finder_agent.py`)
- Converts natural language queries to Aviato DSL for contact search
- Falls back to Clado AI when Aviato has no results
- Returns enriched contact data (name, email, company, title, LinkedIn)

**FollowupAgent** (`agents/followup_agent.py`)
- Generates complete email cadences (initial + 3 follow-ups)
- Uses fact extraction for personalization
- Supports regenerating individual emails in a cadence

### Key Services

**TemplateGenerator** (`services/template_generator.py`)
- Single LLM call for template generation (replaces multi-agent debate)
- Extracts facts from sample emails for grounding
- Supports feedback loop enhancement from user preferences

**GmailService** (`services/gmail_service.py`)
- Sends emails via Gmail API
- Sets up Pub/Sub watch for reply detection
- Handles OAuth token storage and refresh

**FollowupService** (`services/followup_service.py`)
- Manages scheduled_followups table
- Handles follow-up cancellation on reply detection
- Configurable timing (Day 3, 7, 14 defaults)

---

## Chrome Extension (extension/)

- `background.js` - Service worker handling OAuth, Gmail API, message routing
- `content.js` - Main UI injected into Gmail DOM, state management
- Hash-based routing: `#hypatia`, `#hypatia/campaign/{id}`, `#hypatia/leads`

The extension injects into Gmail's DOM - scope styles properly and test in both dark and light modes.

---

## Database (Supabase PostgreSQL)

Key tables:
- `users` - User accounts with Gmail OAuth tokens
- `sent_emails` - Stored outreach emails from Gmail
- `campaigns` - Clustered email campaigns
- `email_campaigns` - Junction table (email_id ↔ campaign_id)
- `generated_leads`, `generated_templates`, `generated_cadence` - AI output storage
- `scheduled_followups` - Follow-up scheduling with status tracking
- `contact_enrichments` - Cached contact data from Aviato/Clado

---

## Configuration Files

- `backend/backend_config.py` - Backend-specific config (Supabase credentials, similarity threshold)
- `config.py` (project root) - Shared config for pipeline module (Aviato API keys, etc.)
- `.env` - Environment variables (not committed)
