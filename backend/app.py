"""
Hypatia Backend API
FastAPI server for handling email storage and campaign clustering
"""

import os
import re
import json
import urllib.request
import urllib.error
import urllib.parse
from typing import Optional
from difflib import SequenceMatcher
from pathlib import Path
from datetime import datetime

# UUID validation pattern
UUID_PATTERN = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)

def is_valid_uuid(value: str) -> bool:
    """Check if a string is a valid UUID format."""
    return bool(UUID_PATTERN.match(value))

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager

from parallel_clustering import identify_campaigns_parallel
from async_supabase import (
    AsyncSupabaseClient,
    save_campaigns_parallel,
    save_generated_leads,
    save_generated_template,
    save_generated_cadence,
    get_generated_leads,
    get_generated_template,
    get_generated_cadence,
    update_cadence_email,
)

# Import learning modules from parent directory
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from learn_user_combined import analyze_single_campaign_combined

# Import followup system from hypatia_agent
from hypatia_agent.services.followup_service import FollowupService
from hypatia_agent.services.gmail_service import GmailService, TokenExpiredError, GmailAPIError
from hypatia_agent.services.supabase_client import SupabaseClient as AgentSupabaseClient
from hypatia_agent.agents.followup_agent import FollowupAgent
from hypatia_agent.agents.people_finder_agent import PeopleFinderAgent
from hypatia_agent.agents.debate.orchestrator import DebateOrchestrator
from hypatia_agent.agents.debate.langgraph_orchestrator import LangGraphDebateOrchestrator
from hypatia_agent.services.llm_client import LLMClient

# Analytics
from analytics import (
    init_analytics,
    track_user_created,
    track_campaign_clustering_completed,
    track_campaign_analyzed,
    track_lead_generation_completed,
    track_template_generation_completed,
    track_cadence_generated,
    track_email_batch_sent,
    track_followup_scheduled,
    track_followup_cancelled,
    shutdown_analytics,
)

# Feedback Loop - "Ever Improving" AI
from feedback_loop import get_feedback_service


# =============================================================================
# CONFIGURATION
# =============================================================================

def load_env():
    """Load environment variables from .env file if it exists."""
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ.setdefault(key.strip(), value.strip())

load_env()

SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', '')
SUPABASE_SERVICE_ROLE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
SIMILARITY_THRESHOLD = 0.60

# Global async Supabase client
async_supabase_client: Optional[AsyncSupabaseClient] = None


# =============================================================================
# FASTAPI APP WITH LIFESPAN
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage async Supabase client lifecycle."""
    global async_supabase_client
    # Use service role key to bypass RLS for backend operations
    async_supabase_client = AsyncSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    # Initialize analytics
    init_analytics()

    # Initialize feedback service with database persistence
    feedback_service = get_feedback_service(async_supabase_client)
    await feedback_service.initialize_from_db()

    yield
    # Shutdown analytics
    await shutdown_analytics()
    if async_supabase_client:
        await async_supabase_client.close()


app = FastAPI(
    title="Hypatia API",
    description="Backend API for Hypatia email intelligence",
    version="1.0.0",
    lifespan=lifespan
)

# CORS - allow extension to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your extension ID
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# PYDANTIC MODELS
# =============================================================================

class UserCreate(BaseModel):
    email: str
    google_id: Optional[str] = None

class EmailData(BaseModel):
    gmail_id: str
    thread_id: Optional[str] = None
    subject: Optional[str] = None
    recipient_to: Optional[str] = None
    recipient_cc: Optional[str] = None
    recipient_bcc: Optional[str] = None
    sent_at: Optional[str] = None
    body: Optional[str] = None

class EmailBatch(BaseModel):
    user_id: str
    emails: list[EmailData]

class ClusterRequest(BaseModel):
    user_id: str


class CreateFollowupPlanRequest(BaseModel):
    user_id: str
    campaign_id: str
    emails: list[dict]
    timing_config: Optional[dict] = None  # Optional timing configuration


class FollowupConfigUpdate(BaseModel):
    followup_1_days: Optional[int] = None
    followup_2_days: Optional[int] = None
    followup_3_days: Optional[int] = None
    max_followups: Optional[int] = None
    enabled: Optional[bool] = None


class InstantRespondUpdate(BaseModel):
    instant_respond_enabled: bool


class GmailTokenUpdate(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    expires_at: str


class LeadGenerateRequest(BaseModel):
    user_id: str
    campaign_id: Optional[str] = None
    query: str
    limit: int = 20


class TemplateGenerateRequest(BaseModel):
    user_id: str
    campaign_id: str
    cta: str
    style_prompt: str
    sample_emails: list = []
    current_subject: Optional[str] = None
    current_body: Optional[str] = None


class CadenceGenerateRequest(BaseModel):
    user_id: str
    campaign_id: str
    style_prompt: str = ""
    sample_emails: list = []
    day_1: int = 1
    day_2: int = 3
    day_3: int = 7
    day_4: int = 14


class CadenceEmailUpdate(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    day_number: Optional[int] = None


class EmailToSend(BaseModel):
    recipient_email: str
    recipient_name: str
    subject: str
    body: str


class SendBatchRequest(BaseModel):
    user_id: str
    campaign_id: str
    emails: list[EmailToSend]
    instant_respond_enabled: bool = False


class CreateCampaignRequest(BaseModel):
    user_id: str
    representative_subject: str = "New Campaign"
    representative_recipient: str = ""
    contact_description: Optional[str] = None
    style_description: Optional[str] = None
    cta_description: Optional[str] = None


# =============================================================================
# SUPABASE HELPERS
# =============================================================================

def supabase_request(endpoint: str, method: str = 'GET', body=None):
    """Make a request to Supabase REST API."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"

    headers = {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    }

    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')

    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as response:
            text = response.read().decode('utf-8')
            return json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        raise HTTPException(status_code=e.code, detail=f"Supabase error: {error_body}")


