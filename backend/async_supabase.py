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
        body: Any = None,
        upsert: bool = False,
        on_conflict: str = None
    ) -> Optional[Any]:
        """Make an async request to Supabase REST API."""
        session = await self._get_session()

        # Build URL with on_conflict parameter for upsert
        if upsert and on_conflict:
            separator = '&' if '?' in endpoint else '?'
            url = f"{self.url}/rest/v1/{endpoint}{separator}on_conflict={on_conflict}"
        else:
            url = f"{self.url}/rest/v1/{endpoint}"

        headers = self._get_headers()
        if upsert:
            # Enable upsert behavior - merge on conflict
            headers['Prefer'] = 'return=representation,resolution=merge-duplicates'

        kwargs = {'headers': headers}
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


async def save_generated_leads(
    client: AsyncSupabaseClient,
    user_id: str,
    campaign_id: Optional[str],
    query: str,
    leads: List[Dict]
) -> Dict[str, Any]:
    """
    Save AI-generated leads to Supabase.

    Creates records in generated_leads table with deduplication by email+user+campaign.
    """
    if not leads:
        return {'leads_saved': 0, 'duplicates_skipped': 0}

    saved_count = 0
    duplicates = 0

    semaphore = asyncio.Semaphore(10)

    async def insert_lead(lead: Dict) -> bool:
        async with semaphore:
            lead_data = {
                'user_id': user_id,
                'campaign_id': campaign_id,
                'generation_query': query,
                'email': lead.get('email', ''),
                'first_name': lead.get('first_name', ''),
                'last_name': lead.get('last_name', ''),
                'full_name': lead.get('name', ''),
                'title': lead.get('title', ''),
                'company': lead.get('company', ''),
                'location': lead.get('location', ''),
                'linkedin_url': lead.get('linkedin_url', ''),
                'source': lead.get('source', 'aviato'),
                'raw_json': json.dumps(lead),
                'status': 'new',
            }

            try:
                # Use upsert to handle duplicates gracefully
                await client.request(
                    'generated_leads',
                    'POST',
                    lead_data,
                    upsert=True,
                    on_conflict='user_id,email,campaign_id'
                )
                return True
            except Exception as e:
                if 'duplicate' in str(e).lower() or '23505' in str(e):
                    return False  # Duplicate, not an error
                print(f"Error inserting lead {lead.get('email')}: {e}")
                return False

    tasks = [insert_lead(lead) for lead in leads]
    results = await asyncio.gather(*tasks)

    saved_count = sum(1 for r in results if r)
    duplicates = len(leads) - saved_count

    return {
        'leads_saved': saved_count,
        'duplicates_skipped': duplicates
    }


async def save_generated_template(
    client: AsyncSupabaseClient,
    user_id: str,
    campaign_id: str,
    template: Dict,
    cta: str,
    style_prompt: str
) -> Dict[str, Any]:
    """
    Save AI-generated email template to Supabase.

    Uses check-then-update/insert pattern for reliability (one template per campaign).
    """
    template_data = {
        'user_id': user_id,
        'campaign_id': campaign_id,
        'subject': template.get('subject', ''),
        'body': template.get('body', ''),
        'placeholders': json.dumps(template.get('placeholders', [])),
        'cta_used': cta,
        'style_prompt_used': style_prompt,
    }

    try:
        # Check if template already exists for this campaign
        existing = await client.request(
            f"generated_templates?campaign_id=eq.{campaign_id}&select=id",
            'GET'
        )

        if existing and len(existing) > 0:
            # Update existing template
            template_id = existing[0]['id']
            result = await client.request(
                f"generated_templates?id=eq.{template_id}",
                'PATCH',
                template_data
            )
            return {
                'template_saved': True,
                'template_id': template_id,
                'action': 'updated'
            }
        else:
            # Insert new template
            result = await client.request(
                'generated_templates',
                'POST',
                template_data
            )
            return {
                'template_saved': True,
                'template_id': result[0]['id'] if result else None,
                'action': 'inserted'
            }
    except Exception as e:
        print(f"Error saving template for campaign {campaign_id}: {e}")
        return {'template_saved': False, 'error': str(e)}


async def save_generated_cadence(
    client: AsyncSupabaseClient,
    user_id: str,
    campaign_id: str,
    cadence_emails: List[Dict]
) -> Dict[str, Any]:
    """
    Save AI-generated email cadence to Supabase.

    Args:
        cadence_emails: List of dicts with keys:
            - day_number: int (1, 3, 7, 14)
            - email_type: str ('initial', 'followup_1', etc.)
            - subject: str
            - body: str
            - tone_guidance: str (optional)

    Replaces existing cadence for the campaign.
    """
    if not cadence_emails:
        return {'emails_saved': 0}

    # Delete existing cadence for this campaign
    try:
        await client.request(f"generated_cadence?campaign_id=eq.{campaign_id}", 'DELETE')
    except Exception:
        pass  # May not exist yet

    # Insert new cadence emails
    saved_count = 0
    for email in cadence_emails:
        cadence_data = {
            'user_id': user_id,
            'campaign_id': campaign_id,
            'day_number': email.get('day_number'),
            'email_type': email.get('email_type'),
            'subject': email.get('subject', ''),
            'body': email.get('body', ''),
            'tone_guidance': email.get('tone_guidance', ''),
        }

        try:
            await client.request('generated_cadence', 'POST', cadence_data)
            saved_count += 1
        except Exception as e:
            print(f"Error saving cadence email day {email.get('day_number')}: {e}")

    return {'emails_saved': saved_count}


async def get_generated_leads(
    client: AsyncSupabaseClient,
    user_id: str,
    campaign_id: Optional[str] = None
) -> List[Dict]:
    """
    Retrieve saved leads for a user/campaign.
    """
    endpoint = f"generated_leads?user_id=eq.{user_id}&order=created_at.desc"
    if campaign_id:
        endpoint += f"&campaign_id=eq.{campaign_id}"

    try:
        result = await client.request(endpoint, 'GET')
        return result or []
    except Exception as e:
        print(f"Error fetching leads: {e}")
        return []


async def get_generated_template(
    client: AsyncSupabaseClient,
    campaign_id: str
) -> Optional[Dict]:
    """
    Retrieve saved template for a campaign.
    """
    try:
        result = await client.request(
            f"generated_templates?campaign_id=eq.{campaign_id}&limit=1",
            'GET'
        )
        return result[0] if result else None
    except Exception as e:
        print(f"Error fetching template: {e}")
        return None


async def get_generated_cadence(
    client: AsyncSupabaseClient,
    campaign_id: str
) -> List[Dict]:
    """
    Retrieve saved email cadence for a campaign.
    """
    try:
        result = await client.request(
            f"generated_cadence?campaign_id=eq.{campaign_id}&order=day_number.asc",
            'GET'
        )
        return result or []
    except Exception as e:
        print(f"Error fetching cadence: {e}")
        return []


async def update_cadence_email(
    client: AsyncSupabaseClient,
    cadence_id: str,
    updates: Dict
) -> Optional[Dict]:
    """
    Update a single cadence email (subject, body, or day_number).
    """
    try:
        result = await client.request(
            f"generated_cadence?id=eq.{cadence_id}",
            'PATCH',
            updates
        )
        return result[0] if result else None
    except Exception as e:
        print(f"Error updating cadence email: {e}")
        return None
