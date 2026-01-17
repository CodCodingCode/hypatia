"""
Combined Campaign Analysis for Hypatia Email Intelligence.

Combines CTA extraction, email style analysis, and contact description
into a single GPT call for improved performance (~66% fewer API calls).

Saves results to:
- campaign_ctas
- campaign_email_styles
- campaign_contacts
"""

import os
import time
import json
import random
import urllib.request
import urllib.error
import urllib.parse
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from pathlib import Path

import asyncio
from openai import AsyncOpenAI


# =============================================================================
# ENVIRONMENT LOADING
# =============================================================================


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


# =============================================================================
# CONFIGURATION
# =============================================================================

CONFIG = {
    "SUPABASE_URL": os.environ.get("SUPABASE_URL", "https://YOUR_PROJECT.supabase.co"),
    "SUPABASE_ANON_KEY": os.environ.get("SUPABASE_ANON_KEY", "YOUR_SUPABASE_ANON_KEY"),
}

AVIATO_API_KEY = os.environ.get(
    "AVIATO_API_KEY", "a770545826390216df81d617f331b30ae27998d7cc886c8f"
)
AVIATO_BASE_URL = "https://data.api.aviato.co"
MAX_ENRICHMENTS_PER_CAMPAIGN = 3
API_RATE_LIMIT_DELAY = 0.5  # seconds between API calls
CONSECUTIVE_FAILURES_THRESHOLD = 5

# OpenRouter config
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
GPT_MODEL = "google/gemini-2.0-flash-001"

# Campaign filtering
MIN_CAMPAIGN_SIZE = 2
MAX_CAMPAIGNS = 5
MIN_SAMPLE = 2
MAX_SAMPLE = 5


# =============================================================================
# DATA STRUCTURES
# =============================================================================


@dataclass
class EnrichmentResult:
    email: str
    success: bool
    raw_json: Optional[dict]
    error: Optional[str]


# =============================================================================
# SUPABASE HELPERS
# =============================================================================


def supabase_request(
    endpoint: str, method: str = "GET", body: dict = None, upsert: bool = False
) -> dict | list | None:
    """Make a request to Supabase REST API."""
    url = f"{CONFIG['SUPABASE_URL']}/rest/v1/{endpoint}"

    # For upserts, need resolution=merge-duplicates in Prefer header
    prefer = "return=representation"
    if upsert:
        prefer = "return=representation,resolution=merge-duplicates"

    headers = {
        "apikey": CONFIG["SUPABASE_ANON_KEY"],
        "Authorization": f"Bearer {CONFIG['SUPABASE_ANON_KEY']}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }

    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"Supabase error ({e.code}): {error_body}")
        return None


def get_users() -> list[dict]:
    """Get all users from Supabase with their profile info."""
    return (
        supabase_request(
            "users?select=id,email,app_purpose,user_type,display_name,contact_types"
        )
        or []
    )


def get_user_campaigns(user_id: str) -> list[dict]:
    """Get qualifying campaigns for a user (>= MIN_CAMPAIGN_SIZE emails), ordered by email count."""
    return (
        supabase_request(
            f"campaigns?user_id=eq.{user_id}&email_count=gte.{MIN_CAMPAIGN_SIZE}&select=id,campaign_number,representative_subject,representative_recipient,email_count&order=email_count.desc&limit={MAX_CAMPAIGNS}"
        )
        or []
    )


# =============================================================================
# ENRICHMENT FUNCTIONS (from learn_user_contact_preferance.py)
# =============================================================================


def get_cached_enrichment(user_id: str, email: str) -> Optional[EnrichmentResult]:
    """Check contact_enrichments table for existing result."""
    encoded_email = urllib.parse.quote(email)
    result = supabase_request(
        f"contact_enrichments?user_id=eq.{user_id}&email=eq.{encoded_email}&select=*"
    )
    if result and len(result) > 0:
        row = result[0]
        return EnrichmentResult(
            email=row["email"],
            success=row["success"],
            raw_json=row.get("raw_json"),
            error=row.get("error"),
        )
    return None


def save_enrichment(user_id: str, result: EnrichmentResult):
    """Save or update enrichment result in database."""
    body = {
        "user_id": user_id,
        "email": result.email,
        "success": result.success,
        "raw_json": result.raw_json,
        "error": result.error,
        "enriched_at": datetime.now(timezone.utc).isoformat(),
    }
    supabase_request(
        "contact_enrichments?on_conflict=user_id,email", method="POST", body=body, upsert=True
    )