def create_campaign_if_new(user_id: str, campaign_id: str, metadata: dict = None) -> str:
    """
    Create a campaign in the database if it doesn't exist.
    Returns the campaign_id (uses the provided UUID if valid).
    """
    if not campaign_id:
        raise HTTPException(status_code=400, detail="campaign_id is required")

    print(f"[Campaign] Checking if campaign exists: {campaign_id} for user {user_id}")

    # Check if campaign already exists
    existing_campaign = supabase_request(
        f"campaigns?id=eq.{campaign_id}&select=id",
        'GET'
    )
    if existing_campaign and len(existing_campaign) > 0:
        print(f"[Campaign] Campaign {campaign_id} already exists")
        return campaign_id  # Campaign exists, use it

    print(f"[Campaign] Campaign not found, creating new one...")

    # Get the next campaign number for this user
    existing = supabase_request(
        f"campaigns?user_id=eq.{user_id}&select=campaign_number&order=campaign_number.desc&limit=1",
        'GET'
    )
    next_number = (existing[0]['campaign_number'] + 1) if existing else 1

    # Create the campaign with the provided UUID
    metadata = metadata or {}
    campaign_data = {
        'id': campaign_id,  # Use the UUID provided by the extension
        'user_id': user_id,
        'campaign_number': next_number,
        'representative_subject': metadata.get('representative_subject', 'New Campaign'),
        'representative_recipient': metadata.get('representative_recipient', ''),
        'email_count': 0,
        'avg_similarity': None,
    }

    print(f"[Campaign] Creating campaign with data: {campaign_data}")

    try:
        result = supabase_request('campaigns', 'POST', campaign_data)
        if result and len(result) > 0:
            print(f"[Campaign] Created new campaign {campaign_id}")
            return campaign_id
        else:
            print(f"[Campaign] No result from insert, result: {result}")
    except Exception as e:
        print(f"[Campaign] Error creating campaign: {e}")
        raise

    raise HTTPException(status_code=500, detail="Failed to create campaign")


# =============================================================================
# CLUSTERING LOGIC
# =============================================================================

def calculate_similarity(email1: dict, email2: dict) -> float:
    """Calculate similarity between two emails using SequenceMatcher."""
    subject_sim = SequenceMatcher(None, email1.get('subject', ''), email2.get('subject', '')).ratio()
    body_sim = SequenceMatcher(None, email1.get('body', ''), email2.get('body', '')).ratio()
    return (subject_sim + body_sim) / 2


def cluster_emails(emails: list[dict]) -> list[list[int]]:
    """Cluster emails into campaigns based on similarity."""
    n = len(emails)
    clusters = []
    assigned = [False] * n

    for i in range(n):
        if assigned[i]:
            continue

        cluster = [i]
        assigned[i] = True

        for j in range(i + 1, n):
            if assigned[j]:
                continue

            for k in cluster:
                sim = calculate_similarity(emails[k], emails[j])
                if sim >= SIMILARITY_THRESHOLD:
                    cluster.append(j)
                    assigned[j] = True
                    break

        clusters.append(cluster)

    return clusters


def identify_campaigns(emails: list[dict]) -> dict:
    """Main function to identify unique campaigns from emails."""
    if not emails:
        return {"total_emails": 0, "unique_campaigns": 0, "campaigns": []}

    clusters = cluster_emails(emails)

    campaigns = []
    for campaign_id, cluster_indices in enumerate(clusters, 1):
        cluster_emails_data = [emails[i] for i in cluster_indices]
        representative = cluster_emails_data[0]

        # Calculate average internal similarity
        avg_similarity = 1.0
        if len(cluster_indices) > 1:
            similarities = []
            for i, idx1 in enumerate(cluster_indices):
                for idx2 in cluster_indices[i + 1:]:
                    similarities.append(calculate_similarity(emails[idx1], emails[idx2]))
            avg_similarity = sum(similarities) / len(similarities) if similarities else 1.0

        campaigns.append({
            "campaign_id": campaign_id,
            "representative_subject": representative.get('subject', ''),
            "representative_recipient": representative.get('recipient_to', ''),
            "email_count": len(cluster_indices),
            "email_ids": [emails[i]['id'] for i in cluster_indices],
            "avg_similarity": round(avg_similarity, 3)
        })

    campaigns.sort(key=lambda x: x['email_count'], reverse=True)

    return {
        "total_emails": len(emails),
        "unique_campaigns": len(campaigns),
        "campaigns": campaigns
    }


def save_campaigns_to_supabase(user_id: str, campaigns: list[dict]):
    """Save campaign results to Supabase."""
    # Delete existing campaigns for this user
    existing = supabase_request(f"campaigns?user_id=eq.{user_id}&select=id", 'GET')
    if existing:
        for c in existing:
            supabase_request(f"email_campaigns?campaign_id=eq.{c['id']}", 'DELETE')
        supabase_request(f"campaigns?user_id=eq.{user_id}", 'DELETE')

    # Insert new campaigns
    for campaign in campaigns:
        campaign_data = {
            'user_id': user_id,
            'campaign_number': campaign['campaign_id'],
            'representative_subject': campaign['representative_subject'],
            'representative_recipient': campaign['representative_recipient'],
            'email_count': campaign['email_count'],
            'avg_similarity': campaign['avg_similarity'],
        }

        result = supabase_request('campaigns', 'POST', campaign_data)
        if not result:
            continue

        campaign_uuid = result[0]['id']

        # Link emails to campaign
        email_links = [
            {'email_id': email_id, 'campaign_id': campaign_uuid}
            for email_id in campaign['email_ids']
        ]

        if email_links:
            supabase_request('email_campaigns', 'POST', email_links)


# =============================================================================
# API ROUTES
# =============================================================================

@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "Hypatia API"}


@app.get("/health")
async def health():
    """Health check with Supabase connection test."""
    try:
        supabase_request("users?select=count", "GET")
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "database": "disconnected", "error": str(e)}


# -----------------------------------------------------------------------------
# USER ENDPOINTS
# -----------------------------------------------------------------------------

@app.post("/users")
async def create_user(user: UserCreate):
    """Create or get existing user."""
    # Check if user exists
    existing = supabase_request(
        f"users?email=eq.{urllib.parse.quote(user.email)}&select=*",
        'GET'
    )

    if existing and len(existing) > 0:
        return {"user": existing[0], "created": False}

    # Create new user
    result = supabase_request('users', 'POST', {
        'email': user.email,
        'google_id': user.google_id
    })

    # Track new user created
    if result and len(result) > 0:
        await track_user_created(result[0]['id'], user.email)

    return {"user": result[0], "created": True}


