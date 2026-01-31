"""
Simple Template Generator - Direct OpenRouter LLM call.

Replaces the complex LangGraph multi-agent debate with a single,
comprehensive LLM call that includes CTA guidance and best practices.
"""

import re
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional

from .llm_client import LLMClient
from ..models.email_facts import ExtractedEmailFacts
from ..agents.fact_extractor import FactExtractorAgent


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


class TemplateGenerator:
    """
    Simple template generator using a single LLM call.

    Combines CTA guidance, best practices, and style matching
    into one comprehensive prompt for efficiency.
    """

    def __init__(self, llm_client: LLMClient = None):
        self.llm = llm_client or LLMClient()
        self.fact_extractor = FactExtractorAgent(self.llm)

    async def generate(
        self,
        cta: str,
        style_prompt: str,
        sample_emails: List[dict] = None,
        verbose: bool = True,
    ) -> tuple[EmailTemplate, list[dict]]:
        """
        Generate an email template with a single LLM call.

        Args:
            cta: What we want the recipient to do
            style_prompt: Analysis of user's writing style
            sample_emails: Example emails from the user
            verbose: Print progress to console

        Returns:
            Tuple of (EmailTemplate, communication_log)
        """
        if verbose:
            print("  [TemplateGen] Step 1: Extracting facts from sample emails...")

        # Extract grounded facts to prevent hallucination
        extracted_facts = await self.fact_extractor.extract_facts(
            sample_emails=sample_emails or [],
            cta=cta
        )
        grounded_facts = extracted_facts.to_grounding_prompt()

        if verbose:
            print(f"  [TemplateGen] Extracted facts: {len(extracted_facts.value_propositions)} value props, {len(extracted_facts.specific_claims)} claims")
            print("  [TemplateGen] Step 2: Generating template...")

        # Build comprehensive prompt
        system_prompt = self._build_system_prompt()
        user_prompt = self._build_user_prompt(
            cta=cta,
            style_prompt=style_prompt,
            sample_emails=sample_emails or [],
            grounded_facts=grounded_facts,
        )

        # Single LLM call
        start_time = datetime.now()
        response = await self.llm.complete(system_prompt, user_prompt)
        end_time = datetime.now()

        # Parse the response
        template = self._parse_response(response)

        if verbose:
            print(f"  [TemplateGen] Generated template: {template.subject}")

        # Simple logging for debugging
        communication_log = [
            {
                "timestamp": start_time.isoformat(),
                "from": "TemplateGenerator",
                "to": "LLM",
                "type": "request",
                "content": user_prompt[:300] + "..." if len(user_prompt) > 300 else user_prompt,
                "metadata": {"model": self.llm.model}
            },
            {
                "timestamp": end_time.isoformat(),
                "from": "LLM",
                "to": "TemplateGenerator",
                "type": "response",
                "content": f"Subject: {template.subject}",
                "metadata": {
                    "duration_ms": int((end_time - start_time).total_seconds() * 1000),
                    "placeholders": template.placeholders
                }
            }
        ]

        return template, communication_log

    def _build_system_prompt(self) -> str:
        """Build the system prompt with all guidance combined."""
        return """You are an expert cold email copywriter. Generate a professional outreach email template.

COLD EMAIL BEST PRACTICES:
- Keep subject lines short (5-7 words) and curiosity-inducing
- Keep body under 100 words - busy people skim
- Lead with value for the recipient, not your credentials
- One clear call-to-action only - make it easy to respond
- Sound human and conversational, not corporate or salesy
- Use short paragraphs (2-3 sentences max)
- End with a simple, low-commitment ask

CTA GUIDANCE:
- Make the CTA specific and actionable
- Frame it as helping them, not you
- Offer a clear next step (call, reply, link)
- Keep it low-pressure - suggest rather than demand

PLACEHOLDERS:
- Use {first_name} for recipient's first name
- Use {last_name} for recipient's last name
- Do NOT use other placeholders like {company} or {title}

OUTPUT FORMAT:
Return the template in this exact format:
SUBJECT: [your subject line here]
BODY:
[your email body here]"""

    def _build_user_prompt(
        self,
        cta: str,
        style_prompt: str,
        sample_emails: List[dict],
        grounded_facts: str,
    ) -> str:
        """Build the user prompt with all context."""
        parts = []

        # Grounded facts (to prevent hallucination)
        parts.append(grounded_facts)
        parts.append("")

        # Style guidance
        if style_prompt:
            parts.append("WRITING STYLE TO MATCH:")
            parts.append(style_prompt)
            parts.append("")

        # CTA
        parts.append("CALL-TO-ACTION TO INCLUDE:")
        parts.append(cta)
        parts.append("")

        # Sample emails for reference
        if sample_emails:
            parts.append("SAMPLE EMAILS FOR TONE REFERENCE:")
            for i, email in enumerate(sample_emails[:3], 1):
                subject = email.get("subject", "")
                body = email.get("body", email.get("content", email.get("snippet", "")))
                # Truncate long bodies
                if len(body) > 300:
                    body = body[:300] + "..."
                parts.append(f"--- Example {i} ---")
                parts.append(f"Subject: {subject}")
                parts.append(body)
                parts.append("")

        parts.append("Generate a cold email template following all the guidance above.")
        parts.append("Remember: Match the sender's writing style, use ONLY the allowed facts, and include a clear CTA.")

        return "\n".join(parts)

    def _parse_response(self, response: str) -> EmailTemplate:
        """Parse LLM response into EmailTemplate."""
        subject = ""
        body = ""

        # Extract subject
        subject_match = re.search(r'SUBJECT:\s*(.+?)(?:\n|BODY:)', response, re.IGNORECASE)
        if subject_match:
            subject = subject_match.group(1).strip()

        # Extract body
        body_match = re.search(r'BODY:\s*(.+)', response, re.IGNORECASE | re.DOTALL)
        if body_match:
            body = body_match.group(1).strip()
        else:
            # Fallback: use everything after subject
            if subject_match:
                body = response[subject_match.end():].strip()
            else:
                body = response.strip()

        # Default subject if not found
        if not subject:
            subject = "Quick question"

        # Extract placeholders
        placeholders = list(set(re.findall(r'\{(\w+)\}', subject + body)))

        return EmailTemplate(
            subject=subject,
            body=body,
            placeholders=placeholders,
        )


# Convenience function for backward compatibility
async def generate_template(
    cta: str,
    style_prompt: str,
    sample_emails: list = None,
    verbose: bool = True,
    llm_client: LLMClient = None,
) -> tuple[EmailTemplate, list[dict]]:
    """
    Convenience function to generate a template.

    Returns:
        Tuple of (EmailTemplate, communication_log)
    """
    generator = TemplateGenerator(llm_client)
    return await generator.generate(
        cta=cta,
        style_prompt=style_prompt,
        sample_emails=sample_emails,
        verbose=verbose,
    )
