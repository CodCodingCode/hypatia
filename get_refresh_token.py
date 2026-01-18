#!/usr/bin/env python3
"""
Get a Gmail API refresh token for a user.

This script runs a local OAuth flow to get a refresh token that can be stored
in the database for server-side Gmail API access.

Usage:
    python get_refresh_token.py

Note: Make sure http://localhost:8080 is added as an authorized redirect URI
in Google Cloud Console at:
https://console.cloud.google.com/apis/credentials?project=hypatia-484602
"""

import json
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import urllib.request
import urllib.parse

# Load credentials from credentials.json
with open("credentials.json") as f:
    creds = json.load(f)
    web_creds = creds["web"]
    CLIENT_ID = web_creds["client_id"]
    CLIENT_SECRET = web_creds["client_secret"]
    REDIRECT_URI = "http://localhost:8080"

# Gmail API scopes
SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
]

auth_code = None


class OAuthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        query = parse_qs(urlparse(self.path).query)

        if "code" in query:
            auth_code = query["code"][0]
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(
                b"""
                <html><body>
                <h1>Authorization successful!</h1>
                <p>You can close this window and return to the terminal.</p>
                </body></html>
            """
            )
        else:
            self.send_response(400)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Suppress log messages


def get_refresh_token():
    """Run OAuth flow to get refresh token."""

    # Step 1: Build authorization URL
    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(
        {
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",  # Critical for getting refresh token
            "prompt": "consent",  # Force consent screen to get refresh token
        }
    )

    print("Opening browser for authorization...")
    print(f"If browser doesn't open, visit: {auth_url}")
    webbrowser.open(auth_url)

    # Step 2: Start local server to receive callback
    server = HTTPServer(("localhost", 8080), OAuthHandler)
    print("Waiting for authorization...")
    server.handle_request()

    if not auth_code:
        print("Error: No authorization code received")
        return None

    # Step 3: Exchange code for tokens
    print("Exchanging code for tokens...")
    data = urllib.parse.urlencode(
        {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "code": auth_code,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        }
    ).encode()

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read())

    return result


if __name__ == "__main__":
    print("=" * 60)
    print("Gmail API Refresh Token Generator")
    print("=" * 60)
    print()

    tokens = get_refresh_token()

    if tokens:
        print("\n" + "=" * 60)
        print("SUCCESS! Got tokens:")
        print("=" * 60)
        print(f"Access Token: {tokens.get('access_token', 'N/A')[:50]}...")
        print(f"Refresh Token: {tokens.get('refresh_token', 'N/A')}")
        print(f"Expires In: {tokens.get('expires_in', 'N/A')} seconds")
        print()
        print("Now you need to update your database with this refresh token.")
        print("You can use the Supabase UI or run this SQL:")
        print()
        print("UPDATE gmail_tokens")
        print(f"SET refresh_token = '{tokens.get('refresh_token')}'")
        print("WHERE user_id = '83ea2cfe-a198-421d-acc9-156c73e6a5ce';")
        print()
    else:
        print("Failed to get tokens")
