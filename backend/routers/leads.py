"""
Lead generation endpoints.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException

from schemas.leads import LeadGenerateRequest
from backend_config import is_valid_uuid
from utils.campaigns import create_campaign_if_new
from dependencies import get_async_supabase, get_agent_supabase

from async_supabase import save_generated_leads, get_generated_leads
from hypatia_agent.agents.people_finder_agent import PeopleFinderAgent

from analytics import track_lead_generation_completed

router = APIRouter(prefix="/leads", tags=["Leads"])


@router.post("/generate")
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
    agent_supabase = get_agent_supabase()
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
        async_client = get_async_supabase()
        save_result = await save_generated_leads(
            client=async_client,
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


@router.get("/{user_id}")
async def get_leads(user_id: str, campaign_id: Optional[str] = None):
    """
    Retrieve saved generated leads for a user.
    Optionally filter by campaign_id.
    """
    # Validate user_id is a valid UUID (reject "null" or invalid strings)
    if not is_valid_uuid(user_id):
        return {"leads": [], "count": 0, "error": "Invalid user_id"}

    async_client = get_async_supabase()
    leads = await get_generated_leads(
        client=async_client,
        user_id=user_id,
        campaign_id=campaign_id,
    )
    return {"leads": leads, "count": len(leads)}
