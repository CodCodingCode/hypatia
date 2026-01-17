"""
People Finder Agent - Finds contacts to email based on target criteria.

Uses the pipeline to convert email context into DSL queries for Aviato API,
with Clado AI as a fallback for text-based search.
"""

import os
import sys
from typing import Optional

import httpx
import requests

from ..base_agent import BaseAgent

# Add parent directory to path for pipeline imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from pipeline import (
    extract_facts_from_description,
    extract_facts_from_email,
    classify_facts,
    map_facts_to_properties,
    generate_search_description,
)
from pipeline.utils import enrich_profile, load_properties, get_contact_info
from config import AVIATO_API_KEY, AVIATO_BASE_URL


class PeopleFinderAgent(BaseAgent):
    """Agent responsible for finding people to contact based on target criteria."""

    CLADO_API_URL = "https://search.clado.ai/api/search"

    def __init__(self, supabase_client):
        self.supabase = supabase_client
        self.clado_api_key = os.getenv("CLADO_API_KEY")
        self.aviato_api_key = AVIATO_API_KEY
        self.aviato_base_url = AVIATO_BASE_URL

    def _build_dsl_payloads(self, dsl_mapping: dict, limit: int = 20, offset: int = 0) -> list:
        """
        Build multiple simple Aviato DSL payloads from property mappings.

        Generates separate queries for each combination of list values.

        Args:
            dsl_mapping: Dict of property paths to values
            limit: Number of results to return per query
            offset: Offset for pagination

        Returns:
            List of DSL payload dicts for Aviato API
        """
        from itertools import product

        list_props = {}
        single_conditions = []

        for prop, value in dsl_mapping.items():
            if value is None:
                continue
            if isinstance(value, str) and value.strip() == "":
                continue
            if isinstance(value, list) and len(value) == 0:
                continue

            if isinstance(value, bool):
                single_conditions.append({prop: {"operation": "eq", "value": value}})
            elif isinstance(value, list):
                valid_values = [v for v in value if v and str(v).strip()]
                if valid_values:
                    list_props[prop] = valid_values
            else:
                single_conditions.append(
                    {prop: {"operation": "textcontains", "value": str(value)}}
                )

        if not list_props:
            if not single_conditions:
                single_conditions = [
                    {"linkedinConnections": {"operation": "gt", "value": 30}}
                ]
            return [
                {
                    "dsl": {
                        "offset": offset,
                        "limit": limit,
                        "filters": [{"AND": single_conditions}],
                    }
                }
            ]

        props = list(list_props.keys())
        value_lists = [list_props[p] for p in props]
        combinations = list(product(*value_lists))

        payloads = []
        for combo in combinations:
            conditions = single_conditions.copy()
            for prop, value in zip(props, combo):
                conditions.append({prop: {"operation": "textcontains", "value": value}})

            payloads.append(
                {
                    "dsl": {
                        "offset": offset,
                        "limit": limit,
                        "filters": [{"AND": conditions}],
                    }
                }
            )

        return payloads

    async def _search_with_description(self, target_description: str, num_results: int = 10) -> list:
        """
        Search for contacts using a natural language description.

        Uses the pipeline to extract facts, classify them, map to DSL properties,
        and search Aviato with pagination to find contacts with emails.

        Args:
            target_description: Natural language description of who to find
            num_results: Number of contacts with emails to return

        Returns:
            List of contact dictionaries with email, name, first_name, last_name, etc.
        """
        print(f"[PeopleFinder] Extracting facts from description...")
        facts = extract_facts_from_description(target_description)
        print(f"[PeopleFinder] Extracted {len(facts)} facts")

        if not facts:
            print("[PeopleFinder] No facts extracted from description")
            return []

        print(f"[PeopleFinder] Classifying facts...")
        classified = classify_facts(facts)

        print(f"[PeopleFinder] Mapping to DSL properties...")
        properties = load_properties()
        dsl_mapping = map_facts_to_properties(classified, properties)

        search_desc = generate_search_description(dsl_mapping)
        print(f"[PeopleFinder] Search: {search_desc}")

        # Build multiple payloads for different query combinations
        batch_size = 20
        payloads = self._build_dsl_payloads(dsl_mapping, limit=batch_size)
        print(f"[PeopleFinder] Generated {len(payloads)} search queries")

        # Debug: print the DSL mapping and first payload
        import json
        print(f"[PeopleFinder] DSL mapping: {json.dumps(dsl_mapping, indent=2)}")
        if payloads:
            print(f"[PeopleFinder] First payload: {json.dumps(payloads[0], indent=2)}")

        collected_contacts = []
        seen_linkedin_urls = set()

        for query_idx, payload in enumerate(payloads, 1):
            if len(collected_contacts) >= num_results:
                break

            print(f"[PeopleFinder] Executing query {query_idx}/{len(payloads)}...")

            # Paginate within each query
            offset = 0
            max_pages = 5

            for page in range(max_pages):
                if len(collected_contacts) >= num_results:
                    break

                payload["dsl"]["offset"] = offset

                try:
                    results = self._execute_aviato_search(payload)
                except Exception as e:
                    print(f"[PeopleFinder] Search failed: {e}")
                    break

                people = results.get("items", [])
                total = results.get("count", {})
                total_count = total.get("value", 0) if isinstance(total, dict) else 0
                print(f"[PeopleFinder] Query returned {total_count} total matches, {len(people)} in this batch")

                if not people:
                    break

                for person in people:
                    # Check if we already have enough contacts BEFORE fetching more
                    if len(collected_contacts) >= num_results:
                        break

                    name = person.get("fullName", "")
                    linkedin = person.get("URLs", {}).get("linkedin", "")

                    # Skip duplicates
                    if linkedin in seen_linkedin_urls:
                        continue
                    seen_linkedin_urls.add(linkedin)

                    # Fetch contact info from Aviato
                    contact_info = get_contact_info(linkedin) if linkedin else {}

                    # Extract email from the emails array
                    email = None
                    emails_list = contact_info.get("emails", [])
                    if emails_list:
                        work_emails = [e["email"] for e in emails_list if e.get("type") == "work"]
                        personal_emails = [e["email"] for e in emails_list if e.get("type") == "personal"]
                        email = (
                            work_emails[0] if work_emails
                            else (personal_emails[0] if personal_emails else emails_list[0].get("email"))
                        )

                    if not email:
                        continue

                    # Split name into first and last
                    name_parts = name.split() if name else []
                    first_name = name_parts[0] if name_parts else ""
                    last_name = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""

                    # Extract current position info
                    experience_list = person.get("experienceList", [])
                    current_title = ""
                    current_company = ""

                    for exp in experience_list:
                        if exp.get("endDate") is None:
                            positions = exp.get("positionList", [])
                            if positions:
                                current_title = positions[0].get("title", "")
                            current_company = exp.get("companyName", "")
                            break

                    contact = {
                        "email": email,
                        "name": name,
                        "first_name": first_name,
                        "last_name": last_name,
                        "title": current_title or person.get("headline", ""),
                        "company": current_company,
                        "linkedin_url": linkedin,
                        "location": person.get("location", ""),
                    }

                    collected_contacts.append(contact)
                    print(f"[PeopleFinder] Found: {name} ({email})")

                offset += batch_size

        print(f"[PeopleFinder] Found {len(collected_contacts)} contacts with emails")
        return collected_contacts

    async def execute(self, *args, **kwargs):
        return await self.find(
            user_id=kwargs.get("user_id", ""),
            target_description=kwargs.get("target_description", ""),
            email_subject=kwargs.get("email_subject"),
            email_body=kwargs.get("email_body"),
            recipient_linkedin_url=kwargs.get("recipient_linkedin_url"),
        )

    async def find(
        self,
        user_id: str,
        target_description: str,
        email_subject: Optional[str] = None,
        email_body: Optional[str] = None,
        recipient_linkedin_url: Optional[str] = None,
    ) -> list:
        """
        Find contacts matching the target description.

        Priority:
        1. Description-based search using pipeline (primary)
        2. Email-based pipeline search if email context is provided
        3. Clado AI fallback

        Args:
            user_id: User ID (for future caching/tracking)
            target_description: The "who" description from manager agent
            email_subject: Optional email subject for pipeline-based search
            email_body: Optional email body for pipeline-based search
            recipient_linkedin_url: Optional LinkedIn URL for profile enrichment

        Returns:
            List of contacts with email, name, first_name, last_name, title, company, linkedin_url
        """
        # Primary: Use description-based search
        if target_description:
            try:
                print(f"[PeopleFinder] Using description-based Aviato search...")
                contacts = await self._search_with_description(target_description)
                if contacts:
                    return contacts[:10]
                print(f"[PeopleFinder] Description search returned no results, trying fallbacks...")
            except Exception as e:
                print(f"[PeopleFinder] Description search failed: {e}, trying fallbacks...")

        # Secondary: Use email-based pipeline search if context is provided
        if email_subject and email_body and recipient_linkedin_url:
            try:
                print(f"[PeopleFinder] Using email-based Aviato search...")
                contacts = await self._search_with_pipeline(
                    email_subject, email_body, recipient_linkedin_url
                )
                if contacts:
                    return contacts[:10]
                print(f"[PeopleFinder] Email search returned no results, falling back to Clado...")
            except Exception as e:
                print(f"[PeopleFinder] Email search failed: {e}, falling back to Clado...")

        # Final fallback: Use Clado for text-based search
        if not self.clado_api_key:
            raise ValueError("CLADO_API_KEY not configured and pipeline searches failed")

        contacts = await self._search_clado(target_description)
        return contacts[:10]

    async def _search_with_pipeline(
        self,
        email_subject: str,
        email_body: str,
        recipient_linkedin_url: str,
    ) -> list:
        """
        Use the pipeline to generate DSL and search Aviato.

        Args:
            email_subject: Email subject line
            email_body: Email body text
            recipient_linkedin_url: LinkedIn URL of the recipient

        Returns:
            List of contact dictionaries
        """
        # Step 1: Enrich recipient profile
        print(f"[PeopleFinder] Enriching profile: {recipient_linkedin_url}")
        profile = enrich_profile(recipient_linkedin_url)

        # Step 2: Run pipeline to generate DSL
        print(f"[PeopleFinder] Extracting facts from email...")
        facts = extract_facts_from_email(email_subject, email_body, profile)
        print(f"[PeopleFinder] Extracted {len(facts)} facts")

        print(f"[PeopleFinder] Classifying facts...")
        classified = classify_facts(facts)

        print(f"[PeopleFinder] Mapping to DSL properties...")
        properties = load_properties()
        dsl_mapping = map_facts_to_properties(classified, properties)

        # Generate human-readable description
        search_desc = generate_search_description(dsl_mapping)
        print(f"[PeopleFinder] Search: {search_desc}")

        # Step 3: Build DSL query for Aviato
        dsl_filters = self._build_dsl_filters(dsl_mapping)
        payload = {
            "dsl": {
                "offset": 0,
                "limit": 10,
                "filters": dsl_filters,
            }
        }

        # Step 4: Execute search against Aviato
        print(f"[PeopleFinder] Executing Aviato search...")
        results = self._execute_aviato_search(payload)

        return self._parse_aviato_response(results)

    def _build_dsl_filters(self, dsl_mapping: dict) -> list:
        """
        Build Aviato DSL filter structure from property mappings.

        Args:
            dsl_mapping: Dict of property paths to values

        Returns:
            List of filter objects for the DSL query
        """
        and_conditions = []

        for prop, value in dsl_mapping.items():
            if value is None:
                continue

            if isinstance(value, bool):
                and_conditions.append({
                    prop: {"operation": "eq", "value": value}
                })
            elif isinstance(value, list):
                # For lists, use OR across values
                or_conditions = [
                    {prop: {"operation": "textcontains", "value": v}}
                    for v in value
                ]
                if or_conditions:
                    and_conditions.append({"OR": or_conditions})
            else:
                and_conditions.append({
                    prop: {"operation": "textcontains", "value": str(value)}
                })

        if not and_conditions:
            # Default filter if no conditions extracted
            return [{"AND": [{"linkedinConnections": {"operation": "gt", "value": 30}}]}]

        return [{"AND": and_conditions}]

    def _execute_aviato_search(self, payload: dict) -> dict:
        """
        Execute search against Aviato API.

        Args:
            payload: DSL query payload

        Returns:
            API response dict
        """
        url = f"{self.aviato_base_url}/person/search"
        headers = {
            "Authorization": f"Bearer {self.aviato_api_key}",
            "Content-Type": "application/json",
        }

        response = requests.post(url, headers=headers, json=payload, timeout=30)

        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Aviato search failed: {response.status_code} - {response.text}")

    def _parse_aviato_response(self, data: dict) -> list:
        """
        Parse Aviato API response into standardized contact format.

        Args:
            data: Raw JSON response from Aviato API

        Returns:
            List of contact dictionaries
        """
        contacts = []
        items = data.get("items", [])

        for person in items:
            # Extract email - try multiple fields
            email = person.get("email") or person.get("workEmail") or person.get("personalEmail")

            # Extract current position info
            experience_list = person.get("experienceList", [])
            current_title = ""
            current_company = ""

            for exp in experience_list:
                # Check if current position (no end date)
                if exp.get("endDate") is None:
                    positions = exp.get("positionList", [])
                    if positions:
                        current_title = positions[0].get("title", "")
                    current_company = exp.get("companyName", "")
                    break

            # Split name into first and last
            full_name = person.get("fullName", "")
            name_parts = full_name.split() if full_name else []
            first_name = name_parts[0] if name_parts else ""
            last_name = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""

            contact = {
                "email": email,
                "name": full_name,
                "first_name": first_name,
                "last_name": last_name,
                "title": current_title or person.get("headline", ""),
                "company": current_company,
                "linkedin_url": person.get("linkedinUrl", ""),
                "location": person.get("locality", ""),
            }

            # Only include contacts with email
            if contact["email"]:
                contacts.append(contact)

        return contacts

    async def _search_clado(self, query: str) -> list:
        """
        Search Clado AI API for people matching the query.

        Args:
            query: Natural language description of who to find

        Returns:
            List of contact dictionaries
        """
        headers = {
            "Authorization": f"Bearer {self.clado_api_key}",
        }
        params = {
            "query": query,
            "limit": 1,
            "advanced_filtering": "true",
            "legacy": "true",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                self.CLADO_API_URL,
                headers=headers,
                params=params,
            )
            response.raise_for_status()
            data = response.json()

        return self._parse_clado_response(data)

    def _parse_clado_response(self, data: dict) -> list:
        """
        Parse Clado API response into standardized contact format.

        Args:
            data: Raw JSON response from Clado API

        Returns:
            List of contact dictionaries
        """
        contacts = []

        # Clado returns results in a 'results' or 'data' array
        results = data.get("results", data.get("data", []))

        for person in results:
            # Handle nested structure - Clado may wrap person data
            if "person" in person:
                person = person["person"]

            # Extract email - try multiple fields
            email = (
                person.get("email")
                or person.get("work_email")
                or person.get("personal_email")
                or person.get("emails", [None])[0]
            )

            # Extract name
            name = person.get("name") or person.get("full_name") or ""
            first_name = person.get("first_name", "")
            last_name = person.get("last_name", "")
            if not name:
                name = f"{first_name} {last_name}".strip()
            elif not first_name and not last_name:
                # Split name into first and last
                name_parts = name.split() if name else []
                first_name = name_parts[0] if name_parts else ""
                last_name = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""

            # Extract title/position
            title = person.get("title") or person.get("job_title") or person.get("headline", "")

            # Extract company
            company = person.get("company") or person.get("company_name") or ""
            if isinstance(company, dict):
                company = company.get("name", "")

            # Extract LinkedIn URL
            linkedin_url = person.get("linkedin_url") or person.get("linkedin", "")

            contact = {
                "email": email,
                "name": name,
                "first_name": first_name,
                "last_name": last_name,
                "title": title,
                "company": company,
                "linkedin_url": linkedin_url,
                "location": person.get("location", ""),
            }

            # Only include contacts with email
            if contact["email"]:
                contacts.append(contact)

        return contacts
