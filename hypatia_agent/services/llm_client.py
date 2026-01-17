"""
LLM Client for Hypatia Agent System.

Wrapper around BackboardClient for simplified async LLM calls.
"""

import os
import re
import json
from pathlib import Path
from backboard import BackboardClient


def _load_env():
    """Load environment variables from .env file if it exists."""
    env_path = Path(__file__).parent.parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip())


_load_env()

BACKBOARD_API_KEY = os.environ.get("BACKBOARD_API_KEY")
DEFAULT_MODEL = "gpt-4o"
DEFAULT_PROVIDER = "openai"


class LLMClient:
    """
    Async LLM client using Backboard API.

    Provides a simple interface for debate agents to get completions.
    """

    def __init__(self, model: str = None, provider: str = None):
        self.model = model or DEFAULT_MODEL
        self.provider = provider or DEFAULT_PROVIDER
        self.api_key = BACKBOARD_API_KEY

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str = None,
    ) -> str:
        """
        Get a completion from the LLM.

        Args:
            system_prompt: System instructions for the model
            user_prompt: User message/query
            model: Override default model

        Returns:
            Model's response as a string
        """
        model = model or self.model

        # Create fresh client for each call (avoids event loop issues)
        client = BackboardClient(api_key=self.api_key)

        assistant = await client.create_assistant(name="Hypatia Agent")
        thread = await client.create_thread(assistant.assistant_id)

        # Combine system and user prompts into the message
        full_prompt = f"SYSTEM: {system_prompt}\n\nUSER: {user_prompt}"

        response = await client.add_message(
            thread_id=thread.thread_id,
            content=full_prompt,
            llm_provider=self.provider,
            model_name=model,
            stream=False,
        )

        return response.content.strip()

    async def complete_json(
        self,
        system_prompt: str,
        user_prompt: str,
        model: str = None,
    ) -> dict:
        """
        Get a JSON completion from the LLM.

        Args:
            system_prompt: System instructions (should request JSON output)
            user_prompt: User message/query
            model: Override default model

        Returns:
            Parsed JSON response as a dict
        """
        response = await self.complete(system_prompt, user_prompt, model)

        # Clean up markdown code blocks
        text = response
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        text = text.strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to extract JSON object
            json_match = re.search(r'\{[\s\S]*\}', text)
            if json_match:
                return json.loads(json_match.group())
            raise
