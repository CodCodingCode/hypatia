"""
Data Models for the Email to DSL Pipeline

Contains dataclasses used throughout the pipeline stages.
"""

from dataclasses import dataclass, field


@dataclass
class AtomicFact:
    """A single extracted fact from the email/profile.

    Attributes:
        value: The extracted value (e.g., "Software Engineer", "Google")
        fact_type: Type of fact - one of: role, company_name, company_attribute,
                   location, skill, education, constraint, temporal
        raw_text: Original text snippet this was extracted from
    """

    value: str
    fact_type: str
    raw_text: str


@dataclass
class ClassifiedFact:
    """A fact enriched with classification and context.

    Attributes:
        value: The extracted value
        fact_type: Original fact type from extraction
        raw_text: Original text snippet
        category: Where in the person's profile this applies
                  (person, experience, education, founded_company, language)
        temporal_context: When this applies (current, past, any)
        scope: What entity the constraint applies to (person, company, school)
        implicit_constraints: Implied boolean flags or constraints (e.g., {"isStartup": true})
    """

    value: str
    fact_type: str
    raw_text: str
    category: str  # person, experience, education, founded_company, language
    temporal_context: str  # current, past, any
    scope: str  # person, company, school
    implicit_constraints: dict = field(default_factory=dict)
