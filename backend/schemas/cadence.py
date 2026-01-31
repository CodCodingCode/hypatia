"""Cadence generation Pydantic schemas."""

from typing import Optional
from pydantic import BaseModel


class CadenceGenerateRequest(BaseModel):
    user_id: str
    campaign_id: str
    style_prompt: str = ""
    sample_emails: list = []
    day_1: int = 1
    day_2: int = 3
    day_3: int = 7
    day_4: int = 14


class CadenceEmailUpdate(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    day_number: Optional[int] = None
