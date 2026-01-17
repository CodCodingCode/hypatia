import os
import json
import base64
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Gmail API scope for reading emails
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

def get_gmail_service():
    """Authenticate and return Gmail API service."""
    creds = None

    # Load existing credentials if available
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)

    # If no valid credentials, initiate OAuth flow
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists('credentials.json'):
                print("ERROR: credentials.json not found!")
                print("\nTo get credentials.json:")
                print("1. Go to https://console.cloud.google.com")
                print("2. Create a new project (or select existing)")
                print("3. Enable the Gmail API")
                print("4. Go to Credentials > Create Credentials > OAuth 2.0 Client ID")
                print("5. Select 'Desktop app' as application type")
                print("6. Download the JSON and save as 'credentials.json' in this directory")
                return None

            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)

        # Save credentials for next run
        with open('token.json', 'w') as token:
            token.write(creds.to_json())

    return build('gmail', 'v1', credentials=creds)


def get_email_body(payload):
    """Extract email body from message payload."""
    body = ""

    if 'body' in payload and payload['body'].get('data'):
        body = base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8', errors='ignore')
    elif 'parts' in payload:
        for part in payload['parts']:
            mime_type = part.get('mimeType', '')
            if mime_type == 'text/plain' and part['body'].get('data'):
                body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
                break
            elif mime_type == 'text/html' and part['body'].get('data') and not body:
                body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
            elif 'parts' in part:
                # Handle nested multipart
                body = get_email_body(part)
                if body:
                    break

    return body


def get_header_value(headers, name):
    """Get a specific header value from email headers."""
    for header in headers:
        if header['name'].lower() == name.lower():
            return header['value']
    return ""


def fetch_sent_emails(service, max_emails=200):
    """Fetch sent emails from Gmail."""
    emails = []
    page_token = None

    print(f"Fetching up to {max_emails} sent emails...")

    while len(emails) < max_emails:
        # Get list of sent message IDs
        results = service.users().messages().list(
            userId='me',
            labelIds=['SENT'],
            maxResults=min(100, max_emails - len(emails)),
            pageToken=page_token
        ).execute()

        messages = results.get('messages', [])
        if not messages:
            break

        # Fetch full details for each message
        for msg in messages:
            if len(emails) >= max_emails:
                break

            message = service.users().messages().get(
                userId='me',
                id=msg['id'],
                format='full'
            ).execute()

            headers = message['payload'].get('headers', [])

            email_data = {
                'id': message['id'],
                'thread_id': message['threadId'],
                'subject': get_header_value(headers, 'Subject'),
                'to': get_header_value(headers, 'To'),
                'cc': get_header_value(headers, 'Cc'),
                'bcc': get_header_value(headers, 'Bcc'),
                'date': get_header_value(headers, 'Date'),
                'body': get_email_body(message['payload'])
            }

            emails.append(email_data)
            print(f"  Fetched {len(emails)}/{max_emails}: {email_data['subject'][:50]}...")

        page_token = results.get('nextPageToken')
        if not page_token:
            break

    return emails


def main():
    """Main function to gather sent emails."""
    print("=" * 60)
    print("Gmail Sent Email Collector")
    print("=" * 60)

    # Authenticate and get service
    service = get_gmail_service()
    if not service:
        return

    print("\nAuthentication successful!")

    # Fetch sent emails
    emails = fetch_sent_emails(service, max_emails=200)

    if not emails:
        print("No sent emails found.")
        return

    # Save to JSON file
    output_file = 'sent_emails.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(emails, f, indent=2, ensure_ascii=False)

    print(f"\n{'=' * 60}")
    print(f"Successfully saved {len(emails)} sent emails to {output_file}")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
