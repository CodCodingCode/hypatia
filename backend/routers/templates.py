"""
Template generation endpoints.
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException

from schemas.templates import TemplateGenerateRequest
from backend_config import is_valid_uuid
from utils.campaigns import create_campaign_if_new
from dependencies import get_async_supabase

from async_supabase import save_generated_template, get_generated_template
from hypatia_agent.services.template_generator import TemplateGenerator
from hypatia_agent.services.llm_client import LLMClient

from analytics import track_template_generation_completed
from feedback_loop import get_feedback_service

router = APIRouter(prefix="/templates", tags=["Templates"])


@router.post("/generate")
async def generate_template_endpoint(request: TemplateGenerateRequest):
    """
    Generate an email template using a single LLM call.

    Creates an optimized email template with placeholders using
    fact extraction for grounding and comprehensive prompt guidance.
    Saves generated template to Supabase for later retrieval.
    """
    print(f"[TemplateGen] Generating template for campaign {request.campaign_id}")
    print(f"[TemplateGen] CTA: {request.cta[:100]}..." if len(request.cta) > 100 else f"[TemplateGen] CTA: {request.cta}")

    # Create campaign if it's a new one (has 'new_' prefix)
    campaign_id = create_campaign_if_new(request.user_id, request.campaign_id)

    # Initialize the simple template generator
    llm_client = LLMClient()
    generator = TemplateGenerator(llm_client)

    # Get feedback service for "ever improving" enhancements
    feedback_service = get_feedback_service()

    try:
        # Build style prompt, incorporating current template if provided
        style_prompt = request.style_prompt

        # FEEDBACK LOOP: Enhance prompt with example templates
        style_prompt = await feedback_service.enhance_with_examples(style_prompt, request.user_id)
        print(f"[TemplateGen] Enhanced style prompt with example templates")
        if request.current_subject or request.current_body:
            style_prompt += f"\n\nThe user has a current draft they want to improve:\n"
            if request.current_subject:
                style_prompt += f"CURRENT SUBJECT: {request.current_subject}\n"
            if request.current_body:
                style_prompt += f"CURRENT BODY:\n{request.current_body}\n"
            style_prompt += "\nUse this as inspiration but improve upon it."

        # Generate template with single LLM call
        template, communication_log = await generator.generate(
            cta=request.cta,
            style_prompt=style_prompt,
            sample_emails=request.sample_emails,
            verbose=True,
        )

        print(f"[TemplateGen] Generated template: {template.subject}")
        print(f"[TemplateGen] Communication log: {len(communication_log)} messages")

        template_dict = {
            "subject": template.subject,
            "body": template.body,
            "placeholders": template.placeholders,
        }

        # Save generated template to Supabase
        async_client = get_async_supabase()
        save_result = await save_generated_template(
            client=async_client,
            user_id=request.user_id,
            campaign_id=campaign_id,
            template=template_dict,
            cta=request.cta,
            style_prompt=request.style_prompt,
        )
        print(f"[TemplateGen] Saved template to Supabase: {save_result}")

        # Track template generation
        await track_template_generation_completed(
            request.user_id,
            campaign_id,
            request.cta[:50] if request.cta else None,
            0,  # generation_time_ms
            True,
            len(template.body) if template.body else 0
        )

        # FEEDBACK LOOP: Record template for quality tracking
        template_id = f"{campaign_id}_{int(datetime.now().timestamp())}"
        feedback_service.record_template_generated(
            template_id=template_id,
            campaign_id=campaign_id,
            user_id=request.user_id,
            subject=template.subject or '',
            body=template.body or '',
        )

        return {
            "template": template_dict,
            "template_id": template_id,  # For tracking edits
            "saved": save_result,
            "communication_log": communication_log,  # Agent interaction history for demo
            "feedback_enhanced": True,  # Indicates feedback loop was applied
            "campaign_id": campaign_id,  # Return actual UUID so frontend can update
        }

    except Exception as e:
        print(f"[TemplateGen] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Template generation failed: {str(e)}")


@router.get("/{campaign_id}")
async def get_template(campaign_id: str):
    """
    Retrieve saved generated template for a campaign.
    """
    async_client = get_async_supabase()
    template = await get_generated_template(
        client=async_client,
        campaign_id=campaign_id,
    )
    if not template:
        return {"template": None}

    return {
        "template": {
            "subject": template.get('subject', ''),
            "body": template.get('body', ''),
            "placeholders": template.get('placeholders', []),
            "cta_used": template.get('cta_used', ''),
            "created_at": template.get('created_at', ''),
        }
    }


@router.get("/user/{user_id}")
async def get_user_templates(user_id: str):
    """
    Retrieve all saved generated templates for a user.
    Returns templates with their associated campaign_id for grouping.
    """
    # Validate user_id is a valid UUID (reject "null" or invalid strings)
    if not is_valid_uuid(user_id):
        return {"templates": [], "count": 0, "error": "Invalid user_id"}

    try:
        async_client = get_async_supabase()
        result = await async_client.request(
            f"generated_templates?user_id=eq.{user_id}&order=created_at.desc",
            'GET'
        )
        templates = result or []
        return {
            "templates": [
                {
                    "id": t.get('id'),
                    "campaign_id": t.get('campaign_id'),
                    "subject": t.get('subject', ''),
                    "body": t.get('body', ''),
                    "placeholders": t.get('placeholders', []),
                    "cta_used": t.get('cta_used', ''),
                    "created_at": t.get('created_at', ''),
                }
                for t in templates
            ],
            "count": len(templates)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
