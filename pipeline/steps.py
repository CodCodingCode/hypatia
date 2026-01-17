"""
Pipeline Step Functions

Contains the main processing steps for the email-to-DSL pipeline:
1. extract_facts_from_email - Extract atomic facts
2. classify_facts - Classify and enrich facts
3. map_facts_to_properties - Map to schema properties
4. generate_search_description - Generate human-readable description
"""

import json
import os
from typing import Any, Dict, List, Optional

from openai import OpenAI
from dotenv import load_dotenv

from .models import AtomicFact, ClassifiedFact
from .schemas import FACT_EXTRACTION_SCHEMA, CLASSIFICATION_SCHEMA, MAPPING_SCHEMA
from .prompts import EMAIL_FACT_EXTRACTION_PROMPT, CLASSIFICATION_PROMPT, MAPPING_PROMPT

# Load environment variables
ENV_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".env"
)
load_dotenv(ENV_PATH)

# Configuration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
MODEL = "gpt-4.1-nano"

client = OpenAI(api_key=OPENAI_API_KEY)


def extract_facts_from_description(description: str) -> List[AtomicFact]:
    """
    Extract atomic facts from a natural language description.

    This is an alternative to extract_facts_from_email that works with
    a simple one-sentence description like "VPs of Sales at Series A startups in SF".

    Args:
        description: Natural language description of who to find

    Returns:
        List of AtomicFact objects
    """
    prompt = f"""Extract search criteria from this description of people to find:

DESCRIPTION: {description}

Extract facts for each criterion mentioned:
- role: Job titles or functions (e.g., "VP of Sales", "Engineer", "Partner", "Medical Doctor", "Clinical Researcher")
- company_name: ONLY specific, named companies or institutions (e.g., "Google", "Stripe", "Stanford University", "Mayo Clinic"). 
- company_attribute: ONLY these specific searchable company types: "startup", "VC firm". Nothing else.
- location: Geographic locations (e.g., "San Francisco", "Bay Area", "NYC")

NORMALIZE ROLES TO SINGULAR:
- "Recruiters" → "Recruiter"
- "Engineers" → "Engineer"
- "admissions officers" → "admissions officer"
- Always use singular form for job titles/roles

CRITICAL - WHAT IS NOT A COMPANY NAME:
- Industries/domains are NOT company names: "healthcare", "tech", "finance", "diagnostics"
- Fields of work are NOT company names: "patient care", "diagnostic technology", "software development"
- Descriptive phrases are NOT company names: "medical devices company", "AI startup", "research lab"
- ONLY extract company_name for PROPER NOUNS that are actual named organizations

IMPORTANT - IGNORE DESCRIPTIVE FLUFF:
Do NOT extract vague qualitative descriptions that cannot be searched in a database:
- "elite", "top", "prestigious", "leading", "best" - these are subjective, not searchable
- "elite institutions", "top companies", "leading firms" - SKIP these entirely
- "involved in X" or "working on Y" - these are domain descriptors, not searchable as company names
- Only extract company_attribute if it's literally "startup" or "VC firm"

Return as JSON array:
[
  {{"value": "...", "fact_type": "role|company_name|company_attribute|location", "raw_text": "..."}},
  ...
]

Only include facts that are explicitly mentioned and actually searchable. Do not infer or guess."""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": "You extract structured search criteria from natural language descriptions. Be precise and only extract what is explicitly stated."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        response_format=FACT_EXTRACTION_SCHEMA,
    )

    facts_data = json.loads(response.choices[0].message.content).get("facts", [])

    # Filter out garbage values
    garbage_values = {"unknown", "n/a", "na", "none", "null", "undefined", ""}

    return [
        AtomicFact(
            value=f["value"],
            fact_type=f["fact_type"],
            raw_text=f.get("raw_text", f["value"]),
        )
        for f in facts_data
        if f.get("value", "").lower().strip() not in garbage_values
    ]


