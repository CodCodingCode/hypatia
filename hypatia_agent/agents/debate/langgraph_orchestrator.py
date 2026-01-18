"""
LangGraph Debate Orchestrator - Multi-agent debate using LangGraph.

This implements the same debate flow as the original orchestrator but using
LangGraph for explicit state management and agent orchestration.

Flow (as a graph):
    draft_initial → critique_cta → revise_for_cta → critique_bp → revise_for_bp
                                                                        ↓
                                    (loop back if rounds remaining) ←──┘
                                                                        ↓
                                                              parse_template → END

This version includes:
- Explicit state management via TypedDict
- Communication log for agent handoffs (required for Foresters challenge)
- Conditional edges for round-based looping
- Full visibility into agent reasoning
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import TypedDict, Annotated, Literal, Optional
import operator

from langgraph.graph import StateGraph, END

from ...services.llm_client import LLMClient
from ...models.email_facts import ExtractedEmailFacts
from ..fact_extractor import FactExtractorAgent
from .style_agent import StyleDebateAgent
from .cta_agent import CTADebateAgent
from .best_practice_agent import BestPracticeDebateAgent


@dataclass
class EmailTemplate:
    """Final email template with placeholders."""
    subject: str
    body: str
    placeholders: list[str]

    def fill(self, **kwargs) -> dict:
        """Fill placeholders with actual values."""
        subject = self.subject
        body = self.body
        for key, value in kwargs.items():
            placeholder = "{" + key + "}"
            subject = subject.replace(placeholder, str(value))
            body = body.replace(placeholder, str(value))
        return {"subject": subject, "body": body}


@dataclass
class AgentMessage:
    """A message in the agent communication log."""
    timestamp: str
    from_agent: str
    to_agent: str
    message_type: str  # 'draft', 'critique', 'revision', 'handoff'
    content: str
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "from": self.from_agent,
            "to": self.to_agent,
            "type": self.message_type,
            "content": self.content,
            "metadata": self.metadata,
        }


def add_messages(existing: list, new: list) -> list:
    """Reducer to append messages to the communication log."""
    return existing + new


class DebateState(TypedDict):
    """State schema for the debate graph."""
    # Core debate state
    draft: str
    cta: str
    style_prompt: str
    sample_emails: list

    # Grounded facts for preventing hallucination
    grounded_facts: str

    # Round tracking
    current_round: int
    max_rounds: int

    # Feedback storage
    cta_feedback: str
    bp_feedback: str

    # Communication log (with reducer for appending)
    communication_log: Annotated[list[dict], add_messages]

    # Final output
    final_template: Optional[dict]

    # Config
    verbose: bool


class LangGraphDebateOrchestrator:
    """
    Orchestrates multi-agent debate using LangGraph.

    This provides the same functionality as DebateOrchestrator but with:
    - Explicit graph-based state management
    - Visible communication log between agents
    - LangGraph framework compliance for Foresters challenge
    """

    def __init__(self, llm_client: LLMClient = None, custom_practices: str = None):
        self.llm = llm_client or LLMClient()
        self.fact_extractor = FactExtractorAgent(self.llm)  # For grounded generation
        self.style_agent = StyleDebateAgent(self.llm)
        self.cta_agent = CTADebateAgent(self.llm)
        self.best_practice_agent = BestPracticeDebateAgent(self.llm, custom_practices)

        # Build the graph
        self.graph = self._build_graph()
        self.app = self.graph.compile()

    def _build_graph(self) -> StateGraph:
        """Build the LangGraph state graph for the debate."""
        graph = StateGraph(DebateState)

        # Add nodes
        graph.add_node("draft_initial", self._node_draft_initial)
        graph.add_node("critique_cta", self._node_critique_cta)
        graph.add_node("revise_for_cta", self._node_revise_for_cta)
        graph.add_node("critique_bp", self._node_critique_bp)
        graph.add_node("revise_for_bp", self._node_revise_for_bp)
        graph.add_node("parse_template", self._node_parse_template)

        # Set entry point
        graph.set_entry_point("draft_initial")

        # Add edges
        graph.add_edge("draft_initial", "critique_cta")
        graph.add_edge("critique_cta", "revise_for_cta")
        graph.add_edge("revise_for_cta", "critique_bp")
        graph.add_edge("critique_bp", "revise_for_bp")

        # Conditional edge: loop back or finish
        graph.add_conditional_edges(
            "revise_for_bp",
            self._should_continue,
            {
                "continue": "critique_cta",
                "finish": "parse_template",
            }
        )

        graph.add_edge("parse_template", END)

        return graph

    def _log_message(
        self,
        from_agent: str,
        to_agent: str,
        message_type: str,
        content: str,
        metadata: dict = None
    ) -> dict:
        """Create a communication log entry."""
        return AgentMessage(
            timestamp=datetime.now().isoformat(),
            from_agent=from_agent,
            to_agent=to_agent,
            message_type=message_type,
            content=content[:500] + "..." if len(content) > 500 else content,
            metadata=metadata or {},
        ).to_dict()

    async def _node_draft_initial(self, state: DebateState) -> dict:
        """StyleAgent creates initial draft using grounded facts."""
        if state.get("verbose"):
            print("  [LangGraph] Node: draft_initial - StyleAgent drafting with grounded facts...")

        draft = await self.style_agent.respond({
            "mode": "draft",
            "cta": state["cta"],
            "style_prompt": state["style_prompt"],
            "sample_emails": state["sample_emails"],
            "grounded_facts": state["grounded_facts"],  # Pass grounded facts
        })

        log_entry = self._log_message(
            from_agent="StyleAgent",
            to_agent="CTAAgent",
            message_type="draft",
            content=draft,
            metadata={"round": 0, "action": "initial_draft"}
        )

        if state.get("verbose"):
            print(f"  [LangGraph] StyleAgent created draft ({len(draft)} chars)")

        return {
            "draft": draft,
            "current_round": 1,
            "communication_log": [log_entry],
        }

    async def _node_critique_cta(self, state: DebateState) -> dict:
        """CTAAgent critiques the current draft."""
        if state.get("verbose"):
            print(f"  [LangGraph] Node: critique_cta (Round {state['current_round']}) - CTAAgent critiquing...")

        feedback = await self.cta_agent.respond({
            "draft": state["draft"],
            "cta": state["cta"],
        })

        log_entry = self._log_message(
            from_agent="CTAAgent",
            to_agent="StyleAgent",
            message_type="critique",
            content=feedback,
            metadata={
                "round": state["current_round"],
                "critique_type": "cta_effectiveness"
            }
        )

        if state.get("verbose"):
            print(f"  [LangGraph] CTAAgent feedback: {feedback[:100]}...")

        return {
            "cta_feedback": feedback,
            "communication_log": [log_entry],
        }

    async def _node_revise_for_cta(self, state: DebateState) -> dict:
        """StyleAgent revises based on CTA feedback, maintaining grounding."""
        if state.get("verbose"):
            print(f"  [LangGraph] Node: revise_for_cta - StyleAgent revising...")

        draft = await self.style_agent.respond({
            "mode": "revise",
            "draft": state["draft"],
            "feedback": state["cta_feedback"],
            "style_prompt": state["style_prompt"],
            "grounded_facts": state["grounded_facts"],  # Maintain grounding during revision
        })

        log_entry = self._log_message(
            from_agent="StyleAgent",
            to_agent="BestPracticeAgent",
            message_type="revision",
            content=draft,
            metadata={
                "round": state["current_round"],
                "revision_reason": "cta_feedback"
            }
        )

        if state.get("verbose"):
            print(f"  [LangGraph] StyleAgent revised for CTA ({len(draft)} chars)")

        return {
            "draft": draft,
            "communication_log": [log_entry],
        }

    async def _node_critique_bp(self, state: DebateState) -> dict:
        """BestPracticeAgent critiques the current draft."""
        if state.get("verbose"):
            print(f"  [LangGraph] Node: critique_bp - BestPracticeAgent critiquing...")

        feedback = await self.best_practice_agent.respond({
            "draft": state["draft"],
        })

        log_entry = self._log_message(
            from_agent="BestPracticeAgent",
            to_agent="StyleAgent",
            message_type="critique",
            content=feedback,
            metadata={
                "round": state["current_round"],
                "critique_type": "best_practices"
            }
        )

        if state.get("verbose"):
            print(f"  [LangGraph] BestPracticeAgent feedback: {feedback[:100]}...")

        return {
            "bp_feedback": feedback,
            "communication_log": [log_entry],
        }

    async def _node_revise_for_bp(self, state: DebateState) -> dict:
        """StyleAgent revises based on best practice feedback, maintaining grounding."""
        if state.get("verbose"):
            print(f"  [LangGraph] Node: revise_for_bp - StyleAgent revising...")

        draft = await self.style_agent.respond({
            "mode": "revise",
            "draft": state["draft"],
            "feedback": state["bp_feedback"],
            "style_prompt": state["style_prompt"],
            "grounded_facts": state["grounded_facts"],  # Maintain grounding during revision
        })

        # Determine next recipient based on whether we continue
        next_round = state["current_round"] + 1
        will_continue = next_round <= state["max_rounds"]
        next_agent = "CTAAgent" if will_continue else "Parser"

        log_entry = self._log_message(
            from_agent="StyleAgent",
            to_agent=next_agent,
            message_type="revision" if will_continue else "handoff",
            content=draft,
            metadata={
                "round": state["current_round"],
                "revision_reason": "best_practice_feedback",
                "rounds_remaining": state["max_rounds"] - state["current_round"]
            }
        )

        if state.get("verbose"):
            print(f"  [LangGraph] StyleAgent revised for BP ({len(draft)} chars)")
            if will_continue:
                print(f"  [LangGraph] Continuing to round {next_round}...")
            else:
                print(f"  [LangGraph] Debate complete, moving to parse...")

        return {
            "draft": draft,
            "current_round": next_round,
            "communication_log": [log_entry],
        }

    def _should_continue(self, state: DebateState) -> Literal["continue", "finish"]:
        """Decide whether to continue debating or finish."""
        if state["current_round"] <= state["max_rounds"]:
            return "continue"
        return "finish"

    async def _node_parse_template(self, state: DebateState) -> dict:
        """Parse the final draft into an EmailTemplate."""
        if state.get("verbose"):
            print("  [LangGraph] Node: parse_template - Extracting final template...")

        template = self._parse_draft(state["draft"])

        log_entry = self._log_message(
            from_agent="Parser",
            to_agent="Output",
            message_type="handoff",
            content=f"Subject: {template.subject}\nPlaceholders: {template.placeholders}",
            metadata={
                "total_rounds": state["max_rounds"],
                "placeholders_found": template.placeholders
            }
        )

        if state.get("verbose"):
            print(f"  [LangGraph] Final template: {template.subject}")

        return {
            "final_template": {
                "subject": template.subject,
                "body": template.body,
                "placeholders": template.placeholders,
            },
            "communication_log": [log_entry],
        }

    def _parse_draft(self, draft: str) -> EmailTemplate:
        """Parse a draft response into an EmailTemplate."""
        subject = ""
        body = ""

        subject_match = re.search(r'SUBJECT:\s*(.+?)(?:\n|BODY:)', draft, re.IGNORECASE)
        if subject_match:
            subject = subject_match.group(1).strip()

        body_match = re.search(r'BODY:\s*(.+)', draft, re.IGNORECASE | re.DOTALL)
        if body_match:
            body = body_match.group(1).strip()
        else:
            if subject_match:
                body = draft[subject_match.end():].strip()
            else:
                body = draft.strip()

        if not subject:
            subject = "Quick question"

        placeholders = list(set(re.findall(r'\{(\w+)\}', subject + body)))

        return EmailTemplate(
            subject=subject,
            body=body,
            placeholders=placeholders,
        )

    async def run_debate(
        self,
        cta: str,
        style_prompt: str,
        sample_emails: list = None,
        max_rounds: int = 2,
        verbose: bool = True,
    ) -> tuple[EmailTemplate, list[dict]]:
        """
        Run the debate to create an email template with fact-grounded generation.

        Args:
            cta: What we want the recipient to do
            style_prompt: Analysis of user's writing style
            sample_emails: Example emails from the user
            max_rounds: Number of critique/revision cycles
            verbose: Print progress to console

        Returns:
            Tuple of (EmailTemplate, communication_log)
        """
        if verbose:
            print("  [LangGraph] Step 1: Extracting facts from sample emails...")

        # FACT EXTRACTION: Extract verifiable facts from sample emails first
        extracted_facts = await self.fact_extractor.extract_facts(
            sample_emails=sample_emails or [],
            cta=cta
        )
        grounded_facts = extracted_facts.to_grounding_prompt()

        if verbose:
            print(f"  [LangGraph] Extracted facts: {len(extracted_facts.value_propositions)} value props, {len(extracted_facts.specific_claims)} claims")
            print("  [LangGraph] Step 2: Starting grounded email template debate...")
            print(f"  [LangGraph] Max rounds: {max_rounds}")

        initial_state: DebateState = {
            "draft": "",
            "cta": cta,
            "style_prompt": style_prompt,
            "sample_emails": sample_emails or [],
            "grounded_facts": grounded_facts,  # Pass extracted facts to state
            "current_round": 0,
            "max_rounds": max_rounds,
            "cta_feedback": "",
            "bp_feedback": "",
            "communication_log": [],
            "final_template": None,
            "verbose": verbose,
        }

        # Run the graph
        final_state = await self.app.ainvoke(initial_state)

        # Extract results
        template_dict = final_state["final_template"]
        template = EmailTemplate(
            subject=template_dict["subject"],
            body=template_dict["body"],
            placeholders=template_dict["placeholders"],
        )

        communication_log = final_state["communication_log"]

        if verbose:
            print(f"  [LangGraph] Debate complete!")
            print(f"  [LangGraph] Communication log: {len(communication_log)} messages")

        return template, communication_log

    def get_graph_visualization(self) -> str:
        """Get a text representation of the graph for documentation."""
        return """
