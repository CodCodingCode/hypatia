"""
User management endpoints.
"""

import urllib.parse

from fastapi import APIRouter, HTTPException

from schemas.users import UserCreate, GmailTokenUpdate
from utils.supabase import supabase_request
from dependencies import get_agent_supabase

from hypatia_agent.services.gmail_service import GmailService, TokenExpiredError, GmailAPIError

from analytics import track_user_created

router = APIRouter(prefix="/users", tags=["Users"])


@router.post("")
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


@router.get("/{user_id}")
async def get_user(user_id: str):
    """Get user by ID."""
    result = supabase_request(f"users?id=eq.{user_id}&select=*", 'GET')
    if not result:
        raise HTTPException(status_code=404, detail="User not found")
    return result[0]


@router.patch("/{user_id}/onboarding")
async def complete_onboarding(user_id: str):
    """Mark user onboarding as complete."""
    supabase_request(
        f"users?id=eq.{user_id}",
        'PATCH',
        {'onboarding_completed': True}
    )
    return {"success": True}


@router.post("/{user_id}/gmail-token")
async def update_gmail_token(user_id: str, token: GmailTokenUpdate):
    """
    Store/update Gmail OAuth tokens for a user.
    Called by extension when tokens are refreshed.
    """
    agent_supabase = get_agent_supabase()
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


@router.post("/{user_id}/gmail-watch")
async def setup_gmail_watch(user_id: str, topic_name: str):
    """
    Set up Gmail push notifications via Pub/Sub for a user.
    Should be called after initial authentication.

    Args:
        topic_name: Full Pub/Sub topic name (e.g., projects/my-project/topics/gmail-notifications)
    """
    agent_supabase = get_agent_supabase()
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
