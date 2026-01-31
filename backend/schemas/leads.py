"""Lead generation Pydantic schemas."""

from typing import Optional
from pydantic import BaseModel


class LeadGenerateRequest(BaseModel):
    user_id: str
    campaign_id: Optional[str] = None
    query: str
    limit: int = 20