@app.get("/users/{user_id}")
async def get_user(user_id: str):
    """Get user by ID."""
    result = supabase_request(f"users?id=eq.{user_id}&select=*", 'GET')
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    return result[0]


@app.patch("/users/{user_id}/onboarding")
async def complete_onboarding(user_id: str):
    """Mark user onboarding as complete."""
    result = supabase_request(
        f"users?id=eq.{user_id}",
        'PATCH',
        {'onboarding_completed': True}
    )
    return {"success": True}


# -----------------------------------------------------------------------------
# EMAIL ENDPOINTS
# -----------------------------------------------------------------------------

@app.post("/emails")
async def store_emails(batch: EmailBatch):
    """Store a batch of emails for a user."""
    if not batch.emails:
        return {"stored": 0}

    # Prepare emails with user_id
    emails_to_store = [
        {
            'user_id': batch.user_id,
            'gmail_id': e.gmail_id,
            'thread_id': e.thread_id,
            'subject': e.subject,
            'recipient_to': e.recipient_to,
            'recipient_cc': e.recipient_cc,
            'recipient_bcc': e.recipient_bcc,
            'sent_at': e.sent_at,
            'body': e.body
        }
        for e in batch.emails
    ]

    # Insert in batches of 50
    stored = 0
    batch_size = 50
    for i in range(0, len(emails_to_store), batch_size):
        chunk = emails_to_store[i:i + batch_size]
        try:
            supabase_request('sent_emails', 'POST', chunk)
            stored += len(chunk)
        except HTTPException as e:
            # Handle duplicate key errors gracefully
            if 'duplicate' in str(e.detail).lower():
                continue
            raise

    return {"stored": stored, "total": len(batch.emails)}


@app.get("/emails/{user_id}")
async def get_user_emails(user_id: str, limit: int = 100):
    """Get emails for a user."""
    result = supabase_request(
        f"sent_emails?user_id=eq.{user_id}&select=*&order=sent_at.desc&limit={limit}",
        'GET'
    )
    return {"emails": result or [], "count": len(result) if result else 0}


@app.post("/emails/send-batch")
async def send_email_batch(request: SendBatchRequest):
    """
    Send a batch of emails via Gmail API.

    Sends each email sequentially, stores results, and returns detailed status.
    """
    if not request.emails:
        return {"total": 0, "sent": 0, "failed": 0, "results": []}

    # Initialize Gmail service
    agent_supabase = AgentSupabaseClient()
    gmail_service = GmailService(agent_supabase)

    results = []

    for email in request.emails:
        try:
            # Send via Gmail API
            result = gmail_service.send_email(
                user_id=request.user_id,
                to=email.recipient_email,
                subject=email.subject,
                body=email.body
            )

            # Store in sent_emails table
            sent_email_data = {
                'user_id': request.user_id,
                'gmail_id': result.get('gmail_id'),
                'thread_id': result.get('thread_id'),
                'subject': email.subject,
                'recipient_to': email.recipient_email,
                'body': email.body,
                'sent_at': 'now()',
                'instant_respond_enabled': request.instant_respond_enabled
            }

            try:
                supabase_request('sent_emails', 'POST', sent_email_data)
            except HTTPException:
                # Continue even if storage fails - email was already sent
                pass

            results.append({
                "recipient_email": email.recipient_email,
                "recipient_name": email.recipient_name,
                "success": True,
                "gmail_id": result.get('gmail_id'),
                "thread_id": result.get('thread_id'),
                "error": None
            })

        except TokenExpiredError as e:
            # Token expired - this is a critical error, return immediately
            raise HTTPException(
                status_code=401,
                detail=f"Gmail token expired. Please re-authenticate. Error: {str(e)}"
            )

        except GmailAPIError as e:
            # Gmail API error for this specific email - log and continue
            results.append({
                "recipient_email": email.recipient_email,
                "recipient_name": email.recipient_name,
                "success": False,
                "gmail_id": None,
                "thread_id": None,
                "error": str(e)
            })

        except Exception as e:
            # Unexpected error - log and continue
            results.append({
                "recipient_email": email.recipient_email,
                "recipient_name": email.recipient_name,
                "success": False,
                "gmail_id": None,
                "thread_id": None,
                "error": f"Unexpected error: {str(e)}"
            })

    sent_count = sum(1 for r in results if r["success"])
    failed_count = sum(1 for r in results if not r["success"])

    # Track email batch sent
    await track_email_batch_sent(
        request.user_id,
        request.campaign_id or '',
        len(request.emails),
        sent_count,
        failed_count
    )

    return {
        "total": len(request.emails),
        "sent": sent_count,
        "failed": failed_count,
        "results": results
    }


# -----------------------------------------------------------------------------
# CAMPAIGN ENDPOINTS
# -----------------------------------------------------------------------------

