#!/usr/bin/env python3
"""
Gmail Watch Setup Script

This script:
1. Opens browser for OAuth consent
2. Gets access token + refresh token
3. Stores tokens in Supabase
4. Sets up Gmail Watch for push notifications

Usage:
    python setup_gmail_watch.py

Requires .env file with:
    GOOGLE_CLIENT_ID
    GOOGLE_CLIENT_SECRET
    SUPABASE_URL
    SUPABASE_ANON_KEY
    GMAIL_WATCH_USER_ID
    GCP_PROJECT_ID
"""

import http.server
import json
import os
import urllib.parse
import urllib.request
import webbrowser
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path


def load_env():
    """Load environment variables from .env file if it exists."""
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())


load_env()

# OAuth credentials from environment
CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
REDIRECT_URI = "http://localhost:8080/oauth/callback"

# Gmail scopes needed
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
]

# Supabase config from environment
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

# Your user ID from Supabase (for local testing)
USER_ID = os.environ.get("GMAIL_WATCH_USER_ID", "")

# Pub/Sub topic for Gmail notifications
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "")
PUBSUB_TOPIC = f"projects/{GCP_PROJECT_ID}/topics/gmail-notifications" if GCP_PROJECT_ID else ""

# Global to capture auth code
auth_code = None
server_done = threading.Event()


class OAuthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/oauth/callback":
            params = urllib.parse.parse_qs(parsed.query)

            if "code" in params:
                auth_code = params["code"][0]
                self.send_response(200)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(b"""
                    <html><body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                    <h1>Authorization Successful!</h1>
                    <p>You can close this window and return to the terminal.</p>
                    </body></html>
                """)
                server_done.set()
            else:
                error = params.get("error", ["Unknown error"])[0]
                self.send_response(400)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                self.wfile.write(f"<html><body><h1>Error: {error}</h1></body></html>".encode())
                server_done.set()
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress logging


def get_auth_url():
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",  # Force consent to get refresh token
    }
    return f"https://accounts.google.com/o/oauth2/auth?{urllib.parse.urlencode(params)}"


def exchange_code_for_tokens(code):
    """Exchange authorization code for access and refresh tokens."""
    data = urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI,
    }).encode()

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )

    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())


def store_tokens_in_supabase(access_token, refresh_token, expires_in):
    """Store tokens in Supabase gmail_tokens table."""
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    body = json.dumps({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at.isoformat(),
    }).encode()

    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/gmail_tokens?user_id=eq.{USER_ID}",
        data=body,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        method="PATCH",
    )

    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())


def setup_gmail_watch(access_token):
    """Set up Gmail push notifications."""
    body = json.dumps({
        "topicName": PUBSUB_TOPIC,
        "labelIds": ["INBOX"],
        "labelFilterBehavior": "INCLUDE",
    }).encode()

    req = urllib.request.Request(
        "https://gmail.googleapis.com/gmail/v1/users/me/watch",
        data=body,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())


def update_watch_info(history_id, expiration):
    """Update watch info in Supabase."""
    expires_at = datetime.fromtimestamp(int(expiration) / 1000, tz=timezone.utc)

    body = json.dumps({
        "history_id": history_id,
        "watch_expiration": expires_at.isoformat(),
    }).encode()

    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/gmail_tokens?user_id=eq.{USER_ID}",
        data=body,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        method="PATCH",
    )

    with urllib.request.urlopen(req) as response:
        return response.read()


def main():
    global auth_code

    print("=" * 60)
    print("Gmail Watch Setup")
    print("=" * 60)

    # Validate required environment variables
    required_vars = {
        "GOOGLE_CLIENT_ID": CLIENT_ID,
        "GOOGLE_CLIENT_SECRET": CLIENT_SECRET,
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_ANON_KEY": SUPABASE_KEY,
        "GMAIL_WATCH_USER_ID": USER_ID,
        "GCP_PROJECT_ID": GCP_PROJECT_ID,
    }
    missing = [k for k, v in required_vars.items() if not v]
    if missing:
        print("\nERROR: Missing required environment variables:")
        for var in missing:
            print(f"  - {var}")
        print("\nPlease set these in your .env file.")
        return

    # Start local server
    server = http.server.HTTPServer(("localhost", 8080), OAuthHandler)
    server_thread = threading.Thread(target=server.handle_request)
    server_thread.start()

    # Open browser for auth
    auth_url = get_auth_url()
    print("\n1. Opening browser for Google authorization...")
    print(f"   If browser doesn't open, go to:\n   {auth_url}\n")
    webbrowser.open(auth_url)

    # Wait for callback
    print("2. Waiting for authorization...")
    server_done.wait(timeout=120)
    server.server_close()

    if not auth_code:
        print("ERROR: No authorization code received!")
        return

    print("   Authorization code received!")

    # Exchange for tokens
    print("\n3. Exchanging code for tokens...")
    try:
        tokens = exchange_code_for_tokens(auth_code)
        access_token = tokens["access_token"]
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in", 3600)

        print(f"   Access token: {access_token[:50]}...")
        print(f"   Refresh token: {'Yes' if refresh_token else 'No'}")
    except Exception as e:
        print(f"ERROR: Failed to get tokens: {e}")
        return

    # Store in Supabase
    print("\n4. Storing tokens in Supabase...")
    try:
        store_tokens_in_supabase(access_token, refresh_token, expires_in)
        print("   Tokens stored successfully!")
    except Exception as e:
        print(f"ERROR: Failed to store tokens: {e}")
        return

    # Set up Gmail Watch
    print("\n5. Setting up Gmail Watch...")
    try:
        watch_result = setup_gmail_watch(access_token)
        history_id = watch_result.get("historyId")
        expiration = watch_result.get("expiration")

        print(f"   History ID: {history_id}")
        print(f"   Watch expires: {datetime.fromtimestamp(int(expiration)/1000)}")

        # Store watch info
        update_watch_info(history_id, expiration)
        print("   Watch info stored in Supabase!")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"ERROR: Gmail Watch failed ({e.code}): {error_body}")
        print("\nMake sure you have:")
        print("  1. Created Pub/Sub topic: gmail-notifications")
        print("  2. Granted gmail-api-push@system.gserviceaccount.com Publisher role")
        return

    print("\n" + "=" * 60)
    print("SUCCESS! Gmail Watch is now active.")
    print("=" * 60)
    print(f"\nPub/Sub topic: {PUBSUB_TOPIC}")
    print(f"Subscription: gmail-reply-detector")
    print("\nTo start the reply detector worker:")
    print("  python -m backend.workers.reply_detector")


if __name__ == "__main__":
    main()
