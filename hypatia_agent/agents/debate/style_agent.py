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

CRITICAL GROUNDING RULES (MOST IMPORTANT):
1. Use ONLY the facts provided in the ALLOWED FACTS section
2. Use ONLY {first_name} and {last_name} as placeholders - NO other placeholders
3. NEVER fabricate information (no fake articles, research, statistics, names, etc.)
4. NEVER add details that aren't in the allowed facts
5. If information seems missing, work with what you have - do NOT invent anything

STYLE RULES:
1. Keep emails SHORT (under 100 words for body)
2. Match the style EXACTLY - if they use lowercase, you use lowercase
3. The call-to-action should feel natural, not forced
4. Output ONLY the email - no explanations

When revising based on feedback, incorporate the suggestions while maintaining grounding in the allowed facts."""

    def _build_user_prompt(self, context: dict) -> str:
        """Build prompt for drafting or revising."""
        mode = context.get("mode", "draft")

        if mode == "draft":
            return self._build_draft_prompt(context)
        else:
            return self._build_revision_prompt(context)

    def _build_draft_prompt(self, context: dict) -> str:
        """Build prompt for initial draft with fact grounding."""
        style_prompt = context.get("style_prompt", "")
        sample_emails = context.get("sample_emails", [])
        cta = context.get("cta", "")
        grounded_facts = context.get("grounded_facts", "")

        # Format sample emails for style reference only
        samples_text = ""
        if sample_emails:
            samples_text = "\n\n---\n\n".join([
                f"Subject: {e.get('subject', 'N/A')}\n{e.get('body', e.get('content', ''))}"
                for e in sample_emails[:3]
            ])

        return f"""Write a cold outreach email template using ONLY the allowed facts below.

{grounded_facts if grounded_facts else ""}

STYLE GUIDE (for tone and writing style only):
{style_prompt}

SAMPLE EMAILS (for style reference - do NOT copy content, only match tone):
{samples_text if samples_text else "(No samples provided)"}

CALL-TO-ACTION:
{cta}

REMEMBER: Use ONLY {{first_name}} and {{last_name}} as placeholders. Do NOT add any information not in the ALLOWED FACTS above.

Write the email now. Format as:
SUBJECT: [subject line]
BODY:
[email body]"""

    def _build_revision_prompt(self, context: dict) -> str:
        """Build prompt for revision based on feedback, maintaining grounding."""
        current_draft = context.get("draft", "")
        feedback = context.get("feedback", "")
        style_prompt = context.get("style_prompt", "")
        grounded_facts = context.get("grounded_facts", "")

        return f"""Revise this email based on the feedback, while maintaining grounding in the allowed facts.

{grounded_facts if grounded_facts else ""}

CURRENT DRAFT:
{current_draft}

FEEDBACK TO INCORPORATE:
{feedback}

STYLE TO MAINTAIN:
{style_prompt}

CRITICAL: When revising, do NOT add any new information. Only use facts from the ALLOWED FACTS section above. Use ONLY {{first_name}} and {{last_name}} as placeholders.

Write the revised email now. Format as:
SUBJECT: [subject line]
BODY:
[email body]"""