@app.post("/campaigns/cluster")
async def cluster_user_campaigns(request: ClusterRequest):
    """Run clustering on user's emails and save campaigns using parallel processing."""
    # Fetch user's emails ordered by sent_at to ensure we keep the first (original) email per thread
    emails = supabase_request(
        f"sent_emails?user_id=eq.{request.user_id}&select=id,thread_id,subject,recipient_to,body&order=sent_at.asc",
        'GET'
    )

    if not emails:
        return {"message": "No emails found", "campaigns": 0}

    print(f"\n[DEBUG] Fetched {len(emails)} total emails from database")

    # Filter out replies and keep only first email per thread (cold outreach detection)
    # 1. Remove emails with Re:/RE:/Fwd:/FWD: prefixes (these are replies, not campaigns)
    # 2. Keep only the first email per thread_id (original outreach, not follow-ups in same thread)
    reply_prefixes = ('re:', 'fwd:', 'fw:')
    seen_threads = set()
    filtered_emails = []
    skipped_replies = []
    skipped_thread_dupes = []

    for email in emails:
        subject = (email.get('subject') or '').lower().strip()
        thread_id = email.get('thread_id')

        # Skip reply/forward emails
        if any(subject.startswith(prefix) for prefix in reply_prefixes):
            skipped_replies.append(email.get('subject', ''))
            continue

        # Skip if we've already seen this thread (keep only first/original email)
        if thread_id and thread_id in seen_threads:
            skipped_thread_dupes.append(email.get('subject', ''))
            continue

        if thread_id:
            seen_threads.add(thread_id)
        filtered_emails.append(email)

    print(f"[DEBUG] Skipped {len(skipped_replies)} reply/forward emails:")
    for subj in skipped_replies[:20]:
        print(f"  - SKIPPED REPLY: {subj[:80]}")
    if len(skipped_replies) > 20:
        print(f"  ... and {len(skipped_replies) - 20} more")

    print(f"[DEBUG] Skipped {len(skipped_thread_dupes)} thread duplicates:")
    for subj in skipped_thread_dupes[:10]:
        print(f"  - {subj[:60]}")
    if len(skipped_thread_dupes) > 10:
        print(f"  ... and {len(skipped_thread_dupes) - 10} more")

    print(f"[DEBUG] Proceeding with {len(filtered_emails)} filtered emails for clustering")

    if not filtered_emails:
        return {"message": "No original outreach emails found (all were replies)", "campaigns": 0}

    # Run parallel clustering on filtered emails
    result = identify_campaigns_parallel(filtered_emails)

    # Filter out single-email campaigns (only keep campaigns with 2+ emails)
    # Single emails are not "campaigns" - campaigns imply repeated outreach
    multi_email_campaigns = [c for c in result['campaigns'] if c['email_count'] >= 2]
    result['campaigns'] = multi_email_campaigns
    result['unique_campaigns'] = len(multi_email_campaigns)

    print(f"\n[DEBUG] Created {len(multi_email_campaigns)} campaigns with 2+ emails:")
    for i, camp in enumerate(multi_email_campaigns[:10]):
        print(f"  Campaign {i+1}: {camp['email_count']} emails - '{camp['representative_subject'][:50]}'")
        # Show the email IDs that will be linked to this campaign
        print(f"    Email IDs: {camp['email_ids'][:5]}{'...' if len(camp['email_ids']) > 5 else ''}")
    if len(multi_email_campaigns) > 10:
        print(f"  ... and {len(multi_email_campaigns) - 10} more campaigns")

    # Save to database using async parallel operations
    if async_supabase_client:
        save_result = await save_campaigns_parallel(
            async_supabase_client,
            request.user_id,
            result['campaigns']
        )
    else:
        # Fallback to synchronous save if async client not available
        save_campaigns_to_supabase(request.user_id, result['campaigns'])
        save_result = {"campaigns_saved": len(result['campaigns']), "email_links_saved": 0}

    # Track clustering completed
    avg_similarity = 0.0
    if result['campaigns']:
        similarities = [c.get('avg_similarity', 0) for c in result['campaigns'] if c.get('avg_similarity')]
        avg_similarity = sum(similarities) / len(similarities) if similarities else 0.0
    await track_campaign_clustering_completed(
        request.user_id,
        result['total_emails'],
        result['unique_campaigns'],
        avg_similarity,
        0  # duration_ms - would need timing wrapper
    )

    return {
        "total_emails": result['total_emails'],
        "campaigns_created": result['unique_campaigns'],
        "campaigns": result['campaigns'],
        "storage_stats": save_result
    }


@app.get("/campaigns/{user_id}")
async def get_user_campaigns(user_id: str):
    """Get campaigns for a user."""
    result = supabase_request(
        f"campaigns?user_id=eq.{user_id}&select=*&order=email_count.desc",
        'GET'
    )
    return {"campaigns": result or [], "count": len(result) if result else 0}


class CreateCampaignRequest(BaseModel):
    user_id: str
    campaign_id: str
    representative_subject: str = "New Campaign"


@app.post("/campaigns/create")
async def create_campaign(request: CreateCampaignRequest):
    """
    Create a new campaign in the database.
    Called before parallel lead/template/cadence generation to avoid race conditions.
    """
    print(f"[Campaign] Creating campaign {request.campaign_id} for user {request.user_id}")

    try:
        campaign_id = create_campaign_if_new(
            request.user_id,
            request.campaign_id,
            metadata={'representative_subject': request.representative_subject}
        )
        return {"success": True, "campaign_id": campaign_id}
    except Exception as e:
        print(f"[Campaign] Error creating campaign: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/campaigns/analyze")
async def analyze_user_campaigns(request: ClusterRequest):
    """
    Run CTA, contact, and style analysis on a user's campaigns.
    Returns enriched campaign data with analysis fields.
    """
    import concurrent.futures

    # Get user info for contact analysis context
    user_result = supabase_request(
        f"users?id=eq.{request.user_id}&select=id,email,user_type,app_purpose,display_name,contact_types",
        'GET'
    )
    if not user_result:
        raise HTTPException(status_code=404, detail="User not found")

    user = user_result[0]
    user_context = {
        'user_type': user.get('user_type'),
        'app_purpose': user.get('app_purpose'),
        'display_name': user.get('display_name'),
        'contact_types': user.get('contact_types'),
    }

    # Get user's campaigns
    campaigns = supabase_request(
        f"campaigns?user_id=eq.{request.user_id}&select=id,campaign_number,representative_subject,representative_recipient,email_count,avg_similarity&order=email_count.desc",
        'GET'
    ) or []

    if not campaigns:
        return {"campaigns": [], "analyzed": 0}

    # Analyze each campaign (run analyses in parallel per campaign)
    analyzed_campaigns = []

    def analyze_campaign(campaign):
        campaign_id = campaign['id']
        result = {
            **campaign,
            'cta_type': None,
            'cta_description': None,
            'cta_urgency': None,
            'contact_description': None,
            'style_description': None,
        }

        # Run combined analysis (CTA + contact + style in one GPT call)
        try:
            combined = analyze_single_campaign_combined(
                campaign_id, request.user_id, user_context
            )
            if combined:
                result['cta_type'] = combined.get('cta_type')
                result['cta_description'] = combined.get('cta_description')
                result['cta_urgency'] = combined.get('urgency')
                result['contact_description'] = combined.get('contact_description')
                result['style_description'] = combined.get('style_description')
        except Exception as e:
            print(f"Analysis error for campaign {campaign_id}: {e}")

        return result

    # Use ThreadPoolExecutor to analyze campaigns in parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        analyzed_campaigns = list(executor.map(analyze_campaign, campaigns))

    return {
        "campaigns": analyzed_campaigns,
        "analyzed": len(analyzed_campaigns)
    }


