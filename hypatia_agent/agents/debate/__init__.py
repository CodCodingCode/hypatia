"""Debate agents for collaborative email template generation."""

from .base_debate_agent import BaseDebateAgent
from .style_agent import StyleDebateAgent
from .cta_agent import CTADebateAgent
from .best_practice_agent import BestPracticeDebateAgent
from .orchestrator import DebateOrchestrator

__all__ = [
    "BaseDebateAgent",
    "StyleDebateAgent",
    "CTADebateAgent",
    "BestPracticeDebateAgent",
    "DebateOrchestrator",
]
