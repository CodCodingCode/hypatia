"""
Profile enrichment functions using Aviato API
"""

import requests
from typing import Optional, Dict

from config import AVIATO_API_KEY


def enrich_sender_by_email(email: str) -> Optional[Dict]:
    """
    Enrich sender profile using their email address

    Args:
        email: Sender's email address

    Returns:
        Enriched person profile dict, or None if enrichment fails
    """
    try:
        print(f"\n[ENRICH] Enriching sender profile for: {email}")

        response = requests.get(
            "https://data.api.aviato.co/person/enrich",
            params={"email": email},
            headers={"Authorization": f"Bearer {AVIATO_API_KEY}"},
            timeout=30,
        )

        if response.status_code == 200:
            profile = response.json()

            # Extract current company from experienceList (first entry is current job)
            current_company = None
            experience_list = profile.get('experienceList', [])
            if experience_list:
                current_company = experience_list[0].get('companyName')

            # Extract education info
            education_info = []
            degree_list = profile.get('degreeList', [])
            for degree in degree_list:
                school = degree.get('school', {})
                education_info.append({
                    'school': school.get('fullName'),
                    'fieldOfStudy': degree.get('fieldOfStudy'),
                    'degree': degree.get('name')
                })

            # Get highlights
            highlights = profile.get('computed_highlightList', [])

            print(f"[ENRICH] Successfully enriched: {profile.get('fullName', 'Unknown')}")
            print(f"         Title: {profile.get('headline', 'N/A')}")
            print(f"         Company: {current_company or 'N/A'}")
            print(f"         Highlights: {highlights[:3] if highlights else 'N/A'}")
            if education_info:
                for edu in education_info[:2]:
                    print(f"         Education: {edu.get('school', 'N/A')} - {edu.get('fieldOfStudy', 'N/A')}")

            # Add extracted fields to profile for easier access
            profile['currentCompany'] = current_company
            profile['educationSummary'] = education_info
            profile['highlights'] = highlights

            return profile
        else:
            print(f"[ENRICH] Email enrichment failed with status {response.status_code}")
            return None

    except Exception as e:
        print(f"[ENRICH] Error enriching sender profile: {str(e)}")
        return None


def enrich_lead_contact_info(linkedin_url: str) -> Optional[Dict]:
    """
    Enrich lead with contact information (email, phone) using LinkedIn URL

    Args:
        linkedin_url: LinkedIn profile URL (e.g., "linkedin.com/in/johndoe")

    Returns:
        Dict with contact info (email, phone numbers), or None if enrichment fails
    """
    try:
        print(f"\n[ENRICH] Fetching contact info for: {linkedin_url}")

        # Ensure URL is properly formatted
        if not linkedin_url.startswith('http'):
            linkedin_url = f"https://{linkedin_url}"

        response = requests.get(
            "https://data.api.aviato.co/person/contact-info",
            params={"linkedinURL": linkedin_url},
            headers={"Authorization": f"Bearer {AVIATO_API_KEY}"},
            timeout=30,
        )

        if response.status_code == 200:
            contact_info = response.json()
            print(f"[ENRICH] Successfully enriched contact info")
            print(f"         Emails: {len(contact_info.get('emails', []))}")
            print(f"         Phones: {len(contact_info.get('phoneNumbers', []))}")
            return contact_info
        else:
            print(f"[ENRICH] Contact enrichment failed with status {response.status_code}")
            return None

    except Exception as e:
        print(f"[ENRICH] Error enriching contact info: {str(e)}")
        return None