def enrich_contact(email: str, retries: int = 3) -> EnrichmentResult:
    """Call Aviato API to enrich a single contact."""
    url = f"{AVIATO_BASE_URL}/person/enrich?email={urllib.parse.quote(email)}"
    headers = {"Authorization": f"Bearer {AVIATO_API_KEY}"}

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode("utf-8"))
                if data:
                    return EnrichmentResult(
                        email=email, success=True, raw_json=data, error=None
                    )
                else:
                    return EnrichmentResult(
                        email=email,
                        success=False,
                        raw_json=None,
                        error="Empty response from API",
                    )
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return EnrichmentResult(
                    email=email, success=False, raw_json=None, error="Contact not found"
                )
            elif e.code == 429:
                if attempt < retries - 1:
                    time.sleep(2 * (attempt + 1))
                    continue
                return EnrichmentResult(
                    email=email, success=False, raw_json=None, error="Rate limited"
                )
            elif e.code in (401, 403):
                return EnrichmentResult(
                    email=email,
                    success=False,
                    raw_json=None,
                    error=f"Authentication error: {e.code}",
                )
            else:
                return EnrichmentResult(
                    email=email,
                    success=False,
                    raw_json=None,
                    error=f"API error: {e.code}",
                )
        except urllib.error.URLError as e:
            return EnrichmentResult(
                email=email,
                success=False,
                raw_json=None,
                error=f"Network error: {str(e)}",
            )
        except Exception as e:
            return EnrichmentResult(
                email=email,
                success=False,
                raw_json=None,
                error=f"Unexpected error: {str(e)}",
            )

    return EnrichmentResult(
        email=email, success=False, raw_json=None, error="Max retries exceeded"
    )


def extract_email_from_header(recipient_to: str) -> str:
    """Extract email address from recipient header like 'Name <email@domain.com>'."""
    if not recipient_to:
        return ""
    match = re.search(r"<([^>]+)>", recipient_to)
    if match:
        return match.group(1).strip().lower()
    if "@" in recipient_to:
        return recipient_to.strip().lower()
    return ""


def get_campaign_recipients(campaign_id: str) -> list[str]:
    """Get unique recipient emails from a campaign."""
    result = supabase_request(
        f"email_campaigns?campaign_id=eq.{campaign_id}&select=sent_emails!inner(recipient_to)"
    )
    if not result:
        return []

    emails = set()
    for row in result:
        recipient_to = row.get("sent_emails", {}).get("recipient_to", "")
        email = extract_email_from_header(recipient_to)
        if email:
            emails.add(email)

    return list(emails)


def enrich_campaign_contacts(
    user_id: str, campaign_id: str, max_enrichments: int = MAX_ENRICHMENTS_PER_CAMPAIGN
) -> tuple[list[EnrichmentResult], bool]:
    """Enrich contacts from a campaign until we get max_enrichments successful results."""
    recipients = get_campaign_recipients(campaign_id)
    print(f"    Found {len(recipients)} unique recipients")

    successful = []
    cached_count = 0
    api_calls = 0
    consecutive_failures = 0
    hit_failure_threshold = False

    for email in recipients:
        if len(successful) >= max_enrichments:
            break

        if consecutive_failures >= CONSECUTIVE_FAILURES_THRESHOLD:
            print(
                f"    [!] Hit {CONSECUTIVE_FAILURES_THRESHOLD} consecutive failures, stopping enrichment"
            )
            hit_failure_threshold = True
            break

        cached = get_cached_enrichment(user_id, email)
        if cached:
            cached_count += 1
            if cached.success:
                successful.append(cached)
                consecutive_failures = 0
                print(f"      [CACHED] {email}: Success")
            else:
                consecutive_failures += 1
                print(f"      [CACHED] {email}: {cached.error}")
        else:
            api_calls += 1
            print(f"      [API] Enriching {email}...", end=" ")

            if api_calls > 1:
                time.sleep(API_RATE_LIMIT_DELAY)

            result = enrich_contact(email)
            save_enrichment(user_id, result)

            if result.success:
                successful.append(result)
                consecutive_failures = 0
                print("Success!")
            else:
                consecutive_failures += 1
                print(f"Failed: {result.error}")

    if consecutive_failures >= CONSECUTIVE_FAILURES_THRESHOLD:
        hit_failure_threshold = True

    print(
        f"    Results: {len(successful)} successful, {cached_count} cached, {api_calls} API calls"
    )
    return successful, hit_failure_threshold


