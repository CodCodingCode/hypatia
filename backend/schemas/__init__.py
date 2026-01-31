"""
Pydantic schemas for Hypatia Backend API.
"""

from .users import UserCreate, GmailTokenUpdate
from .emails import EmailData, EmailBatch, EmailToSend, SendBatchRequest
from .campaigns import (
    ClusterRequest,
    CreateCampaignRequest,
    FollowupConfigUpdate,
    InstantRespondUpdate,
)
from .leads import LeadGenerateRequest
from .templates import TemplateGenerateRequest
from .cadence import CadenceGenerateRequest, CadenceEmailUpdate
from .feedback import RecordEditRequest
from .followups import CreateFollowupPlanRequest

__all__ = [
    # Users
    "UserCreate",
    "GmailTokenUpdate",
    # Emails
    "EmailData",
    "EmailBatch",
    "EmailToSend",
    "SendBatchRequest",
    # Campaigns
    "ClusterRequest",
    "CreateCampaignRequest",
    "FollowupConfigUpdate",
    "InstantRespondUpdate",
    # Leads
    "LeadGenerateRequest",
    # Templates
    "TemplateGenerateRequest",
    # Cadence
    "CadenceGenerateRequest",
    "CadenceEmailUpdate",
    # Feedback
    "RecordEditRequest",
    # Followups
    "CreateFollowupPlanRequest",
]
