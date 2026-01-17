"""
Identify unique email campaigns using text similarity.
Uses character-based comparison (difflib.SequenceMatcher) on subject and body
to cluster similar emails into campaigns.

Now integrated with Supabase - fetches emails from database and saves campaigns back.
"""

import json
import os
import re
import urllib.request
import urllib.error
from difflib import SequenceMatcher
from pathlib import Path


SIMILARITY_THRESHOLD = 0.60  # 60% similarity to be in same campaign


def load_env():
    """Load environment variables from .env file if it exists."""
    env_path = Path(__file__).parent / '.env'
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ.setdefault(key.strip(), value.strip())


# Load .env file
load_env()

# =============================================================================
# CONFIGURATION
# Set via environment variables or .env file
# =============================================================================
CONFIG = {
    'SUPABASE_URL': os.environ.get('SUPABASE_URL', 'https://YOUR_PROJECT.supabase.co'),
    'SUPABASE_ANON_KEY': os.environ.get('SUPABASE_ANON_KEY', 'YOUR_SUPABASE_ANON_KEY'),
}


# =============================================================================
# SUPABASE HELPERS
# =============================================================================

def supabase_request(endpoint: str, method: str = 'GET', body: dict = None) -> dict | list | None:
    """Make a request to Supabase REST API."""
    url = f"{CONFIG['SUPABASE_URL']}/rest/v1/{endpoint}"

    headers = {
        'apikey': CONFIG['SUPABASE_ANON_KEY'],
        'Authorization': f"Bearer {CONFIG['SUPABASE_ANON_KEY']}",
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    }

    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')

    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as response:
            text = response.read().decode('utf-8')
            return json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        raise Exception(f"Supabase error ({e.code}): {error_body}")


def get_user_by_email(email: str) -> dict | None:
    """Get user from Supabase by email."""
    result = supabase_request(f"users?email=eq.{urllib.parse.quote(email)}&select=*")
    return result[0] if result else None


def get_users() -> list[dict]:
    """Get all users from Supabase."""
    return supabase_request("users?select=id,email") or []


def normalize_subject(subject: str) -> str:
    """Strip 'Re:' and 'Fwd:' prefixes from subject for better similarity matching."""
    # Remove Re:, Fwd:, FW:, RE: etc. (case insensitive, can be multiple)
    normalized = re.sub(r'^(re:|fwd?:|fw:)\s*', '', subject or '', flags=re.IGNORECASE)
    # Repeat in case of multiple prefixes like "Re: Fwd: Re:"
    while normalized != subject:
        subject = normalized
        normalized = re.sub(r'^(re:|fwd?:|fw:)\s*', '', subject, flags=re.IGNORECASE)
    return normalized.strip()


def is_reply_or_forward(subject: str) -> bool:
    """Check if subject indicates a reply or forward (should be skipped from analysis)."""
    return bool(re.match(r'^(re:|fwd?:|fw:)\s*', subject or '', flags=re.IGNORECASE))


def fetch_emails_from_supabase(user_id: str) -> list[dict]:
    """Fetch all sent emails for a user from Supabase, deduplicated by thread_id."""
    emails = supabase_request(
        f"sent_emails?user_id=eq.{user_id}&select=id,thread_id,subject,recipient_to,body,sent_at&order=sent_at.asc"
    )

    # Deduplicate by thread_id - keep only the first email in each thread
    # Also skip replies/forwards (Re:, Fwd:) - they shouldn't be analyzed
    seen_threads = set()
    unique_emails = []
    skipped_replies = 0
    skipped_thread_dupes = 0
    for e in (emails or []):
        thread_id = e['thread_id'] or e['id']  # Use email id if no thread_id

        # Skip replies and forwards entirely
        if is_reply_or_forward(e.get('subject', '')):
            skipped_replies += 1
            continue

        # Skip duplicate emails in the same thread (keep first only)
        if thread_id in seen_threads:
            skipped_thread_dupes += 1
            continue

        seen_threads.add(thread_id)
        unique_emails.append(e)

    if skipped_replies > 0:
        print(f"  Skipped {skipped_replies} replies/forwards (Re:/Fwd:)")
    if skipped_thread_dupes > 0:
        print(f"  Skipped {skipped_thread_dupes} duplicate thread emails (kept first per thread)")

    # Normalize field names
    return [
        {
            'id': e['id'],  # Database UUID
            'thread_id': e['thread_id'] or '',
            'to': e['recipient_to'] or '',  # Map recipient_to -> to
            'subject': e['subject'] or '',
            'body': e['body'] or '',
        }
        for e in unique_emails
    ]


