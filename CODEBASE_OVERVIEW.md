# Hypatia - Codebase Overview

## What is Hypatia?

**Hypatia** is an AI-powered email intelligence platform that learns your communication patterns from Gmail to help you identify, analyze, and replicate your email outreach campaigns. It's built as a Chrome extension that integrates directly into Gmail.

**Key Value Proposition:** Help users understand their own email communication patterns so they can write better emails faster and identify successful outreach campaigns.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Chrome Extension                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ background.js│  │  content.js  │  │  UI Components       │  │
│  │ (OAuth,      │  │  (Main UI,   │  │  (campaign, leads,   │  │
│  │  Gmail API,  │  │   routing,   │  │   template, sent.js) │  │
│  │  Supabase)   │  │   state)     │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FastAPI Backend                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   app.py     │  │  parallel_   │  │  async_supabase.py   │  │
│  │  (REST API)  │  │  clustering  │  │  (Async DB client)   │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     External Services                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Supabase   │  │  Gmail API   │  │  Backboard/Aviato    │  │
│  │  (Database)  │  │  (OAuth)     │  │  (LLM + Enrichment)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
hypatia/
├── extension/                 # Chrome Extension (Frontend)
│   ├── manifest.json         # Extension config & permissions
│   ├── background.js         # Service worker (OAuth, Gmail, Supabase)
│   ├── content.js            # Main UI & state management
│   ├── campaign.js           # Campaign detail view
│   ├── leads.js              # Lead generation interface
│   ├── template.js           # Email template editor
│   ├── sent.js               # Email tracking dashboard
│   ├── styles.css            # Complete styling
│   └── config.js             # API keys & URLs
│
├── backend/                   # FastAPI Backend
│   ├── app.py                # REST API endpoints
│   ├── parallel_clustering.py # Optimized similarity calculations
│   └── async_supabase.py     # Async database operations
│
├── hypatia_agent/            # Analysis Scripts
│   ├── learn_user_combined.py # LLM analysis (CTA, style, contacts)
│   ├── group_user_convos.py  # Email clustering algorithm
│   ├── main.py               # Legacy Gmail client
│   └── manager.py            # Agent manager
│
└── supabase_schema.sql       # Database schema
```

---

## Components Implemented

### 1. Chrome Extension (`/extension/`)

#### `background.js` - Service Worker
| Feature | Status | Description |
|---------|--------|-------------|
| OAuth Authentication | ✅ Complete | Google OAuth via Chrome Identity API |
| User Management | ✅ Complete | Create/retrieve users in Supabase |
| Email Fetching | ✅ Complete | Fetch 200 most recent sent emails from Gmail |
| Batch Processing | ✅ Complete | Parallel fetch (5 emails at a time) |
| Supabase Storage | ✅ Complete | Save emails with duplicate handling |
| Clustering Trigger | ✅ Complete | Call backend `/campaigns/cluster` |
| Analysis Trigger | ✅ Complete | Call backend `/campaigns/analyze` |
| Progress Updates | ✅ Complete | Real-time UI updates during processing |

#### `content.js` - Main UI (94KB)
| Screen | Status | Description |
|--------|--------|-------------|
| Welcome Screen | ✅ Complete | Sign-in prompt |
| Progress Screen | ✅ Complete | Real-time backend progress |
| Questionnaire | ✅ Complete | User profiling form (6 questions) |
| Campaigns Grid | ✅ Complete | 3x2 paginated campaign display |
| Campaign Detail | ✅ Complete | Full campaign analysis view |
| Leads Screen | ⚠️ UI Only | Natural language lead generation |
| Template Editor | ⚠️ UI Only | Email template creation |
| Sent Tracking | ⚠️ UI Only | Email tracking with sample data |

#### `styles.css` - Styling (31KB)
- Slide-in panel from right side
- Dark overlay
- Sign-in button (header + floating fallback)
- Responsive grid layouts
- Status badges and icons
- Form inputs and animations

---

### 2. FastAPI Backend (`/backend/`)

#### `app.py` - REST API
| Endpoint | Method | Status | Description |
|----------|--------|--------|-------------|
| `/` | GET | ✅ | Health check |
| `/health` | GET | ✅ | DB connection test |
| `/users` | POST | ✅ | Create/get user |
| `/users/{id}` | GET | ✅ | Retrieve user |
| `/users/{id}/onboarding` | PATCH | ✅ | Mark onboarding complete |
| `/emails` | POST | ✅ | Store email batch |
| `/emails/{user_id}` | GET | ✅ | Retrieve user emails |
| `/campaigns/cluster` | POST | ✅ | Run similarity clustering |
| `/campaigns/analyze` | POST | ✅ | Run LLM analysis |

#### `parallel_clustering.py` - Clustering Engine
- ThreadPoolExecutor with 8 workers
- Precomputed similarity matrix
- 60% similarity threshold
- Body truncation (1000 chars) for speed
- Quick ratio pre-filter optimization

#### `async_supabase.py` - Async Database Client
- aiohttp for non-blocking HTTP
- Parallel campaign saves (10 concurrent)
- Batch link insertions (100 per batch)

---

### 3. Analysis Scripts (`/hypatia_agent/`)

#### `learn_user_combined.py` - LLM Analysis (28KB)
| Feature | Status | Description |
|---------|--------|-------------|
| CTA Extraction | ✅ Complete | Type, description, urgency |
| Style Analysis | ✅ Complete | One-sentence description + prompt |
| Contact Profiling | ✅ Complete | Target audience description |
| Contact Enrichment | ✅ Complete | Aviato API integration |
| Caching | ✅ Complete | contact_enrichments table |

**LLM Provider:** Backboard API with Google Gemini 3.5 Flash

#### `group_user_convos.py` - Clustering (19KB)
- Agglomerative clustering algorithm
- Reply/forward filtering (Re:, Fwd:)
- Thread deduplication
- 60% similarity threshold
- Minimum 2 emails per campaign

---

### 4. Database Schema

| Table | Purpose |
|-------|---------|
| `users` | User accounts + questionnaire data |
| `sent_emails` | Fetched Gmail sent emails |
| `campaigns` | Identified email campaigns |
| `email_campaigns` | Junction: email ↔ campaign |
| `contact_enrichments` | Cached Aviato enrichments |
| `campaign_ctas` | Extracted CTAs per campaign |
| `campaign_email_styles` | Style analysis per campaign |
| `campaign_contacts` | Contact descriptions per campaign |

**Views:** `user_email_stats`, `campaign_stats`, `grouped_emails`, `campaign_with_emails`

---

## Onboarding Flow

```
User Clicks Sign-In
        │
        ▼
