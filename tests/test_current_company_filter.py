#!/usr/bin/env python3
"""
Test script to verify that the current company filter is added correctly.
"""

import json

# Simulate the _build_dsl_payloads logic
def build_dsl_payloads(dsl_mapping: dict, limit: int = 20, offset: int = 0) -> list:
    """Build DSL payloads with current company filter."""
    from itertools import product

    list_props = {}
    single_conditions = []
    has_company_filter = False

    for prop, value in dsl_mapping.items():
        if value is None:
            continue
        if isinstance(value, str) and value.strip() == "":
            continue
        if isinstance(value, list) and len(value) == 0:
            continue

        # Track if we have a company filter
        if prop == "experienceList.companyName":
            has_company_filter = True

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

    # CRITICAL: Add filter for current company only (endDate is null)
    # This ensures experienceList.companyName matches CURRENT employer, not past
    if has_company_filter:
        single_conditions.append(
            {"experienceList.endDate": {"operation": "eq", "value": None}}
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


# Test Case 1: Kalshi Engineers (from your example)
print("=" * 80)
print("TEST 1: Kalshi Engineers (Current)")
print("=" * 80)

dsl_mapping_1 = {
    'experienceList.companyName': 'Kalshi',
    "get_titles(experienceList.positionList, 'current')": 'Engineer'
}

payloads_1 = build_dsl_payloads(dsl_mapping_1, limit=20)
print(json.dumps(payloads_1[0], indent=2))
print()

# Verify the filter is present
filters = payloads_1[0]["dsl"]["filters"][0]["AND"]
has_end_date_filter = any(
    "experienceList.endDate" in condition for condition in filters
)
print(f"✓ Has endDate filter: {has_end_date_filter}")
print()

# Test Case 2: Without company filter (should NOT add endDate filter)
print("=" * 80)
print("TEST 2: Engineers only (no company filter)")
print("=" * 80)

dsl_mapping_2 = {
    "get_titles(experienceList.positionList, 'current')": 'Engineer',
    "locality": "San Francisco"
}

payloads_2 = build_dsl_payloads(dsl_mapping_2, limit=20)
print(json.dumps(payloads_2[0], indent=2))
print()

# Verify the filter is NOT present
filters_2 = payloads_2[0]["dsl"]["filters"][0]["AND"]
has_end_date_filter_2 = any(
    "experienceList.endDate" in condition for condition in filters_2
)
print(f"✓ Has endDate filter: {has_end_date_filter_2} (should be False)")
print()

# Test Case 3: Multiple companies (list)
print("=" * 80)
print("TEST 3: Multiple companies (Google or Meta)")
print("=" * 80)

dsl_mapping_3 = {
    'experienceList.companyName': ['Google', 'Meta'],
    "get_titles(experienceList.positionList, 'current')": 'Engineer'
}

payloads_3 = build_dsl_payloads(dsl_mapping_3, limit=20)
for i, payload in enumerate(payloads_3):
    print(f"\nQuery {i+1}:")
    print(json.dumps(payload, indent=2))

print("\n" + "=" * 80)
print("All tests completed!")
print("=" * 80)
