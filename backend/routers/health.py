"""
Health check endpoints.
"""

from fastapi import APIRouter

from utils.supabase import supabase_request

router = APIRouter(tags=["Health"])


@router.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "Hypatia API"}


@router.get("/health")
async def health():
    """Health check with Supabase connection test."""
    try:
        supabase_request("users?select=count", "GET")
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "database": "disconnected", "error": str(e)}
