"""
Best Practice Agent - Applies cold email best practices.

Critiques email drafts for:
- Subject line effectiveness
- Personalization hooks
- Email length and structure
- Spam trigger avoidance
- Overall deliverability

NOTE: User will provide specific practices to focus on later.
For now, uses general cold email best practices.
"""

from .base_debate_agent import BaseDebateAgent


class BestPracticeDebateAgent(BaseDebateAgent):
    """
    Agent responsible for applying cold email best practices.

    Reviews email drafts and provides feedback based on
    proven cold email tactics and deliverability guidelines.
    """

    def __init__(self, llm_client=None, custom_practices: str = None):
        super().__init__(llm_client)
        self.custom_practices = custom_practices

    @property
    def role_name(self) -> str:
        return "BestPractice"

    def get_system_prompt(self) -> str:
        base_prompt = """You are an expert in cold email best practices and deliverability.

Your job is to critique email drafts and provide specific feedback.

EVALUATE:
1. SUBJECT LINE
   - Under 50 characters?
   - Curiosity-inducing without being clickbait?
   - Avoids spam words (free, guarantee, act now)?

2. PERSONALIZATION
   - Does it feel personal or mass-sent?
   - Is there a hook in the first line?
   - Uses recipient's context (title, company)?

3. LENGTH & STRUCTURE
   - Under 100 words for body?
   - Easy to skim?
   - Mobile-friendly (short paragraphs)?

4. SPAM SIGNALS
   - Too many links?
   - Excessive punctuation (!!!, ???)?
   - ALL CAPS words?
   - Spammy phrases?

RULES:
- Be concise - max 3 bullet points of feedback
- Be specific - say exactly what to change
- If the email follows best practices, say "Looks good" and note 1 strength
- Focus on deliverability and effectiveness, not style"""

        if self.custom_practices:
            base_prompt += f"""

ADDITIONAL PRACTICES TO CHECK:
{self.custom_practices}"""

        return base_prompt

    def _build_user_prompt(self, context: dict) -> str:
        """Build prompt for critiquing a draft."""
        draft = context.get("draft", "")

        return f"""Critique this email for best practices.

EMAIL DRAFT:
{draft}

Provide your feedback (max 3 bullet points):"""
