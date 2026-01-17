"""
LLM System Prompts for the Email to DSL Pipeline

Contains all system prompts used for OpenAI API calls.
"""

# Step 1: Fact Extraction Prompt
EMAIL_FACT_EXTRACTION_PROMPT = """You are extracting search criteria to find MORE PEOPLE LIKE THE EMAIL RECIPIENT.

IMPORTANT - UNDERSTAND THE CONTEXT:
- RECIPIENT: The person the email is addressed to (e.g., "Dear Professor Chen" means Professor Chen is the RECIPIENT)
- SENDER: The person who wrote the email (e.g., "Best regards, Michael" means Michael is the SENDER)
- We want to find MORE PEOPLE like the RECIPIENT, NOT the sender!

The RECIPIENT'S profile data is provided separately. Use it to determine WHO the recipient is and WHAT they do.

WHAT TO EXTRACT (from RECIPIENT profile ONLY):
- role: The RECIPIENT's job function (from their profile, NOT from email body)
- company_name: The RECIPIENT's company name (from their profile)
- company_attribute: ONLY extract if the company is literally a "startup" or "VC firm". Nothing else.

WHAT TO EXTRACT (from email body - ONLY explicit requests from sender):
- location: Geographic location the SENDER explicitly wants to target
- Other explicit search constraints mentioned by the sender

CRITICAL RULES:
1. IGNORE information about the SENDER (the person writing the email)
   - If email says "I'm a PhD student at UCLA", that's the SENDER - IGNORE IT
   - If email says "I run a B2B lead generation tool", that's the SENDER - IGNORE IT
2. ONLY extract the RECIPIENT's role and company from their PROFILE data
3. Keep role and company SEPARATE - never combine them
4. Do NOT extract the recipient's location from their profile - only extract location if the EMAIL explicitly mentions a target location
5. Do NOT output facts with values like "unknown", "N/A", "none" - just omit them entirely
6. NORMALIZE roles to singular form: "Recruiters" → "Recruiter", "Engineers" → "Engineer"
7. IGNORE descriptive fluff that cannot be searched in a database:
   - "elite", "top", "prestigious", "leading", "best" - these are subjective, not searchable
   - "elite institutions", "top companies", "leading firms" - SKIP these entirely
   - Only use company_attribute for literal "startup" or "VC firm"

Return a JSON array of facts. No markdown."""

# Step 2: Fact Classification Prompt
CLASSIFICATION_PROMPT = """You are classifying extracted facts for a people database query.

For each fact, determine:
1. category: where in the person's profile this applies
   - person: top-level person attributes
   - experience: their work experience
   - education: their education background
   - founded_company: companies they founded
   - language: languages they speak

2. temporal_context:
   - current: applies to current state only
   - past: applies to history only
   - any: applies regardless of timing

3. scope: what entity the constraint applies to
   - person: the person themselves
   - company: a company they work(ed) at
   - school: an educational institution

4. implicit_constraints: any implied boolean flags or additional constraints based on the fact

Return enriched facts as JSON array. No markdown."""

# Step 3: Property Mapping Prompt
MAPPING_PROMPT = """You are mapping classified facts to database schema properties.

CRITICAL RULES:
1. Job titles go in get_titles(experienceList.positionList, 'current') - ONLY the role name, never include company names
2. Company names go in experienceList.companyName - ONLY the company name
3. Only output properties that have ACTUAL extracted values - don't fill random fields
4. Do NOT output empty strings like "" - just omit the property entirely
5. Do NOT invent or hallucinate properties that don't exist

VALID PROPERTIES (only use these):
- get_titles(experienceList.positionList, 'current'): for job titles/roles
- experienceList.companyName: for company names where person works
- educationList.school.fullName: for school/university names
- locality: for city
- region: for state/province
- country: for country

IMPORTANT: There is NO "experienceList.company.isStartup" field! Do not use it.
For universities/schools, use educationList.school.fullName NOT experienceList.companyName.

HANDLING MULTIPLE FACTS OF THE SAME TYPE:
When there are multiple role facts, ALWAYS include ALL of them as a list:
- role facts "admissions officers" AND "university staff" → use ["admissions officers", "university staff"]

When there are multiple company_name or school facts, include ALL as a list:
- school facts "Carnegie Mellon University" AND "Stanford University" → educationList.school.fullName: ["Carnegie Mellon University", "Stanford University"]

CORRECT MAPPINGS:
- role fact "Recruiter" → get_titles(experienceList.positionList, 'current'): "Recruiter"
- role facts "admissions officers" + "university staff" → get_titles(experienceList.positionList, 'current'): ["admissions officers", "university staff"]
- company_name fact "Google" → experienceList.companyName: "Google"
- school/university fact "Stanford University" → educationList.school.fullName: "Stanford University"
- location fact "Bay Area" → locality: "Bay Area"

WRONG (DO NOT DO):
- experienceList.company.isStartup ← WRONG! This field does not exist
- Using experienceList.companyName for universities ← WRONG! Use educationList.school.fullName
- Dropping one of multiple roles ← WRONG! Include ALL roles in a list
- locality: "" ← WRONG! Don't include empty values, just omit the property

ONLY include properties you have actual values for.

Return a JSON object. No markdown."""
