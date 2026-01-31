"""
FastAPI dependencies for Hypatia Backend API.
Provides shared database clients and services.
"""

from typing import Optional

from async_supabase import AsyncSupabaseClient
from hypatia_agent.services.supabase_client import SupabaseClient as AgentSupabaseClient

from backend_config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY


# Global async Supabase client (initialized in app lifespan)
async_supabase_client: Optional[AsyncSupabaseClient] = None


def get_async_supabase() -> AsyncSupabaseClient:
    """Get the global async Supabase client."""
    if async_supabase_client is None:
        raise RuntimeError("Async Supabase client not initialized")
    return async_supabase_client


def get_agent_supabase() -> AgentSupabaseClient:
    """Get a new AgentSupabaseClient instance for agent operations."""
    return AgentSupabaseClient()


def init_async_supabase() -> AsyncSupabaseClient:
    """Initialize the async Supabase client. Called during app startup."""
    global async_supabase_client
    async_supabase_client = AsyncSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    return async_supabase_client


async def close_async_supabase():
    """Close the async Supabase client. Called during app shutdown."""
    global async_supabase_client
    if async_supabase_client:
        await async_supabase_client.close()
        async_supabase_client = None