def get_existing_campaigns(user_id: str) -> list[dict]:
    """Fetch existing campaigns for a user with their representative email data."""
    campaigns = supabase_request(
        f"campaigns?user_id=eq.{user_id}&select=id,campaign_number,representative_subject,representative_recipient,email_count,avg_similarity"
    )
    return campaigns or []


def get_emails_in_campaigns(user_id: str) -> set[str]:
    """Get set of email IDs that are already assigned to campaigns."""
    # Get all email_campaigns entries for this user's campaigns
    result = supabase_request(
        f"email_campaigns?select=email_id,campaigns!inner(user_id)&campaigns.user_id=eq.{user_id}"
    )
    if not result:
        return set()
    return {r['email_id'] for r in result}


def get_campaign_representative_emails(user_id: str, campaigns: list[dict]) -> dict[str, dict]:
    """
    For each campaign, fetch a representative email to use for similarity comparison.
    Returns mapping of campaign_id -> email data (subject, body).
    """
    if not campaigns:
        return {}

    campaign_reps = {}
    for campaign in campaigns:
        # Get one email from this campaign to use as representative
        result = supabase_request(
            f"email_campaigns?campaign_id=eq.{campaign['id']}&select=sent_emails!inner(id,subject,body)&limit=1"
        )
        if result and len(result) > 0:
            email_data = result[0]['sent_emails']
            campaign_reps[campaign['id']] = {
                'id': campaign['id'],
                'campaign_number': campaign['campaign_number'],
                'subject': normalize_subject(email_data.get('subject', '')),  # Normalize for comparison
                'body': email_data.get('body', ''),
                'email_count': campaign['email_count'],
                'avg_similarity': campaign['avg_similarity'],
                'representative_subject': campaign['representative_subject'],
                'representative_recipient': campaign['representative_recipient'],
            }
    return campaign_reps


def delete_user_campaigns(user_id: str):
    """Delete existing campaigns for a user before reclustering."""
    # First get campaign IDs
    campaigns = supabase_request(f"campaigns?user_id=eq.{user_id}&select=id")
    if not campaigns:
        return

    campaign_ids = [c['id'] for c in campaigns]

    # Delete email_campaigns entries
    for cid in campaign_ids:
        supabase_request(f"email_campaigns?campaign_id=eq.{cid}", method='DELETE')

    # Delete campaigns
    supabase_request(f"campaigns?user_id=eq.{user_id}", method='DELETE')


def match_email_to_existing_campaign(email: dict, campaign_reps: dict[str, dict]) -> str | None:
    """
    Check if an email matches an existing campaign based on similarity.
    Returns campaign_id if match found, None otherwise.
    """
    for campaign_id, rep in campaign_reps.items():
        rep_email = {'subject': rep['subject'], 'body': rep['body']}
        sim = calculate_similarity(email, rep_email)
        if sim >= SIMILARITY_THRESHOLD:
            return campaign_id
    return None


def add_emails_to_existing_campaign(campaign_id: str, email_ids: list[str], new_count: int):
    """Add new emails to an existing campaign and update its email_count."""
    # Add email-campaign links
    links = [{'email_id': eid, 'campaign_id': campaign_id} for eid in email_ids]
    if links:
        supabase_request('email_campaigns', method='POST', body=links)

    # Update campaign email count
    # Fetch current count and update
    campaign = supabase_request(f"campaigns?id=eq.{campaign_id}&select=email_count")
    if campaign:
        current_count = campaign[0].get('email_count', 0)
        supabase_request(
            f"campaigns?id=eq.{campaign_id}",
            method='PATCH',
            body={'email_count': current_count + new_count}
        )