# -----------------------------------------------------------------------------
# FOLLOWUP ENDPOINTS
# -----------------------------------------------------------------------------

@app.post("/followups/plan")
async def create_followup_plan(request: CreateFollowupPlanRequest):
    """
    Generate and schedule AI-personalized follow-up plans.

    1. Fetches campaign style and CTA from database
    2. Uses FollowupAgent to generate personalized content
    3. Saves scheduled_followups to database

    Returns: List of created followup schedules
    """
    # Initialize services
    agent_supabase = AgentSupabaseClient()
    followup_agent = FollowupAgent(agent_supabase)
    followup_service = FollowupService(agent_supabase)

    # Save timing config if provided
    if request.timing_config:
        followup_service.update_followup_config(request.campaign_id, request.timing_config)

    # Fetch campaign data for style and CTA
    cta_data = supabase_request(
        f"campaign_ctas?campaign_id=eq.{request.campaign_id}&select=cta_description"
    )
    style_data = supabase_request(
        f"campaign_email_styles?campaign_id=eq.{request.campaign_id}&select=style_analysis_prompt"
    )

    cta = cta_data[0].get("cta_description", "") if cta_data else ""
    style_prompt = style_data[0].get("style_analysis_prompt", "") if style_data else ""

    # Get enrichments for recipients
    recipient_emails = [e.get("to") or e.get("recipient_to", "") for e in request.emails]
    enrichments_data = supabase_request(
        f"contact_enrichments?user_id=eq.{request.user_id}&success=eq.true&select=email,raw_json"
    ) or []

    enrichments = {e["email"]: e for e in enrichments_data if e.get("email") in recipient_emails}

    # Generate and persist followup plans
    result = await followup_agent.plan_with_persistence(
        user_id=request.user_id,
        emails=request.emails,
        cta=cta,
        style_prompt=style_prompt,
        enrichments=enrichments,
        campaign_id=request.campaign_id,
    )

    # Track followups scheduled
    await track_followup_scheduled(
        request.user_id,
        request.campaign_id,
        len(result["scheduled"]),
        len(request.emails)
    )

    return {
        "plans": result["plans"],
        "scheduled_count": len(result["scheduled"]),
        "scheduled": result["scheduled"],
    }


@app.get("/followups/{user_id}")
async def get_user_followups(user_id: str, status: Optional[str] = None, limit: int = 100):
    """Get all followups for a user, optionally filtered by status."""
    agent_supabase = AgentSupabaseClient()
    followup_service = FollowupService(agent_supabase)

    followups = followup_service.get_user_followups(user_id, status=status, limit=limit)

    return {
        "followups": followups,
        "count": len(followups),
    }


@app.get("/followups/pending/{user_id}")
async def get_pending_followups(user_id: str, limit: int = 50):
    """Get upcoming scheduled followups for a user."""
    agent_supabase = AgentSupabaseClient()
    followup_service = FollowupService(agent_supabase)

    followups = followup_service.get_pending_followups(user_id, limit=limit)
    stats = followup_service.get_followup_stats(user_id)

    return {
        "followups": followups,
        "count": len(followups),
        "stats": stats,
    }


@app.post("/followups/{followup_id}/cancel")
async def cancel_followup(followup_id: str, reason: str = "manual_cancel"):
    """Manually cancel a pending followup."""
    agent_supabase = AgentSupabaseClient()
    followup_service = FollowupService(agent_supabase)

    success = followup_service.cancel_followup(followup_id, reason=reason)

    if not success:
        raise HTTPException(status_code=404, detail="Followup not found or already processed")

    # Track followup cancelled
    await track_followup_cancelled('unknown', followup_id, reason)

    return {"success": True, "followup_id": followup_id, "status": "cancelled"}


@app.patch("/campaigns/{campaign_id}/followup-config")
async def update_followup_config(campaign_id: str, config: FollowupConfigUpdate):
    """Update followup timing configuration for a campaign."""
    agent_supabase = AgentSupabaseClient()
    followup_service = FollowupService(agent_supabase)

    config_dict = config.model_dump(exclude_none=True)
    if not config_dict:
        raise HTTPException(status_code=400, detail="No configuration fields provided")

    result = followup_service.update_followup_config(campaign_id, config_dict)

    if not result:
        raise HTTPException(status_code=500, detail="Failed to update configuration")

    return {"success": True, "config": result}


@app.patch("/campaigns/{campaign_id}/instant-respond")
async def update_instant_respond(campaign_id: str, config: InstantRespondUpdate):
    """Enable or disable instant AI responses for all emails in a campaign."""
    result = supabase_request(
        f"campaigns?id=eq.{campaign_id}",
        method="PATCH",
        body={"instant_respond_enabled": config.instant_respond_enabled}
    )

    if not result:
        raise HTTPException(status_code=404, detail="Campaign not found")

    return {"success": True, "instant_respond_enabled": config.instant_respond_enabled}


# -----------------------------------------------------------------------------
# LEAD GENERATION ENDPOINTS
# -----------------------------------------------------------------------------

@app.post("/leads/generate")
async def generate_leads(request: LeadGenerateRequest):
    """
    Generate leads using PeopleFinderAgent.

    Takes a natural language query describing the target contacts
    and returns matching leads from Aviato API or Clado AI.
    Saves generated leads to Supabase for later retrieval.
    """
    print(f"[LeadGen] Generating leads for user {request.user_id}")
    print(f"[LeadGen] Query: {request.query}")
    print(f"[LeadGen] Limit: {request.limit}")

    # Create campaign if it's a new one (has 'new_' prefix)
    campaign_id = create_campaign_if_new(request.user_id, request.campaign_id)

    # Initialize the PeopleFinderAgent
    agent_supabase = AgentSupabaseClient()
    people_finder = PeopleFinderAgent(agent_supabase)

    try:
        # Call the find method with the natural language query
        contacts = await people_finder.find(
            user_id=request.user_id,
            target_description=request.query,
        )

        # Limit results if we got more than requested
        if len(contacts) > request.limit:
            contacts = contacts[:request.limit]

        print(f"[LeadGen] Found {len(contacts)} contacts")

        # Save generated leads to Supabase
        save_result = await save_generated_leads(
            client=async_supabase_client,
            user_id=request.user_id,
            campaign_id=campaign_id,
            query=request.query,
            leads=contacts,
        )
        print(f"[LeadGen] Saved {save_result['leads_saved']} leads to Supabase")

        # Track lead generation
        await track_lead_generation_completed(
            request.user_id,
            campaign_id,
            request.query,
            len(contacts),
            'aviato',  # API used
            0  # duration_ms
        )

        return {
            "leads": contacts,
            "count": len(contacts),
            "saved": save_result,
            "campaign_id": campaign_id,  # Return actual UUID so frontend can update
        }

    except Exception as e:
        print(f"[LeadGen] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Lead generation failed: {str(e)}")


