"""
Data models for extracted email facts used in grounded generation.

These models ensure that email generation is based ONLY on verifiable facts
extracted from sample emails, preventing hallucination.
"""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class ExtractedEmailFacts:
    """
    Collection of verifiable facts extracted from sample emails.

    Used to ground email generation - the LLM can ONLY use facts
    contained in this structure plus {first_name} and {last_name} placeholders.
    """
    sender_offering: Optional[str] = None  # What the sender does/offers
    value_propositions: List[str] = field(default_factory=list)  # Benefits mentioned
    specific_claims: List[str] = field(default_factory=list)  # Claims made
    company_name: Optional[str] = None  # Sender's company name
    product_name: Optional[str] = None  # Product/service name
    statistics: List[str] = field(default_factory=list)  # Numbers/stats mentioned
    cta_used: Optional[str] = None  # CTA from sample emails

    def to_grounding_prompt(self) -> str:
        """
        Format extracted facts as constraints for the generation prompt.

        Returns a formatted string that instructs the LLM to ONLY use
        these facts when generating the email.
        """
        lines = ["ALLOWED FACTS (you may ONLY use information from this list):", ""]

        if self.sender_offering:
            lines.append(f"- What sender offers/does: {self.sender_offering}")
        if self.company_name:
            lines.append(f"- Company name: {self.company_name}")
        if self.product_name:
            lines.append(f"- Product/service name: {self.product_name}")
        for vp in self.value_propositions:
            lines.append(f"- Value proposition: {vp}")
        for claim in self.specific_claims:
            lines.append(f"- Claim: {claim}")
        for stat in self.statistics:
            lines.append(f"- Statistic: {stat}")
        if self.cta_used:
            lines.append(f"- CTA to use: {self.cta_used}")

        # If no facts were extracted, note that
        if len(lines) == 2:
            lines.append("- (No specific facts extracted - keep email very generic)")

        lines.append("")
        lines.append("ALLOWED PLACEHOLDERS (use ONLY these):")
        lines.append("- {first_name} - recipient's first name")
        lines.append("- {last_name} - recipient's last name")
        lines.append("")
        lines.append("CRITICAL: Do NOT invent, fabricate, or add ANY information not listed above.")
        lines.append("Do NOT use any other placeholders like {company}, {title}, etc.")

        return "\n".join(lines)

    def has_facts(self) -> bool:
        """Check if any meaningful facts were extracted."""
        return bool(
            self.sender_offering
            or self.value_propositions
            or self.specific_claims
            or self.company_name
            or self.product_name
            or self.statistics
            or self.cta_used
        )
