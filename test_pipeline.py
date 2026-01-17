"""
Test script for the DSL pipeline.

Usage:
    python test_pipeline.py "VPs of Sales at Series A SaaS startups in SF"
    python test_pipeline.py  # Uses default test query
"""

import sys
import json
import requests
from pipeline import (
    extract_facts_from_description,
    classify_facts,
    map_facts_to_properties,
    generate_search_description,
)
from pipeline.utils import load_properties, get_contact_info
from config import AVIATO_API_KEY, AVIATO_BASE_URL


def build_dsl_payloads(dsl_mapping: dict, limit: int = 5, offset: int = 0) -> list:
    """
    Build multiple simple Aviato DSL payloads from property mappings.

    Instead of complex AND/OR queries, generates separate queries for each
    combination of list values to avoid API 500 errors.

    Args:
        dsl_mapping: Dict of property paths to values
        limit: Number of results to return per query
        offset: Offset for pagination

    Returns:
        List of DSL payload dicts for Aviato API
    """
    from itertools import product

    # Separate list values from single values
    list_props = {}  # props with multiple values
    single_conditions = []  # props with single values

    for prop, value in dsl_mapping.items():
        # Skip None, empty strings, and empty lists
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        if isinstance(value, list) and len(value) == 0:
            continue

        if isinstance(value, bool):
            single_conditions.append({prop: {"operation": "eq", "value": value}})
        elif isinstance(value, list):
            # Filter out empty strings
            valid_values = [v for v in value if v and str(v).strip()]
            if valid_values:
                list_props[prop] = valid_values
        else:
            single_conditions.append(
                {prop: {"operation": "textcontains", "value": str(value)}}
            )

    # If no list properties, return single payload
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

    # Generate all combinations of list values
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


def search_aviato(payload: dict, verbose: bool = True) -> dict:
    """
    Execute search against Aviato API.

    Args:
        payload: DSL query payload
        verbose: Print detailed output

    Returns:
        API response dict with success status and results
    """
    url = f"{AVIATO_BASE_URL}/person/search"
    headers = {
        "Authorization": f"Bearer {AVIATO_API_KEY}",
        "Content-Type": "application/json",
    }

    if verbose:
        print(f"\nEndpoint: {url}")
        print("Executing search...")

    response = requests.post(url, headers=headers, json=payload, timeout=30)

    if verbose:
        print(f"Status Code: {response.status_code}")

    if response.status_code == 200:
        data = response.json()
        items = data.get("items", [])
        count_obj = data.get("count", {})
        total = int(count_obj.get("value", 0)) if isinstance(count_obj, dict) else 0

        return {"success": True, "total": total, "results": items}
    else:
        return {
            "success": False,
            "status_code": response.status_code,
            "error": response.text,
        }