def save_campaigns_to_supabase(user_id: str, campaigns: list[dict], emails: list[dict]):
    """Save NEW campaign results to Supabase (does not delete existing)."""
    # Create email_id lookup by thread_id
    email_lookup = {e['thread_id']: e['id'] for e in emails if e['thread_id']}

    # Get the next campaign number for this user
    existing = supabase_request(
        f"campaigns?user_id=eq.{user_id}&select=campaign_number&order=campaign_number.desc&limit=1"
    )
    next_campaign_num = (existing[0]['campaign_number'] + 1) if existing else 1

    for campaign in campaigns:
        # Insert campaign with sequential numbering
        campaign_data = {
            'user_id': user_id,
            'campaign_number': next_campaign_num,
            'representative_subject': campaign['representative_subject'],
            'representative_recipient': campaign['representative_recipient'],
            'email_count': campaign['email_count'],
            'avg_similarity': campaign['avg_similarity'],
        }

        result = supabase_request('campaigns', method='POST', body=campaign_data)
        if not result:
            continue

        campaign_uuid = result[0]['id']
        next_campaign_num += 1

        # Link emails to campaign
        email_campaign_links = []
        for thread_id in campaign['thread_ids']:
            email_uuid = email_lookup.get(thread_id)
            if email_uuid:
                email_campaign_links.append({
                    'email_id': email_uuid,
                    'campaign_id': campaign_uuid,
                })

        # Batch insert email-campaign links
        if email_campaign_links:
            supabase_request('email_campaigns', method='POST', body=email_campaign_links)


# =============================================================================
# CLUSTERING LOGIC (unchanged)
# =============================================================================

def calculate_similarity(email1: dict, email2: dict) -> float:
    """
    Calculate similarity between two emails using SequenceMatcher.
    Returns average of subject and body similarity (weighted equally).
    """
    subject_sim = SequenceMatcher(None, email1['subject'], email2['subject']).ratio()
    body_sim = SequenceMatcher(None, email1['body'], email2['body']).ratio()
    return (subject_sim + body_sim) / 2


def cluster_emails(emails: list[dict]) -> list[list[int]]:
    """
    Cluster emails into campaigns based on similarity.
    Uses simple agglomerative clustering - if an email is >= threshold similar
    to any email in a cluster, it joins that cluster.
    """
    n = len(emails)
    clusters = []  # List of lists of email indices
    assigned = [False] * n

    for i in range(n):
        if assigned[i]:
            continue

        # Start a new cluster with this email
        cluster = [i]
        assigned[i] = True

        # Find all similar emails
        for j in range(i + 1, n):
            if assigned[j]:
                continue

            # Check similarity against any email in the cluster
            for k in cluster:
                sim = calculate_similarity(emails[k], emails[j])
                if sim >= SIMILARITY_THRESHOLD:
                    cluster.append(j)
                    assigned[j] = True
                    break

        clusters.append(cluster)

    return clusters


def identify_campaigns(emails: list[dict]) -> dict:
    """
    Main function to identify unique campaigns from emails.
    """
    print(f"Loaded {len(emails)} emails\n")

    print("Calculating similarities and clustering...\n")
    clusters = cluster_emails(emails)

    # Create thread_id -> campaign_id mapping
    thread_to_campaign = {}

    # Build campaign data
    campaigns = []
    for campaign_id, cluster_indices in enumerate(clusters, 1):
        cluster_emails_data = [emails[i] for i in cluster_indices]

        # Use first email's subject as representative
        representative = cluster_emails_data[0]

        # Map each thread_id to this campaign_id
        for i in cluster_indices:
            thread_to_campaign[emails[i]['thread_id']] = campaign_id

        # Calculate average internal similarity if more than 1 email
        avg_similarity = 1.0
        if len(cluster_indices) > 1:
            similarities = []
            for i, idx1 in enumerate(cluster_indices):
                for idx2 in cluster_indices[i + 1:]:
                    similarities.append(calculate_similarity(emails[idx1], emails[idx2]))
            avg_similarity = sum(similarities) / len(similarities) if similarities else 1.0

        campaigns.append({
            "campaign_id": campaign_id,
            "representative_subject": representative['subject'],
            "representative_recipient": representative['to'],
            "email_count": len(cluster_indices),
            "thread_ids": [emails[i]['thread_id'] for i in cluster_indices],
            "recipients": list(set(emails[i]['to'] for i in cluster_indices)),
            "avg_similarity": round(avg_similarity, 3)
        })

    # Sort by email count (largest campaigns first)
    campaigns.sort(key=lambda x: x['email_count'], reverse=True)

    return {
        "total_emails": len(emails),
        "unique_campaigns": len(campaigns),
        "campaigns": campaigns,
        "thread_to_campaign": thread_to_campaign
    }


# =============================================================================
# MAIN
# =============================================================================

