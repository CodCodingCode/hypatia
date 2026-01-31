"""Campaign-related Pydantic schemas."""

from typing import Optional
from pydantic import BaseModel


class ClusterRequest(BaseModel):
    user_id: str


class CreateCampaignRequest(BaseModel):
    user_id: str
    campaign_id: str
    representative_subject: str = "New Campaign"


class FollowupConfigUpdate(BaseModel):
    followup_1_days: Optional[int] = None
    followup_2_days: Optional[int] = None
    followup_3_days: Optional[int] = None
    max_followups: Optional[int] = None
    enabled: Optional[bool] = None


class InstantRespondUpdate(BaseModel):
    instant_respond_enabled: bool