# -----------------------------------------------------------------------------
# TEMPLATE GENERATION ENDPOINTS
# -----------------------------------------------------------------------------

@app.post("/templates/generate")
async def generate_template(request: TemplateGenerateRequest):
    """
    Generate an email template using LangGraph multi-agent debate.

    Runs a multi-agent debate (Style, CTA, BestPractice) to create
    an optimized email template with placeholders.
    Saves generated template to Supabase for later retrieval.

    Returns the template and a communication log showing agent interactions
    (required for Foresters Financial hackathon challenge).
    """
    print(f"[TemplateGen] Generating template for campaign {request.campaign_id}")
    print(f"[TemplateGen] CTA: {request.cta[:100]}..." if len(request.cta) > 100 else f"[TemplateGen] CTA: {request.cta}")

    # Create campaign if it's a new one (has 'new_' prefix)
    campaign_id = create_campaign_if_new(request.user_id, request.campaign_id)

    # Initialize the LangGraph DebateOrchestrator (multi-agent with state management)
    llm_client = LLMClient()
    orchestrator = LangGraphDebateOrchestrator(llm_client)

    # Get feedback service for "ever improving" enhancements
    feedback_service = get_feedback_service()

    try:
        # Build style prompt, incorporating current template if provided
        style_prompt = request.style_prompt

        # FEEDBACK LOOP: Enhance prompt with example templates
        style_prompt = await feedback_service.enhance_with_examples(style_prompt, request.user_id)
        print(f"[TemplateGen] Enhanced style prompt with example templates")
        if request.current_subject or request.current_body:
            style_prompt += f"\n\nThe user has a current draft they want to improve:\n"
            if request.current_subject:
                style_prompt += f"CURRENT SUBJECT: {request.current_subject}\n"
            if request.current_body:
                style_prompt += f"CURRENT BODY:\n{request.current_body}\n"
            style_prompt += "\nUse this as inspiration but improve upon it."

        # Run the LangGraph debate to generate the template
        # Returns both the template and the communication log
        template, communication_log = await orchestrator.run_debate(
            cta=request.cta,
            style_prompt=style_prompt,
            sample_emails=request.sample_emails,
            max_rounds=2,
            verbose=True,
        )

        print(f"[TemplateGen] Generated template: {template.subject}")
        print(f"[TemplateGen] Communication log: {len(communication_log)} agent messages")

        template_dict = {
            "subject": template.subject,
            "body": template.body,
            "placeholders": template.placeholders,
        }

        # Save generated template to Supabase
        save_result = await save_generated_template(
            client=async_supabase_client,
            user_id=request.user_id,
            campaign_id=campaign_id,
            template=template_dict,
            cta=request.cta,
            style_prompt=request.style_prompt,
        )
        print(f"[TemplateGen] Saved template to Supabase: {save_result}")

        # Track template generation
        await track_template_generation_completed(
            request.user_id,
            campaign_id,
            request.cta[:50] if request.cta else None,
            0,  # generation_time_ms
            True,
            len(template.body) if template.body else 0
        )

        # FEEDBACK LOOP: Record template for quality tracking
        template_id = f"{campaign_id}_{int(datetime.now().timestamp())}"
        feedback_service.record_template_generated(
            template_id=template_id,
            campaign_id=campaign_id,
            user_id=request.user_id,
            subject=template.subject or '',
            body=template.body or '',
        )

        return {
            "template": template_dict,
            "template_id": template_id,  # For tracking edits
            "saved": save_result,
            "communication_log": communication_log,  # Agent interaction history for demo
            "feedback_enhanced": True,  # Indicates feedback loop was applied
            "campaign_id": campaign_id,  # Return actual UUID so frontend can update
        }

    except Exception as e:
        print(f"[TemplateGen] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Template generation failed: {str(e)}")


# -----------------------------------------------------------------------------
# FEEDBACK LOOP ENDPOINTS - "Ever Improving" AI
# -----------------------------------------------------------------------------

@app.get("/feedback/{user_id}")
async def get_feedback_summary(user_id: str):
    """
    Get feedback loop summary showing how the AI is improving.

    Returns:
    - Templates analyzed and their quality scores
    - Learned patterns from user behavior
    - Style recommendations for future generations
    - Query keyword recommendations

    This endpoint demonstrates the "ever improving" system for the
    Amplitude hackathon prize track.
    """
    feedback_service = get_feedback_service()
    summary = feedback_service.get_feedback_summary(user_id)

    return {
        "user_id": user_id,
        "feedback_loop_active": True,
        "summary": summary,
        "description": {
            "templates_analyzed": "Number of templates tracked for quality",
            "high_performing_templates": "Templates with low edit rate + high engagement",
            "style_recommendations": "Learned preferences applied to future generations",
            "patterns_learned": "Winning patterns extracted from successful templates",
        }
    }


class RecordEditRequest(BaseModel):
    """Request to record template edits for learning."""
    template_id: str
    user_id: str
    new_subject: str
    new_body: str


