"""Template generation Pydantic schemas."""

from typing import Optional
from pydantic import BaseModel


class TemplateGenerateRequest(BaseModel):
    user_id: str
    campaign_id: str
    cta: str
    style_prompt: str
    sample_emails: list = []
    current_subject: Optional[str] = None
    current_body: Optional[str] = None
