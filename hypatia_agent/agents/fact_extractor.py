"""
Fact Extractor Agent - Extracts verifiable facts from sample emails.

This agent is the first step in the two-part grounded email generation process.
It extracts ONLY explicit, verifiable facts from sample emails to prevent
hallucination in the subsequent generation step.
"""

from typing import List
from ..services.llm_client import LLMClient
from ..models.email_facts import ExtractedEmailFacts


class FactExtractorAgent:
    """
    Extracts verifiable facts from sample emails for grounded generation.

    This ensures that the email generation step can ONLY use facts that
    actually exist in the user's previous emails.
    """

    def __init__(self, llm_client: LLMClient = None):
        self.llm = llm_client or LLMClient()

    async def extract_facts(
        self,
        sample_emails: List[dict],
        cta: str = ""
    ) -> ExtractedEmailFacts:
        """
        Extract all verifiable facts from sample emails.

        Args:
            sample_emails: List of email dicts with 'subject' and 'body'/'content' keys
            cta: The intended CTA (used as fallback if not found in samples)

        Returns:
            ExtractedEmailFacts with all verifiable information
        """
        if not sample_emails:
            # Return minimal facts with just the provided CTA
            return ExtractedEmailFacts(cta_used=cta if cta else None)

        # Format sample emails for extraction
        emails_text = self._format_emails(sample_emails)

        system_prompt = self._get_extraction_system_prompt()
        user_prompt = self._get_extraction_user_prompt(emails_text, cta)

        try:
            result = await self.llm.complete_json(system_prompt, user_prompt)

            return ExtractedEmailFacts(
                sender_offering=result.get("sender_offering"),
                value_propositions=result.get("value_propositions", []),
                specific_claims=result.get("specific_claims", []),
                company_name=result.get("company_name"),
                product_name=result.get("product_name"),
                statistics=result.get("statistics", []),
                cta_used=result.get("cta_used") or cta,
            )
        except Exception as e:
            print(f"[FactExtractor] Extraction failed: {e}")
            # Return minimal facts on failure
            return ExtractedEmailFacts(cta_used=cta if cta else None)

    def _format_emails(self, sample_emails: List[dict]) -> str:
        """Format sample emails for the extraction prompt."""
        parts = []
        for i, email in enumerate(sample_emails[:5], 1):  # Limit to 5 samples
            subject = email.get("subject", "")
            body = email.get("body", email.get("content", email.get("snippet", "")))
            parts.append(f"--- Email {i} ---\nSubject: {subject}\n{body}")
        return "\n\n".join(parts)

    def _get_extraction_system_prompt(self) -> str:
        return """You are a fact extraction specialist. Your job is to extract ONLY verifiable, concrete facts from sample emails.

CRITICAL RULES:
1. Extract ONLY information that is EXPLICITLY stated in the emails
2. Do NOT infer, assume, or add any information that isn't written
3. If something is not mentioned, return null or empty array
4. Preserve exact wording for claims and statistics - do not paraphrase
5. Do NOT make up or guess any information

WHAT TO EXTRACT:
- sender_offering: What does the sender do or offer? (their core service/product, exactly as stated)
- value_propositions: Specific benefits or value mentioned (as array, exact wording)
- specific_claims: Any claims made about results, capabilities, etc (as array, exact wording)
- company_name: The sender's company name (only if explicitly mentioned)
- product_name: Specific product or service name (only if explicitly mentioned)
- statistics: Any numbers, percentages, or quantified claims (as array, exact wording)
- cta_used: What action is the sender asking for? (the call-to-action)

Return ONLY valid JSON with these exact keys. Use null for missing string values and [] for missing arrays."""

    def _get_extraction_user_prompt(self, emails_text: str, cta: str) -> str:
        return f"""Extract verifiable facts from these sample emails. Only extract what is EXPLICITLY written.

SAMPLE EMAILS:
{emails_text}

{f"Note: The intended CTA for the new email is: {cta}" if cta else ""}

Return JSON with the extracted facts. Only include information that is explicitly stated in the emails above.

Example format:
{{
    "sender_offering": "string or null",
    "value_propositions": ["array", "of", "strings"],
    "specific_claims": ["array", "of", "strings"],
    "company_name": "string or null",
    "product_name": "string or null",
    "statistics": ["array", "of", "strings"],
    "cta_used": "string or null"
}}"""
