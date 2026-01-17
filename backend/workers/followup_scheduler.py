"""
Follow-up Scheduler Worker

Runs periodically to:
1. Find follow-ups due for sending
2. Send each via Gmail API
3. Update status (sent/failed)
4. Log errors but continue sequence

Usage:
    python -m backend.workers.followup_scheduler

    Or run as a cron job / systemd service.
"""

import os
import sys
import asyncio
import logging
from pathlib import Path
from datetime import datetime, timezone

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from hypatia_agent.services.followup_service import FollowupService
from hypatia_agent.services.gmail_service import (
    GmailService,
    TokenExpiredError,
    GmailAPIError,
)
from hypatia_agent.services.supabase_client import SupabaseClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class FollowupSchedulerWorker:
    """Worker that sends scheduled follow-ups."""

    def __init__(self):
        self.supabase = SupabaseClient()
        self.followup_service = FollowupService(self.supabase)
        self.gmail_service = GmailService(self.supabase)
        self.running = False

    def run_once(self) -> dict:
        """Process one batch of due follow-ups."""
        stats = {"processed": 0, "sent": 0, "failed": 0, "skipped": 0}

        due_followups = self.followup_service.get_due_followups(limit=50)

        if not due_followups:
            logger.debug("No due followups found")
            return stats

        logger.info(f"Found {len(due_followups)} due followups to process")

        for followup in due_followups:
            stats["processed"] += 1
            followup_id = followup.get("id")
            user_id = followup.get("user_id")
            recipient = followup.get("recipient_email")

            try:
                # Check if we have a valid token for this user
                token_data = self.gmail_service.get_gmail_token(user_id)
                if not token_data:
                    logger.warning(f"No Gmail token for user {user_id}, skipping followup {followup_id}")
                    self.followup_service.mark_followup_failed(
                        followup_id, "No Gmail token available"
                    )
                    stats["skipped"] += 1
                    continue

                # Send the email
                result = self.gmail_service.send_email(
                    user_id=user_id,
                    to=recipient,
                    subject=followup.get("subject", ""),
                    body=followup.get("body", ""),
                    thread_id=followup.get("thread_id"),
                )

                # Mark as sent
                self.followup_service.mark_followup_sent(
                    followup_id=followup_id,
                    gmail_message_id=result.get("gmail_id", ""),
                )

                stats["sent"] += 1
                logger.info(f"Sent followup {followup_id} to {recipient}")

            except TokenExpiredError as e:
                # Token issues - mark as skipped, user needs to re-auth
                self.followup_service.mark_followup_failed(
                    followup_id, f"Token expired: {str(e)[:200]}"
                )
                stats["failed"] += 1
                logger.warning(f"Token expired for user {user_id}: {e}")

            except GmailAPIError as e:
                # Gmail API error - log and skip
                self.followup_service.mark_followup_failed(
                    followup_id, f"Gmail API error: {str(e)[:200]}"
                )
                stats["failed"] += 1
                logger.error(f"Gmail API error for followup {followup_id}: {e}")

            except Exception as e:
                # Unexpected error - log and skip
                self.followup_service.mark_followup_failed(
                    followup_id, f"Unexpected error: {str(e)[:200]}"
                )
                stats["failed"] += 1
                logger.exception(f"Unexpected error processing followup {followup_id}")

        return stats

    def run_loop(self, interval_seconds: int = 60):
        """Run scheduler in a loop."""
        self.running = True
        logger.info(f"Starting followup scheduler (interval: {interval_seconds}s)")

        while self.running:
            try:
                stats = self.run_once()
                if stats["processed"] > 0:
                    logger.info(
                        f"Scheduler batch complete: "
                        f"processed={stats['processed']}, "
                        f"sent={stats['sent']}, "
                        f"failed={stats['failed']}, "
                        f"skipped={stats['skipped']}"
                    )
            except Exception as e:
                logger.exception(f"Scheduler loop error: {e}")

            # Sleep until next check
            for _ in range(interval_seconds):
                if not self.running:
                    break
                import time
                time.sleep(1)

        logger.info("Followup scheduler stopped")

    def stop(self):
        """Stop the scheduler loop."""
        self.running = False


def main():
    """Entry point for the scheduler worker."""
    import argparse

    parser = argparse.ArgumentParser(description="Followup Scheduler Worker")
    parser.add_argument(
        "--interval",
        type=int,
        default=60,
        help="Seconds between scheduler runs (default: 60)",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run once and exit (for testing or cron)",
    )
    args = parser.parse_args()

    worker = FollowupSchedulerWorker()

    if args.once:
        stats = worker.run_once()
        print(f"Results: {stats}")
    else:
        try:
            worker.run_loop(interval_seconds=args.interval)
        except KeyboardInterrupt:
            logger.info("Received interrupt, shutting down...")
            worker.stop()


if __name__ == "__main__":
    main()
