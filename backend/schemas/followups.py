"""Followup-related Pydantic schemas."""

from typing import Optional
from pydantic import BaseModel


class CreateFollowupPlanRequest(BaseModel):
    user_id: str
    campaign_id: str
    emails: list[dict]
    timing_config: Optional[dict] = None
