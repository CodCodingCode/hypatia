"""
Enhanced Follow-up Agent - Creates AI-personalized follow-up content.

Uses LLM (Backboard API with Gemini) to generate each follow-up uniquely based on:
- Recipient data (name, title, company from enrichments)
- Original email content
- CTA
- User's email style (from campaign_email_styles table)
"""

from datetime import datetime, timedelta, timezone
from ..base_agent import BaseAgent
from ..services.llm_client import LLMClient
from ..services.supabase_client import SupabaseClient


class FollowupAgent(BaseAgent):
    """Agent responsible for creating AI-personalized follow-up plans."""

    def __init__(self, supabase_client: SupabaseClient = None):
        self.supabase = supabase_client or SupabaseClient()
        self.llm = LLMClient()

    async def execute(self, *args, **kwargs):
        return await self.plan(
            emails=kwargs.get("emails", []),
            cta=kwargs.get("cta", ""),
            style_prompt=kwargs.get("style_prompt", ""),
            enrichments=kwargs.get("enrichments", {}),
            campaign_id=kwargs.get("campaign_id"),
        )

    async def plan(
        self,
        emails: list,
        cta: str = "",
        style_prompt: str = "",
        enrichments: dict = None,
        campaign_id: str = None,
    ) -> list:
        """
        Create personalized follow-up plans for sent emails.

        Args:
            emails: List of emails that were sent
            cta: The original call-to-action for context
            style_prompt: User's writing style from campaign_email_styles
            enrichments: Dict mapping email -> enrichment data
            campaign_id: Optional campaign ID for config lookup

        Returns:
            List of follow-up plans with timing and AI-generated content
        """
        plans = []
        enrichments = enrichments or {}

        config = await self._get_followup_config(campaign_id)

        for i, email in enumerate(emails):
            recipient_email = email.get("to", "")
            enrichment = enrichments.get(recipient_email, {})

            followups = await self._generate_followup_sequence(
                email=email,
                cta=cta,
                style_prompt=style_prompt,
                enrichment=enrichment,
                config=config,
            )

            email_plan = {
                "email_index": i,
                "recipient": recipient_email,
                "recipient_name": email.get("recipient_name", ""),
                "original_subject": email.get("subject", ""),
                "thread_id": email.get("thread_id", ""),
                "followups": followups,
            }

            plans.append(email_plan)

        return plans

    async def _generate_followup_sequence(
        self,
        email: dict,
        cta: str,
        style_prompt: str,
        enrichment: dict,
        config: dict,
    ) -> list:
        """Generate 3 personalized follow-up emails using LLM."""

        followup_types = [
            {
                "day": config.get("followup_1_days", 3),
                "type": "gentle_reminder",
                "tone": "Friendly check-in, acknowledge they're busy, keep it very short",
            },
            {
                "day": config.get("followup_2_days", 7),
                "type": "add_value",
                "tone": "Provide additional value or a new angle, reference the CTA",
            },
            {
                "day": config.get("followup_3_days", 14),
                "type": "final_attempt",
                "tone": "Graceful last attempt, low pressure, leave the door open",
            },
        ]

        now = datetime.now(timezone.utc)
        followups = []
        max_followups = config.get("max_followups", 3)

        for ft in followup_types[:max_followups]:
            scheduled_date = now + timedelta(days=ft["day"])

            content = await self._generate_single_followup(
                email=email,
                cta=cta,
                style_prompt=style_prompt,
                enrichment=enrichment,
                followup_type=ft["type"],
                tone_guidance=ft["tone"],
            )

            followups.append({
                "sequence_number": ft["day"],
                "type": ft["type"],
                "scheduled_for": scheduled_date.isoformat(),
                "subject": content["subject"],
                "body": content["body"],
                "condition": "if_no_reply",
            })

        return followups

    async def _generate_single_followup(
        self,
        email: dict,
        cta: str,
        style_prompt: str,
        enrichment: dict,
        followup_type: str,
        tone_guidance: str,
    ) -> dict:
        """Generate a single follow-up email using LLM."""

        recipient_name = email.get("recipient_name", "there")
        first_name = recipient_name.split()[0] if recipient_name and recipient_name != "there" else "there"

        title = ""
        company = ""
        if enrichment and enrichment.get("raw_json"):
            raw_json = enrichment.get("raw_json", {})
            if isinstance(raw_json, str):
                import json
                try:
                    raw_json = json.loads(raw_json)
                except json.JSONDecodeError:
                    raw_json = {}

            person = raw_json.get("person", {})
            title = person.get("title", "")
            company = person.get("company", {}).get("name", "") if person.get("company") else ""

        system_prompt = f"""You write very brief follow-up emails.

CRITICAL RULES:
- NEVER make up or fabricate any information (no fake articles, research, news, etc.)
- NEVER add new content that wasn't in the original email
- Keep it to 2-3 sentences MAX
- Just politely bump the thread asking if they had a chance to look at your previous email
- The subject MUST be exactly "Re: " followed by the original subject
- Sign off with just "Best" - no name needed

{f"STYLE: {style_prompt}" if style_prompt else ""}"""

        user_prompt = f"""Write a very short follow-up email (2-3 sentences max).

Original subject: {email.get('subject', '')}
Recipient first name: {first_name}
Followup type: {followup_type}

Just write a brief "checking in" style message. Do NOT invent any new information, articles, or research.

Return ONLY valid JSON with exactly two keys: "subject" and "body". No markdown, no code blocks."""

        try:
            result = await self.llm.complete_json(system_prompt, user_prompt)
            return {
                "subject": result.get("subject", f"Re: {email.get('subject', 'Following up')}"),
                "body": result.get("body", self._get_fallback_body(first_name, followup_type)),
            }
        except Exception as e:
            print(f"LLM followup generation failed: {e}")
            return {
                "subject": f"Re: {email.get('subject', 'Following up')}",
                "body": self._get_fallback_body(first_name, followup_type),
            }

    def _get_fallback_body(self, name: str, followup_type: str) -> str:
        """Return a safe fallback template if LLM fails."""
        templates = {
            "gentle_reminder": f"Hi {name},\n\nJust wanted to bump this up - did you get a chance to look at my previous email?\n\nBest",
            "add_value": f"Hi {name},\n\nFollowing up on my last email. Let me know if you have any questions.\n\nBest",
            "final_attempt": f"Hi {name},\n\nCircling back one more time. No worries if the timing isn't right.\n\nBest",
        }
        return templates.get(followup_type, templates["gentle_reminder"])

    async def _get_followup_config(self, campaign_id: str = None) -> dict:
        """Get followup timing configuration."""
        if not campaign_id:
            return self._default_config()

        result = self.supabase.request(
            f"followup_configs?campaign_id=eq.{campaign_id}&select=*"
        )

        if result and len(result) > 0:
            return result[0]
        return self._default_config()

    def _default_config(self) -> dict:
        return {
            "followup_1_days": 3,
            "followup_2_days": 7,
            "followup_3_days": 14,
            "max_followups": 3,
            "enabled": True,
        }

    async def plan_with_persistence(
        self,
        user_id: str,
        emails: list,
        cta: str = "",
        style_prompt: str = "",
        enrichments: dict = None,
        campaign_id: str = None,
    ) -> dict:
        """
        Create follow-up plans and save them to the database.

        This is the main entry point when you want to both generate
        and persist the follow-up plans.

        Returns:
            dict with 'plans' (the generated plans) and 'scheduled' (DB records)
        """
        from ..services.followup_service import FollowupService

        plans = await self.plan(
            emails=emails,
            cta=cta,
            style_prompt=style_prompt,
            enrichments=enrichments,
            campaign_id=campaign_id,
        )

        followup_service = FollowupService(self.supabase)
        scheduled = []

        for i, plan in enumerate(plans):
            original_email = emails[i] if i < len(emails) else {}

            created = followup_service.schedule_followups(
                user_id=user_id,
                original_email=original_email,
                followup_plans=plan.get("followups", []),
                campaign_id=campaign_id,
            )
            scheduled.extend(created)

        return {
            "plans": plans,
            "scheduled": scheduled,
        }

    # =========================================================================
    # CADENCE GENERATION METHODS
    # =========================================================================

    async def generate_full_cadence(
        self,
        user_id: str,
        campaign_id: str,
        style_prompt: str = "",
        sample_emails: list = None,
        timing: dict = None,
    ) -> list:
        """
        Generate a complete 4-email cadence (initial + 3 follow-ups).

        Args:
            user_id: User ID for context
            campaign_id: Campaign ID for fetching campaign data
            style_prompt: User's writing style description
            sample_emails: Sample emails from the campaign for context
            timing: Dict with keys 'initial', 'followup_1', 'followup_2', 'followup_3'
                    containing day numbers (default: 1, 3, 7, 14)

        Returns:
            List of 4 email dicts with day_number, email_type, subject, body, tone_guidance
        """
        timing = timing or {'initial': 1, 'followup_1': 3, 'followup_2': 7, 'followup_3': 14}
        sample_emails = sample_emails or []

        # Get campaign data for context
        campaign = {}
        if campaign_id and not campaign_id.startswith("new_"):
            campaign_data = self.supabase.request(
                f"campaigns?id=eq.{campaign_id}&select=*"
            )
            campaign = campaign_data[0] if campaign_data else {}

        cadence_types = [
            {
                'day': timing.get('initial', 1),
                'type': 'initial',
                'tone': 'First outreach - establish value proposition clearly and concisely',
            },
            {
                'day': timing.get('followup_1', 3),
                'type': 'followup_1',
                'tone': 'Friendly check-in, acknowledge they are busy, keep it very short',
            },
            {
                'day': timing.get('followup_2', 7),
                'type': 'followup_2',
                'tone': 'Provide additional value or a new angle',
            },
            {
                'day': timing.get('followup_3', 14),
                'type': 'followup_3',
                'tone': 'Graceful last attempt, low pressure, leave the door open',
            },
        ]

        cadence = []
        for ct in cadence_types:
            content = await self._generate_cadence_email(
                email_type=ct['type'],
                tone_guidance=ct['tone'],
                style_prompt=style_prompt,
                sample_emails=sample_emails,
                campaign=campaign,
            )

            cadence.append({
                'day_number': ct['day'],
                'email_type': ct['type'],
                'subject': content['subject'],
                'body': content['body'],
                'tone_guidance': ct['tone'],
            })

        return cadence

    async def _generate_cadence_email(
        self,
        email_type: str,
        tone_guidance: str,
        style_prompt: str,
        sample_emails: list,
        campaign: dict,
    ) -> dict:
        """Generate a single email for the cadence."""

        is_initial = email_type == 'initial'

        # Build context from sample emails
        email_context = ""
        if sample_emails:
            email_context = "\n\nSAMPLE EMAILS FROM THIS CAMPAIGN (match this style):\n"
            for i, email in enumerate(sample_emails[:2], 1):
                subject = email.get('subject', '')
                body = email.get('body', email.get('snippet', ''))[:300]
                email_context += f"\n--- Sample {i} ---\nSubject: {subject}\nBody: {body}\n"

        system_prompt = f"""You write {'initial outreach' if is_initial else 'follow-up'} emails.

CRITICAL RULES:
- Keep emails SHORT (2-4 sentences for follow-ups, 4-6 for initial)
- Be professional but personable
- Use placeholders: {{{{first_name}}}}, {{{{company}}}}, {{{{title}}}}
- {"Subject should be attention-grabbing but not clickbait" if is_initial else "Subject MUST start with 'Re: ' to indicate follow-up"}
- Sign off with just "Best" - no name needed
- NEVER fabricate information (no fake articles, research, news)

{f"STYLE GUIDANCE: {style_prompt}" if style_prompt else ""}
{email_context}"""

        contact_desc = campaign.get('contact_description', 'Professional contacts')
        rep_subject = campaign.get('representative_subject', '')

        user_prompt = f"""Write a {email_type.replace('_', ' ')} email.

Tone: {tone_guidance}
Target audience: {contact_desc}
{f"Original campaign subject for reference: {rep_subject}" if rep_subject and not is_initial else ""}

Return ONLY valid JSON with exactly two keys: "subject" and "body". No markdown, no code blocks."""

        try:
            result = await self.llm.complete_json(system_prompt, user_prompt)
            return {
                'subject': result.get('subject', 'Quick question, {{first_name}}' if is_initial else 'Re: Quick question'),
                'body': result.get('body', self._get_fallback_cadence_email(email_type)['body']),
            }
        except Exception as e:
            print(f"Cadence email generation failed: {e}")
            return self._get_fallback_cadence_email(email_type)

    def _get_fallback_cadence_email(self, email_type: str) -> dict:
        """Fallback templates if LLM fails."""
        templates = {
            'initial': {
                'subject': 'Quick question, {{first_name}}',
                'body': 'Hi {{first_name}},\n\nI wanted to reach out regarding a potential opportunity that might be relevant for {{company}}.\n\nWould you be open to a quick conversation?\n\nBest',
            },
            'followup_1': {
                'subject': 'Re: Quick question',
                'body': 'Hi {{first_name}},\n\nJust wanted to bump this up - did you get a chance to see my previous email?\n\nBest',
            },
            'followup_2': {
                'subject': 'Re: Quick question',
                'body': 'Hi {{first_name}},\n\nFollowing up one more time. Let me know if you have any questions.\n\nBest',
            },
            'followup_3': {
                'subject': 'Re: Quick question',
                'body': 'Hi {{first_name}},\n\nCircling back one last time. No worries if the timing is not right - feel free to reach out whenever it makes sense.\n\nBest',
            },
        }
        return templates.get(email_type, templates['initial'])

    async def regenerate_single_email(
        self,
        email_type: str,
        campaign_id: str,
        tone_guidance: str = "",
    ) -> dict:
        """Regenerate a single email with fresh content."""
        # Get campaign data
        campaign = {}
        if campaign_id and not campaign_id.startswith("new_"):
            campaign_data = self.supabase.request(
                f"campaigns?id=eq.{campaign_id}&select=*"
            )
            campaign = campaign_data[0] if campaign_data else {}

        # Get style data if available
        style_prompt = ""
        if campaign_id and not campaign_id.startswith("new_"):
            style_data = self.supabase.request(
                f"campaign_email_styles?campaign_id=eq.{campaign_id}&select=style_analysis_prompt"
            )
            style_prompt = style_data[0].get('style_analysis_prompt', '') if style_data else ''

        return await self._generate_cadence_email(
            email_type=email_type,
            tone_guidance=tone_guidance or self._default_tone_for_type(email_type),
            style_prompt=style_prompt,
            sample_emails=[],
            campaign=campaign,
        )

    def _default_tone_for_type(self, email_type: str) -> str:
        """Get default tone guidance for an email type."""
        tones = {
            'initial': 'First outreach - establish value proposition',
            'followup_1': 'Gentle reminder, keep it short',
            'followup_2': 'Provide additional value',
            'followup_3': 'Final graceful attempt',
        }
        return tones.get(email_type, '')
