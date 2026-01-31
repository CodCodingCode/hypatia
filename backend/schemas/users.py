"""User-related Pydantic schemas."""

from typing import Optional
from pydantic import BaseModel


class UserCreate(BaseModel):
    email: str
    google_id: Optional[str] = None


class GmailTokenUpdate(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    expires_at: str