# =============================================================================
# CAMPAIGN DATA ACCESS
# =============================================================================


def get_campaign_emails(campaign_id: str, limit: int = MAX_SAMPLE) -> list[dict]:
    """Fetch emails for a campaign."""
    email_links = supabase_request(
        f"email_campaigns?campaign_id=eq.{campaign_id}&select=email_id"
    ) or []

    if not email_links:
        return []

    email_ids = [e['email_id'] for e in email_links]

    if len(email_ids) > limit:
        email_ids = random.sample(email_ids, limit)

    emails = []
    for email_id in email_ids:
        result = supabase_request(
            f"sent_emails?id=eq.{email_id}&select=subject,body,recipient_to,sent_at"
        )
        if result:
            emails.append(result[0])

    # Sort by sent_at to get first email
    emails.sort(key=lambda x: x.get('sent_at', '') or '')
    return emails


def get_campaign_first_email(campaign_id: str) -> dict | None:
    """Get the first (earliest) email from a campaign."""
    result = supabase_request(
        f"email_campaigns?campaign_id=eq.{campaign_id}&select=sent_emails!inner(subject,body,sent_at)&sent_emails.order=sent_at.asc&limit=1"
    )
    if result and len(result) > 0:
        return result[0].get("sent_emails", {})
    return None


# =============================================================================
# CACHE CHECKING
# =============================================================================


def get_cached_cta(campaign_id: str) -> dict | None:
    """Check if CTA already exists for campaign."""
    result = supabase_request(
        f"campaign_ctas?campaign_id=eq.{campaign_id}&select=*"
    )
    if result and len(result) > 0:
        return result[0]
    return None


def get_cached_style(campaign_id: str) -> dict | None:
    """Check if style analysis already exists for campaign."""
    result = supabase_request(
        f"campaign_email_styles?campaign_id=eq.{campaign_id}&select=one_sentence_description,style_analysis_prompt"
    )
    if result and len(result) > 0:
        return result[0]
    return None


def get_cached_contact(campaign_id: str) -> str | None:
    """Check if contact description already exists for campaign."""
    result = supabase_request(
        f"campaign_contacts?campaign_id=eq.{campaign_id}&select=contact_description"
    )
    if result and len(result) > 0:
        return result[0].get("contact_description")
    return None


# =============================================================================
# SAVE FUNCTIONS
# =============================================================================


def save_campaign_cta(campaign_id: str, cta_analysis: dict):
    """Save or update CTA analysis in Supabase."""
    body = {
        "campaign_id": campaign_id,
        "cta_type": cta_analysis.get("cta_type"),
        "cta_description": cta_analysis.get("cta_description"),
        "cta_text": cta_analysis.get("cta_text"),
        "urgency": cta_analysis.get("urgency"),
    }
    result = supabase_request(
        "campaign_ctas?on_conflict=campaign_id",
        method="POST",
        body=body,
        upsert=True
    )
    if result:
        print(f"    Saved CTA to Supabase")
    return result


def save_style_analysis(campaign_id: str, analysis: dict, sample_count: int):
    """Save the style analysis to Supabase."""
    data = {
        'campaign_id': campaign_id,
        'one_sentence_description': analysis.get('one_sentence_description', ''),
        'style_analysis_prompt': analysis.get('style_analysis_prompt', ''),
        'sample_emails_analyzed': sample_count,
    }
    supabase_request('campaign_email_styles?on_conflict=campaign_id', method='POST', body=data, upsert=True)
    print(f"    Saved style to Supabase")


def save_contact_description(campaign_id: str, description: str):
    """Save contact description to Supabase."""
    body = {
        "campaign_id": campaign_id,
        "contact_description": description,
    }
    supabase_request(
        "campaign_contacts?on_conflict=campaign_id", method="POST", body=body, upsert=True
    )
    print(f"    Saved contact description to Supabase")


# =============================================================================
# COMBINED GPT ANALYSIS
# =============================================================================


