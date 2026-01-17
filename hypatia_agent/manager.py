"""
Manager Agent for Hypatia Email Campaign Execution.

Orchestrates three specialized sub-agents using real data from Supabase:
1. PeopleFinderAgent - Uses contact_enrichments and campaign_contacts
2. WriterAgent - Uses campaign_email_styles for style matching
3. FollowupAgent - Creates follow-up plans based on campaign patterns
"""

from .agents import PeopleFinderAgent, WriterAgent, FollowupAgent
from .services import SupabaseClient


class ManagerAgent:
    """
    Manager agent that orchestrates email campaign execution.

    Uses real campaign data from Supabase to:
    - Find the CTA, style, and contact patterns from an existing campaign
    - Delegate to sub-agents with real data
    """

    def __init__(self):
        self.supabase = SupabaseClient()
        self.people_finder = PeopleFinderAgent(self.supabase)
        self.writer = WriterAgent(self.supabase)
        self.followup = FollowupAgent(self.supabase)

    async def execute_from_campaign(self, user_id: str, campaign_id: str) -> dict:
        """
        Execute a campaign using data from an existing Supabase campaign.

        Args:
            user_id: The user's ID
            campaign_id: The campaign ID to use as a template

        Returns:
            dict with contacts, emails, and followup_plan
        """
        print(f"[Manager] Loading campaign data from Supabase...")
        print(f"[Manager] Campaign ID: {campaign_id}")
        print()

        # Fetch all campaign data from Supabase
        campaign_data = self.supabase.get_full_campaign_data(campaign_id)

        cta_data = campaign_data["cta"]
        style_data = campaign_data["style"]
        contact_data = campaign_data["contacts"]
        sample_emails = campaign_data["emails"]

        print(f"[Manager] CTA: {cta_data.get('cta_description') if cta_data else 'None'}")
        print(f"[Manager] Style: {style_data.get('one_sentence_description') if style_data else 'None'}")
        print(f"[Manager] Contact type: {contact_data.get('contact_description') if contact_data else 'None'}")
        print(f"[Manager] Sample emails: {len(sample_emails)}")
        print()

        # Extract the key data for agents
        cta = cta_data.get("cta_description", "") if cta_data else ""
        style_prompt = style_data.get("style_analysis_prompt", "") if style_data else ""
        people_target = contact_data.get("contact_description", "") if contact_data else ""

        return await self.execute(
            user_id=user_id,
            cta=cta,
            people_target=people_target,
            style=style_prompt,
            sample_emails=sample_emails,
        )

    async def execute(
        self,
        user_id: str,
        cta: str,
        people_target: str,
        style: str,
        sample_emails: list = None,
    ) -> dict:
        """
        Execute a full email campaign.

        Args:
            user_id: The user's ID
            cta: Call-to-action (what you want recipients to do)
            people_target: Description of who to contact
            style: Writing style prompt
            sample_emails: Optional sample emails for style reference

        Returns:
            dict with contacts, emails, and followup_plan
        """
        print(f"[Manager] Starting campaign execution")
        print(f"[Manager] CTA: {cta[:100]}..." if len(cta) > 100 else f"[Manager] CTA: {cta}")
        print(f"[Manager] Target: {people_target}")
        print()

        # Step 1: Find people to contact
        print("[Manager] Delegating to PeopleFinderAgent...")
        contacts = await self.people_finder.find(user_id, people_target)
        print(f"[Manager] Found {len(contacts)} contacts")
        for c in contacts:
            print(f"  - {c.get('name', 'Unknown')} ({c.get('email')}) - {c.get('title', 'N/A')}")
        print()

        # Step 2: Write emails for each contact
        print("[Manager] Delegating to WriterAgent...")
        emails = []
        for contact in contacts:
            email = await self.writer.write(
                contact=contact,
                cta=cta,
                style=style,
                sample_emails=sample_emails,
            )
            emails.append(email)
            print(f"  - Wrote email to {contact.get('name', contact['email'])}")
        print()

        # Step 3: Create follow-up plan
        print("[Manager] Delegating to FollowupAgent...")
        followup_plan = await self.followup.plan(emails, cta)
        print(f"[Manager] Created follow-up plan for {len(followup_plan)} emails")
        print()

        result = {
            "contacts": contacts,
            "emails": emails,
            "followup_plan": followup_plan,
        }

        # Write output files
        self._write_output_files(result)

        print("[Manager] Campaign execution complete!")
        return result

    def _write_output_files(self, result: dict) -> None:
        """Write followup_plan.json and email.txt output files."""
        import json

        # Write followup_plan.json
        followup_plan = result.get("followup_plan", [])
        with open("followup_plan.json", "w", encoding="utf-8") as f:
            json.dump(followup_plan, f, indent=2, ensure_ascii=False, default=str)
        print("[Manager] Wrote followup_plan.json")

        # Write email.txt with all email templates
        emails = result.get("emails", [])
        with open("email.txt", "w", encoding="utf-8") as f:
            for i, email in enumerate(emails):
                if i > 0:
                    f.write("\n" + "=" * 60 + "\n\n")
                f.write(f"To: {email.get('to', '')}\n")
                f.write(f"Subject: {email.get('subject', '')}\n")
                f.write(f"\n{email.get('body', '')}\n")
        print("[Manager] Wrote email.txt")


# Quick test
if __name__ == "__main__":
    import asyncio
    import json

    async def main():
        manager = ManagerAgent()

        # Get the first user and their first campaign
        users = manager.supabase.get_users()
        if not users:
            print("No users found in database")
            return

        user = users[0]
        print(f"Using user: {user.get('display_name', user['email'])} ({user['id']})")
        print()

        campaigns = manager.supabase.get_user_campaigns(user["id"])
        if not campaigns:
            print("No campaigns found for user")
            return

        campaign = campaigns[0]
        print(f"Using campaign #{campaign['campaign_number']}: {campaign['representative_subject']}")
        print(f"  - {campaign['email_count']} emails, {campaign['avg_similarity']:.0%} similarity")
        print()

        # Execute using real campaign data
        result = await manager.execute_from_campaign(
            user_id=user["id"],
            campaign_id=campaign["id"],
        )

        print("\n" + "=" * 60)
        print("RESULT:")
        print("=" * 60)
        print(json.dumps(result, indent=2, default=str))

    asyncio.run(main())
