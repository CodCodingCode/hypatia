"""
Reply Detection Worker

Subscribes to Gmail push notifications via Google Cloud Pub/Sub:
1. Receive notification of new message
2. Check if message is a reply to a tracked thread
3. Cancel pending follow-ups for that thread

Prerequisites:
- Google Cloud project with Pub/Sub enabled
- Service account with Pub/Sub subscriber permissions
- GOOGLE_APPLICATION_CREDENTIALS environment variable set
- Gmail watch set up for users (via /users/{id}/gmail-watch endpoint)

Usage:
    export GOOGLE_CLOUD_PROJECT=your-project-id
    python -m backend.workers.reply_detector

Configuration via environment variables:
    GOOGLE_CLOUD_PROJECT: GCP project ID
    PUBSUB_SUBSCRIPTION: Subscription name (default: gmail-reply-detector)
"""

import os
import sys
import json
import base64
import logging
from pathlib import Path

# Add parent directories to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from hypatia_agent.services.followup_service import FollowupService
from hypatia_agent.services.gmail_service import GmailService, GmailAPIError
from hypatia_agent.services.supabase_client import SupabaseClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Configuration
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
SUBSCRIPTION_NAME = os.environ.get("PUBSUB_SUBSCRIPTION", "gmail-reply-detector")


