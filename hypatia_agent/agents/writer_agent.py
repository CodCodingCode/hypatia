"""
Writer Agent - Writes personalized emails based on style and CTA.

Uses a debate system with 3 sub-agents (Style, CTA, BestPractice)
to collaboratively create high-quality email templates.
"""

from ..base_agent import BaseAgent
from ..services.llm_client import LLMClient
from .debate import DebateOrchestrator


class WriterAgent(BaseAgent):
    """
    Agent responsible for writing personalized emails.

    Uses an internal debate between StyleAgent, CTAAgent, and BestPracticeAgent
    to create email templates that are then filled with contact data.
    """

    def __init__(self, supabase_client, custom_practices: str = None):
        self.supabase = supabase_client
        self.llm = LLMClient()
        self.orchestrator = DebateOrchestrator(self.llm, custom_practices)
        self._template_cache = {}  # Cache templates by (cta, style) hash

    async def execute(self, *args, **kwargs):
        return await self.write(
            contact=kwargs.get("contact", {}),
            cta=kwargs.get("cta", ""),
            style=kwargs.get("style", ""),
            sample_emails=kwargs.get("sample_emails", []),
        )

    async def write(
        self,
        contact: dict,
        cta: str,
        style: str,
        sample_emails: list = None,
    ) -> dict:
        """
        Write a personalized email for a contact.

        Uses the debate system to create a template, then fills it
        with the contact's information.

        Args:
            contact: Contact info (email, name, title, company)
            cta: Call-to-action to include
            style: Style analysis prompt from campaign_email_styles
            sample_emails: Sample emails from the campaign for reference

        Returns:
            Email dict with to, subject, body, and metadata
        """
        sample_emails = sample_emails or []

        # Extract contact info
        name = contact.get("name", "there")
        first_name = name.split()[0] if name and name != "there" else name
        title = contact.get("title", "")
        company = contact.get("company", "")

        # Check cache for existing template with same CTA/style
        cache_key = hash((cta, style))
        if cache_key in self._template_cache:
            template = self._template_cache[cache_key]
        else:
            # Run debate to create template
            template = await self.orchestrator.run_debate(
                cta=cta,
                style_prompt=style,
                sample_emails=sample_emails,
                max_rounds=2,
                verbose=True,
            )
            self._template_cache[cache_key] = template

        # Fill template with contact data
        filled = template.fill(
            first_name=first_name,
            title=title,
            company=company,
            name=name,
        )

        return {
            "to": contact["email"],
            "recipient_name": name,
            "subject": filled["subject"],
            "body": filled["body"],
            "style_used": style[:100] + "..." if style and len(style) > 100 else style,
            "personalization": {
                "name": name,
                "title": title,
                "company": company,
            },
            "template": {
                "subject": template.subject,
                "body": template.body,
                "placeholders": template.placeholders,
            },
        }
