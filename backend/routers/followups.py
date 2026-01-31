"""
Follow-up automation endpoints.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException

from schemas.followups import CreateFollowupPlanRequest
from schemas.campaigns import FollowupConfigUpdate, InstantRespondUpdate
from utils.supabase import supabase_request
from dependencies import get_agent_supabase

from hypatia_agent.services.followup_service import FollowupService
from hypatia_agent.agents.followup_agent import FollowupAgent

from analytics import track_followup_scheduled, track_followup_cancelled

router = APIRouter(prefix="/followups", tags=["Follow-ups"])


@router.post("/plan")
async def create_followup_plan(request: CreateFollowupPlanRequest):
    """
    Generate and schedule AI-personalized follow-up plans.

    1. Fetches campaign style and CTA from database
    2. Uses FollowupAgent to generate personalized content
    3. Saves scheduled_followups to database

    Returns: List of created followup schedules
    """
    # Initialize services
    agent_supabase = get_agent_supabase()
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


@router.get("/{user_id}")
async def get_user_followups(user_id: str, status: Optional[str] = None, limit: int = 100):
    """Get all followups for a user, optionally filtered by status."""
    agent_supabase = get_agent_supabase()
    followup_service = FollowupService(agent_supabase)

    followups = followup_service.get_user_followups(user_id, status=status, limit=limit)

    return {
        "followups": followups,
        "count": len(followups),
    }


@router.get("/pending/{user_id}")
async def get_pending_followups(user_id: str, limit: int = 50):
    """Get upcoming scheduled followups for a user."""
    agent_supabase = get_agent_supabase()
    followup_service = FollowupService(agent_supabase)

    followups = followup_service.get_pending_followups(user_id, limit=limit)
    stats = followup_service.get_followup_stats(user_id)

    return {
        "followups": followups,
        "count": len(followups),
        "stats": stats,
    }


@router.post("/{followup_id}/cancel")
async def cancel_followup(followup_id: str, reason: str = "manual_cancel"):
    """Manually cancel a pending followup."""
    agent_supabase = get_agent_supabase()
    followup_service = FollowupService(agent_supabase)

    success = followup_service.cancel_followup(followup_id, reason=reason)

    if not success:
        raise HTTPException(status_code=404, detail="Followup not found or already processed")

    # Track followup cancelled
    await track_followup_cancelled('unknown', followup_id, reason)

    return {"success": True, "followup_id": followup_id, "status": "cancelled"}


# These endpoints are under /campaigns/ path but logically belong to followups
# We include them here for code organization but register them with the campaigns prefix

campaigns_router = APIRouter(prefix="/campaigns", tags=["Follow-ups"])


@campaigns_router.patch("/{campaign_id}/followup-config")
async def update_followup_config(campaign_id: str, config: FollowupConfigUpdate):
    """Update followup timing configuration for a campaign."""
    agent_supabase = get_agent_supabase()
    followup_service = FollowupService(agent_supabase)

    config_dict = config.model_dump(exclude_none=True)
    if not config_dict:
        raise HTTPException(status_code=400, detail="No configuration fields provided")

    result = followup_service.update_followup_config(campaign_id, config_dict)

    if not result:
        raise HTTPException(status_code=500, detail="Failed to update configuration")

    return {"success": True, "config": result}


@campaigns_router.patch("/{campaign_id}/instant-respond")
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
