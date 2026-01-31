"""Email-related Pydantic schemas."""

from typing import Optional
from pydantic import BaseModel


class EmailData(BaseModel):
    gmail_id: str
    thread_id: Optional[str] = None
    subject: Optional[str] = None
    recipient_to: Optional[str] = None
    recipient_cc: Optional[str] = None
    recipient_bcc: Optional[str] = None
    sent_at: Optional[str] = None
    body: Optional[str] = None


class EmailBatch(BaseModel):
    user_id: str
    emails: list[EmailData]


class EmailToSend(BaseModel):
    recipient_email: str
    recipient_name: str
    subject: str
    body: str


class SendBatchRequest(BaseModel):
    user_id: str
    campaign_id: str
    emails: list[EmailToSend]
    instant_respond_enabled: bool = False
