"""
Gmail Service for the Hypatia agent system.

Handles sending emails via Gmail API using stored OAuth tokens.
"""

import os
import base64
import json
import urllib.request
import urllib.error
from email.mime.text import MIMEText
from datetime import datetime, timezone, timedelta
from typing import Optional
from pathlib import Path

from .supabase_client import SupabaseClient


def _load_env():
    """Load environment variables from .env file if it exists."""
    env_path = Path(__file__).parent.parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())


_load_env()

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1"
GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")


class GmailServiceError(Exception):
    """Base exception for Gmail service errors."""
    pass


class TokenExpiredError(GmailServiceError):
    """Token has expired and cannot be refreshed."""
    pass


class GmailAPIError(GmailServiceError):
    """Gmail API returned an error."""
    pass


class GmailService:
    """Service for sending emails via Gmail API."""

    def __init__(self, supabase_client: SupabaseClient = None):
        self.supabase = supabase_client or SupabaseClient()

    def get_gmail_token(self, user_id: str) -> Optional[dict]:
        """Get stored Gmail token for a user."""
        result = self.supabase.request(
            f"gmail_tokens?user_id=eq.{user_id}&select=*"
        )
        if result and len(result) > 0:
            return result[0]
        return None

    def store_gmail_token(
        self,
        user_id: str,
        access_token: str,
        expires_at: str,
        refresh_token: str = None,
    ) -> Optional[dict]:
        """Store or update Gmail OAuth token for a user."""
        existing = self.supabase.request(
            f"gmail_tokens?user_id=eq.{user_id}&select=id"
        )

        token_data = {
            "access_token": access_token,
            "expires_at": expires_at,
        }
        if refresh_token:
            token_data["refresh_token"] = refresh_token

        if existing and len(existing) > 0:
            result = self.supabase.request(
                f"gmail_tokens?user_id=eq.{user_id}",
                method="PATCH",
                body=token_data,
            )
        else:
            token_data["user_id"] = user_id
            result = self.supabase.request(
                "gmail_tokens",
                method="POST",
                body=token_data,
            )

        if result:
            return result[0] if isinstance(result, list) else result
        return None

    def get_valid_token(self, user_id: str) -> str:
        """
        Get a valid access token for user.
        Refreshes token if expired using refresh_token.

        Raises:
            TokenExpiredError: If token is expired and cannot be refreshed
        """
        token_data = self.get_gmail_token(user_id)
        if not token_data:
            raise TokenExpiredError(f"No Gmail token found for user {user_id}")

        access_token = token_data.get("access_token")
        expires_at_str = token_data.get("expires_at")
        refresh_token = token_data.get("refresh_token")

        if expires_at_str:
            expires_at = datetime.fromisoformat(expires_at_str.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)

            if now >= expires_at - timedelta(minutes=5):
                if refresh_token and GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
                    access_token = self._refresh_access_token(
                        user_id, refresh_token
                    )
                else:
                    raise TokenExpiredError(
                        f"Token expired for user {user_id} and cannot be refreshed"
                    )

        return access_token

    def _refresh_access_token(self, user_id: str, refresh_token: str) -> str:
        """Refresh the access token using the refresh token."""
        data = urllib.parse.urlencode({
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }).encode("utf-8")

        req = urllib.request.Request(
            GOOGLE_OAUTH_TOKEN_URL,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as response:
                result = json.loads(response.read().decode("utf-8"))
                new_access_token = result.get("access_token")
                expires_in = result.get("expires_in", 3600)

                expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
                self.store_gmail_token(
                    user_id=user_id,
                    access_token=new_access_token,
                    expires_at=expires_at.isoformat(),
                )

                return new_access_token
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            raise TokenExpiredError(f"Failed to refresh token: {error_body}")

    def send_email(
        self,
        user_id: str,
        to: str,
        subject: str,
        body: str,
        thread_id: str = None,
        in_reply_to: str = None,
        references: str = None,
    ) -> dict:
        """
        Send an email via Gmail API.

        Args:
            user_id: User ID to send from
            to: Recipient email address
            subject: Email subject
            body: Email body (plain text)
            thread_id: Gmail thread ID for threading replies
            in_reply_to: Message-ID header for threading
            references: References header for threading

        Returns:
            dict with gmail_id, thread_id, and message_id

        Raises:
            TokenExpiredError: If token is expired
            GmailAPIError: If Gmail API returns an error
        """
        access_token = self.get_valid_token(user_id)

        message = MIMEText(body)
        message["to"] = to
        message["subject"] = subject

        if in_reply_to:
            message["In-Reply-To"] = in_reply_to
        if references:
            message["References"] = references

        raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")

        send_body = {"raw": raw}
        if thread_id:
            send_body["threadId"] = thread_id

        url = f"{GMAIL_API_BASE}/users/me/messages/send"
        req_data = json.dumps(send_body).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=req_data,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as response:
                result = json.loads(response.read().decode("utf-8"))
                return {
                    "gmail_id": result.get("id"),
                    "thread_id": result.get("threadId"),
                    "label_ids": result.get("labelIds", []),
                }
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            raise GmailAPIError(f"Gmail API error ({e.code}): {error_body}")

    def setup_watch(self, user_id: str, topic_name: str) -> dict:
        """
        Set up Gmail push notifications via Pub/Sub.

        Args:
            user_id: User ID
            topic_name: Full Pub/Sub topic name (projects/xxx/topics/yyy)

        Returns:
            dict with historyId and expiration

        Raises:
            TokenExpiredError: If token is expired
            GmailAPIError: If Gmail API returns an error
        """
        access_token = self.get_valid_token(user_id)

        url = f"{GMAIL_API_BASE}/users/me/watch"
        watch_body = {
            "topicName": topic_name,
            "labelIds": ["INBOX"],
            "labelFilterBehavior": "INCLUDE",
        }
        req_data = json.dumps(watch_body).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=req_data,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as response:
                result = json.loads(response.read().decode("utf-8"))

                history_id = result.get("historyId")
                expiration = result.get("expiration")

                if history_id:
                    self.supabase.request(
                        f"gmail_tokens?user_id=eq.{user_id}",
                        method="PATCH",
                        body={
                            "history_id": history_id,
                            "watch_expiration": datetime.fromtimestamp(
                                int(expiration) / 1000, tz=timezone.utc
                            ).isoformat() if expiration else None,
                        },
                    )

                return {
                    "history_id": history_id,
                    "expiration": expiration,
                }
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            raise GmailAPIError(f"Gmail watch setup failed ({e.code}): {error_body}")

    def get_history(
        self,
        user_id: str,
        start_history_id: str,
        history_types: list[str] = None,
    ) -> list[dict]:
        """
        Get Gmail history changes since a history ID.

        Args:
            user_id: User ID
            start_history_id: History ID to start from
            history_types: Types to include (messageAdded, messageDeleted, etc.)

        Returns:
            List of history records
        """
        access_token = self.get_valid_token(user_id)

        params = {"startHistoryId": start_history_id}
        if history_types:
            params["historyTypes"] = ",".join(history_types)

        query_string = urllib.parse.urlencode(params)
        url = f"{GMAIL_API_BASE}/users/me/history?{query_string}"

        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
            method="GET",
        )

        try:
            with urllib.request.urlopen(req) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result.get("history", [])
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return []
            error_body = e.read().decode("utf-8")
            raise GmailAPIError(f"Gmail history fetch failed ({e.code}): {error_body}")

    def get_message(self, user_id: str, message_id: str) -> Optional[dict]:
        """Get a specific Gmail message."""
        access_token = self.get_valid_token(user_id)

        url = f"{GMAIL_API_BASE}/users/me/messages/{message_id}?format=metadata"

        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
            method="GET",
        )

        try:
            with urllib.request.urlopen(req) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            error_body = e.read().decode("utf-8")
            raise GmailAPIError(f"Gmail message fetch failed ({e.code}): {error_body}")