def extract_facts_from_email(
    subject: str, body: str, profile: Optional[Dict[str, Any]] = None
) -> List[AtomicFact]:
    """
    Step 1: Extract atomic facts from email and recipient profile.

    Uses the recipient's profile to infer what type of person the user wants to find,
    and the email content for additional constraints (location, goals, etc).

    Args:
        subject: Email subject line
        body: Email body text
        profile: Enriched profile data (optional)

    Returns:
        List of AtomicFact objects
    """
    # Build profile context with ALL enriched data
    profile_context = _build_profile_context(profile)

    prompt = f"""Extract search facts to find MORE PEOPLE LIKE THE RECIPIENT.

{profile_context}

EMAIL SUBJECT: {subject}

EMAIL BODY:
{body}

TASK:
1. Extract the RECIPIENT's ROLE and COMPANY from their PROFILE above (NOT from the email body!)
2. The email body contains info about the SENDER - IGNORE any self-descriptions like "I'm a PhD student" or "I run a company"
3. Only extract location if the SENDER explicitly mentions wanting to target a specific geographic area

Return as JSON array:
[
  {{"value": "...", "fact_type": "role|company_name|company_attribute|location", "raw_text": "..."}},
  ...
]"""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": EMAIL_FACT_EXTRACTION_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        response_format=FACT_EXTRACTION_SCHEMA,
    )

    facts_data = json.loads(response.choices[0].message.content).get("facts", [])

    # Filter out garbage values like "unknown", "N/A", "none", etc.
    garbage_values = {"unknown", "n/a", "na", "none", "null", "undefined", ""}

    return [
        AtomicFact(
            value=f["value"],
            fact_type=f["fact_type"],
            raw_text=f.get("raw_text", f["value"]),
        )
        for f in facts_data
        if f.get("value", "").lower().strip() not in garbage_values
    ]


def classify_facts(facts: List[AtomicFact]) -> List[ClassifiedFact]:
    """
    Step 2: Classify facts and identify implicit constraints.

    Args:
        facts: List of AtomicFact objects from extraction step

    Returns:
        List of ClassifiedFact objects with enriched metadata
    """
    facts_json = json.dumps(
        [
            {"value": f.value, "fact_type": f.fact_type, "raw_text": f.raw_text}
            for f in facts
        ]
    )

    prompt = f"""Classify these extracted facts:

{facts_json}

For each fact, return:
{{
  "value": "...",
  "fact_type": "...",
  "raw_text": "...",
  "category": "person|experience|education|founded_company|language",
  "temporal_context": "current|past|any",
  "scope": "person|company|school",
  "implicit_constraints": {{...}}
}}

Return as JSON array."""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": CLASSIFICATION_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        response_format=CLASSIFICATION_SCHEMA,
    )

    classified_data = json.loads(response.choices[0].message.content).get(
        "classified_facts", []
    )

    return [
        ClassifiedFact(
            value=f["value"],
            fact_type=f["fact_type"],
            raw_text=f.get("raw_text", f["value"]),
            category=f.get("category", "person"),
            temporal_context=f.get("temporal_context", "any"),
            scope=f.get("scope", "person"),
            implicit_constraints=f.get("implicit_constraints", {}),
        )
        for f in classified_data
    ]


def map_facts_to_properties(
    classified_facts: List[ClassifiedFact], properties: dict
) -> dict:
    """
    Step 3: Map classified facts to schema property paths.

    Args:
        classified_facts: List of ClassifiedFact objects
        properties: Schema properties dict from person_schema_simple.json

    Returns:
        Dict mapping property paths to extracted values
    """
    # Build a simplified schema reference for the LLM
    schema_summary = []
    for prop_name, prop_def in properties.items():
        desc = prop_def.get("#", "No description")
        schema_summary.append(f"- {prop_name}: {desc}")

    schema_str = "\n".join(schema_summary)

    facts_json = json.dumps(
        [
            {
                "value": f.value,
                "fact_type": f.fact_type,
                "category": f.category,
                "temporal_context": f.temporal_context,
                "scope": f.scope,
                "implicit_constraints": f.implicit_constraints,
            }
            for f in classified_facts
        ],
        indent=2,
    )

    prompt = f"""Map these classified facts to schema properties:

FACTS:
{facts_json}

AVAILABLE SCHEMA PROPERTIES:
{schema_str}

Return mappings as a JSON array. For each mapping, use EXACTLY ONE of the value fields:
- string_value: for single text values (set list_value and bool_value to null)
- list_value: for multiple values as an array (set string_value and bool_value to null)
- bool_value: for true/false values (set string_value and list_value to null)

Example:
[
  {{"property": "get_titles(experienceList.positionList, 'current')", "string_value": "Engineer", "list_value": null, "bool_value": null}},
  {{"property": "experienceList.company.isStartup", "string_value": null, "list_value": null, "bool_value": true}},
  {{"property": "skills", "string_value": null, "list_value": ["Python", "ML"], "bool_value": null}},
  {{"property": "experienceList.companyName", "string_value": "Google", "list_value": null, "bool_value": null}}
]"""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": MAPPING_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
        response_format=MAPPING_SCHEMA,
    )

    # Convert array of mappings back to dict, extracting the non-null value
    mappings_data = json.loads(response.choices[0].message.content).get("mappings", [])
    return {m["property"]: _get_mapping_value(m) for m in mappings_data}


def _get_mapping_value(mapping: dict):
    """Extract the non-null value from a mapping with separate typed fields."""
    if mapping.get("bool_value") is not None:
        return mapping["bool_value"]
    if mapping.get("list_value") is not None:
        return mapping["list_value"]
    return mapping.get("string_value")


