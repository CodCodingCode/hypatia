"""
Email to DSL Pipeline Module

Modular pipeline for converting emails to structured DSL search queries.

Components:
- schemas: JSON schemas for structured LLM output
- models: Data classes (AtomicFact, ClassifiedFact)
- prompts: LLM system prompts
- steps: Pipeline step functions (extract, classify, map)
- utils: Helper functions (JSON parsing, profile enrichment)
"""

from .models import AtomicFact, ClassifiedFact
from .schemas import (
    FACT_EXTRACTION_SCHEMA,
    CLASSIFICATION_SCHEMA,
    MAPPING_SCHEMA,
)
from .prompts import (
    EMAIL_FACT_EXTRACTION_PROMPT,
    CLASSIFICATION_PROMPT,
    MAPPING_PROMPT,
)
from .steps import (
    extract_facts_from_description,
    extract_facts_from_email,
    classify_facts,
    map_facts_to_properties,
    generate_search_description,
)
from .utils import (
    safe_parse_json,
    enrich_profile,
    load_properties,
)

__all__ = [
    # Models
    "AtomicFact",
    "ClassifiedFact",
    # Schemas
    "FACT_EXTRACTION_SCHEMA",
    "CLASSIFICATION_SCHEMA",
    "MAPPING_SCHEMA",
    # Prompts
    "EMAIL_FACT_EXTRACTION_PROMPT",
    "CLASSIFICATION_PROMPT",
    "MAPPING_PROMPT",
    # Steps
    "extract_facts_from_description",
    "extract_facts_from_email",
    "classify_facts",
    "map_facts_to_properties",
    "generate_search_description",
    # Utils
    "safe_parse_json",
    "enrich_profile",
    "load_properties",
]
