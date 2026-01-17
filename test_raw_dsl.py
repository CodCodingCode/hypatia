"""
Test script for raw DSL queries against Aviato API.

Usage:
    python test_raw_dsl.py '{"dsl": {"limit": 5, "filters": [{"AND": [{"locality": {"operation": "textcontains", "value": "San Francisco"}}]}]}}'

    python test_raw_dsl.py  # Uses default test query

    python test_raw_dsl.py --file query.json  # Load from file
"""

import sys
import json
import requests
from config import AVIATO_API_KEY, AVIATO_BASE_URL


def run_raw_dsl(payload: dict, verbose: bool = True):
    """
    Execute a raw DSL query against Aviato API.

    Args:
        payload: The raw DSL payload dict
        verbose: Print detailed output

    Returns:
        API response dict
    """
    url = f"{AVIATO_BASE_URL}/person/search"
    headers = {
        "Authorization": f"Bearer {AVIATO_API_KEY}",
        "Content-Type": "application/json",
    }

    if verbose:
        print("\n" + "=" * 80)
        print("RAW DSL TEST")
        print("=" * 80)
        print(f"\nEndpoint: {url}")
        print(f"\nPayload:")
        print(json.dumps(payload, indent=2))
        print("\n" + "-" * 40)
        print("Executing search...")
        print("-" * 40)

    response = requests.post(url, headers=headers, json=payload, timeout=30)

    if verbose:
        print(f"\nStatus Code: {response.status_code}")

    if response.status_code == 200:
        data = response.json()
        items = data.get("items", [])
        count_obj = data.get("count", {})
        total = int(count_obj.get("value", 0)) if isinstance(count_obj, dict) else 0

        if verbose:
            print("\n" + "=" * 80)
            print("RESULTS")
            print("=" * 80)
            print(f"\nFound {total} total matches, showing {len(items)}:\n")

            for i, person in enumerate(items, 1):
                name = person.get("fullName", "Unknown")
                headline = person.get("headline", "No headline")
                location = person.get("location", "")
                linkedin = person.get("linkedinUrl", "")

                print(f"{i}. {name}")
                print(f"   {headline}")
                if location:
                    print(f"   Location: {location}")
                if linkedin:
                    print(f"   LinkedIn: {linkedin}")
                print()

        return {"success": True, "total": total, "results": items}
    else:
        if verbose:
            print("\n" + "=" * 80)
            print("ERROR")
            print("=" * 80)
            print(f"\nStatus: {response.status_code}")
            print(f"Response: {response.text}")

        return {
            "success": False,
            "status_code": response.status_code,
            "error": response.text,
        }


def main():
    # Default test payload
    default_payload = {
        {
            "dsl": {
                "offset": 0,
                "limit": 20,
                "filters": [
                    {
                        "AND": [
                            {
                                "OR": [
                                    {
                                        "get_titles(experienceList.positionList, 'current')": {
                                            "operation": "textcontains",
                                            "value": "admissions officers",
                                        }
                                    },
                                    {
                                        "get_titles(experienceList.positionList, 'current')": {
                                            "operation": "textcontains",
                                            "value": "university staff",
                                        }
                                    },
                                ]
                            },
                            {
                                "OR": [
                                    {
                                        "educationList.school.fullName": {
                                            "operation": "textcontains",
                                            "value": "Carnegie Mellon University",
                                        }
                                    },
                                    {
                                        "educationList.school.fullName": {
                                            "operation": "textcontains",
                                            "value": "Stanford University",
                                        }
                                    },
                                ]
                            },
                            {
                                "experienceList.company.isVCFirm": {
                                    "operation": "eq",
                                    "value": True,
                                }
                            },
                        ]
                    }
                ],
            }
        }
    }

    if len(sys.argv) > 1:
        if sys.argv[1] == "--file":
            # Load from file
            if len(sys.argv) < 3:
                print("Error: --file requires a filename")
                sys.exit(1)
            with open(sys.argv[2], "r") as f:
                payload = json.load(f)
        elif sys.argv[1] == "--help" or sys.argv[1] == "-h":
            print(__doc__)
            print("\nExample DSL structure:")
            print(json.dumps(default_payload, indent=2))
            sys.exit(0)
        else:
            # Parse JSON from command line
            try:
                payload = json.loads(sys.argv[1])
            except json.JSONDecodeError as e:
                print(f"Error parsing JSON: {e}")
                print("\nMake sure to wrap your JSON in single quotes:")
                print("  python test_raw_dsl.py '{\"dsl\": {...}}'")
                sys.exit(1)
    else:
        print("Using default test payload (run with --help for options)")
        payload = default_payload

    run_raw_dsl(payload)


if __name__ == "__main__":
    main()
