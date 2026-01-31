"""
Supabase HTTP request helper.
"""

import json
import urllib.request
import urllib.error
from fastapi import HTTPException

from backend_config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY


def supabase_request(endpoint: str, method: str = 'GET', body=None):
    """Make a request to Supabase REST API."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"

    headers = {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    }

    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')

    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as response:
            text = response.read().decode('utf-8')
            return json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        raise HTTPException(status_code=e.code, detail=f"Supabase error: {error_body}")