def build_enrichment_profiles_text(enrichments: list[EnrichmentResult]) -> str:
    """Build text summary of enriched profiles for GPT prompt."""
    profiles_summary = []
    for e in enrichments:
        if e.success and e.raw_json:
            data = e.raw_json
            name = (
                data.get("name")
                or data.get("full_name")
                or data.get("person", {}).get("name", "")
            )
            title = (
                data.get("title")
                or data.get("job_title")
                or data.get("person", {}).get("title", "")
            )
            company = (
                data.get("company")
                or data.get("organization")
                or data.get("person", {}).get("company", "")
            )

            profile_str = f"- {name}" if name else f"- {e.email}"
            if title:
                profile_str += f", {title}"
            if company:
                profile_str += f" at {company}"
            profiles_summary.append(profile_str)

    return "\n".join(profiles_summary) if profiles_summary else "No enriched profile data available."


async def analyze_campaign_combined_async(
    emails: list[dict],
    enrichments: list[EnrichmentResult],
    user_context: dict
) -> dict:
    """
    Use Backboard to analyze emails and extract CTA, style, and contact description
    in a single API call.

    Returns a dict with 'cta', 'style', and 'contact' sections.
    """
    # Build email samples for style analysis (all emails)
    email_texts = []
    for i, email in enumerate(emails, 1):
        subject = email.get('subject', '(no subject)')
        body = email.get('body', '')[:1500]
        email_texts.append(f"--- Email {i} ---\nSubject: {subject}\n\n{body}")

    emails_content = "\n\n".join(email_texts)

    # First email for CTA analysis
    first_email = emails[0] if emails else {}
    first_subject = first_email.get('subject', '')
    first_body = first_email.get('body', '')[:2000]

    # Enrichment profiles for contact analysis
    profiles_text = build_enrichment_profiles_text(enrichments)

    # User context for contact analysis
    user_role = user_context.get("user_type", "unknown")
    app_purpose = user_context.get("app_purpose", "unknown")
    contact_types = user_context.get("contact_types", "unknown")

    prompt = f"""You are an expert email analyst. Always respond with valid JSON only, no markdown formatting.

Analyze these emails from the same sender and return a JSON object with three sections.

=== EMAILS FROM THIS CAMPAIGN ===
{emails_content}

=== ENRICHED CONTACT PROFILES ===
{profiles_text}

=== USER CONTEXT ===
- Their role: {user_role}
- Why they use this app: {app_purpose}
- Types of people they generally contact: {contact_types}

Return a JSON object with exactly these three sections:

1. "cta" - Analyze the FIRST email and identify the main call-to-action:
   - "cta_type": A short category (e.g., "Schedule Meeting", "Reply Request", "Form Submission", "Investment Ask", "Advice Request", "Introduction Request", "No Clear CTA")
   - "cta_description": A brief description of what action the sender wants
   - "cta_text": The exact text/sentence from the email containing the CTA
   - "urgency": Rate as "low", "medium", or "high"

2. "style" - Analyze ALL emails to understand writing style:
   - "one_sentence_description": A single, concise sentence (under 100 words) capturing the essence of this person's email writing style
   - "style_analysis_prompt": A detailed prompt (400-600 words) teaching an AI to write emails like this person, covering:
     * Step 1 - Opening Style: How do they start emails?
     * Step 2 - Sentence Structure: Short/punchy or long/complex?
     * Step 3 - Tone & Formality: Formal, casual, or in between?
     * Step 4 - Vocabulary Patterns: What words/phrases do they favor?
     * Step 5 - Making Requests: How do they ask for things?
     * Step 6 - Closing Style: How do they end emails?
     * Step 7 - Unique Quirks: Distinctive habits?

3. "contact" - Describe who is being contacted:
   - "contact_description": ONE concise sentence describing the people being contacted (e.g., "recruiters at Google", "medical researchers at Harvard", "managing engineers at big tech companies")

Respond ONLY with valid JSON, no other text or markdown formatting."""

    max_retries = 2
    last_error = None

    # Debug: Check API key at startup
    print(f"\n{'='*60}")
    print("OPENROUTER DEBUG INFO")
    print(f"{'='*60}")
    print(f"  API Key configured: {'Yes' if OPENROUTER_API_KEY else 'NO - MISSING!'}")
    if OPENROUTER_API_KEY:
        print(f"  API Key prefix: {OPENROUTER_API_KEY[:15]}...")
        print(f"  API Key length: {len(OPENROUTER_API_KEY)} chars")
    print(f"  Model: {GPT_MODEL}")
    print(f"  Base URL: {OPENROUTER_BASE_URL}")
    print(f"{'='*60}\n")

    # Create OpenRouter client (OpenAI-compatible)
    client = AsyncOpenAI(
        api_key=OPENROUTER_API_KEY,
        base_url=OPENROUTER_BASE_URL,
    )

    for attempt in range(max_retries):
        print(f"  [Attempt {attempt + 1}/{max_retries}] Sending request to OpenRouter...")
        try:
            response = await client.chat.completions.create(
                model=GPT_MODEL,
                messages=[
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
            )
            print(f"  [Attempt {attempt + 1}/{max_retries}] Response received!")

            result_text = response.choices[0].message.content.strip()
            print(f"  [Attempt {attempt + 1}/{max_retries}] Response length: {len(result_text)} chars")
            print(f"  [Attempt {attempt + 1}/{max_retries}] Response starts with: {result_text[:100]}...")

            # Clean up potential markdown code blocks
            if result_text.startswith("```"):
                result_text = result_text.split("```")[1]
                if result_text.startswith("json"):
                    result_text = result_text[4:]
            result_text = result_text.strip()

            try:
                parsed = json.loads(result_text)
                print(f"  [Attempt {attempt + 1}/{max_retries}] JSON parsed successfully!")
                return parsed
            except json.JSONDecodeError as je:
                # Try to extract JSON object if there's extra content
                json_match = re.search(r'\{[\s\S]*\}', result_text)
                if json_match:
                    try:
                        parsed = json.loads(json_match.group())
                        print(f"  [Attempt {attempt + 1}/{max_retries}] JSON extracted and parsed successfully!")
                        return parsed
                    except json.JSONDecodeError:
                        pass

                # Log the problematic response for debugging
                print(f"    JSON parse error (attempt {attempt + 1}): {je}")
                print(f"    Full response text:\n{'-'*40}\n{result_text}\n{'-'*40}")
                last_error = je

                if attempt < max_retries - 1:
                    print(f"    Retrying...")
                    continue
                raise je

        except json.JSONDecodeError:
            if attempt >= max_retries - 1:
                break
            continue
        except Exception as e:
            last_error = e
            print(f"    [Attempt {attempt + 1}/{max_retries}] EXCEPTION: {type(e).__name__}: {e}")
            if attempt >= max_retries - 1:
                break
            print(f"    Retrying...")
            continue

    print(f"\n{'='*60}")
    print(f"OPENROUTER FAILED after {max_retries} attempts")
    print(f"Last error: {type(last_error).__name__}: {last_error}")
    print(f"{'='*60}\n")
    return {
        "cta": {
            "cta_type": "Error",
            "cta_description": f"Failed to analyze: {str(last_error)}",
            "cta_text": "",
            "urgency": "unknown",
        },
        "style": {
            "one_sentence_description": f"Error analyzing style: {str(last_error)}",
            "style_analysis_prompt": "",
        },
        "contact": {
            "contact_description": f"Error: {str(last_error)}",
        },
    }


def analyze_campaign_combined(
    emails: list[dict],
    enrichments: list[EnrichmentResult],
    user_context: dict
) -> dict:
    """Synchronous wrapper for analyze_campaign_combined_async."""
    return asyncio.run(analyze_campaign_combined_async(emails, enrichments, user_context))


# =============================================================================
# MAIN API FUNCTION
# =============================================================================


def analyze_single_campaign_combined(
    campaign_id: str, user_id: str, user_context: dict
) -> dict | None:
    """
    Analyze a single campaign for CTA, style, and contact description.
    Returns combined results dict or None.

    Uses caching - if ALL three analyses exist, returns cached data.
    If ANY is missing, makes a fresh combined GPT call and updates all tables.

    This is the function to call from the API endpoint.

    Returns:
        {
            "cta_type": str,
            "cta_description": str,
            "cta_text": str,
            "urgency": str,
            "style_description": str,
            "style_prompt": str,
            "contact_description": str,
            "cached": bool
        }
    """
    # Check if ALL three are cached
    cached_cta = get_cached_cta(campaign_id)
    cached_style = get_cached_style(campaign_id)
    cached_contact = get_cached_contact(campaign_id)

    if cached_cta and cached_style and cached_style.get('one_sentence_description') and cached_contact:
        print(f"    [CACHED] All analyses exist, returning cached data")
        return {
            "cta_type": cached_cta.get("cta_type"),
            "cta_description": cached_cta.get("cta_description"),
            "cta_text": cached_cta.get("cta_text"),
            "urgency": cached_cta.get("urgency"),
            "style_description": cached_style.get("one_sentence_description"),
            "style_prompt": cached_style.get("style_analysis_prompt"),
            "contact_description": cached_contact,
            "cached": True,
        }

    # Get sample emails (2-5)
    emails = get_campaign_emails(campaign_id, MAX_SAMPLE)
    if len(emails) < MIN_SAMPLE:
        print(f"    Not enough emails ({len(emails)}) for analysis, need at least {MIN_SAMPLE}")
        return None

    # Get enrichments
    enrichments, hit_failure_threshold = enrich_campaign_contacts(user_id, campaign_id)

    # Make combined GPT call
    print(f"    Analyzing {len(emails)} emails with combined GPT call...")
    result = analyze_campaign_combined(emails, enrichments, user_context)

    # Save all three to database
    cta_data = result.get("cta", {})
    style_data = result.get("style", {})
    contact_data = result.get("contact", {})

    if cta_data.get("cta_type") and cta_data.get("cta_type") != "Error":
        save_campaign_cta(campaign_id, cta_data)

    if style_data.get("style_analysis_prompt"):
        save_style_analysis(campaign_id, style_data, len(emails))

    contact_desc = contact_data.get("contact_description", "")
    if contact_desc and not contact_desc.startswith("Error"):
        save_contact_description(campaign_id, contact_desc)

    return {
        "cta_type": cta_data.get("cta_type"),
        "cta_description": cta_data.get("cta_description"),
        "cta_text": cta_data.get("cta_text"),
        "urgency": cta_data.get("urgency"),
        "style_description": style_data.get("one_sentence_description"),
        "style_prompt": style_data.get("style_analysis_prompt"),
        "contact_description": contact_desc,
        "cached": False,
    }


# =============================================================================
# STANDALONE MAIN
# =============================================================================


def main():
    """Run combined analysis for all users (standalone mode)."""
    if "YOUR_PROJECT" in CONFIG["SUPABASE_URL"]:
        print("ERROR: Please set SUPABASE_URL and SUPABASE_ANON_KEY")
        return []

    users = get_users()
    if not users:
        print("No users found in database.")
        return []

    print(f"Found {len(users)} user(s)\n")

    all_results = []

    for user in users:
        print("=" * 70)
        print(f"Processing user: {user['email']}")
        print(f"  Role: {user.get('user_type', 'N/A')}")
        print(f"  App Purpose: {user.get('app_purpose', 'N/A')}")
        print("=" * 70)

        user_context = {
            "user_type": user.get("user_type"),
            "app_purpose": user.get("app_purpose"),
            "display_name": user.get("display_name"),
            "contact_types": user.get("contact_types"),
        }

        campaigns = get_user_campaigns(user["id"])
        if not campaigns:
            print(f"  No qualifying campaigns found (need >= {MIN_CAMPAIGN_SIZE} emails)")
            continue

        print(f"  Found {len(campaigns)} qualifying campaigns")

        for campaign in campaigns:
            campaign_id = campaign["id"]
            campaign_num = campaign.get("campaign_number", "?")
            subject = campaign.get("representative_subject", "N/A")[:50]
            email_count = campaign.get("email_count", 0)

            print(f"\n  Campaign #{campaign_num}: {subject}... ({email_count} emails)")

            result = analyze_single_campaign_combined(
                campaign_id, user["id"], user_context
            )

            if result:
                print(f"    CTA Type: {result.get('cta_type')}")
                print(f"    Style: {result.get('style_description', '')[:80]}...")
                print(f"    Contacts: {result.get('contact_description')}")
                all_results.append({
                    "campaign_id": campaign_id,
                    "campaign_number": campaign_num,
                    **result
                })

    print("\n\n" + "=" * 70)
    print(f"COMPLETE: Analyzed {len(all_results)} campaigns")
    print("=" * 70)

    return all_results


if __name__ == "__main__":
    results = main()
