"""
CTA Agent - Ensures the call-to-action is clear and compelling.

Critiques email drafts to make sure the ask is:
- Clear and specific
- Not buried or hidden
- Not too aggressive or pushy
- Has a clear next step
"""

from .base_debate_agent import BaseDebateAgent


class CTADebateAgent(BaseDebateAgent):
    """
    Agent responsible for critiquing and improving the call-to-action.

    Reviews email drafts and provides specific feedback on how
    to make the CTA more effective.
    """

    @property
    def role_name(self) -> str:
        return "CTA"

    def get_system_prompt(self) -> str:
        return """You are an expert at crafting effective calls-to-action in cold emails.

Your job is to critique email drafts and provide specific feedback on the CTA.

EVALUATE:
1. CLARITY: Is it obvious what you want the recipient to do?
2. PLACEMENT: Is the ask visible or buried in the middle?
3. SPECIFICITY: Is there a clear next step (book a call, reply, click link)?
4. TONE: Is it too aggressive/pushy or too passive/weak?
5. FRICTION: How easy is it for them to take action?

RULES:
- Be concise - max 3 bullet points of feedback
- Be specific - say exactly what to change
- If the CTA is good, say "CTA looks good" and explain why
- Focus ONLY on the call-to-action, not style or other elements"""

    def _build_user_prompt(self, context: dict) -> str:
        """Build prompt for critiquing a draft."""
        draft = context.get("draft", "")
        intended_cta = context.get("cta", "")

        return f"""Critique the call-to-action in this email.

INTENDED CTA (what we want recipient to do):
{intended_cta}

EMAIL DRAFT:
{draft}

Provide your feedback on the CTA (max 3 bullet points):"""
