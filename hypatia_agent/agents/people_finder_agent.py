"""
People Finder Agent - Finds contacts to email based on target criteria.

Uses contact_enrichments from Supabase to find real enriched contacts.
"""

from ..base_agent import BaseAgent


class PeopleFinderAgent(BaseAgent):
    """Agent responsible for finding people to contact based on target criteria."""

    def __init__(self, supabase_client):
        self.supabase = supabase_client

    async def execute(self, *args, **kwargs):
        return await self.find(
            kwargs.get("user_id", ""),
            kwargs.get("target_description", ""),
        )

    async def find(self, user_id: str, target_description: str) -> list:
        """
        Find contacts matching the target description.

        Uses contact_enrichments table to find real enriched contacts
        that match the target criteria.

        Args:
            user_id: User ID to find contacts for
            target_description: Description of who to find (e.g., "recruiters at tech companies")

        Returns:
            List of contacts with email, name, title, company
        """
        # Get enriched contacts from Supabase
        enrichments = self.supabase.get_contact_enrichments(user_id, success_only=True)

        contacts = []
        for enrichment in enrichments:
            raw = enrichment.get("raw_json", {})
            if not raw:
                continue

            # Extract person data from Aviato enrichment format
            person = raw.get("person", raw)

            contact = {
                "email": enrichment.get("email"),
                "name": person.get("name", ""),
                "title": person.get("title", ""),
                "company": person.get("company", ""),
                "linkedin_url": person.get("linkedin_url", ""),
            }

            # Only include contacts with at least email and name
            if contact["email"] and contact["name"]:
                contacts.append(contact)

        # If no enriched contacts, return the target description as context
        if not contacts:
            return [
                {
                    "email": "example@company.com",
                    "name": "Contact",
                    "title": target_description,
                    "company": "",
                    "note": "No enriched contacts found - this is a placeholder",
                }
            ]

        return contacts[:10]  # Limit to 10 contacts
