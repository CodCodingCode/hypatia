# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hypatia is an AI-powered email intelligence Chrome extension that integrates with Gmail. It analyzes sent emails to identify outreach campaigns, then generates personalized email templates and automated follow-up sequences using a multi-agent LLM system.

## Commands

```bash
# Backend server
cd backend && uvicorn app:app --reload --port 8000

# Run tests
pytest test_*.py
python test_pipeline.py

# Run a single test
python test_name_parser.py

# Test LangGraph agents
python -m hypatia_agent.langgraph_manager

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
FastAPI Backend (backend/app.py)
    │
    ├── Supabase PostgreSQL
    ├── LangGraph Multi-Agent System (hypatia_agent/)
    └── External APIs (Gmail, Aviato, Clado, OpenRouter)
```

### Key Data Flow

1. **Email Clustering**: Gmail sent emails → 60% similarity threshold clustering → campaigns
2. **Template Generation**: Campaign data → StyleAgent draft → CTAAgent/BestPracticeAgent critique → revisions → final template
3. **Follow-up Automation**: Sent email → generate 3 follow-ups (Day 3, 7, 14) → Pub/Sub reply detection → auto-cancel

### Multi-Agent System (hypatia_agent/)

Uses LangGraph for orchestration with explicit state management and agent communication logging:

- **ManagerAgent** - Orchestrates workflow
- **PeopleFinderAgent** - Contact search via Aviato DSL (Clado fallback)
- **WriterAgent** - Personalizes emails using debate system
- **FollowupAgent** - Creates 3-email cadences
- **Debate sub-graph**: StyleAgent → CTAAgent critique → revision → BestPracticeAgent critique → final revision

### Chrome Extension (extension/)

- `background.js` - Service worker handling OAuth, Gmail API, message routing
- `content.js` - Main UI injected into Gmail DOM, state management
- Hash-based routing: `#hypatia`, `#hypatia/campaign/{id}`, `#hypatia/leads`

### Backend (backend/)

- `app.py` - FastAPI endpoints for users, emails, campaigns, leads, templates, cadences, followups
- `parallel_clustering.py` - ThreadPoolExecutor-based email similarity (difflib.SequenceMatcher)
- `async_supabase.py` - Async HTTP client for parallel Supabase operations
- `workers/` - Background tasks for reply detection and follow-up scheduling

## Frontend Aesthetics

<frontend_aesthetics>
Avoid generic "AI slop" aesthetic. Make creative, distinctive frontends that surprise and delight:

**Typography:** Never use Inter, Roboto, Open Sans, Lato, system fonts. Use distinctive choices:
- Code aesthetic: JetBrains Mono, Fira Code
- Editorial: Playfair Display, Crimson Pro, Fraunces
- Startup: Clash Display, Satoshi, Cabinet Grotesk
- Technical: IBM Plex family, Source Sans 3
- Distinctive: Bricolage Grotesque, Newsreader

Use extreme weight contrasts (100/200 vs 800/900) and size jumps of 3x+.

**Color & Theme:** Commit to a cohesive aesthetic with CSS variables. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics.

**Motion:** Focus on high-impact moments - one well-orchestrated page load with staggered reveals (animation-delay) over scattered micro-interactions. CSS-only preferred.

**Backgrounds:** Layer CSS gradients, use geometric patterns, add contextual effects. Avoid solid colors and purple gradients on white.

Think outside the box. Vary between light/dark themes, different fonts, different aesthetics. Avoid Space Grotesk and other overused choices.
</frontend_aesthetics>

The extension injects into Gmail's DOM - scope styles properly and test in both dark and light modes.
