"""
FastAPI routers for Hypatia Backend API.
"""

from . import health
from . import users
from . import emails
from . import campaigns
from . import followups
from . import leads
from . import templates
from . import cadence
from . import sent
from . import feedback

__all__ = [
    "health",
    "users",
    "emails",
    "campaigns",
    "followups",
    "leads",
    "templates",
    "cadence",
    "sent",
    "feedback",
]
