"""
Followup Service for the Hypatia agent system.

Handles scheduling, persistence, and status management for follow-up emails.
"""

from datetime import datetime, timezone
from typing import Optional
from .supabase_client import SupabaseClient


class FollowupService:
    """Service for managing follow-up scheduling and persistence."""

    def __init__(self, supabase_client: SupabaseClient = None):
        self.supabase = supabase_client or SupabaseClient()

    def schedule_followups(
        self,
        user_id: str,
        original_email: dict,
        followup_plans: list[dict],
        campaign_id: str = None,
    ) -> list[dict]:
        """
        Save scheduled followups to database.

        Args:
            user_id: User ID
            original_email: The sent email dict (must have thread_id, recipient, etc.)
            followup_plans: List of AI-generated followup content
            campaign_id: Optional campaign ID

        Returns:
            List of created scheduled_followup records
        """
        created = []
        original_email_id = original_email.get("id")
        thread_id = original_email.get("thread_id", "")
        recipient_email = original_email.get("to") or original_email.get("recipient_to", "")
        recipient_name = original_email.get("recipient_name", "")

        for plan in followup_plans:
            record = {
                "user_id": user_id,
                "campaign_id": campaign_id,
                "original_email_id": original_email_id,
                "thread_id": thread_id,
                "recipient_email": recipient_email,
                "recipient_name": recipient_name,
                "sequence_number": plan.get("sequence_number", 1),
                "followup_type": plan.get("type", "gentle_reminder"),
                "subject": plan.get("subject", ""),
                "body": plan.get("body", ""),
                "scheduled_for": plan.get("scheduled_for"),
                "status": "pending",
            }

            result = self.supabase.request(
                "scheduled_followups",
                method="POST",
                body=record,
            )

            if result:
                created.append(result[0] if isinstance(result, list) else result)

        return created

    def get_due_followups(self, limit: int = 100) -> list[dict]:
        """
        Get followups that are due for sending.

        Returns followups where status='pending' and scheduled_for <= now.
        """
        now = datetime.now(timezone.utc).isoformat()
        result = self.supabase.request(
            f"scheduled_followups?status=eq.pending&scheduled_for=lte.{now}"
            f"&select=*&order=scheduled_for.asc&limit={limit}"
        )
        return result or []

    def get_pending_followups(self, user_id: str, limit: int = 50) -> list[dict]:
        """Get all pending followups for a user, ordered by scheduled time."""
        result = self.supabase.request(
            f"scheduled_followups?user_id=eq.{user_id}&status=eq.pending"
            f"&select=*&order=scheduled_for.asc&limit={limit}"
        )
        return result or []

    def get_user_followups(
        self, user_id: str, status: str = None, limit: int = 100
    ) -> list[dict]:
        """Get all followups for a user, optionally filtered by status."""
        query = f"scheduled_followups?user_id=eq.{user_id}&select=*&order=scheduled_for.desc&limit={limit}"
        if status:
            query = f"scheduled_followups?user_id=eq.{user_id}&status=eq.{status}&select=*&order=scheduled_for.desc&limit={limit}"
        result = self.supabase.request(query)
        return result or []

    def cancel_followups_for_thread(self, thread_id: str, reason: str = "reply_detected") -> int:
        """
        Cancel all pending followups for a thread (e.g., when reply detected).

        Returns:
            Number of followups cancelled
        """
        pending = self.supabase.request(
            f"scheduled_followups?thread_id=eq.{thread_id}&status=eq.pending&select=id"
        )

        if not pending:
            return 0

        cancelled_count = 0
        for followup in pending:
            result = self.supabase.request(
                f"scheduled_followups?id=eq.{followup['id']}",
                method="PATCH",
                body={
                    "status": "cancelled",
                    "status_reason": reason,
                },
            )
            if result:
                cancelled_count += 1

        return cancelled_count

    def cancel_followup(self, followup_id: str, reason: str = "manual_cancel") -> bool:
        """Cancel a single pending followup."""
        result = self.supabase.request(
            f"scheduled_followups?id=eq.{followup_id}&status=eq.pending",
            method="PATCH",
            body={
                "status": "cancelled",
                "status_reason": reason,
            },
        )
        return result is not None

    def mark_followup_sent(self, followup_id: str, gmail_message_id: str) -> bool:
        """Update followup status to 'sent' with execution details."""
        result = self.supabase.request(
            f"scheduled_followups?id=eq.{followup_id}",
            method="PATCH",
            body={
                "status": "sent",
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "gmail_message_id": gmail_message_id,
            },
        )
        return result is not None

    def mark_followup_failed(self, followup_id: str, error_message: str) -> bool:
        """Update followup status to 'skipped' with error info."""
        result = self.supabase.request(
            f"scheduled_followups?id=eq.{followup_id}",
            method="PATCH",
            body={
                "status": "skipped",
                "status_reason": "send_error",
                "error_message": error_message[:500] if error_message else None,
            },
        )
        return result is not None

    def get_followup_config(self, campaign_id: str) -> dict:
        """Get timing configuration for a campaign (with defaults)."""
        if not campaign_id:
            return self._default_config()

        result = self.supabase.request(
            f"followup_configs?campaign_id=eq.{campaign_id}&select=*"
        )

        if result and len(result) > 0:
            return result[0]
        return self._default_config()

    def update_followup_config(self, campaign_id: str, config: dict) -> Optional[dict]:
        """Update or create followup config for a campaign."""
        existing = self.supabase.request(
            f"followup_configs?campaign_id=eq.{campaign_id}&select=id"
        )

        if existing and len(existing) > 0:
            result = self.supabase.request(
                f"followup_configs?campaign_id=eq.{campaign_id}",
                method="PATCH",
                body=config,
            )
        else:
            config["campaign_id"] = campaign_id
            result = self.supabase.request(
                "followup_configs",
                method="POST",
                body=config,
            )

        if result:
            return result[0] if isinstance(result, list) else result
        return None

    def get_followup_stats(self, user_id: str) -> dict:
        """Get followup statistics for a user."""
        result = self.supabase.request(
            f"user_followup_stats?user_id=eq.{user_id}&select=*"
        )
        if result and len(result) > 0:
            return result[0]
        return {
            "pending_count": 0,
            "sent_count": 0,
            "cancelled_count": 0,
            "skipped_count": 0,
            "total_count": 0,
            "next_scheduled": None,
        }

    def _default_config(self) -> dict:
        """Return default followup configuration."""
        return {
            "followup_1_days": 3,
            "followup_2_days": 7,
            "followup_3_days": 14,
            "max_followups": 3,
            "enabled": True,
        }
