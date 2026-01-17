"""
Supabase client for the Hypatia agent system.
Provides access to campaigns, CTAs, styles, contacts, and enrichments.
"""

import os
import json
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path
from typing import Optional


def load_env():
    """Load environment variables from .env file if it exists."""
    env_path = Path(__file__).parent.parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())


load_env()


class SupabaseClient:
    """Client for Supabase REST API operations."""

    def __init__(self):
        self.url = os.environ.get("SUPABASE_URL", "")
        self.anon_key = os.environ.get("SUPABASE_ANON_KEY", "")

    def request(
        self, endpoint: str, method: str = "GET", body: dict = None
    ) -> dict | list | None:
        """Make a request to Supabase REST API."""
        url = f"{self.url}/rest/v1/{endpoint}"

        headers = {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {self.anon_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")

        req = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req) as response:
                text = response.read().decode("utf-8")
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            print(f"Supabase error ({e.code}): {error_body}")
            return None

    def get_user_campaigns(self, user_id: str, limit: int = 5) -> list[dict]:
        """Get campaigns for a user, ordered by email count."""
        return (
            self.request(
                f"campaigns?user_id=eq.{user_id}&email_count=gte.2&select=id,campaign_number,representative_subject,representative_recipient,email_count,avg_similarity&order=email_count.desc&limit={limit}"
            )
            or []
        )

    def get_campaign_cta(self, campaign_id: str) -> Optional[dict]:
        """Get CTA analysis for a campaign."""
        result = self.request(f"campaign_ctas?campaign_id=eq.{campaign_id}&select=*")
        return result[0] if result else None

    def get_campaign_style(self, campaign_id: str) -> Optional[dict]:
        """Get email style analysis for a campaign."""
        result = self.request(
            f"campaign_email_styles?campaign_id=eq.{campaign_id}&select=*"
        )
        return result[0] if result else None

    def get_campaign_contacts(self, campaign_id: str) -> Optional[dict]:
        """Get contact description for a campaign."""
        result = self.request(
            f"campaign_contacts?campaign_id=eq.{campaign_id}&select=*"
        )
        return result[0] if result else None

    def get_campaign_emails(self, campaign_id: str, limit: int = 5) -> list[dict]:
        """Get sample emails from a campaign."""
        result = self.request(
            f"email_campaigns?campaign_id=eq.{campaign_id}&select=sent_emails(id,subject,body,recipient_to,sent_at)&limit={limit}"
        )
        if result:
            return [r["sent_emails"] for r in result if r.get("sent_emails")]
        return []

    def get_contact_enrichments(
        self, user_id: str, success_only: bool = True
    ) -> list[dict]:
        """Get enriched contact data for a user."""
        query = f"contact_enrichments?user_id=eq.{user_id}&select=email,raw_json,success"
        if success_only:
            query += "&success=eq.true"
        return self.request(query) or []

    def get_full_campaign_data(self, campaign_id: str) -> dict:
        """Get all data for a campaign (CTA, style, contacts, sample emails)."""
        return {
            "cta": self.get_campaign_cta(campaign_id),
            "style": self.get_campaign_style(campaign_id),
            "contacts": self.get_campaign_contacts(campaign_id),
            "emails": self.get_campaign_emails(campaign_id),
        }

    def get_users(self) -> list[dict]:
        """Get all users."""
        return (
            self.request(
                "users?select=id,email,app_purpose,user_type,display_name,contact_types"
            )
            or []
        )
