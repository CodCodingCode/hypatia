"""Feedback loop Pydantic schemas."""

from pydantic import BaseModel


class RecordEditRequest(BaseModel):
    """Request to record template edits for learning."""
    template_id: str
    user_id: str
    new_subject: str
    new_body: str
