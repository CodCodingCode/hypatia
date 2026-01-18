"""
Hypatia Feedback Loop System
"Ever Improving" AI through detailed user preference learning

This module learns from how users edit AI-generated templates to build
a preference profile that improves future generations.

Key Features:
1. Detailed Edit Analysis - tracks exactly what users change
2. Preference Profile - builds user preferences over time
3. Style Learning - learns tone, length, formality preferences
4. Smart Prompt Enhancement - applies learned preferences to new generations
"""

import os
import re
from typing import Optional, Dict, List, Any, Tuple
from datetime import datetime
from dataclasses import dataclass, field, asdict
from collections import Counter
import json


@dataclass
class EditAnalysis:
    """Detailed analysis of what the user changed."""
    # Subject changes
    subject_shortened: bool = False
    subject_lengthened: bool = False
    subject_question_added: bool = False
    subject_question_removed: bool = False
    subject_personalization_added: bool = False

    # Body changes
    body_shortened: bool = False
    body_lengthened: bool = False
    body_more_casual: bool = False
    body_more_formal: bool = False
    body_added_personalization: bool = False
    body_removed_personalization: bool = False
    body_added_bullet_points: bool = False
    body_simplified_language: bool = False

    # CTA changes
    cta_made_softer: bool = False
    cta_made_stronger: bool = False
    cta_changed_type: bool = False

    # Overall
    significant_rewrite: bool = False
    minor_tweaks: bool = False


@dataclass
class UserPreferences:
    """Learned preferences for a user."""
    user_id: str

    # Subject preferences
    preferred_subject_length: str = 'medium'  # short, medium, long
    prefers_questions_in_subject: Optional[bool] = None
    prefers_personalized_subject: Optional[bool] = None

    # Body preferences
    preferred_body_length: str = 'medium'  # short, medium, long
    preferred_tone: str = 'professional'  # casual, professional, formal
    preferred_personalization_level: str = 'medium'  # low, medium, high
    prefers_bullet_points: Optional[bool] = None
    prefers_simple_language: Optional[bool] = None

    # CTA preferences
    preferred_cta_strength: str = 'medium'  # soft, medium, strong
    preferred_cta_types: List[str] = field(default_factory=list)

    # Confidence scores (0-1)
    confidence: float = 0.0
    samples_analyzed: int = 0

    # Raw tracking for learning
    subject_length_votes: Dict[str, int] = field(default_factory=lambda: {'short': 0, 'medium': 0, 'long': 0})
    body_length_votes: Dict[str, int] = field(default_factory=lambda: {'short': 0, 'medium': 0, 'long': 0})
    tone_votes: Dict[str, int] = field(default_factory=lambda: {'casual': 0, 'professional': 0, 'formal': 0})
    cta_strength_votes: Dict[str, int] = field(default_factory=lambda: {'soft': 0, 'medium': 0, 'strong': 0})


@dataclass
class TemplateRecord:
    """Record of a generated template and its edits."""
    template_id: str
    campaign_id: str
    user_id: str
    original_subject: str
    original_body: str
    edited_subject: Optional[str] = None
    edited_body: Optional[str] = None
    edit_analysis: Optional[EditAnalysis] = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    was_edited: bool = False
    was_used: bool = False  # True if emails were sent with this template