def main():
    # Check config
    if 'YOUR_PROJECT' in CONFIG['SUPABASE_URL']:
        print("ERROR: Please set SUPABASE_URL and SUPABASE_ANON_KEY")
        print("Either update the CONFIG dict or set environment variables:")
        print("  export SUPABASE_URL='https://your-project.supabase.co'")
        print("  export SUPABASE_ANON_KEY='your-anon-key'")
        return

    # Get all users
    users = get_users()
    if not users:
        print("No users found in database.")
        return

    print(f"Found {len(users)} user(s) in database:\n")
    for i, user in enumerate(users, 1):
        print(f"  {i}. {user['email']}")

    # Process each user
    for user in users:
        print(f"\n{'='*60}")
        print(f"Processing user: {user['email']}")
        print('='*60)

        # Fetch emails from Supabase
        emails = fetch_emails_from_supabase(user['id'])

        if not emails:
            print(f"No emails found for {user['email']}")
            continue

        # Check for existing campaigns and already-assigned emails
        existing_campaigns = get_existing_campaigns(user['id'])
        assigned_email_ids = get_emails_in_campaigns(user['id'])

        print(f"Found {len(existing_campaigns)} existing campaigns")
        print(f"Found {len(assigned_email_ids)} emails already assigned to campaigns")

        # Filter to only unassigned emails
        unassigned_emails = [e for e in emails if e['id'] not in assigned_email_ids]
        print(f"Found {len(unassigned_emails)} new/unassigned emails to process")

        if not unassigned_emails:
            print("No new emails to process.")
            continue

        # Get representative emails for existing campaigns (for similarity matching)
        campaign_reps = get_campaign_representative_emails(user['id'], existing_campaigns)

        # Match unassigned emails to existing campaigns
        emails_to_add_to_existing = {}  # campaign_id -> list of email data
        truly_new_emails = []

        for email in unassigned_emails:
            # Defensive check: skip replies even if they somehow slipped through earlier filtering
            if is_reply_or_forward(email.get('subject', '')):
                continue
            matched_campaign_id = match_email_to_existing_campaign(email, campaign_reps)
            if matched_campaign_id:
                if matched_campaign_id not in emails_to_add_to_existing:
                    emails_to_add_to_existing[matched_campaign_id] = []
                emails_to_add_to_existing[matched_campaign_id].append(email)
            else:
                truly_new_emails.append(email)

        # Add matched emails to existing campaigns
        matched_count = sum(len(v) for v in emails_to_add_to_existing.values())
        if matched_count > 0:
            print(f"\nAdding {matched_count} emails to {len(emails_to_add_to_existing)} existing campaigns...")
            for campaign_id, campaign_emails in emails_to_add_to_existing.items():
                email_ids = [e['id'] for e in campaign_emails]
                add_emails_to_existing_campaign(campaign_id, email_ids, len(email_ids))

        # Cluster truly new emails into new campaigns
        if truly_new_emails:
            print(f"\nClustering {len(truly_new_emails)} new emails into campaigns...")
            result = identify_campaigns(truly_new_emails)

            # Save new campaigns to Supabase
            print(f"Creating {result['unique_campaigns']} new campaigns...")
            save_campaigns_to_supabase(user['id'], result['campaigns'], truly_new_emails)

            # Print summary of new campaigns
            print(f"\nNEW CAMPAIGNS CREATED: {result['unique_campaigns']}")
            for i, campaign in enumerate(result['campaigns'][:10], 1):
                print(f"\n{i}. [{campaign['email_count']} emails] {campaign['representative_subject'][:60]}")
                print(f"   Recipients: {', '.join(campaign['recipients'][:3])}")
                if campaign['email_count'] > 1:
                    print(f"   Avg similarity: {campaign['avg_similarity']:.1%}")

            if len(result['campaigns']) > 10:
                print(f"\n... and {len(result['campaigns']) - 10} more campaigns")
        else:
            print("\nNo new campaigns needed - all emails matched existing patterns.")

        # Print overall summary
        new_campaign_count = result['unique_campaigns'] if truly_new_emails else 0
        total_campaigns = len(existing_campaigns) + new_campaign_count
        print(f"\nTOTAL CAMPAIGNS FOR USER: {total_campaigns}")

    print(f"\n\nDone! Campaigns saved to Supabase.")


if __name__ == "__main__":
    main()
