"""
Parallel clustering implementation for email similarity calculations.
Uses ThreadPoolExecutor to parallelize similarity operations.
Optimized with quick_ratio() for faster comparisons.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import SequenceMatcher
from typing import List, Dict, Tuple

SIMILARITY_THRESHOLD = 0.60
MAX_WORKERS = 8  # Increased for better parallelism
MAX_BODY_LENGTH = 1000  # Truncate long bodies for faster comparison


def calculate_similarity(email1: dict, email2: dict) -> float:
    """
    Calculate similarity between two emails.
    Uses quick_ratio() first as a fast filter, then real_quick_ratio() for speed.
    Truncates long bodies to avoid slow comparisons.
    """
    subject1 = email1.get('subject', '') or ''
    subject2 = email2.get('subject', '') or ''
    body1 = (email1.get('body', '') or '')[:MAX_BODY_LENGTH]
    body2 = (email2.get('body', '') or '')[:MAX_BODY_LENGTH]

    # Subject similarity (usually short, use full ratio)
    subject_matcher = SequenceMatcher(None, subject1, subject2)
    subject_sim = subject_matcher.ratio()

    # Body similarity - use quick_ratio first as a filter
    body_matcher = SequenceMatcher(None, body1, body2)

    # quick_ratio is an upper bound - if it's below threshold, skip full calc
    if body_matcher.quick_ratio() < SIMILARITY_THRESHOLD * 0.8:
        body_sim = body_matcher.quick_ratio()
    else:
        body_sim = body_matcher.ratio()

    return (subject_sim + body_sim) / 2


def compute_similarity_pair(args: Tuple[int, int, dict, dict]) -> Tuple[int, int, float]:
    """Compute similarity for a single pair of emails."""
    i, j, email_i, email_j = args
    sim = calculate_similarity(email_i, email_j)
    return (i, j, sim)


def compute_similarity_matrix_parallel(emails: List[dict]) -> Dict[Tuple[int, int], float]:
    """
    Compute pairwise similarity matrix in parallel.
    Only computes upper triangle (i < j) to avoid redundant calculations.
    Returns dict mapping (i, j) -> similarity score.
    """
    n = len(emails)
    if n <= 1:
        return {}

    # Generate all pairs to compute
    pairs = [
        (i, j, emails[i], emails[j])
        for i in range(n)
        for j in range(i + 1, n)
    ]

    similarity_cache = {}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(compute_similarity_pair, pair): pair
            for pair in pairs
        }

        for future in as_completed(futures):
            try:
                i, j, sim = future.result()
                similarity_cache[(i, j)] = sim
            except Exception as e:
                pair = futures[future]
                print(f"Error computing similarity for pair ({pair[0]}, {pair[1]}): {e}")
                similarity_cache[(pair[0], pair[1])] = 0.0

    return similarity_cache


def get_cached_similarity(cache: Dict[Tuple[int, int], float], i: int, j: int) -> float:
    """Get similarity from cache, handling both (i,j) and (j,i) lookups."""
    if i == j:
        return 1.0
    if i > j:
        i, j = j, i
    return cache.get((i, j), 0.0)


def cluster_emails_with_cache(emails: List[dict], similarity_cache: Dict[Tuple[int, int], float]) -> List[List[int]]:
    """Cluster emails into campaigns using a precomputed similarity cache."""
    n = len(emails)
    if n == 0:
        return []

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

            # Check similarity against any email in the cluster
            for k in cluster:
                sim = get_cached_similarity(similarity_cache, k, j)
                if sim >= SIMILARITY_THRESHOLD:
                    cluster.append(j)
                    assigned[j] = True
                    break

        clusters.append(cluster)

    return clusters


def identify_campaigns_parallel(emails: List[dict]) -> dict:
    """
    Main function to identify unique campaigns from emails using parallel processing.
    Drop-in replacement for identify_campaigns().
    """
    if not emails:
        return {"total_emails": 0, "unique_campaigns": 0, "campaigns": []}

    # Compute similarity matrix once and reuse
    similarity_cache = compute_similarity_matrix_parallel(emails)

    # Cluster using the precomputed cache
    clusters = cluster_emails_with_cache(emails, similarity_cache)

    campaigns = []
    for campaign_id, cluster_indices in enumerate(clusters, 1):
        cluster_emails_data = [emails[i] for i in cluster_indices]
        representative = cluster_emails_data[0]

        # Calculate average internal similarity using cached values
        avg_similarity = 1.0
        if len(cluster_indices) > 1:
            similarities = []
            for i_idx, idx1 in enumerate(cluster_indices):
                for idx2 in cluster_indices[i_idx + 1:]:
                    similarities.append(get_cached_similarity(similarity_cache, idx1, idx2))
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