┌───────────────────┐
│  OAuth + Create   │
│      User         │
└───────────────────┘
        │
        ├──────────────────────────────────┐
        ▼                                  ▼
┌───────────────────┐          ┌───────────────────┐
│  Show Questionnaire│          │  Backend Process  │
│  (6 questions)     │          │  (in parallel)    │
│                    │          │  - Fetch emails   │
│  • Name            │          │  - Save to DB     │
│  • App purpose     │          │  - Cluster        │
│  • User type       │          │  - Analyze        │
│  • General CTAs    │          │                   │
│  • Contact types   │          │                   │
│  • Referral source │          │                   │
└───────────────────┘          └───────────────────┘
        │                                  │
        └──────────────┬───────────────────┘
                       ▼
            ┌───────────────────┐
            │  Show Campaigns   │
            │  Grid (3x2)       │
            └───────────────────┘
                       │
                       ▼
            ┌───────────────────┐
            │  Campaign Detail  │
            │  • CTA analysis   │
            │  • Style analysis │
            │  • Contact desc   │
            └───────────────────┘
```

---

## Key Algorithms

### Email Similarity
```python
from difflib import SequenceMatcher

subject_sim = SequenceMatcher(None, subject1, subject2).ratio()
body_sim = SequenceMatcher(None, body1[:1000], body2[:1000]).ratio()
similarity = (subject_sim + body_sim) / 2

# Threshold: 60%
if similarity >= 0.60:
    # Same campaign
```

### Agglomerative Clustering
1. Start with first unassigned email → create cluster
2. For each remaining email:
   - If similar to ANY email in cluster → add to cluster
   - Else → create new cluster
3. Filter to clusters with 2+ emails (campaigns)

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Chrome Extension (Manifest V3), Vanilla JS |
| Backend | FastAPI, Python 3.10+ |
| Database | Supabase (PostgreSQL) |
| Auth | Google OAuth 2.0 via Chrome Identity |
| LLM | Backboard API (Gemini 3.5 Flash) |
| Enrichment | Aviato API |
| Async | asyncio, aiohttp, ThreadPoolExecutor |

---

## What's NOT Implemented Yet

| Feature | Current State |
|---------|---------------|
| Lead Generation | UI built, no backend API |
| Template Generation | UI built, no LLM integration |
| Email Sending | UI with sample data only |
| Email Tracking | UI with mock stats |
| Production RLS | Permissive policies (security risk) |
| API Key Security | Hardcoded in source (security risk) |

---

## Configuration Files

### `extension/config.js`
```javascript
CONFIG = {
  SUPABASE_URL: 'https://tvwghwfqscbikvwvujcy.supabase.co',
  SUPABASE_ANON_KEY: '...',
  API_URL: 'http://localhost:8000',
  MAX_EMAILS: 200
}
```

### Environment Variables (Backend)
```
SUPABASE_URL=...
SUPABASE_KEY=...
AVIATO_API_KEY=...
BACKBOARD_API_KEY=...
```

---

## Running the Project

### Backend
```bash
cd backend
pip install fastapi uvicorn aiohttp
uvicorn app:app --reload --port 8000
```

### Extension
1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `/extension` folder
4. Navigate to Gmail → click Hypatia sign-in button

---

## File Sizes

| File | Size | Purpose |
|------|------|---------|
| content.js | 94KB | Main UI + all screens |
| styles.css | 31KB | Complete styling |
| learn_user_combined.py | 28KB | LLM analysis engine |
| sent.js | 22KB | Email tracking UI |
| background.js | 20KB | Service worker |
| group_user_convos.py | 19KB | Clustering algorithm |
| template.js | 17KB | Template editor |
| campaign.js | 13KB | Campaign detail view |
| leads.js | 11KB | Lead generation UI |
