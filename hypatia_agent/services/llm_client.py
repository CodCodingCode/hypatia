"""
LLM Client for Hypatia Agent System.

Wrapper around OpenRouter API for simplified async LLM calls.
"""

import os
import re
import json
import httpx
from pathlib import Path


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

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
DEFAULT_MODEL = "google/gemini-3-flash-preview"


class LLMClient:
    """
    Async LLM client using OpenRouter API.

    Provides a simple interface for debate agents to get completions.
    """

    def __init__(self, model: str = None):
        self.model = model or DEFAULT_MODEL
        self.api_key = OPENROUTER_API_KEY
        self.base_url = "https://openrouter.ai/api/v1/chat/completions"

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

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.base_url,
                headers=headers,
                json=payload,
                timeout=60.0,
            )
            response.raise_for_status()
            data = response.json()

        return data["choices"][0]["message"]["content"].strip()

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