@app.post("/feedback/record-edit")
async def record_template_edit(request: RecordEditRequest):
    """
    Record when a user edits an AI-generated template.

    This analyzes exactly what the user changed and updates their
    preference profile so future templates better match their style.

    Tracks:
    - Subject length preference (short/medium/long)
    - Body length preference
    - Tone preference (casual/professional/formal)
    - CTA strength preference (soft/medium/strong)
    - Personalization preference
    - Bullet point preference
    - Simple language preference

    Also saves full edit history to database for analytics.
    """
    feedback_service = get_feedback_service(async_supabase_client)
    result = await feedback_service.record_template_edited(
        template_id=request.template_id,
        new_subject=request.new_subject,
        new_body=request.new_body,
        user_id=request.user_id,
    )

    return {
        "success": True,
        "template_id": request.template_id,
        "edit_analysis": result.get('analysis', {}),
        "preferences_updated": result.get('preferences_updated', False),
        "current_preferences": result.get('current_preferences', {}),
        "message": "Your preferences have been updated. Future templates will better match your style.",
    }


@app.get("/feedback/query-suggestions")
async def get_query_suggestions(partial_query: str = ''):
    """
    Get query suggestions based on what has worked before.

    Returns queries ranked by conversion rate (leads → sent emails).
    """
    feedback_service = get_feedback_service()

    return {
        "suggestions": feedback_service.get_query_suggestions(partial_query),
        "top_keywords": feedback_service.get_keyword_recommendations(),
    }


# -----------------------------------------------------------------------------
# CADENCE GENERATION ENDPOINTS
# -----------------------------------------------------------------------------

@app.post("/cadence/generate")
async def generate_cadence(request: CadenceGenerateRequest):
    """
    Generate a complete email cadence (initial + 3 follow-ups) using FollowupAgent.

    Returns 4 emails with configurable day timing that users can customize.
    """
    print(f"[CadenceGen] Generating cadence for campaign {request.campaign_id}")

    # Create campaign if it's a new one (has 'new_' prefix)
    campaign_id = create_campaign_if_new(request.user_id, request.campaign_id)

    agent_supabase = AgentSupabaseClient()
    followup_agent = FollowupAgent(agent_supabase)

    try:
        # Generate cadence using enhanced FollowupAgent
        cadence = await followup_agent.generate_full_cadence(
            user_id=request.user_id,
            campaign_id=campaign_id,
            style_prompt=request.style_prompt,
            sample_emails=request.sample_emails,
            timing={
                'initial': request.day_1,
                'followup_1': request.day_2,
                'followup_2': request.day_3,
                'followup_3': request.day_4,
            }
        )

        print(f"[CadenceGen] Generated {len(cadence)} emails")

        # Save to database
        save_result = await save_generated_cadence(
            client=async_supabase_client,
            user_id=request.user_id,
            campaign_id=campaign_id,
            cadence_emails=cadence,
        )
        print(f"[CadenceGen] Saved cadence to Supabase: {save_result}")

        # Fetch saved cadence to get IDs
        saved_cadence = await get_generated_cadence(async_supabase_client, campaign_id)

        return {"cadence": saved_cadence, "saved": save_result, "campaign_id": campaign_id}

    except Exception as e:
        print(f"[CadenceGen] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Cadence generation failed: {str(e)}")


@app.get("/cadence/{campaign_id}")
async def get_cadence(campaign_id: str):
    """Retrieve saved email cadence for a campaign."""
    cadence = await get_generated_cadence(async_supabase_client, campaign_id)
    return {"cadence": cadence}


@app.patch("/cadence/{cadence_id}")
async def update_cadence(cadence_id: str, update: CadenceEmailUpdate):
    """Update a single email in the cadence (timing, subject, or body)."""
    updates = update.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No update fields provided")

    result = await update_cadence_email(async_supabase_client, cadence_id, updates)
    if not result:
        raise HTTPException(status_code=404, detail="Cadence email not found")

    return {"success": True, "updated": result}


