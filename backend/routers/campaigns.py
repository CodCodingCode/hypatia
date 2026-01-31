"""
Campaign management endpoints.
"""

import asyncio
import concurrent.futures
from pathlib import Path
import sys

from fastapi import APIRouter, HTTPException

from schemas.campaigns import ClusterRequest, CreateCampaignRequest
from utils.supabase import supabase_request
from utils.clustering import save_campaigns_to_supabase
from utils.campaigns import create_campaign_if_new
from dependencies import get_async_supabase

from parallel_clustering import identify_campaigns_parallel
from async_supabase import (
    save_campaigns_parallel,
    get_generated_leads,
    get_generated_template,
    get_generated_cadence,
)

from analytics import track_campaign_clustering_completed, track_campaign_analyzed

# Import learning modules from parent directory
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from learn_user_combined import analyze_single_campaign_combined

router = APIRouter(prefix="/campaigns", tags=["Campaigns"])


@router.post("/cluster")
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
    async_client = get_async_supabase()
    if async_client:
        save_result = await save_campaigns_parallel(
            async_client,
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


@router.get("/{user_id}")
async def get_user_campaigns(user_id: str):
    """Get campaigns for a user."""
    result = supabase_request(
        f"campaigns?user_id=eq.{user_id}&select=*&order=email_count.desc",
        'GET'
    )
    return {"campaigns": result or [], "count": len(result) if result else 0}


@router.post("/create")
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


@router.post("/analyze")
async def analyze_user_campaigns(request: ClusterRequest):
    """
    Run CTA, contact, and style analysis on a user's campaigns.
    Returns enriched campaign data with analysis fields.
    """
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


@router.get("/{campaign_id}/saved-content")
async def get_campaign_saved_content(campaign_id: str, user_id: str):
    """
    Retrieve all saved AI-generated content for a campaign in one call.
    Returns leads, template, and cadence.
    """
    async_client = get_async_supabase()

    # Fetch all in parallel
    leads_task = get_generated_leads(async_client, user_id, campaign_id)
    template_task = get_generated_template(async_client, campaign_id)
    cadence_task = get_generated_cadence(async_client, campaign_id)

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
