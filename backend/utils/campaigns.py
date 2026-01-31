"""
Campaign helper functions.
"""

from fastapi import HTTPException

from utils.supabase import supabase_request


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