class FeedbackLoopService:
    """
    Learns user preferences from template edits to improve AI generation.

    The "ever improving" loop:
    1. AI generates template → we record the original
    2. User edits template → we analyze exactly what changed
    3. We update user preference profile based on edit patterns
    4. Future generations incorporate learned preferences
    5. Templates get better over time, requiring fewer edits
    """

    def __init__(self, async_supabase_client=None):
        self._templates: Dict[str, TemplateRecord] = {}
        self._user_preferences: Dict[str, UserPreferences] = {}
        self._query_cache: Dict[str, Dict] = {}
        self._async_supabase_client = async_supabase_client

    # =========================================================================
    # TEMPLATE RECORDING
    # =========================================================================

    def record_template_generated(
        self,
        template_id: str,
        campaign_id: str,
        user_id: str,
        subject: str,
        body: str,
    ) -> None:
        """Record when a template is generated (before any edits)."""
        self._templates[template_id] = TemplateRecord(
            template_id=template_id,
            campaign_id=campaign_id,
            user_id=user_id,
            original_subject=subject,
            original_body=body,
        )

        # Ensure user has a preference profile
        if user_id not in self._user_preferences:
            self._user_preferences[user_id] = UserPreferences(user_id=user_id)

    async def record_template_edited(
        self,
        template_id: str,
        new_subject: str,
        new_body: str,
        user_id: str,
    ) -> Dict[str, Any]:
        """
        Record when user edits a template and learn from the changes.

        Returns detailed analysis of what changed and preferences learned.
        """
        if template_id not in self._templates:
            # Template not tracked - record it now
            self._templates[template_id] = TemplateRecord(
                template_id=template_id,
                campaign_id='unknown',
                user_id=user_id,
                original_subject='',
                original_body='',
            )

        record = self._templates[template_id]
        record.edited_subject = new_subject
        record.edited_body = new_body
        record.was_edited = True

        # Analyze the edits in detail
        analysis = self._analyze_edits(
            record.original_subject,
            record.original_body,
            new_subject,
            new_body
        )
        record.edit_analysis = analysis

        # Save edit to database (full history)
        await self._save_edit_to_db(
            template_id=template_id,
            user_id=user_id,
            campaign_id=record.campaign_id,
            original_subject=record.original_subject,
            original_body=record.original_body,
            edited_subject=new_subject,
            edited_body=new_body,
            analysis=analysis
        )

        # Update user preferences based on this edit
        self._update_preferences_from_edit(user_id, analysis, record)

        # Save updated preferences to database
        if user_id in self._user_preferences:
            await self._save_preferences_to_db(user_id, self._user_preferences[user_id])

        # Return analysis for logging/display
        return {
            'template_id': template_id,
            'analysis': self._analysis_to_dict(analysis),
            'preferences_updated': True,
            'current_preferences': self._preferences_to_dict(self._user_preferences.get(user_id)),
        }

    def _analyze_edits(
        self,
        orig_subject: str,
        orig_body: str,
        new_subject: str,
        new_body: str,
    ) -> EditAnalysis:
        """Analyze exactly what the user changed."""
        analysis = EditAnalysis()

        # Subject analysis
        if orig_subject and new_subject:
            orig_len = len(orig_subject)
            new_len = len(new_subject)
            if new_len < orig_len * 0.7:
                analysis.subject_shortened = True
            elif new_len > orig_len * 1.3:
                analysis.subject_lengthened = True

            analysis.subject_question_added = '?' not in orig_subject and '?' in new_subject
            analysis.subject_question_removed = '?' in orig_subject and '?' not in new_subject
            analysis.subject_personalization_added = (
                orig_subject.count('{') < new_subject.count('{')
            )

        # Body analysis
        if orig_body and new_body:
            orig_len = len(orig_body)
            new_len = len(new_body)
            if new_len < orig_len * 0.7:
                analysis.body_shortened = True
            elif new_len > orig_len * 1.3:
                analysis.body_lengthened = True

            # Personalization
            orig_vars = orig_body.count('{')
            new_vars = new_body.count('{')
            if new_vars > orig_vars:
                analysis.body_added_personalization = True
            elif new_vars < orig_vars:
                analysis.body_removed_personalization = True

            # Bullet points
            orig_bullets = orig_body.count('\n-') + orig_body.count('\n•')
            new_bullets = new_body.count('\n-') + new_body.count('\n•')
            if new_bullets > orig_bullets:
                analysis.body_added_bullet_points = True

            # Tone analysis (simplified)
            analysis.body_more_casual = self._is_more_casual(orig_body, new_body)
            analysis.body_more_formal = self._is_more_formal(orig_body, new_body)
            analysis.body_simplified_language = self._is_simpler(orig_body, new_body)

            # CTA analysis
            analysis.cta_made_softer = self._cta_softened(orig_body, new_body)
            analysis.cta_made_stronger = self._cta_strengthened(orig_body, new_body)

        # Overall assessment
        total_changes = sum([
            analysis.subject_shortened, analysis.subject_lengthened,
            analysis.body_shortened, analysis.body_lengthened,
            analysis.body_more_casual, analysis.body_more_formal,
            analysis.cta_made_softer, analysis.cta_made_stronger,
        ])
        analysis.significant_rewrite = total_changes >= 3
        analysis.minor_tweaks = total_changes <= 1

        return analysis

    def _is_more_casual(self, orig: str, new: str) -> bool:
        """Check if the new version is more casual."""
        casual_markers = ['hey', 'hi ', 'thanks!', '!', ':)', 'quick', 'just']
        formal_markers = ['dear', 'sincerely', 'regards', 'respectfully', 'kindly']

        orig_casual = sum(1 for m in casual_markers if m in orig.lower())
        new_casual = sum(1 for m in casual_markers if m in new.lower())
        orig_formal = sum(1 for m in formal_markers if m in orig.lower())
        new_formal = sum(1 for m in formal_markers if m in new.lower())

        return (new_casual > orig_casual) or (new_formal < orig_formal)

    def _is_more_formal(self, orig: str, new: str) -> bool:
        """Check if the new version is more formal."""
        formal_markers = ['dear', 'sincerely', 'regards', 'respectfully', 'kindly', 'would you']
        orig_formal = sum(1 for m in formal_markers if m in orig.lower())
        new_formal = sum(1 for m in formal_markers if m in new.lower())
        return new_formal > orig_formal

    def _is_simpler(self, orig: str, new: str) -> bool:
        """Check if language was simplified."""
        # Average word length as proxy for complexity
        orig_words = orig.split()
        new_words = new.split()
        if not orig_words or not new_words:
            return False
        orig_avg = sum(len(w) for w in orig_words) / len(orig_words)
        new_avg = sum(len(w) for w in new_words) / len(new_words)
        return new_avg < orig_avg * 0.9

    def _cta_softened(self, orig: str, new: str) -> bool:
        """Check if CTA was made softer."""
        strong_ctas = ['schedule a call', 'book a meeting', 'sign up', 'buy now', 'act now']
        soft_ctas = ['let me know', 'would love to', 'when you have time', 'no pressure', 'if interested']

        orig_strong = sum(1 for c in strong_ctas if c in orig.lower())
        new_strong = sum(1 for c in strong_ctas if c in new.lower())
        new_soft = sum(1 for c in soft_ctas if c in new.lower())

        return new_strong < orig_strong or new_soft > 0

    def _cta_strengthened(self, orig: str, new: str) -> bool:
        """Check if CTA was made stronger."""
        strong_ctas = ['schedule', 'book', 'call me', 'let\'s talk', 'this week']
        orig_strong = sum(1 for c in strong_ctas if c in orig.lower())
        new_strong = sum(1 for c in strong_ctas if c in new.lower())
        return new_strong > orig_strong

    # =========================================================================
    # PREFERENCE LEARNING
    # =========================================================================

    def _update_preferences_from_edit(
        self,
        user_id: str,
        analysis: EditAnalysis,
        record: TemplateRecord,
    ) -> None:
        """Update user preferences based on observed edit patterns."""
        if user_id not in self._user_preferences:
            self._user_preferences[user_id] = UserPreferences(user_id=user_id)

        prefs = self._user_preferences[user_id]
        prefs.samples_analyzed += 1

        # Subject length preference
        if analysis.subject_shortened:
            prefs.subject_length_votes['short'] += 1
        elif analysis.subject_lengthened:
            prefs.subject_length_votes['long'] += 1
        else:
            prefs.subject_length_votes['medium'] += 1

        # Body length preference
        if analysis.body_shortened:
            prefs.body_length_votes['short'] += 1
        elif analysis.body_lengthened:
            prefs.body_length_votes['long'] += 1
        else:
            prefs.body_length_votes['medium'] += 1

        # Tone preference
        if analysis.body_more_casual:
            prefs.tone_votes['casual'] += 1
        elif analysis.body_more_formal:
            prefs.tone_votes['formal'] += 1
        else:
            prefs.tone_votes['professional'] += 1

        # CTA strength preference
        if analysis.cta_made_softer:
            prefs.cta_strength_votes['soft'] += 1
        elif analysis.cta_made_stronger:
            prefs.cta_strength_votes['strong'] += 1
        else:
            prefs.cta_strength_votes['medium'] += 1

        # Question preference
        if analysis.subject_question_added:
            prefs.prefers_questions_in_subject = True
        elif analysis.subject_question_removed:
            prefs.prefers_questions_in_subject = False

        # Personalization preference
        if analysis.body_added_personalization or analysis.subject_personalization_added:
            prefs.preferred_personalization_level = 'high'
        elif analysis.body_removed_personalization:
            prefs.preferred_personalization_level = 'low'

        # Bullet points preference
        if analysis.body_added_bullet_points:
            prefs.prefers_bullet_points = True

        # Simple language preference
        if analysis.body_simplified_language:
            prefs.prefers_simple_language = True

        # Update derived preferences from votes
        self._derive_preferences(prefs)

    def _derive_preferences(self, prefs: UserPreferences) -> None:
        """Derive final preferences from vote counts."""
        # Subject length
        prefs.preferred_subject_length = max(
            prefs.subject_length_votes,
            key=prefs.subject_length_votes.get
        )

        # Body length
        prefs.preferred_body_length = max(
            prefs.body_length_votes,
            key=prefs.body_length_votes.get
        )

        # Tone
        prefs.preferred_tone = max(
            prefs.tone_votes,
            key=prefs.tone_votes.get
        )

        # CTA strength
        prefs.preferred_cta_strength = max(
            prefs.cta_strength_votes,
            key=prefs.cta_strength_votes.get
        )

        # Confidence (0-1 based on samples)
        prefs.confidence = min(prefs.samples_analyzed / 5, 1.0)  # 5+ samples = 100%

    # =========================================================================
    # DATABASE PERSISTENCE
    # =========================================================================

    async def _save_preferences_to_db(self, user_id: str, preferences: UserPreferences) -> bool:
        """Save user preferences to database."""
        if not self._async_supabase_client:
            return False

        try:
            # Convert preferences to database format
            prefs_data = {
                'user_id': user_id,

                # Subject preferences (vote counts)
                'subject_length_short': preferences.subject_length_votes.get('short', 0),
                'subject_length_medium': preferences.subject_length_votes.get('medium', 0),
                'subject_length_long': preferences.subject_length_votes.get('long', 0),
                'subject_use_questions': 1 if preferences.prefers_questions_in_subject is True else
                                        -1 if preferences.prefers_questions_in_subject is False else 0,
                'subject_personalization_level': 1 if preferences.prefers_personalized_subject is True else
                                                 -1 if preferences.prefers_personalized_subject is False else 0,

                # Body preferences (vote counts)
                'body_length_brief': preferences.body_length_votes.get('short', 0),
                'body_length_medium': preferences.body_length_votes.get('medium', 0),
                'body_length_long': preferences.body_length_votes.get('long', 0),
                'body_tone_casual': preferences.tone_votes.get('casual', 0),
                'body_tone_professional': preferences.tone_votes.get('professional', 0),
                'body_tone_formal': preferences.tone_votes.get('formal', 0),
                'body_personalization_level': {'low': -1, 'medium': 0, 'high': 1}.get(
                    preferences.preferred_personalization_level, 0
                ),
                'body_use_bullets': 1 if preferences.prefers_bullet_points is True else
                                   -1 if preferences.prefers_bullet_points is False else 0,
                'body_simple_language': 1 if preferences.prefers_simple_language is True else
                                       -1 if preferences.prefers_simple_language is False else 0,

                # CTA preferences (vote counts)
                'cta_strength_soft': preferences.cta_strength_votes.get('soft', 0),
                'cta_strength_medium': preferences.cta_strength_votes.get('medium', 0),
                'cta_strength_strong': preferences.cta_strength_votes.get('strong', 0),

                # Metadata
                'confidence_score': preferences.confidence,
                'total_edits_analyzed': preferences.samples_analyzed,
                'updated_at': datetime.utcnow().isoformat(),
            }

            # Upsert to database (insert or update)
            await self._async_supabase_client.request(
                'user_preferences',
                'POST',
                prefs_data,
                upsert=True,
                on_conflict='user_id'
            )

            return True
        except Exception as e:
            print(f"[FeedbackLoop] Error saving preferences to DB: {e}")
            return False

    async def _load_preferences_from_db(self, user_id: str) -> Optional[UserPreferences]:
        """Load user preferences from database."""
        if not self._async_supabase_client:
            return None

        try:
            result = await self._async_supabase_client.request(
                f"user_preferences?user_id=eq.{user_id}&select=*",
                'GET'
            )

            if not result or len(result) == 0:
                return None

            row = result[0]

            # Convert database row to UserPreferences object
            prefs = UserPreferences(user_id=user_id)

            # Subject votes
            prefs.subject_length_votes = {
                'short': row.get('subject_length_short', 0),
                'medium': row.get('subject_length_medium', 0),
                'long': row.get('subject_length_long', 0),
            }

            # Body votes
            prefs.body_length_votes = {
                'short': row.get('body_length_brief', 0),
                'medium': row.get('body_length_medium', 0),
                'long': row.get('body_length_long', 0),
            }

            prefs.tone_votes = {
                'casual': row.get('body_tone_casual', 0),
                'professional': row.get('body_tone_professional', 0),
                'formal': row.get('body_tone_formal', 0),
            }

            # CTA votes
            prefs.cta_strength_votes = {
                'soft': row.get('cta_strength_soft', 0),
                'medium': row.get('cta_strength_medium', 0),
                'strong': row.get('cta_strength_strong', 0),
            }

            # Boolean preferences
            subject_questions = row.get('subject_use_questions', 0)
            prefs.prefers_questions_in_subject = True if subject_questions > 0 else False if subject_questions < 0 else None

            subject_personalization = row.get('subject_personalization_level', 0)
            prefs.prefers_personalized_subject = True if subject_personalization > 0 else False if subject_personalization < 0 else None

            bullets = row.get('body_use_bullets', 0)
            prefs.prefers_bullet_points = True if bullets > 0 else False if bullets < 0 else None

            simple_lang = row.get('body_simple_language', 0)
            prefs.prefers_simple_language = True if simple_lang > 0 else False if simple_lang < 0 else None

            # Personalization level
            personalization_level = row.get('body_personalization_level', 0)
            if personalization_level > 0:
                prefs.preferred_personalization_level = 'high'
            elif personalization_level < 0:
                prefs.preferred_personalization_level = 'low'
            else:
                prefs.preferred_personalization_level = 'medium'

            # Metadata
            prefs.confidence = row.get('confidence_score', 0.0)
            prefs.samples_analyzed = row.get('total_edits_analyzed', 0)

            # Derive final preferences from votes
            self._derive_preferences(prefs)

            return prefs

        except Exception as e:
            print(f"[FeedbackLoop] Error loading preferences from DB: {e}")
            return None

    async def _save_edit_to_db(
        self,
        template_id: str,
        user_id: str,
        campaign_id: str,
        original_subject: str,
        original_body: str,
        edited_subject: str,
        edited_body: str,
        analysis: EditAnalysis
    ) -> bool:
        """Save full edit history to database."""
        if not self._async_supabase_client:
            return False

        try:
            # Convert EditAnalysis to JSON
            analysis_dict = self._analysis_to_dict(analysis)

            edit_data = {
                'template_id': template_id,
                'user_id': user_id,
                'campaign_id': campaign_id,
                'original_subject': original_subject,
                'original_body': original_body,
                'edited_subject': edited_subject,
                'edited_body': edited_body,
                'edit_analysis': json.dumps(analysis_dict),
            }

            await self._async_supabase_client.request(
                'template_edits',
                'POST',
                edit_data
            )

            return True
        except Exception as e:
            print(f"[FeedbackLoop] Error saving edit to DB: {e}")
            return False

    async def initialize_from_db(self) -> int:
        """
        Load all user preferences from database on service startup.
        Returns the number of user preferences loaded.
        """
        if not self._async_supabase_client:
            print("[FeedbackLoop] No async client available, skipping DB initialization")
            return 0

        try:
            # Load all user preferences
            result = await self._async_supabase_client.request(
                "user_preferences?select=*",
                'GET'
            )

            if not result:
                print("[FeedbackLoop] No user preferences found in database")
                return 0

            count = 0
            for row in result:
                user_id = row.get('user_id')
                if user_id:
                    prefs = await self._load_preferences_from_db(user_id)
                    if prefs:
                        self._user_preferences[user_id] = prefs
                        count += 1

            print(f"[FeedbackLoop] Loaded {count} user preferences from database")
            return count

        except Exception as e:
            print(f"[FeedbackLoop] Error initializing from DB: {e}")
            return 0

    # =========================================================================
    # PROMPT ENHANCEMENT
    # =========================================================================

    def get_user_preferences(self, user_id: str) -> Optional[UserPreferences]:
        """Get learned preferences for a user."""
        return self._user_preferences.get(user_id)

    def enhance_style_prompt(self, original_prompt: str, user_id: str) -> str:
        """
        Enhance a style prompt with learned user preferences.

        This is where the feedback loop CLOSES - we inject learned
        preferences into the AI generation prompt.
        """
        prefs = self._user_preferences.get(user_id)

        if not prefs or prefs.confidence < 0.2:
            return original_prompt

        enhancements = ["\n\n[USER PREFERENCES - LEARNED FROM THEIR EDITS]"]

        # Subject preferences
        subject_tips = []
        if prefs.preferred_subject_length == 'short':
            subject_tips.append("Keep subject lines SHORT (under 40 chars)")
        elif prefs.preferred_subject_length == 'long':
            subject_tips.append("User prefers DETAILED subject lines (50+ chars)")

        if prefs.prefers_questions_in_subject is True:
            subject_tips.append("Use a QUESTION in the subject line")
        elif prefs.prefers_questions_in_subject is False:
            subject_tips.append("Avoid questions in subject - use statements")

        if subject_tips:
            enhancements.append(f"SUBJECT: {'; '.join(subject_tips)}")

        # Body preferences
        body_tips = []
        if prefs.preferred_body_length == 'short':
            body_tips.append("Keep email BRIEF (under 100 words)")
        elif prefs.preferred_body_length == 'long':
            body_tips.append("User prefers DETAILED emails (150+ words)")

        if prefs.preferred_tone == 'casual':
            body_tips.append("Use CASUAL, friendly tone")
        elif prefs.preferred_tone == 'formal':
            body_tips.append("Use FORMAL, professional tone")

        if prefs.preferred_personalization_level == 'high':
            body_tips.append("Include MULTIPLE personalization variables")
        elif prefs.preferred_personalization_level == 'low':
            body_tips.append("Minimize personalization - keep it general")

        if prefs.prefers_bullet_points:
            body_tips.append("Use BULLET POINTS to organize information")

        if prefs.prefers_simple_language:
            body_tips.append("Use SIMPLE, clear language - avoid jargon")

        if body_tips:
            enhancements.append(f"BODY: {'; '.join(body_tips)}")

        # CTA preferences
        cta_tips = []
        if prefs.preferred_cta_strength == 'soft':
            cta_tips.append("Use a SOFT CTA (e.g., 'let me know if interested')")
        elif prefs.preferred_cta_strength == 'strong':
            cta_tips.append("Use a STRONG CTA (e.g., 'let's schedule a call this week')")

        if cta_tips:
            enhancements.append(f"CTA: {'; '.join(cta_tips)}")

        enhancements.append(f"(Confidence: {prefs.confidence:.0%} based on {prefs.samples_analyzed} edits)")

        return original_prompt + "\n".join(enhancements)

    async def get_example_templates(
        self,
        user_id: str,
        limit: int = 3
    ) -> List[Dict[str, str]]:
        """
        Retrieve most recent edited templates for example-based prompting.

        Returns list of {edited_subject, edited_body, created_at} dicts.
        Used for showing the AI actual examples instead of abstract preferences.
        """
        if not self._async_supabase_client:
            return []

        try:
            # Use Supabase query builder to fetch recent edited templates
            result = await self._async_supabase_client.request(
                f"template_edits?user_id=eq.{user_id}&select=edited_subject,edited_body,created_at&order=created_at.desc&limit={limit}",
                'GET'
            )

            if result and isinstance(result, list):
                # Filter out any entries with null values
                return [
                    item for item in result
                    if item.get('edited_subject') and item.get('edited_body')
                ]
            return []

        except Exception as e:
            print(f"Error fetching example templates: {e}")
            return []

    async def enhance_with_examples(
        self,
        original_prompt: str,
        user_id: str
    ) -> str:
        """
        Enhance prompt with actual template examples instead of abstract preferences.

        This is the NEW feedback loop closure - we show the AI exactly what
        templates the user edited and approved, instructing it to make new ones
        very similar with minimal changes.
        """
        examples = await self.get_example_templates(user_id, limit=3)

        if not examples:
            # No examples yet - return original prompt
            return original_prompt

        enhancements = ["\n\n[TEMPLATE EXAMPLES - From your previous edits]"]
        enhancements.append("The user has edited templates before. Here are examples of their approved style:\n")

        for i, example in enumerate(examples, 1):
            enhancements.append(f"EXAMPLE {i}:")
            enhancements.append(f"SUBJECT: {example['edited_subject']}")
            enhancements.append(f"BODY:")
            enhancements.append(example['edited_body'])
            enhancements.append("")  # Blank line between examples

        enhancements.append("INSTRUCTIONS: Generate new templates using a VERY similar structure, tone,")
        enhancements.append("and style to these examples. Change ONLY what's necessary for the new")
        enhancements.append("context (company name, specific details, CTA). Keep the same:")
        enhancements.append("- Subject line format and length")
        enhancements.append("- Email structure and paragraph breaks")
        enhancements.append("- Tone and language style")
        enhancements.append("- Formatting (bullets, spacing, etc.)")
        enhancements.append("")
        enhancements.append(f"(Based on {len(examples)} recent template(s) you edited)")

        return original_prompt + "\n".join(enhancements)

    # =========================================================================
    # HELPERS & REPORTING
    # =========================================================================

    def _analysis_to_dict(self, analysis: Optional[EditAnalysis]) -> Dict[str, Any]:
        """Convert EditAnalysis to dictionary."""
        if not analysis:
            return {}
        return {
            'subject_changes': {
                'shortened': analysis.subject_shortened,
                'lengthened': analysis.subject_lengthened,
                'question_added': analysis.subject_question_added,
                'question_removed': analysis.subject_question_removed,
                'personalization_added': analysis.subject_personalization_added,
            },
            'body_changes': {
                'shortened': analysis.body_shortened,
                'lengthened': analysis.body_lengthened,
                'more_casual': analysis.body_more_casual,
                'more_formal': analysis.body_more_formal,
                'added_personalization': analysis.body_added_personalization,
                'removed_personalization': analysis.body_removed_personalization,
                'added_bullet_points': analysis.body_added_bullet_points,
                'simplified_language': analysis.body_simplified_language,
            },
            'cta_changes': {
                'made_softer': analysis.cta_made_softer,
                'made_stronger': analysis.cta_made_stronger,
            },
            'overall': {
                'significant_rewrite': analysis.significant_rewrite,
                'minor_tweaks': analysis.minor_tweaks,
            }
        }

    def _preferences_to_dict(self, prefs: Optional[UserPreferences]) -> Dict[str, Any]:
        """Convert UserPreferences to dictionary."""
        if not prefs:
            return {}
        return {
            'subject': {
                'preferred_length': prefs.preferred_subject_length,
                'prefers_questions': prefs.prefers_questions_in_subject,
                'prefers_personalized': prefs.prefers_personalized_subject,
            },
            'body': {
                'preferred_length': prefs.preferred_body_length,
                'preferred_tone': prefs.preferred_tone,
                'personalization_level': prefs.preferred_personalization_level,
                'prefers_bullet_points': prefs.prefers_bullet_points,
                'prefers_simple_language': prefs.prefers_simple_language,
            },
            'cta': {
                'preferred_strength': prefs.preferred_cta_strength,
                'preferred_types': prefs.preferred_cta_types,
            },
            'meta': {
                'confidence': prefs.confidence,
                'samples_analyzed': prefs.samples_analyzed,
            }
        }

    def get_feedback_summary(self, user_id: str) -> Dict[str, Any]:
        """Get a summary of the feedback system status."""
        prefs = self._user_preferences.get(user_id)
        user_templates = [t for t in self._templates.values() if t.user_id == user_id]

        return {
            'templates_tracked': len(user_templates),
            'templates_edited': len([t for t in user_templates if t.was_edited]),
            'preferences': self._preferences_to_dict(prefs),
            'learning_status': (
                'Not enough data' if not prefs or prefs.confidence < 0.2
                else 'Learning' if prefs.confidence < 0.6
                else 'Confident'
            ),
            'next_template_will_use': (
                self.enhance_style_prompt('', user_id).strip()
                if prefs and prefs.confidence >= 0.2
                else 'No preferences learned yet'
            ),
        }

    # =========================================================================
    # QUERY TRACKING (unchanged from before)
    # =========================================================================

    def record_query_executed(self, query: str, leads_found: int, campaign_id: str) -> None:
        """Record when a lead generation query is executed."""
        self._query_cache[query] = {
            'query': query,
            'leads_found': leads_found,
            'leads_emailed': 0,
            'campaign_id': campaign_id,
        }

    def get_query_suggestions(self, partial_query: str = '') -> List[Dict[str, Any]]:
        """Get query suggestions based on past performance."""
        suggestions = []
        for query, data in self._query_cache.items():
            if data['leads_found'] > 0:
                conversion = data['leads_emailed'] / data['leads_found']
                if conversion > 0.3 or not partial_query:
                    suggestions.append({
                        'query': query,
                        'leads_found': data['leads_found'],
                        'conversion_rate': conversion,
                    })

        suggestions.sort(key=lambda x: x.get('conversion_rate', 0), reverse=True)

        if partial_query:
            suggestions = [s for s in suggestions if partial_query.lower() in s['query'].lower()]

        return suggestions[:5]

    def get_keyword_recommendations(self) -> List[str]:
        """Get keywords from successful queries."""
        all_words = []
        for data in self._query_cache.values():
            if data['leads_found'] > 0:
                words = data['query'].lower().split()
                all_words.extend(words)

        # Count and filter
        counts = Counter(all_words)
        stop_words = {'find', 'me', 'who', 'are', 'the', 'a', 'an', 'in', 'at', 'for', 'to'}
        return [w for w, _ in counts.most_common(10) if w not in stop_words and len(w) > 2]


# Global instance
_feedback_service: Optional[FeedbackLoopService] = None


def get_feedback_service(async_supabase_client=None) -> FeedbackLoopService:
    """Get the global feedback service instance."""
    global _feedback_service
    if _feedback_service is None:
        _feedback_service = FeedbackLoopService(async_supabase_client)
    elif async_supabase_client and not _feedback_service._async_supabase_client:
        # Update the client if it wasn't set initially
        _feedback_service._async_supabase_client = async_supabase_client
    return _feedback_service
