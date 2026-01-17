from abc import ABC, abstractmethod


class BaseAgent(ABC):
    """Abstract base class for all agents."""

    @abstractmethod
    async def execute(self, *args, **kwargs):
        """Execute the agent's main task."""
        pass
