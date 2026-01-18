"""
Hypatia Analytics Module
Server-side Amplitude integration for tracking business events
"""

import os
import time
import asyncio
from typing import Optional, Dict, Any, List
from datetime import datetime
import aiohttp
from functools import wraps

# Configuration
AMPLITUDE_API_KEY = os.environ.get('AMPLITUDE_API_KEY', '')
AMPLITUDE_ENDPOINT = 'https://api2.amplitude.com/2/httpapi'

# Event queue for batching
_event_queue: List[Dict] = []
_queue_lock = asyncio.Lock()
_flush_task: Optional[asyncio.Task] = None


async def _flush_events():
    """Flush queued events to Amplitude."""
    global _event_queue

    async with _queue_lock:
        if not _event_queue:
            return
        events_to_send = _event_queue.copy()
        _event_queue = []

    if not AMPLITUDE_API_KEY:
        print(f"[Analytics] No API key - would send {len(events_to_send)} events")
        return

    payload = {
        'api_key': AMPLITUDE_API_KEY,
        'events': events_to_send
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                AMPLITUDE_ENDPOINT,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    print(f"[Analytics] Flushed {len(events_to_send)} events")
                else:
                    text = await response.text()
                    print(f"[Analytics] Error {response.status}: {text[:200]}")
    except Exception as e:
        print(f"[Analytics] Flush failed: {e}")
        # Re-queue failed events
        async with _queue_lock:
            _event_queue = events_to_send + _event_queue


async def _flush_loop():
    """Background task to flush events periodically."""
    while True:
        await asyncio.sleep(30)
        await _flush_events()


def init_analytics():
    """Initialize analytics module. Call on app startup."""
    global _flush_task
    if _flush_task is None:
        try:
            loop = asyncio.get_event_loop()
            _flush_task = loop.create_task(_flush_loop())
            print("[Analytics] Background flush task started")
        except RuntimeError:
            print("[Analytics] No event loop - flush task not started")


async def track_event(
    event_name: str,
    user_id: str,
    properties: Optional[Dict[str, Any]] = None,
    user_properties: Optional[Dict[str, Any]] = None
):
    """
    Track an event asynchronously.

    Args:
        event_name: Name of the event
        user_id: Hypatia user ID (UUID)
        properties: Event-specific properties
        user_properties: User traits to update
    """
    event = {
        'user_id': str(user_id),
        'event_type': event_name,
        'time': int(time.time() * 1000),
        'event_properties': {
            **(properties or {}),
            'source': 'backend'
        },
        'platform': 'Backend'
    }

    if user_properties:
        event['user_properties'] = user_properties

    async with _queue_lock:
        _event_queue.append(event)

    print(f"[Analytics] Queued: {event_name} for {str(user_id)[:8]}...")

    # Immediate flush if queue is large
    if len(_event_queue) >= 10:
        asyncio.create_task(_flush_events())


def track_sync(event_name: str, user_id: str, properties: Optional[Dict[str, Any]] = None):
    """Synchronous wrapper for tracking."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(track_event(event_name, user_id, properties))
        else:
            loop.run_until_complete(track_event(event_name, user_id, properties))
    except RuntimeError:
        # No event loop, just log
        print(f"[Analytics] Would track: {event_name} for {str(user_id)[:8]}...")


# =============================================================================
# PREDEFINED EVENT TRACKING FUNCTIONS
# =============================================================================

async def track_user_created(
    user_id: str,
    email: str,
    referral_source: Optional[str] = None,
    user_type: Optional[str] = None
):
    """Track new user registration."""
    email_domain = email.split('@')[1] if '@' in email else None

    await track_event(
        'user_created',
        user_id,
        {'email_domain': email_domain},
        user_properties={
            'referral_source': referral_source,
            'user_type': user_type,
            'created_at': datetime.utcnow().isoformat()
        }
    )


async def track_campaign_clustering_completed(
    user_id: str,
    total_emails: int,
    campaigns_created: int,
    avg_similarity: float,
    duration_ms: int
):
    """Track when email clustering completes."""
    await track_event(
        'campaign_clustering_completed',
        user_id,
        {
            'total_emails': total_emails,
            'campaigns_created': campaigns_created,
            'avg_similarity': round(avg_similarity, 3),
            'duration_ms': duration_ms,
            'emails_per_campaign': round(total_emails / max(campaigns_created, 1), 1)
        }
    )


async def track_campaign_analyzed(
    user_id: str,
    campaign_id: str,
    has_cta: bool,
    has_style: bool
):
    """Track when a campaign is analyzed."""
    await track_event(
        'campaign_analyzed',
        user_id,
        {
            'campaign_id': campaign_id,
            'has_cta': has_cta,
            'has_style': has_style
        }
    )


async def track_lead_generation_completed(
    user_id: str,
    campaign_id: Optional[str],
    query: str,
    leads_found: int,
    api_used: str,
    duration_ms: int
):
    """Track when lead generation completes."""
    await track_event(
        'lead_generation_completed',
        user_id,
        {
            'campaign_id': campaign_id,
            'query_length': len(query),
            'query_words': len(query.split()),
            'leads_found': leads_found,
            'api_used': api_used,
            'duration_ms': duration_ms,
            'success': leads_found > 0
        }
    )


async def track_template_generation_completed(
    user_id: str,
    campaign_id: str,
    cta_type: Optional[str],
    generation_time_ms: int,
    success: bool,
    body_length: int = 0
):
    """Track when AI template generation completes."""
    await track_event(
        'template_generation_completed',
        user_id,
        {
            'campaign_id': campaign_id,
            'cta_type': cta_type,
            'generation_time_ms': generation_time_ms,
            'success': success,
            'body_length': body_length
        }
    )


async def track_cadence_generated(
    user_id: str,
    campaign_id: str,
    email_count: int,
    duration_ms: int
):
    """Track when cadence is generated."""
    await track_event(
        'cadence_generated',
        user_id,
        {
            'campaign_id': campaign_id,
            'email_count': email_count,
            'duration_ms': duration_ms
        }
    )


async def track_email_batch_sent(
    user_id: str,
    campaign_id: str,
    batch_size: int,
    sent_count: int,
    failed_count: int
):
    """Track when email batch sending completes."""
    await track_event(
        'email_batch_sent',
        user_id,
        {
            'campaign_id': campaign_id,
            'batch_size': batch_size,
            'sent_count': sent_count,
            'failed_count': failed_count,
            'success_rate': round(sent_count / max(batch_size, 1), 2)
        }
    )


async def track_followup_scheduled(
    user_id: str,
    campaign_id: str,
    followup_count: int,
    recipient_count: int
):
    """Track when followups are scheduled."""
    await track_event(
        'followup_scheduled',
        user_id,
        {
            'campaign_id': campaign_id,
            'followup_count': followup_count,
            'recipient_count': recipient_count
        }
    )


async def track_followup_cancelled(
    user_id: str,
    followup_id: str,
    reason: str
):
    """Track when a followup is cancelled."""
    await track_event(
        'followup_cancelled',
        user_id,
        {
            'followup_id': followup_id,
            'reason': reason
        }
    )


async def track_api_error(
    user_id: str,
    endpoint: str,
    error_type: str,
    error_message: str
):
    """Track API errors."""
    await track_event(
        'api_error',
        user_id,
        {
            'endpoint': endpoint,
            'error_type': error_type,
            'error_message': error_message[:200]
        }
    )


# =============================================================================
# DECORATOR FOR AUTOMATIC TRACKING
# =============================================================================

def track_endpoint(event_name: str):
    """
    Decorator to automatically track endpoint calls.

    Usage:
        @track_endpoint('leads_generated')
        async def generate_leads(request: LeadGenerateRequest):
            ...
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            start_time = time.time()
            try:
                result = await func(*args, **kwargs)
                duration_ms = int((time.time() - start_time) * 1000)

                # Try to extract user_id from args/kwargs
                user_id = None
                for arg in args:
                    if hasattr(arg, 'user_id'):
                        user_id = arg.user_id
                        break
                if not user_id:
                    user_id = kwargs.get('user_id', 'unknown')

                await track_event(
                    event_name,
                    str(user_id),
                    {'duration_ms': duration_ms, 'success': True}
                )

                return result
            except Exception as e:
                duration_ms = int((time.time() - start_time) * 1000)
                await track_event(
                    event_name,
                    'unknown',
                    {'duration_ms': duration_ms, 'success': False, 'error': str(e)[:100]}
                )
                raise
        return wrapper
    return decorator


# Ensure events are flushed on shutdown
async def shutdown_analytics():
    """Flush remaining events before shutdown."""
    await _flush_events()
    print("[Analytics] Shutdown complete")
