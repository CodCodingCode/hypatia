"""
Sent emails and thread tracking endpoints.
"""

import asyncio
from fastapi import APIRouter

from backend_config import is_valid_uuid
from dependencies import get_async_supabase

router = APIRouter(prefix="/sent", tags=["Sent Emails"])


@router.get("/user/{user_id}")
async def get_user_sent_emails(user_id: str):
    """
    Retrieve all sent emails for a user with follow-up and reply status.
    Returns sent emails grouped by campaign with aggregate follow-up stats.
    """
    if not is_valid_uuid(user_id):
        return {"sent_emails": [], "count": 0, "error": "Invalid user_id"}

    try:
        async_client = get_async_supabase()

        # 1. Get sent emails (non-followups only)
        emails = await async_client.request(
            f"sent_emails?user_id=eq.{user_id}&or=(is_followup.is.false,is_followup.is.null)&order=sent_at.desc",
            'GET'
        )
        emails = emails or []

        if not emails:
            return {"sent_emails": [], "count": 0}

        email_ids = [e['id'] for e in emails]

        # 2. Get campaign mappings and pending followups in parallel
        email_ids_str = ','.join(email_ids)
        campaigns_task = async_client.request(
            f"email_campaigns?email_id=in.({email_ids_str})&select=email_id,campaign_id,campaigns(representative_subject)",
            'GET'
        )
        followups_task = async_client.request(
            f"scheduled_followups?user_id=eq.{user_id}&status=eq.pending&select=original_email_id,scheduled_for",
            'GET'
        )

        campaigns, followups = await asyncio.gather(campaigns_task, followups_task)
        campaigns = campaigns or []
        followups = followups or []

        # 3. Build lookup maps
        campaign_map = {}
        for ec in campaigns:
            campaign_map[ec['email_id']] = {
                'campaign_id': ec['campaign_id'],
                'campaign_subject': ec.get('campaigns', {}).get('representative_subject') if ec.get('campaigns') else None
            }

        followup_map = {}
        for f in followups:
            eid = f['original_email_id']
            if eid not in followup_map:
                followup_map[eid] = {'count': 0, 'next_date': None}
            followup_map[eid]['count'] += 1
            scheduled = f['scheduled_for']
            if scheduled and (followup_map[eid]['next_date'] is None or scheduled < followup_map[eid]['next_date']):
                followup_map[eid]['next_date'] = scheduled

        # 4. Merge results
        sent_emails = []
        for e in emails:
            eid = e['id']
            camp = campaign_map.get(eid, {})
            fu = followup_map.get(eid, {'count': 0, 'next_date': None})
            sent_emails.append({
                'id': eid,
                'subject': e.get('subject'),
                'recipient_to': e.get('recipient_to'),
                'sent_at': e.get('sent_at'),
                'reply_detected_at': e.get('reply_detected_at'),
                'thread_id': e.get('thread_id'),
                'body': e.get('body'),
                'campaign_id': camp.get('campaign_id'),
                'campaign_subject': camp.get('campaign_subject'),
                'pending_followups': fu['count'],
                'next_followup_date': fu['next_date']
            })

        return {
            "sent_emails": sent_emails,
            "count": len(sent_emails)
        }
    except Exception as e:
        print(f"[SentEmails] Error: {e}")
        return {"sent_emails": [], "count": 0, "error": str(e)}


@router.get("/thread/{thread_id}")
async def get_thread_details(thread_id: str, user_id: str):
    """
    Get complete thread timeline including:
    - Original sent email
    - All sent follow-ups
    - Pending scheduled follow-ups
    - Detected replies
    """
    try:
        async_client = get_async_supabase()

        # Fetch sent emails and scheduled followups in parallel
        sent_task = async_client.request(
            f"sent_emails?thread_id=eq.{thread_id}&user_id=eq.{user_id}&select=id,subject,body,sent_at,is_followup",
            'GET'
        )
        scheduled_task = async_client.request(
            f"scheduled_followups?thread_id=eq.{thread_id}&user_id=eq.{user_id}&status=eq.pending&select=id,subject,body,scheduled_for,status,sequence_number",
            'GET'
        )

        sent_emails, scheduled_followups = await asyncio.gather(sent_task, scheduled_task)
        sent_emails = sent_emails or []
        scheduled_followups = scheduled_followups or []

        # Build unified timeline
        timeline = []

        for se in sent_emails:
            timeline.append({
                'type': 'sent',
                'id': se['id'],
                'subject': se.get('subject'),
                'body': se.get('body'),
                'timestamp': se.get('sent_at'),
                'is_followup': se.get('is_followup'),
                'status': None,
                'sequence_number': None
            })

        for sf in scheduled_followups:
            timeline.append({
                'type': 'scheduled',
                'id': str(sf['id']),
                'subject': sf.get('subject'),
                'body': sf.get('body'),
                'timestamp': sf.get('scheduled_for'),
                'is_followup': True,
                'status': sf.get('status'),
                'sequence_number': sf.get('sequence_number')
            })

        # Sort by timestamp
        timeline.sort(key=lambda x: x['timestamp'] or '')

        return {
            "thread": timeline,
            "thread_id": thread_id
        }
    except Exception as e:
        print(f"[ThreadDetails] Error: {e}")
        return {"thread": [], "error": str(e)}
