"""
Debate Orchestrator - Runs round-robin debate between agents.

Flow:
1. StyleAgent drafts initial template
2. CTAAgent critiques → StyleAgent revises
3. BestPracticeAgent critiques → StyleAgent revises
4. Return final template with placeholders
"""

import re
from dataclasses import dataclass
from typing import Optional

from ...services.llm_client import LLMClient
from .style_agent import StyleDebateAgent
from .cta_agent import CTADebateAgent
from .best_practice_agent import BestPracticeDebateAgent


@dataclass
class EmailTemplate:
    """Final email template with placeholders."""
    subject: str
    body: str
    placeholders: list[str]

    def fill(self, **kwargs) -> dict:
        """Fill placeholders with actual values."""
        subject = self.subject
        body = self.body

        for key, value in kwargs.items():
            placeholder = "{" + key + "}"
            subject = subject.replace(placeholder, str(value))
            body = body.replace(placeholder, str(value))

        return {"subject": subject, "body": body}


class DebateOrchestrator:
    """
    Orchestrates the debate between Style, CTA, and BestPractice agents.

    Uses round-robin critique to iteratively improve the email template.
    """

    def __init__(self, llm_client: LLMClient = None, custom_practices: str = None):
        self.llm = llm_client or LLMClient()
        self.style_agent = StyleDebateAgent(self.llm)
        self.cta_agent = CTADebateAgent(self.llm)
        self.best_practice_agent = BestPracticeDebateAgent(self.llm, custom_practices)

    async def run_debate(
        self,
        cta: str,
        style_prompt: str,
        sample_emails: list = None,
        max_rounds: int = 2,
        verbose: bool = True,
    ) -> EmailTemplate:
        """
        Run the debate to create an email template.

        Args:
            cta: What we want the recipient to do
            style_prompt: Analysis of user's writing style
            sample_emails: Example emails from the user
            max_rounds: Number of critique/revision cycles
            verbose: Print progress to console

        Returns:
            EmailTemplate with subject, body, and placeholders
        """
        sample_emails = sample_emails or []

        if verbose:
            print("  [Debate] Starting email template debate...")

        # Round 1: StyleAgent creates initial draft
        if verbose:
            print("  [Debate] StyleAgent drafting initial template...")

        draft = await self.style_agent.respond({
            "mode": "draft",
            "cta": cta,
            "style_prompt": style_prompt,
            "sample_emails": sample_emails,
        })

        if verbose:
            print(f"  [Debate] Initial draft created ({len(draft)} chars)")

        # Debate rounds
        for round_num in range(max_rounds):
            if verbose:
                print(f"  [Debate] Round {round_num + 1}/{max_rounds}")

            # CTA Agent critique
            if verbose:
                print("  [Debate] CTAAgent critiquing...")

            cta_feedback = await self.cta_agent.respond({
                "draft": draft,
                "cta": cta,
            })

            if verbose:
                print(f"  [Debate] CTA feedback: {cta_feedback[:100]}...")

            # StyleAgent revises based on CTA feedback
            if verbose:
                print("  [Debate] StyleAgent revising for CTA...")

            draft = await self.style_agent.respond({
                "mode": "revise",
                "draft": draft,
                "feedback": cta_feedback,
                "style_prompt": style_prompt,
            })

            # BestPractice Agent critique
            if verbose:
                print("  [Debate] BestPracticeAgent critiquing...")

            bp_feedback = await self.best_practice_agent.respond({
                "draft": draft,
            })

            if verbose:
                print(f"  [Debate] Best practice feedback: {bp_feedback[:100]}...")

            # StyleAgent revises based on best practice feedback
            if verbose:
                print("  [Debate] StyleAgent revising for best practices...")

            draft = await self.style_agent.respond({
                "mode": "revise",
                "draft": draft,
                "feedback": bp_feedback,
                "style_prompt": style_prompt,
            })

        if verbose:
            print("  [Debate] Debate complete, parsing final template...")

        # Parse final draft into EmailTemplate
        template = self._parse_draft(draft)

        if verbose:
            print(f"  [Debate] Final template: {template.subject}")

        return template

    def _parse_draft(self, draft: str) -> EmailTemplate:
        """Parse a draft response into an EmailTemplate."""
        subject = ""
        body = ""

        # Try to extract subject line
        subject_match = re.search(r'SUBJECT:\s*(.+?)(?:\n|BODY:)', draft, re.IGNORECASE)
        if subject_match:
            subject = subject_match.group(1).strip()

        # Try to extract body
        body_match = re.search(r'BODY:\s*(.+)', draft, re.IGNORECASE | re.DOTALL)
        if body_match:
            body = body_match.group(1).strip()
        else:
            # If no BODY: marker, use everything after subject
            if subject_match:
                body = draft[subject_match.end():].strip()
            else:
                body = draft.strip()

        # If no subject found, generate a simple one
        if not subject:
            subject = "Quick question"

        # Find all placeholders used
        placeholders = list(set(re.findall(r'\{(\w+)\}', subject + body)))

        return EmailTemplate(
            subject=subject,
            body=body,
            placeholders=placeholders,
        )
