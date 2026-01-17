"""
JSON Schemas for Structured LLM Output

These schemas enforce strict JSON output formats from OpenAI's API
using the response_format parameter with json_schema type.
"""

# Schema for Step 1: Fact Extraction
FACT_EXTRACTION_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "extracted_facts",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "facts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "value": {"type": "string"},
                            "fact_type": {
                                "type": "string",
                                "enum": [
                                    "role",
                                    "company_name",
                                    "company_attribute",
                                    "location",
                                    "skill",
                                    "education",
                                    "constraint",
                                    "temporal",
                                ],
                            },
                            "raw_text": {"type": "string"},
                        },
                        "required": ["value", "fact_type", "raw_text"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["facts"],
            "additionalProperties": False,
        },
    },
}

# Schema for Step 2: Fact Classification
CLASSIFICATION_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "classified_facts",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "classified_facts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "value": {"type": "string"},
                            "fact_type": {"type": "string"},
                            "raw_text": {"type": "string"},
                            "category": {
                                "type": "string",
                                "enum": [
                                    "person",
                                    "experience",
                                    "education",
                                    "founded_company",
                                    "language",
                                ],
                            },
                            "temporal_context": {
                                "type": "string",
                                "enum": ["current", "past", "any"],
                            },
                            "scope": {
                                "type": "string",
                                "enum": ["person", "company", "school"],
                            },
                            "implicit_constraints": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {},
                            },
                        },
                        "required": [
                            "value",
                            "fact_type",
                            "raw_text",
                            "category",
                            "temporal_context",
                            "scope",
                            "implicit_constraints",
                        ],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["classified_facts"],
            "additionalProperties": False,
        },
    },
}

# Schema for Step 3: Property Mapping
# Uses array of mappings with separate typed fields for values
MAPPING_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "property_mappings",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "mappings": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "property": {"type": "string"},
                            "string_value": {"type": ["string", "null"]},
                            "list_value": {
                                "type": ["array", "null"],
                                "items": {"type": "string"},
                            },
                            "bool_value": {"type": ["boolean", "null"]},
                        },
                        "required": [
                            "property",
                            "string_value",
                            "list_value",
                            "bool_value",
                        ],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["mappings"],
            "additionalProperties": False,
        },
    },
}
