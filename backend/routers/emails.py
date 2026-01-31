"""
Email storage and sending endpoints.
"""

from fastapi import APIRouter, HTTPException

from schemas.emails import EmailBatch, SendBatchRequest
from utils.supabase import supabase_request
from dependencies import get_agent_supabase

from hypatia_agent.services.gmail_service import GmailService, TokenExpiredError, GmailAPIError

from analytics import track_email_batch_sent

router = APIRouter(prefix="/emails", tags=["Emails"])


@router.post("")
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


@router.get("/{user_id}")
async def get_user_emails(user_id: str, limit: int = 100):
    """Get emails for a user."""
    result = supabase_request(
        f"sent_emails?user_id=eq.{user_id}&select=*&order=sent_at.desc&limit={limit}",
        'GET'
    )
    return {"emails": result or [], "count": len(result) if result else 0}


@router.post("/send-batch")
async def send_email_batch(request: SendBatchRequest):
    """
    Send a batch of emails via Gmail API.

    Sends each email sequentially, stores results, and returns detailed status.
    """
    if not request.emails:
        return {"total": 0, "sent": 0, "failed": 0, "results": []}

    # Initialize Gmail service
    agent_supabase = get_agent_supabase()
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