@app.post("/cadence/{cadence_id}/regenerate")
async def regenerate_cadence_email(cadence_id: str, user_id: str):
    """Regenerate a single email in the cadence using AI."""
    # Get existing cadence email (verify it belongs to this user)
    existing = await async_supabase_client.request(
        f"generated_cadence?id=eq.{cadence_id}&user_id=eq.{user_id}&select=*", 'GET'
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Cadence email not found")

    email_data = existing[0]

    agent_supabase = AgentSupabaseClient()
    followup_agent = FollowupAgent(agent_supabase)

    # Regenerate this specific email
    new_content = await followup_agent.regenerate_single_email(
        email_type=email_data['email_type'],
        campaign_id=email_data['campaign_id'],
        tone_guidance=email_data.get('tone_guidance', ''),
    )

    # Update in database
    await async_supabase_client.request(
        f"generated_cadence?id=eq.{cadence_id}",
        'PATCH',
        {'subject': new_content['subject'], 'body': new_content['body']}
    )

    return {"success": True, "email": {**email_data, **new_content}}


# -----------------------------------------------------------------------------
# SAVED AI CONTENT RETRIEVAL ENDPOINTS
# -----------------------------------------------------------------------------

@app.get("/leads/{user_id}")
async def get_leads(user_id: str, campaign_id: Optional[str] = None):
    """
    Retrieve saved generated leads for a user.
    Optionally filter by campaign_id.
    """
    # Validate user_id is a valid UUID (reject "null" or invalid strings)
    if not is_valid_uuid(user_id):
        return {"leads": [], "count": 0, "error": "Invalid user_id"}

    leads = await get_generated_leads(
        client=async_supabase_client,
        user_id=user_id,
        campaign_id=campaign_id,
    )
    return {"leads": leads, "count": len(leads)}


@app.get("/templates/{campaign_id}")
async def get_template(campaign_id: str):
    """
    Retrieve saved generated template for a campaign.
    """
    template = await get_generated_template(
        client=async_supabase_client,
        campaign_id=campaign_id,
    )
    if not template:
        return {"template": None}

    return {
        "template": {
            "subject": template.get('subject', ''),
            "body": template.get('body', ''),
            "placeholders": template.get('placeholders', []),
            "cta_used": template.get('cta_used', ''),
            "created_at": template.get('created_at', ''),
        }
    }


@app.get("/templates/user/{user_id}")
async def get_user_templates(user_id: str):
    """
    Retrieve all saved generated templates for a user.
    Returns templates with their associated campaign_id for grouping.
    """
    # Validate user_id is a valid UUID (reject "null" or invalid strings)
    if not is_valid_uuid(user_id):
        return {"templates": [], "count": 0, "error": "Invalid user_id"}

    try:
        result = await async_supabase_client.request(
            f"generated_templates?user_id=eq.{user_id}&order=created_at.desc",
            'GET'
        )
        templates = result or []
        return {
            "templates": [
                {
                    "id": t.get('id'),
                    "campaign_id": t.get('campaign_id'),
                    "subject": t.get('subject', ''),
                    "body": t.get('body', ''),
                    "placeholders": t.get('placeholders', []),
                    "cta_used": t.get('cta_used', ''),
                    "created_at": t.get('created_at', ''),
                }
                for t in templates
            ],
            "count": len(templates)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/sent/user/{user_id}")
async def get_user_sent_emails(user_id: str):
    """
    Retrieve all sent emails for a user with follow-up and reply status.
    Returns sent emails grouped by campaign with aggregate follow-up stats.
    """
    # Validate user_id is a valid UUID
    if not is_valid_uuid(user_id):
        return {"sent_emails": [], "count": 0, "error": "Invalid user_id"}

    try:
        # Query sent_emails with JOIN to scheduled_followups
        # For each sent email, get:
        # - Email details (id, subject, recipient_to, sent_at, reply_detected_at)
        # - Campaign info (campaign_id via email_campaigns junction table)
        # - Follow-up stats (count pending, next scheduled date)
        # - Reply status (reply_detected_at != NULL)

        query = """
        SELECT
            se.id,
            se.subject,
            se.recipient_to,
            se.sent_at,
            se.reply_detected_at,
            se.thread_id,
            se.body,
            ec.campaign_id,
            c.representative_subject as campaign_subject,
            COUNT(sf.id) FILTER (WHERE sf.status = 'pending') as pending_followups,
            MIN(sf.scheduled_for) FILTER (WHERE sf.status = 'pending') as next_followup_date
        FROM sent_emails se
        LEFT JOIN email_campaigns ec ON se.id = ec.email_id
        LEFT JOIN campaigns c ON ec.campaign_id = c.id
        LEFT JOIN scheduled_followups sf ON se.id = sf.original_email_id
        WHERE se.user_id = %s AND (se.is_followup = false OR se.is_followup IS NULL)
        GROUP BY se.id, ec.campaign_id, c.representative_subject
        ORDER BY se.sent_at DESC
        """

        result = await async_supabase_client.raw_query(query, (user_id,))
        sent_emails = result or []

        return {
            "sent_emails": sent_emails,
            "count": len(sent_emails)
        }
    except Exception as e:
        print(f"[SentEmails] Error: {e}")
        return {"sent_emails": [], "count": 0, "error": str(e)}


@app.get("/sent/thread/{thread_id}")
async def get_thread_details(thread_id: str, user_id: str):
    """
    Get complete thread timeline including:
    - Original sent email
    - All sent follow-ups
    - Pending scheduled follow-ups
    - Detected replies
    """
    try:
        # Query chronological thread view
        query = """
        SELECT
            'sent' as type,
            se.id,
            se.subject,
            se.body,
            se.sent_at as timestamp,
            se.is_followup,
            NULL as status,
            NULL::integer as sequence_number
        FROM sent_emails se
        WHERE se.thread_id = %s AND se.user_id = %s

        UNION ALL

        SELECT
            'scheduled' as type,
            sf.id::text,
            sf.subject,
            sf.body,
            sf.scheduled_for as timestamp,
            true as is_followup,
            sf.status,
            sf.sequence_number
        FROM scheduled_followups sf
        WHERE sf.thread_id = %s AND sf.user_id = %s AND sf.status = 'pending'

        ORDER BY timestamp ASC
        """

        result = await async_supabase_client.raw_query(query, (thread_id, user_id, thread_id, user_id))

        return {
            "thread": result or [],
            "thread_id": thread_id
        }
    except Exception as e:
        print(f"[ThreadDetails] Error: {e}")
        return {"thread": [], "error": str(e)}


@app.get("/campaigns/{campaign_id}/saved-content")
async def get_campaign_saved_content(campaign_id: str, user_id: str):
    """
    Retrieve all saved AI-generated content for a campaign in one call.
    Returns leads, template, and cadence.
    """
    # Fetch all in parallel
    import asyncio
    leads_task = get_generated_leads(async_supabase_client, user_id, campaign_id)
    template_task = get_generated_template(async_supabase_client, campaign_id)
    cadence_task = get_generated_cadence(async_supabase_client, campaign_id)

    leads, template, cadence = await asyncio.gather(leads_task, template_task, cadence_task)

    return {
        "leads": leads,
        "template": {
            "subject": template.get('subject', ''),
            "body": template.get('body', ''),
            "placeholders": template.get('placeholders', []),
        } if template else None,
        "cadence": cadence,
        "has_saved_content": bool(leads or template or cadence),
    }


# -----------------------------------------------------------------------------
# GMAIL TOKEN ENDPOINTS
# -----------------------------------------------------------------------------

@app.post("/users/{user_id}/gmail-token")
async def update_gmail_token(user_id: str, token: GmailTokenUpdate):
    """
    Store/update Gmail OAuth tokens for a user.
    Called by extension when tokens are refreshed.
    """
    agent_supabase = AgentSupabaseClient()
    gmail_service = GmailService(agent_supabase)

    result = gmail_service.store_gmail_token(
        user_id=user_id,
        access_token=token.access_token,
        expires_at=token.expires_at,
        refresh_token=token.refresh_token,
    )

    if not result:
        raise HTTPException(status_code=500, detail="Failed to store Gmail token")

    return {"success": True, "user_id": user_id}


@app.post("/users/{user_id}/gmail-watch")
async def setup_gmail_watch(user_id: str, topic_name: str):
    """
    Set up Gmail push notifications via Pub/Sub for a user.
    Should be called after initial authentication.

    Args:
        topic_name: Full Pub/Sub topic name (e.g., projects/my-project/topics/gmail-notifications)
    """
    agent_supabase = AgentSupabaseClient()
    gmail_service = GmailService(agent_supabase)

    try:
        result = gmail_service.setup_watch(user_id, topic_name)
        return {
            "success": True,
            "history_id": result.get("history_id"),
            "expiration": result.get("expiration"),
        }
    except TokenExpiredError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except GmailAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
