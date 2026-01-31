#!/usr/bin/env python3
"""Test script for name parsing utility."""

# Direct import to avoid dependency issues
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'hypatia_agent', 'utils'))

from name_parser import parse_display_name, format_full_name

# Test cases
test_cases = [
    ("John Doe", {"first_name": "John", "last_name": "Doe"}),
    ("John", {"first_name": "John", "last_name": ""}),
    ("John Michael Doe", {"first_name": "John", "last_name": "Doe"}),
    ("", {"first_name": "", "last_name": ""}),
    ("  John   Doe  ", {"first_name": "John", "last_name": "Doe"}),
    ("SingleName", {"first_name": "SingleName", "last_name": ""}),
    ("First Middle Last", {"first_name": "First", "last_name": "Last"}),
]

print("Testing parse_display_name()...")
print("-" * 60)

all_passed = True
for input_name, expected in test_cases:
    result = parse_display_name(input_name)
    passed = result == expected
    all_passed = all_passed and passed

    status = "✓ PASS" if passed else "✗ FAIL"
    print(f"{status}: '{input_name}' -> {result}")
    if not passed:
        print(f"       Expected: {expected}")

print("-" * 60)

# Test format_full_name
print("\nTesting format_full_name()...")
print("-" * 60)

format_tests = [
    (("John", "Doe"), "John Doe"),
    (("John", ""), "John"),
    (("", "Doe"), "Doe"),
    (("", ""), ""),
]

for (first, last), expected in format_tests:
    result = format_full_name(first, last)
    passed = result == expected
    all_passed = all_passed and passed

    status = "✓ PASS" if passed else "✗ FAIL"
    print(f"{status}: format_full_name('{first}', '{last}') -> '{result}'")
    if not passed:
        print(f"       Expected: '{expected}'")

print("-" * 60)

if all_passed:
    print("\n✓ All tests passed!")
    sys.exit(0)
else:
    print("\n✗ Some tests failed!")
    sys.exit(1)