LangGraph Debate Flow:
======================

    ┌─────────────────┐
    │  draft_initial  │ (StyleAgent creates initial template)
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │  critique_cta   │ (CTAAgent evaluates CTA effectiveness)
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │ revise_for_cta  │ (StyleAgent incorporates CTA feedback)
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │  critique_bp    │ (BestPracticeAgent checks email practices)
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │ revise_for_bp   │ (StyleAgent incorporates BP feedback)
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐     rounds remaining?
    │ should_continue │────────────────────┐
    └────────┬────────┘                    │
             │ no                          │ yes
             ▼                             │
    ┌─────────────────┐                    │
    │ parse_template  │                    │
    └────────┬────────┘                    │
             │                             │
             ▼                             │
    ┌─────────────────┐                    │
    │      END        │      ◄─────────────┘
    └─────────────────┘      (loop back to critique_cta)

Agents:
- StyleAgent: Primary writer, creates and revises drafts
- CTAAgent: Evaluates call-to-action clarity and effectiveness
- BestPracticeAgent: Checks cold email best practices

State Management:
- draft: Current email template text
- cta_feedback: Last CTA critique
- bp_feedback: Last best practice critique
- current_round: Loop counter
- communication_log: Full agent message history
"""


# Convenience function for backward compatibility
async def run_langgraph_debate(
    cta: str,
    style_prompt: str,
    sample_emails: list = None,
    max_rounds: int = 2,
    verbose: bool = True,
    llm_client: LLMClient = None,
    custom_practices: str = None,
) -> tuple[EmailTemplate, list[dict]]:
    """
    Convenience function to run a LangGraph debate.

    Returns:
        Tuple of (EmailTemplate, communication_log)
    """
    orchestrator = LangGraphDebateOrchestrator(llm_client, custom_practices)
    return await orchestrator.run_debate(
        cta=cta,
        style_prompt=style_prompt,
        sample_emails=sample_emails,
        max_rounds=max_rounds,
        verbose=verbose,
    )