def run_pipeline(description: str, num_results: int = 10):
    """
    Run the full pipeline from a natural language description.

    Args:
        description: One-sentence description of who to find
        num_results: Number of results to return
    """
    print("\n" + "=" * 80)
    print("DSL PIPELINE TEST")
    print("=" * 80)
    print(f'\nInput: "{description}"')
    print(f"Requested results: {num_results}")

    # Step 1: Extract facts from description
    print("\n" + "-" * 40)
    print("STEP 1: Extracting facts from description...")
    print("-" * 40)

    facts = extract_facts_from_description(description)
    print(f"\nExtracted {len(facts)} facts:")
    for fact in facts:
        print(f"  - {fact.fact_type}: {fact.value}")

    if not facts:
        print("\nNo facts extracted. Try a more specific description.")
        return None

    # Step 2: Classify facts
    print("\n" + "-" * 40)
    print("STEP 2: Classifying facts...")
    print("-" * 40)

    classified = classify_facts(facts)
    print(f"\nClassified {len(classified)} facts:")
    for fact in classified:
        print(
            f"  - {fact.fact_type}: {fact.value} (category={fact.category}, scope={fact.scope})"
        )

    # Step 3: Map to DSL properties
    print("\n" + "-" * 40)
    print("STEP 3: Mapping to DSL properties...")
    print("-" * 40)

    properties = load_properties()
    dsl_mapping = map_facts_to_properties(classified, properties)
    print("\nDSL mapping:")
    print(json.dumps(dsl_mapping, indent=2))

    # Generate human-readable description
    search_desc = generate_search_description(dsl_mapping)
    print(f"\nSearch description: {search_desc}")

    # Step 4: Build and execute search with multiple simple queries
    print("\n" + "-" * 40)
    print("STEP 4: Executing Aviato search...")
    print("-" * 40)
    print(f"\nSearching for {num_results} people with emails...\n")

    # Build multiple simple payloads (one per combination)
    batch_size = 20
    payloads = build_dsl_payloads(dsl_mapping, limit=batch_size)

    print(f"Generated {len(payloads)} search queries:")
    for i, payload in enumerate(payloads, 1):
        # Extract the search criteria from the payload for display
        conditions = payload["dsl"]["filters"][0]["AND"]
        criteria = []
        for cond in conditions:
            for key, val in cond.items():
                if isinstance(val, dict) and "value" in val:
                    criteria.append(f"{key.split('.')[-1]}={val['value']}")
        print(f"  Query {i}: {', '.join(criteria)}")

    print("\nDSL payloads:")
    print(json.dumps(payloads, indent=2))

    collected_contacts = []  # People with emails
    seen_linkedin_urls = set()  # Track duplicates across queries
    total_searched = 0

    for query_idx, payload in enumerate(payloads, 1):
        if len(collected_contacts) >= num_results:
            break

        print(f"\n[QUERY {query_idx}/{len(payloads)}] Executing search...")

        # Paginate within each query
        offset = 0
        max_pages = 5  # Safety limit per query

        for page in range(max_pages):
            if len(collected_contacts) >= num_results:
                break

            payload["dsl"]["offset"] = offset

            results = search_aviato(payload, verbose=False)

            if not results.get("success", False):
                print(f"  Search failed: {results.get('error', 'Unknown error')}")
                break

            total = results.get("total", 0)
            if page == 0:
                print(f"  Found {total} matches")

            people = results.get("results", [])
            if not people:
                break

            for person in people:
                total_searched += 1
                name = person.get("fullName", "Unknown")
                location = person.get("location", "")
                linkedin = person.get("URLs", {}).get("linkedin", "")

                # Skip duplicates
                if linkedin in seen_linkedin_urls:
                    continue
                seen_linkedin_urls.add(linkedin)

                print(f"[DEBUG] Person {total_searched}: {name}")
                print(f"[DEBUG]   LinkedIn URL: {linkedin}")

                # Fetch contact info from Aviato
                contact_info = get_contact_info(linkedin) if linkedin else {}

                # Extract email from the emails array
                email = None
                emails_list = contact_info.get("emails", [])
                if emails_list:
                    work_emails = [
                        e["email"] for e in emails_list if e.get("type") == "work"
                    ]
                    personal_emails = [
                        e["email"] for e in emails_list if e.get("type") == "personal"
                    ]
                    email = (
                        work_emails[0]
                        if work_emails
                        else (
                            personal_emails[0]
                            if personal_emails
                            else emails_list[0].get("email")
                        )
                    )

                if not email:
                    print(f"[DEBUG]   SKIPPING - no email found\n")
                    continue

                print(f"[DEBUG]   ✓ Found email: {email}\n")
                collected_contacts.append(
                    {
                        "name": name,
                        "email": email,
                        "location": location,
                        "linkedin": linkedin,
                    }
                )

                if len(collected_contacts) >= num_results:
                    break

            offset += batch_size

    # Display results
    print("\n" + "=" * 80)
    print("RESULTS")
    print("=" * 80)

    print(
        f"\nSearched {total_searched} people, found {len(collected_contacts)} with emails:\n"
    )

    for i, contact in enumerate(collected_contacts, 1):
        print(f"{i}. {contact['name']}")
        print(f"   Email: {contact['email']}")
        if contact["location"]:
            print(f"   Location: {contact['location']}")
        if contact["linkedin"]:
            print(f"   LinkedIn: {contact['linkedin']}")
        print()

    if not collected_contacts:
        print("No contacts found with email addresses.")

    return {
        "success": True,
        "contacts": collected_contacts,
        "total_searched": total_searched,
    }


if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] in ["--help", "-h"]:
            print(__doc__)
        else:
            # Join all arguments as the description
            description = " ".join(sys.argv[1:])
            run_pipeline(description)
    else:
        # Default test
        print("Running default test...")
        print('Usage: python test_pipeline.py "<description>"\n')

        run_pipeline("Recruiters at Google")
