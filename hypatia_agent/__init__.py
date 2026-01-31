# Note: manager.py was removed, imports are done directly from submodules
from .base_agent import BaseAgent
from .services import SupabaseClient

__all__ = [
    "BaseAgent",
    "SupabaseClient",
]