def generate_search_description(dsl: dict) -> str:
    """
    Step 4: Generate a human-readable description of the search criteria.

    Args:
        dsl: DSL dict with property mappings

    Returns:
        Human-readable description string
    """
    parts = []

    # Get role/title
    title = dsl.get("get_titles(experienceList.positionList, 'current')") or dsl.get(
        "get_titles(experienceList.positionList, 'any')"
    )
    if title:
        if isinstance(title, list):
            parts.append(" or ".join(title))
        else:
            parts.append(str(title))

    # Get company
    company = dsl.get("experienceList.companyName")
    if company:
        if isinstance(company, list):
            parts.append(f"at {' or '.join(company)}")
        else:
            parts.append(f"at {company}")

    # Get school/university
    school = dsl.get("educationList.school.fullName")
    if school:
        if isinstance(school, list):
            parts.append(f"at {' or '.join(school)}")
        else:
            parts.append(f"at {school}")

    # Get company attributes
    if dsl.get("experienceList.company.isVCFirm"):
        parts.append("at VC firms")

    # Get location
    location = dsl.get("locality") or dsl.get("region") or dsl.get("country")
    if location:
        if isinstance(location, list):
            parts.append(f"in {' or '.join(location)}")
        else:
            parts.append(f"in {location}")

    if parts:
        return " ".join(parts)
    return "People matching your criteria"


def _build_profile_context(profile: Optional[Dict[str, Any]]) -> str:
    """Build profile context string for the LLM prompt."""
    if not profile:
        return ""

    # Basic info
    full_name = profile.get("fullName", "Unknown")
    headline = profile.get("headline", "")
    locality = profile.get("locality", "")
    region = profile.get("region", "")
    country = profile.get("country", "")
    skills = profile.get("skills", [])
    linkedin_status = profile.get("linkedinLaborStatus", "")

    # Build experience summary
    experience_lines = []
    exp_list = profile.get("experienceList", [])
    for exp in exp_list[:3]:  # Top 3 experiences
        company_name = exp.get("companyName", "")
        positions = exp.get("positionList", [])
        title = positions[0].get("title", "") if positions else ""
        is_current = exp.get("endDate") is None

        # Company details
        company = exp.get("company", {})
        company_info = []
        if company.get("isStartup"):
            company_info.append("startup")
        if company.get("isVCFirm"):
            company_info.append("VC firm")
        if company.get("latestDealType"):
            company_info.append(f"funding: {company.get('latestDealType')}")
        if company.get("headcount"):
            company_info.append(f"{company.get('headcount')} employees")
        if company.get("locality"):
            company_info.append(f"HQ: {company.get('locality')}")

        status = "CURRENT" if is_current else "PAST"
        company_details = f" ({', '.join(company_info)})" if company_info else ""
        experience_lines.append(
            f"  [{status}] {title} at {company_name}{company_details}"
        )

    # Build education summary
    education_lines = []
    edu_list = profile.get("educationList", [])
    for edu in edu_list[:2]:  # Top 2 education entries
        school = edu.get("school", {})
        school_name = school.get("fullName", edu.get("name", ""))
        degree = edu.get("degree", {})
        degree_name = degree.get("name", "")
        field = degree.get("fieldOfStudy", "")
        if school_name:
            edu_str = (
                f"  {degree_name} in {field} from {school_name}"
                if degree_name
                else f"  {school_name}"
            )
            education_lines.append(edu_str)

    # Build companies founded summary
    founded_lines = []
    founded_list = profile.get("companiesFoundedList", [])
    for founded in founded_list[:2]:
        company = founded.get("company", {})
        company_name = company.get("name", "")
        if company_name:
            founded_lines.append(f"  {company_name}")

    # Build profile context - only include fields that have actual values
    profile_lines = ["RECIPIENT PROFILE (FULL ENRICHED DATA):"]
    profile_lines.append(f"- Name: {full_name}")
    if headline:
        profile_lines.append(f"- Headline: {headline}")

    # Location - only include non-empty parts
    location_parts = [p for p in [locality, region, country] if p]
    if location_parts:
        profile_lines.append(f"- Location: {', '.join(location_parts)}")

    if linkedin_status:
        profile_lines.append(f"- LinkedIn Status: {linkedin_status}")

    if skills:
        profile_lines.append(f"- Skills: {', '.join(skills[:10])}")

    if experience_lines:
        profile_lines.append("\nEXPERIENCE:")
        profile_lines.extend(experience_lines)

    if education_lines:
        profile_lines.append("\nEDUCATION:")
        profile_lines.extend(education_lines)

    if founded_lines:
        profile_lines.append("\nCOMPANIES FOUNDED:")
        profile_lines.extend(founded_lines)

    return "\n".join(profile_lines)
