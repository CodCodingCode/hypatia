"""
Email clustering logic for campaign identification.
"""

from difflib import SequenceMatcher

from backend_config import SIMILARITY_THRESHOLD
from utils.supabase import supabase_request


def calculate_similarity(email1: dict, email2: dict) -> float:
    """Calculate similarity between two emails using SequenceMatcher."""
    subject_sim = SequenceMatcher(None, email1.get('subject', ''), email2.get('subject', '')).ratio()
    body_sim = SequenceMatcher(None, email1.get('body', ''), email2.get('body', '')).ratio()
    return (subject_sim + body_sim) / 2


def cluster_emails(emails: list[dict]) -> list[list[int]]:
    """Cluster emails into campaigns based on similarity."""
    n = len(emails)
    clusters = []
    assigned = [False] * n

    for i in range(n):
        if assigned[i]:
            continue

        cluster = [i]
        assigned[i] = True

        for j in range(i + 1, n):
            if assigned[j]:
                continue

            for k in cluster:
                sim = calculate_similarity(emails[k], emails[j])
                if sim >= SIMILARITY_THRESHOLD:
                    cluster.append(j)
                    assigned[j] = True
                    break

        clusters.append(cluster)

    return clusters


def identify_campaigns(emails: list[dict]) -> dict:
    """Main function to identify unique campaigns from emails."""
    if not emails:
        return {"total_emails": 0, "unique_campaigns": 0, "campaigns": []}

    clusters = cluster_emails(emails)

    campaigns = []
    for campaign_id, cluster_indices in enumerate(clusters, 1):
        cluster_emails_data = [emails[i] for i in cluster_indices]
        representative = cluster_emails_data[0]

        # Calculate average internal similarity
        avg_similarity = 1.0
        if len(cluster_indices) > 1:
            similarities = []
            for i, idx1 in enumerate(cluster_indices):
                for idx2 in cluster_indices[i + 1:]:
                    similarities.append(calculate_similarity(emails[idx1], emails[idx2]))
            avg_similarity = sum(similarities) / len(similarities) if similarities else 1.0

        campaigns.append({
            "campaign_id": campaign_id,
            "representative_subject": representative.get('subject', ''),
            "representative_recipient": representative.get('recipient_to', ''),
            "email_count": len(cluster_indices),
            "email_ids": [emails[i]['id'] for i in cluster_indices],
            "avg_similarity": round(avg_similarity, 3)
        })

    campaigns.sort(key=lambda x: x['email_count'], reverse=True)

    return {
        "total_emails": len(emails),
        "unique_campaigns": len(campaigns),
        "campaigns": campaigns
    }


def save_campaigns_to_supabase(user_id: str, campaigns: list[dict]):
    """Save campaign results to Supabase."""
    # Delete existing campaigns for this user
    existing = supabase_request(f"campaigns?user_id=eq.{user_id}&select=id", 'GET')
    if existing:
        for c in existing:
            supabase_request(f"email_campaigns?campaign_id=eq.{c['id']}", 'DELETE')
        supabase_request(f"campaigns?user_id=eq.{user_id}", 'DELETE')

    # Insert new campaigns
    for campaign in campaigns:
        campaign_data = {
            'user_id': user_id,
            'campaign_number': campaign['campaign_id'],
            'representative_subject': campaign['representative_subject'],
            'representative_recipient': campaign['representative_recipient'],
            'email_count': campaign['email_count'],
            'avg_similarity': campaign['avg_similarity'],
        }

        result = supabase_request('campaigns', 'POST', campaign_data)
        if not result:
            continue

        campaign_uuid = result[0]['id']

        # Link emails to campaign
        email_links = [
            {'email_id': email_id, 'campaign_id': campaign_uuid}
            for email_id in campaign['email_ids']
        ]

        if email_links:
            supabase_request('email_campaigns', 'POST', email_links)
