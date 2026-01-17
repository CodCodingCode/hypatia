"""
Style Agent - Drafts and revises emails to match user's writing style.

This is the primary "writer" in the debate. It creates initial drafts
and incorporates feedback from other agents.
"""

from .base_debate_agent import BaseDebateAgent


class StyleDebateAgent(BaseDebateAgent):
    """
    Agent responsible for writing emails that match the user's style.

    Takes style analysis prompts and sample emails to understand
    the user's voice, then drafts/revises email templates.
    """

    @property
    def role_name(self) -> str:
        return "Style"

    def get_system_prompt(self) -> str:
        return """You are an expert email copywriter who specializes in matching a person's unique writing style.

Your job is to write cold outreach emails that sound EXACTLY like the person would write them - same tone, vocabulary, sentence structure, and personality.

CRITICAL RULES:
1. Use placeholders for personalization: {first_name}, {last_name}
2. Keep emails SHORT (under 100 words for body)
3. Match the style EXACTLY - if they use lowercase, you use lowercase
4. The call-to-action should feel natural, not forced
5. Output ONLY the email - no explanations

When revising based on feedback, incorporate the suggestions while maintaining the original style."""

    def _build_user_prompt(self, context: dict) -> str:
        """Build prompt for drafting or revising."""
        mode = context.get("mode", "draft")

        if mode == "draft":
            return self._build_draft_prompt(context)
        else:
            return self._build_revision_prompt(context)

    def _build_draft_prompt(self, context: dict) -> str:
        """Build prompt for initial draft."""
        style_prompt = context.get("style_prompt", "")
        sample_emails = context.get("sample_emails", [])
        cta = context.get("cta", "")

        # Format sample emails
        samples_text = ""
        if sample_emails:
            samples_text = "\n\n---\n\n".join([
                f"Subject: {e.get('subject', 'N/A')}\n{e.get('body', e.get('content', ''))}"
                for e in sample_emails[:3]
            ])

        return f"""Write a cold outreach email template.

STYLE GUIDE:
{style_prompt}

SAMPLE EMAILS FROM THIS PERSON:
{samples_text if samples_text else "(No samples provided)"}

CALL-TO-ACTION (what we want the recipient to do):
{cta}

PLACEHOLDERS TO USE:
- {{first_name}} - recipient's first name
- {{last_name}} - recipient's last name

Write the email now. Format as:
SUBJECT: [subject line]
BODY:
[email body]"""

    def _build_revision_prompt(self, context: dict) -> str:
        """Build prompt for revision based on feedback."""
        current_draft = context.get("draft", "")
        feedback = context.get("feedback", "")
        style_prompt = context.get("style_prompt", "")

        return f"""Revise this email based on the feedback, while maintaining the original style.

CURRENT DRAFT:
{current_draft}

FEEDBACK TO INCORPORATE:
{feedback}

STYLE TO MAINTAIN:
{style_prompt}

Write the revised email now. Format as:
SUBJECT: [subject line]
BODY:
[email body]"""
