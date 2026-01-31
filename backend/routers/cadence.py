"""
Email cadence generation endpoints.
"""

from fastapi import APIRouter, HTTPException

from schemas.cadence import CadenceGenerateRequest, CadenceEmailUpdate
from utils.campaigns import create_campaign_if_new
from dependencies import get_async_supabase, get_agent_supabase

from async_supabase import save_generated_cadence, get_generated_cadence, update_cadence_email
from hypatia_agent.agents.followup_agent import FollowupAgent

router = APIRouter(prefix="/cadence", tags=["Cadence"])


@router.post("/generate")
async def generate_cadence(request: CadenceGenerateRequest):
    """
    Generate a complete email cadence (initial + 3 follow-ups) using FollowupAgent.

    Returns 4 emails with configurable day timing that users can customize.
    """
    print(f"[CadenceGen] Generating cadence for campaign {request.campaign_id}")

    # Create campaign if it's a new one (has 'new_' prefix)
    campaign_id = create_campaign_if_new(request.user_id, request.campaign_id)

    agent_supabase = get_agent_supabase()
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
        async_client = get_async_supabase()
        save_result = await save_generated_cadence(
            client=async_client,
            user_id=request.user_id,
            campaign_id=campaign_id,
            cadence_emails=cadence,
        )
        print(f"[CadenceGen] Saved cadence to Supabase: {save_result}")

        # Fetch saved cadence to get IDs
        saved_cadence = await get_generated_cadence(async_client, campaign_id)

        return {"cadence": saved_cadence, "saved": save_result, "campaign_id": campaign_id}

    except Exception as e:
        print(f"[CadenceGen] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Cadence generation failed: {str(e)}")


@router.get("/{campaign_id}")
async def get_cadence(campaign_id: str):
    """Retrieve saved email cadence for a campaign."""
    async_client = get_async_supabase()
    cadence = await get_generated_cadence(async_client, campaign_id)
    return {"cadence": cadence}


@router.patch("/{cadence_id}")
async def update_cadence(cadence_id: str, update: CadenceEmailUpdate):
    """Update a single email in the cadence (timing, subject, or body)."""
    updates = update.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No update fields provided")

    async_client = get_async_supabase()
    result = await update_cadence_email(async_client, cadence_id, updates)
    if not result:
        raise HTTPException(status_code=404, detail="Cadence email not found")

    return {"success": True, "updated": result}


@router.post("/{cadence_id}/regenerate")
async def regenerate_cadence_email(cadence_id: str, user_id: str):
    """Regenerate a single email in the cadence using AI."""
    async_client = get_async_supabase()

    # Get existing cadence email (verify it belongs to this user)
    existing = await async_client.request(
        f"generated_cadence?id=eq.{cadence_id}&user_id=eq.{user_id}&select=*", 'GET'
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Cadence email not found")

    email_data = existing[0]

    agent_supabase = get_agent_supabase()
    followup_agent = FollowupAgent(agent_supabase)

    # Regenerate this specific email
    new_content = await followup_agent.regenerate_single_email(
        email_type=email_data['email_type'],
        campaign_id=email_data['campaign_id'],
        tone_guidance=email_data.get('tone_guidance', ''),
    )

    # Update in database
    await async_client.request(
        f"generated_cadence?id=eq.{cadence_id}",
        'PATCH',
        {'subject': new_content['subject'], 'body': new_content['body']}
    )

    return {"success": True, "email": {**email_data, **new_content}}
