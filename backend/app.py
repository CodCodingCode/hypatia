"""
Hypatia Backend API
FastAPI server for handling email storage and campaign clustering.

This is the main entry point - all endpoints are organized in routers.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from dependencies import init_async_supabase, close_async_supabase, get_async_supabase
from routers import (
    health,
    users,
    emails,
    campaigns,
    followups,
    leads,
    templates,
    cadence,
    sent,
    feedback,
)

from analytics import init_analytics, shutdown_analytics
from feedback_loop import get_feedback_service


# =============================================================================
# FASTAPI APP WITH LIFESPAN
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage async Supabase client lifecycle."""
    # Initialize async Supabase client
    init_async_supabase()

    # Initialize analytics
    init_analytics()

    # Initialize feedback service with database persistence
    async_client = get_async_supabase()
    feedback_service = get_feedback_service(async_client)
    await feedback_service.initialize_from_db()

    yield

    # Shutdown analytics
    await shutdown_analytics()

    # Close async Supabase client
    await close_async_supabase()


app = FastAPI(
    title="Hypatia API",
    description="Backend API for Hypatia email intelligence",
    version="1.0.0",
    lifespan=lifespan
)

# CORS - allow extension to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your extension ID
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# REGISTER ROUTERS
# =============================================================================

# Health endpoints (no prefix - at root)
app.include_router(health.router)

# Resource routers
app.include_router(users.router)
app.include_router(emails.router)
app.include_router(campaigns.router)
app.include_router(followups.router)
app.include_router(leads.router)
app.include_router(templates.router)
app.include_router(cadence.router)
app.include_router(sent.router)
app.include_router(feedback.router)

# Followup config endpoints that live under /campaigns/ path
app.include_router(followups.campaigns_router)


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
