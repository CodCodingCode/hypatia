"""
Utility Functions for the Email to DSL Pipeline

Contains helper functions for JSON parsing, API calls, and schema loading.
"""

import json
import os
import re
import sys
from typing import Any, Dict

import requests

# Add parent directory to path for clean_json imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Try to import clean_json utilities, fall back to no-op if not available
try:
    from clean_json import (
        remove_redundant_fields,
        clean_location_details,
        merge_degrees_into_education,
        dedupe_experience_dates,
    )
except ImportError:
    # Fallback no-op functions if clean_json not available
    def remove_redundant_fields(profile):
        return profile

    def clean_location_details(profile):
        return profile

    def merge_degrees_into_education(profile):
        return profile

    def dedupe_experience_dates(profile):
        return profile

# Import configuration from central config module
from config import AVIATO_API_KEY, AVIATO_BASE_URL


def safe_parse_json(raw_response: str) -> Any:
    """
    Parse JSON from LLM response, handling common issues.

    Handles:
    - Markdown code fences (```json ... ```)
    - Smart quotes
    - Trailing commas

    Args:
        raw_response: Raw string from LLM

    Returns:
        Parsed JSON object
    """
    result = raw_response.strip()

    # Remove markdown code fences
    if "```" in result:
        if "```json" in result:
            result = result.split("```json")[-1].split("```")[0].strip()
        else:
            result = result.split("```")[1].split("```")[0].strip()

    if not result:
        result = raw_response.strip()

    # Fix common issues
    result = result.replace('"', '"').replace('"', '"')
    result = re.sub(r",\s*([}\]])", r"\1", result)

    return json.loads(result)


def enrich_profile(linkedin_url: str) -> Dict[str, Any]:
    """
    Fetch enriched profile from LinkedIn URL using Aviato API.

    Args:
        linkedin_url: LinkedIn profile URL

    Returns:
        Cleaned and enriched profile data

    Raises:
        Exception: If API call fails
    """
    if not linkedin_url.startswith("http"):
        linkedin_url = f"https://{linkedin_url}"

    response = requests.get(
        f"{AVIATO_BASE_URL}/person/enrich",
        params={"linkedinURL": linkedin_url},
        headers={"Authorization": f"Bearer {AVIATO_API_KEY}"},
        timeout=30,
    )

    if response.status_code == 200:
        profile = response.json()
        # Clean the profile to reduce noise
        profile = remove_redundant_fields(profile)
        profile = clean_location_details(profile)
        profile = merge_degrees_into_education(profile)
        profile = dedupe_experience_dates(profile)
        return profile
    else:
        raise Exception(f"Enrichment failed: {response.status_code} - {response.text}")


def load_properties() -> dict:
    """
    Load properties from the person schema JSON file.

    Returns:
        Dict of schema properties
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    schema_path = os.path.join(script_dir, "..", "person_schema_simple.json")

    with open(schema_path) as f:
        schema = json.load(f)

    return schema["properties"]


def get_contact_info(linkedin_url: str) -> Dict[str, Any]:
    """
    Fetch contact info (email, phone) for a person via their LinkedIn URL.

    Args:
        linkedin_url: LinkedIn profile URL

    Returns:
        Dict with contact info fields, or empty dict on failure
    """
    # Normalize LinkedIn URL to expected format: https://www.linkedin.com/in/username/
    if not linkedin_url.startswith("http"):
        linkedin_url = f"https://{linkedin_url}"

    # Ensure www. prefix
    if "://linkedin.com" in linkedin_url:
        linkedin_url = linkedin_url.replace("://linkedin.com", "://www.linkedin.com")

    # Ensure trailing slash
    if not linkedin_url.endswith("/"):
        linkedin_url = f"{linkedin_url}/"

    print(f"[CONTACT-API] Requesting: {linkedin_url}")

    try:
        response = requests.get(
            f"{AVIATO_BASE_URL}/person/contact-info",
            params={"linkedinURL": linkedin_url},
            headers={"Authorization": f"Bearer {AVIATO_API_KEY}"},
            timeout=30,
        )

        print(f"[CONTACT-API] Status: {response.status_code}")

        if response.status_code == 200:
            data = response.json()
            print(f"[CONTACT-API] Response keys: {list(data.keys())}")
            return data
        else:
            print(f"[CONTACT-API] Error: {response.text[:200]}")
            return {}
    except Exception as e:
        print(f"[CONTACT-API] Exception: {e}")
        return {}
