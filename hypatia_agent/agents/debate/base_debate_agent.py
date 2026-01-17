"""
Base class for debate agents.

Each debate agent has a specific role in the email template creation process.
"""

from abc import ABC, abstractmethod
from ...services.llm_client import LLMClient


class BaseDebateAgent(ABC):
    """
    Abstract base class for debate agents.

    Each agent specializes in one aspect of email creation:
    - StyleAgent: Matches user's writing style
    - CTAAgent: Ensures effective call-to-action
    - BestPracticeAgent: Applies cold email best practices
    """

    def __init__(self, llm_client: LLMClient = None):
        self.llm = llm_client or LLMClient()

    @property
    @abstractmethod
    def role_name(self) -> str:
        """Short name for this agent's role."""
        pass

    @abstractmethod
    def get_system_prompt(self) -> str:
        """Return the system prompt that defines this agent's behavior."""
        pass

    async def respond(self, context: dict) -> str:
        """
        Generate a response given the current debate context.

        Args:
            context: Dict containing relevant info for this agent's task.
                     Keys vary by agent type but typically include:
                     - draft: Current email draft (if revising)
                     - feedback: Feedback from other agents (if responding)
                     - cta: Call-to-action description
                     - style_prompt: User's style analysis
                     - sample_emails: Example emails from user

        Returns:
            Agent's response (draft, critique, or revision)
        """
        system_prompt = self.get_system_prompt()
        user_prompt = self._build_user_prompt(context)

        response = await self.llm.complete(system_prompt, user_prompt)
        return response

    @abstractmethod
    def _build_user_prompt(self, context: dict) -> str:
        """Build the user prompt from the context dict."""
        pass
