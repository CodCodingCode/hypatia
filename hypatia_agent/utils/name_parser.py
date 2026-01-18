"""
Name parsing utilities for extracting first and last names from display names.
"""


def parse_display_name(display_name: str) -> dict:
    """
    Parse a display name into first and last name components.

    Examples:
        "John Doe" -> {"first_name": "John", "last_name": "Doe"}
        "John" -> {"first_name": "John", "last_name": ""}
        "John Michael Doe" -> {"first_name": "John", "last_name": "Doe"}
        "" -> {"first_name": "", "last_name": ""}
        "  John   Doe  " -> {"first_name": "John", "last_name": "Doe"}

    Args:
        display_name: The full display name to parse

    Returns:
        Dictionary with 'first_name' and 'last_name' keys
    """
    if not display_name:
        return {"first_name": "", "last_name": ""}

    # Strip and split on whitespace
    parts = display_name.strip().split()

    # Filter out empty strings
    parts = [p for p in parts if p]

    if not parts:
        return {"first_name": "", "last_name": ""}

    if len(parts) == 1:
        return {"first_name": parts[0], "last_name": ""}

    # Take first word as first name, last word as last name
    return {"first_name": parts[0], "last_name": parts[-1]}


def format_full_name(first_name: str, last_name: str) -> str:
    """
    Format first and last names into a full name string.

    Args:
        first_name: First name
        last_name: Last name

    Returns:
        Formatted full name (e.g., "John Doe" or "John" if no last name)
    """
    if not first_name and not last_name:
        return ""

    if not last_name:
        return first_name

    if not first_name:
        return last_name

    return f"{first_name} {last_name}"