class ReplyDetectorWorker:
    """Worker that processes Gmail notifications and cancels followups on reply."""

    def __init__(self):
        self.supabase = SupabaseClient()
        self.followup_service = FollowupService(self.supabase)
        self.gmail_service = GmailService(self.supabase)
        self.subscriber = None
        self.subscription_path = None

    def _init_pubsub(self):
        """Initialize Pub/Sub client (lazy loading to handle import errors gracefully)."""
        if self.subscriber is not None:
            return

        try:
            from google.cloud import pubsub_v1
            self.subscriber = pubsub_v1.SubscriberClient()
            self.subscription_path = self.subscriber.subscription_path(
                PROJECT_ID, SUBSCRIPTION_NAME
            )
            logger.info(f"Initialized Pub/Sub subscriber: {self.subscription_path}")
        except ImportError:
            logger.error(
                "google-cloud-pubsub not installed. "
                "Install with: pip install google-cloud-pubsub"
            )
            raise
        except Exception as e:
            logger.error(f"Failed to initialize Pub/Sub: {e}")
            raise

    def process_message(self, message) -> bool:
        """
        Process a single Pub/Sub message.

        Returns True if message was processed successfully (should be acked).
        Returns False if message should be nacked for retry.
        """
        try:
            # Decode message data - Pub/Sub may send raw JSON or base64 encoded
            raw_data = message.data
            if isinstance(raw_data, bytes):
                raw_data = raw_data.decode("utf-8")

            # Try parsing as JSON first (Pub/Sub client may already decode)
            try:
                data = json.loads(raw_data)
            except json.JSONDecodeError:
                # Fall back to base64 decoding with padding fix
                padded = raw_data + "=" * (4 - len(raw_data) % 4)
                data = json.loads(base64.b64decode(padded).decode())
            user_email = data.get("emailAddress")
            history_id = str(data.get("historyId", ""))

            if not user_email or not history_id:
                logger.warning(f"Invalid message format: {data}")
                return True  # Ack invalid messages to avoid infinite retry

            logger.info(f"Processing notification for {user_email}, historyId={history_id}")

            # Get user by email
            users = self.supabase.request(
                f"users?email=eq.{user_email}&select=id"
            )

            if not users:
                logger.info(f"No user found for email: {user_email}")
                return True  # Ack - not our user

            user_id = users[0]["id"]

            # Get the user's stored history_id
            token_data = self.gmail_service.get_gmail_token(user_id)
            if not token_data:
                logger.debug(f"No Gmail token for user {user_id}")
                return True

            stored_history_id = token_data.get("history_id")
            if not stored_history_id:
                logger.info(f"No stored history_id for user {user_id}, updating to {history_id}")
                # Update the history_id for next time
                self.supabase.request(
                    f"gmail_tokens?user_id=eq.{user_id}",
                    method="PATCH",
                    body={"history_id": history_id},
                )
                return True

            # Get history changes since last processed
            try:
                changes = self.gmail_service.get_history(
                    user_id,
                    stored_history_id,
                    history_types=["messageAdded"],
                )
            except GmailAPIError as e:
                if "404" in str(e) or "historyId" in str(e).lower():
                    # History ID is too old, update and continue
                    logger.warning(f"History ID too old for user {user_id}, updating")
                    self.supabase.request(
                        f"gmail_tokens?user_id=eq.{user_id}",
                        method="PATCH",
                        body={"history_id": history_id},
                    )
                    return True
                raise

            # Process each change
            total_cancelled = 0
            logger.info(f"Got {len(changes)} history changes for user {user_id}")
            for change in changes:
                messages_added = change.get("messagesAdded", [])
                for msg_add in messages_added:
                    msg = msg_add.get("message", {})
                    thread_id = msg.get("threadId")
                    label_ids = msg.get("labelIds", [])
                    logger.info(f"New message in thread {thread_id}, labels: {label_ids}")

                    # Only process INBOX messages (replies to our sent emails)
                    if thread_id and "INBOX" in label_ids:
                        # Check if this thread has instant_respond enabled
                        instant_respond_email = self._check_instant_respond_thread(
                            user_id, thread_id
                        )

                        if instant_respond_email:
                            # INSTANT RESPOND: Generate and send AI response
                            logger.info(
                                f"Thread {thread_id} has instant respond enabled, "
                                f"generating AI response"
                            )
                            self._send_instant_response(
                                user_id, instant_respond_email, msg.get("id")
                            )
                        else:
                            # EXISTING LOGIC: Cancel pending followups
                            cancelled = self.followup_service.cancel_followups_for_thread(
                                thread_id=thread_id,
                                reason="reply_detected",
                            )

                            if cancelled > 0:
                                total_cancelled += cancelled
                                logger.info(
                                    f"Cancelled {cancelled} followups for thread {thread_id} "
                                    f"(user {user_id})"
                                )

            # Update stored history_id
            self.supabase.request(
                f"gmail_tokens?user_id=eq.{user_id}",
                method="PATCH",
                body={"history_id": history_id},
            )

            if total_cancelled > 0:
                logger.info(f"Total followups cancelled for user {user_id}: {total_cancelled}")

            return True

        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in message: {e}")
            return True  # Ack malformed messages

        except Exception as e:
            logger.exception(f"Error processing message: {e}")
            return False  # Nack for retry

    def _check_instant_respond_thread(self, user_id: str, thread_id: str):
        """Check if this thread has instant respond enabled (via email or campaign)."""
        try:
            # First check if any email in this thread has instant_respond_enabled directly
            result = self.supabase.request(
                f"sent_emails?user_id=eq.{user_id}&thread_id=eq.{thread_id}"
                f"&instant_respond_enabled=eq.true&select=id,recipient_to,subject,body"
            )

            if result and len(result) > 0:
                return result[0]

            # If not, check if the email is part of a campaign with instant_respond_enabled
            # Join sent_emails -> email_campaigns -> campaigns
            campaign_result = self.supabase.request(
                f"sent_emails?user_id=eq.{user_id}&thread_id=eq.{thread_id}"
                f"&select=id,recipient_to,subject,body,email_campaigns(campaign_id,campaigns(instant_respond_enabled))"
            )

            if campaign_result and len(campaign_result) > 0:
                email_data = campaign_result[0]
                # Check if any associated campaign has instant_respond_enabled
                email_campaigns = email_data.get("email_campaigns", [])
                for ec in email_campaigns:
                    campaign = ec.get("campaigns")
                    if campaign and campaign.get("instant_respond_enabled"):
                        logger.info(f"Thread {thread_id} is in campaign with instant respond enabled")
                        return email_data

            return None
        except Exception as e:
            logger.error(f"Error checking instant respond thread: {e}")
            return None

    def _send_instant_response(self, user_id: str, original_email: dict, reply_message_id: str):
        """Generate and send instant AI response."""
        import asyncio

        try:
            from hypatia_agent.agents.followup_agent import FollowupAgent

            # Get full reply message details
            full_message = self.gmail_service.get_message(user_id, reply_message_id)

            # Extract reply details
            reply_from = self._extract_sender_email(full_message)
            reply_subject = self._extract_subject(full_message)
            reply_body = self._extract_body(full_message)
            thread_id = full_message.get("threadId")

            logger.info(
                f"Generating instant response to {reply_from} "
                f"(thread: {thread_id})"
            )

            # Generate AI response (async)
            followup_agent = FollowupAgent()
            response_body = asyncio.run(followup_agent.generate_instant_response(
                original_email=original_email.get("body", ""),
                recipient_reply=reply_body,
                personalization={}
            ))

            # Send via Gmail
            result = self.gmail_service.send_email(
                user_id=user_id,
                to=reply_from,
                subject=f"Re: {reply_subject}" if not reply_subject.startswith("Re:") else reply_subject,
                body=response_body,
                thread_id=thread_id
            )

            # Track in database
            self.supabase.request(
                "sent_emails",
                method="POST",
                body={
                    "user_id": user_id,
                    "gmail_id": result.get("gmail_id"),
                    "thread_id": thread_id,
                    "subject": result.get("subject", reply_subject),
                    "recipient_to": reply_from,
                    "body": response_body,
                    "sent_at": "now()",
                    "instant_respond_enabled": False,  # Don't auto-respond to our auto-response
                }
            )

            logger.info(f"✅ Sent instant response to {reply_from} in thread {thread_id}")

        except Exception as e:
            logger.error(f"❌ Failed to send instant response: {e}")

    def _extract_sender_email(self, message: dict) -> str:
        """Extract sender email from Gmail message."""
        headers = message.get("payload", {}).get("headers", [])
        for header in headers:
            if header["name"].lower() == "from":
                # Parse "Name <email@example.com>" format
                from_value = header["value"]
                if "<" in from_value and ">" in from_value:
                    return from_value.split("<")[1].split(">")[0]
                return from_value
        return ""

    def _extract_subject(self, message: dict) -> str:
        """Extract subject from Gmail message."""
        headers = message.get("payload", {}).get("headers", [])
        for header in headers:
            if header["name"].lower() == "subject":
                return header["value"]
        return ""

    def _extract_body(self, message: dict) -> str:
        """Extract plain text body from Gmail message."""
        payload = message.get("payload", {})

        # Try to get plain text part
        if "parts" in payload:
            for part in payload["parts"]:
                if part.get("mimeType") == "text/plain":
                    data = part.get("body", {}).get("data", "")
                    if data:
                        import base64
                        return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")

        # Fall back to body.data if no parts
        data = payload.get("body", {}).get("data", "")
        if data:
            import base64
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")

        return ""

    def run(self):
        """Start the subscriber (blocking)."""
        self._init_pubsub()

        logger.info(f"Starting reply detector on {self.subscription_path}")

        def callback(message):
            if self.process_message(message):
                message.ack()
            else:
                message.nack()

        streaming_pull_future = self.subscriber.subscribe(
            self.subscription_path,
            callback=callback,
        )

        try:
            # Block until an error occurs
            streaming_pull_future.result()
        except KeyboardInterrupt:
            logger.info("Received interrupt, shutting down...")
            streaming_pull_future.cancel()
            streaming_pull_future.result()
        except Exception as e:
            logger.error(f"Subscriber error: {e}")
            streaming_pull_future.cancel()
            raise


def main():
    """Entry point for the reply detector worker."""
    global PROJECT_ID, SUBSCRIPTION_NAME
    import argparse

    parser = argparse.ArgumentParser(description="Reply Detector Worker")
    parser.add_argument(
        "--project",
        type=str,
        default=PROJECT_ID,
        help="Google Cloud project ID",
    )
    parser.add_argument(
        "--subscription",
        type=str,
        default=SUBSCRIPTION_NAME,
        help="Pub/Sub subscription name",
    )
    args = parser.parse_args()

    # Override from args
    PROJECT_ID = args.project
    SUBSCRIPTION_NAME = args.subscription

    if not PROJECT_ID:
        print("Error: GOOGLE_CLOUD_PROJECT environment variable or --project argument required")
        sys.exit(1)

    worker = ReplyDetectorWorker()
    worker.run()


if __name__ == "__main__":
    main()
