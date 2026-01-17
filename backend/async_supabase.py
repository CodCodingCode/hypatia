"""
Async Supabase client for parallel HTTP operations.
Uses aiohttp for concurrent requests to Supabase REST API.
"""

import asyncio
import aiohttp
import json
from typing import Optional, List, Dict, Any


class AsyncSupabaseClient:
    """Async client for Supabase REST API operations."""

    def __init__(self, url: str, anon_key: str):
        self.url = url
        self.anon_key = anon_key
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    def _get_headers(self) -> Dict[str, str]:
        return {
            'apikey': self.anon_key,
            'Authorization': f'Bearer {self.anon_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }

    async def request(
        self,
        endpoint: str,
        method: str = 'GET',
        body: Any = None
    ) -> Optional[Any]:
        """Make an async request to Supabase REST API."""
        session = await self._get_session()
        url = f"{self.url}/rest/v1/{endpoint}"

        kwargs = {'headers': self._get_headers()}
        if body is not None:
            kwargs['data'] = json.dumps(body)

        async with session.request(method, url, **kwargs) as response:
            if not response.ok:
                error_text = await response.text()
                raise Exception(f"Supabase error ({response.status}): {error_text}")

            text = await response.text()
            return json.loads(text) if text else None


async def save_campaigns_parallel(
    client: AsyncSupabaseClient,
    user_id: str,
    campaigns: List[Dict]
) -> Dict[str, int]:
    """
    Save campaigns to Supabase using parallel async operations.

    Strategy:
    1. Delete existing campaigns (must be sequential due to FK constraints)
    2. Insert all campaigns in parallel
    3. Insert all email-campaign links in batches
    """
    # Phase 1: Clean up existing campaigns
    existing = await client.request(
        f"campaigns?user_id=eq.{user_id}&select=id", 'GET'
    )

    if existing:
        # Delete email_campaigns first (FK constraint)
        delete_tasks = [
            client.request(f"email_campaigns?campaign_id=eq.{c['id']}", 'DELETE')
            for c in existing
        ]
        await asyncio.gather(*delete_tasks, return_exceptions=True)

        # Then delete campaigns
        await client.request(f"campaigns?user_id=eq.{user_id}", 'DELETE')

    # Phase 2: Insert campaigns in parallel (up to 10 concurrent)
    semaphore = asyncio.Semaphore(10)
    campaign_results = []

    async def insert_campaign(campaign: Dict) -> Optional[Dict]:
        async with semaphore:
            campaign_data = {
                'user_id': user_id,
                'campaign_number': campaign['campaign_id'],
                'representative_subject': campaign['representative_subject'],
                'representative_recipient': campaign['representative_recipient'],
                'email_count': campaign['email_count'],
                'avg_similarity': campaign['avg_similarity'],
            }

            try:
                result = await client.request('campaigns', 'POST', campaign_data)
                return {
                    'campaign_id': campaign['campaign_id'],
                    'uuid': result[0]['id'] if result else None,
                    'email_ids': campaign['email_ids']
                }
            except Exception as e:
                print(f"Error inserting campaign {campaign['campaign_id']}: {e}")
                return None

    tasks = [insert_campaign(c) for c in campaigns]
    results = await asyncio.gather(*tasks)

    # Phase 3: Collect all email-campaign links
    all_email_links = []
    for result in results:
        if result and result['uuid']:
            campaign_results.append(result)
            for email_id in result['email_ids']:
                all_email_links.append({
                    'email_id': email_id,
                    'campaign_id': result['uuid']
                })

    # Phase 4: Insert email links in batches
    if all_email_links:
        batch_size = 100
        for i in range(0, len(all_email_links), batch_size):
            batch = all_email_links[i:i + batch_size]
            try:
                await client.request('email_campaigns', 'POST', batch)
            except Exception as e:
                print(f"Error inserting email links batch: {e}")

    return {
        'campaigns_saved': len(campaign_results),
        'email_links_saved': len(all_email_links)
    }
