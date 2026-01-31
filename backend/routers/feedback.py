"""
Feedback loop endpoints - "Ever Improving" AI.
"""

from fastapi import APIRouter

from schemas.feedback import RecordEditRequest
from dependencies import get_async_supabase

from feedback_loop import get_feedback_service

router = APIRouter(prefix="/feedback", tags=["Feedback"])


@router.get("/{user_id}")
async def get_feedback_summary(user_id: str):
    """
    Get feedback loop summary showing how the AI is improving.

    Returns:
    - Templates analyzed and their quality scores
    - Learned patterns from user behavior
    - Style recommendations for future generations
    - Query keyword recommendations

    This endpoint demonstrates the "ever improving" system for the
    Amplitude hackathon prize track.
    """
    feedback_service = get_feedback_service()
    summary = feedback_service.get_feedback_summary(user_id)

    return {
        "user_id": user_id,
        "feedback_loop_active": True,
        "summary": summary,
        "description": {
            "templates_analyzed": "Number of templates tracked for quality",
            "high_performing_templates": "Templates with low edit rate + high engagement",
            "style_recommendations": "Learned preferences applied to future generations",
            "patterns_learned": "Winning patterns extracted from successful templates",
        }
    }


@router.post("/record-edit")
async def record_template_edit(request: RecordEditRequest):
    """
    Record when a user edits an AI-generated template.

    This analyzes exactly what the user changed and updates their
    preference profile so future templates better match their style.

    Tracks:
    - Subject length preference (short/medium/long)
    - Body length preference
    - Tone preference (casual/professional/formal)
    - CTA strength preference (soft/medium/strong)
    - Personalization preference
    - Bullet point preference
    - Simple language preference

    Also saves full edit history to database for analytics.
    """
    async_client = get_async_supabase()
    feedback_service = get_feedback_service(async_client)
    result = await feedback_service.record_template_edited(
        template_id=request.template_id,
        new_subject=request.new_subject,
        new_body=request.new_body,
        user_id=request.user_id,
    )

    return {
        "success": True,
        "template_id": request.template_id,
        "edit_analysis": result.get('analysis', {}),
        "preferences_updated": result.get('preferences_updated', False),
        "current_preferences": result.get('current_preferences', {}),
        "message": "Your preferences have been updated. Future templates will better match your style.",
    }


@router.get("/query-suggestions")
async def get_query_suggestions(partial_query: str = ''):
    """
    Get query suggestions based on what has worked before.

    Returns queries ranked by conversion rate (leads → sent emails).
    """
    feedback_service = get_feedback_service()

    return {
        "suggestions": feedback_service.get_query_suggestions(partial_query),
        "top_keywords": feedback_service.get_keyword_recommendations(),
    }
