"""
LangGraph Manager - Multi-agent orchestration for email campaigns.

This implements the full email campaign workflow using LangGraph:

    load_campaign → find_people → write_emails → plan_followups → END

Each node delegates to specialized agents with full state tracking
and communication logging for the Foresters Financial challenge.

Features:
- 4+ specialized agents with clear handoffs
- Full communication log showing agent reasoning
- State management via LangGraph TypedDict
- Conditional routing (Aviato → Clado fallback)
"""

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import TypedDict, Annotated, Literal, Optional

from langgraph.graph import StateGraph, END

from .services import SupabaseClient
from .services.llm_client import LLMClient
from .agents import PeopleFinderAgent, WriterAgent, FollowupAgent
from .agents.debate.langgraph_orchestrator import LangGraphDebateOrchestrator


def append_logs(existing: list, new: list) -> list:
    """Reducer to append to communication log."""
    return existing + new


def append_contacts(existing: list, new: list) -> list:
    """Reducer to append contacts."""
    return existing + new


def append_emails(existing: list, new: list) -> list:
    """Reducer to append emails."""
    return existing + new


@dataclass
class AgentCommunication:
    """A message in the agent communication log."""
    timestamp: str
    from_agent: str
    to_agent: str
    action: str
    summary: str
    details: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "from": self.from_agent,
            "to": self.to_agent,
            "action": self.action,
            "summary": self.summary,
            "details": self.details,
        }


class CampaignState(TypedDict):
    """State schema for the campaign workflow graph."""
    # User context
    user_id: str
    campaign_id: Optional[str]

    # Campaign inputs
    cta: str
    style_prompt: str
    people_target: str
    sample_emails: list

    # Agent outputs
    contacts: Annotated[list, append_contacts]
    emails: Annotated[list, append_emails]
    followup_plan: list

    # Communication log
    communication_log: Annotated[list[dict], append_logs]

    # Debate sub-log (from template generation)
    debate_log: list

    # Config
    verbose: bool
    max_contacts: int


class LangGraphManagerAgent:
    """
    Manager agent using LangGraph for multi-agent orchestration.

    This orchestrates 4+ specialized agents:
    1. DataLoaderAgent - Loads campaign data from Supabase
    2. PeopleFinderAgent - Finds contacts (Aviato → Clado fallback)
    3. WriterAgent - Writes personalized emails (uses DebateOrchestrator)
    4. FollowupAgent - Creates follow-up sequences

    Provides full communication logging for Foresters Financial challenge.
    """

    def __init__(self):
        self.supabase = SupabaseClient()
        self.llm = LLMClient()
        self.people_finder = PeopleFinderAgent(self.supabase)
        self.writer = WriterAgent(self.supabase)
        self.followup = FollowupAgent(self.supabase)
        self.debate_orchestrator = LangGraphDebateOrchestrator(self.llm)

        # Build the graph
        self.graph = self._build_graph()
        self.app = self.graph.compile()

    def _build_graph(self) -> StateGraph:
        """Build the LangGraph workflow for campaign execution."""
        graph = StateGraph(CampaignState)

        # Add nodes
        graph.add_node("load_campaign", self._node_load_campaign)
        graph.add_node("find_people", self._node_find_people)
        graph.add_node("write_emails", self._node_write_emails)
        graph.add_node("plan_followups", self._node_plan_followups)
        graph.add_node("generate_output", self._node_generate_output)

        # Set entry point
        graph.set_entry_point("load_campaign")

        # Add edges (linear flow)
        graph.add_edge("load_campaign", "find_people")
        graph.add_edge("find_people", "write_emails")
        graph.add_edge("write_emails", "plan_followups")
        graph.add_edge("plan_followups", "generate_output")
        graph.add_edge("generate_output", END)

        return graph

    def _log(
        self,
        from_agent: str,
        to_agent: str,
        action: str,
        summary: str,
        details: dict = None
    ) -> dict:
        """Create a communication log entry."""
        return AgentCommunication(
            timestamp=datetime.now().isoformat(),
            from_agent=from_agent,
            to_agent=to_agent,
            action=action,
            summary=summary,
            details=details or {},
        ).to_dict()

    async def _node_load_campaign(self, state: CampaignState) -> dict:
        """Load campaign data from Supabase."""
        verbose = state.get("verbose", True)
        campaign_id = state.get("campaign_id")

        if verbose:
            print("[LangGraph Manager] Node: load_campaign")

        logs = []

        # If we have a campaign_id, load from Supabase
        if campaign_id:
            if verbose:
                print(f"  Loading campaign {campaign_id} from Supabase...")

            campaign_data = self.supabase.get_full_campaign_data(campaign_id)

            cta_data = campaign_data.get("cta") or {}
            style_data = campaign_data.get("style") or {}
            contact_data = campaign_data.get("contacts") or {}
            sample_emails = campaign_data.get("emails") or []

            cta = cta_data.get("cta_description", state.get("cta", ""))
            style_prompt = style_data.get("style_analysis_prompt", state.get("style_prompt", ""))
            people_target = contact_data.get("contact_description", state.get("people_target", ""))

            logs.append(self._log(
                from_agent="DataLoaderAgent",
                to_agent="PeopleFinderAgent",
                action="load_campaign_data",
                summary=f"Loaded campaign data: CTA='{cta[:50]}...', Target='{people_target[:50]}...'",
                details={
                    "campaign_id": campaign_id,
                    "sample_emails_count": len(sample_emails),
                    "has_cta": bool(cta),
                    "has_style": bool(style_prompt),
                    "has_target": bool(people_target),
                }
            ))

            if verbose:
                print(f"  Loaded: CTA={bool(cta)}, Style={bool(style_prompt)}, Target={bool(people_target)}")

            return {
                "cta": cta,
                "style_prompt": style_prompt,
                "people_target": people_target,
                "sample_emails": sample_emails,
                "communication_log": logs,
            }
        else:
            # Use provided state values
            logs.append(self._log(
                from_agent="DataLoaderAgent",
                to_agent="PeopleFinderAgent",
                action="use_provided_data",
                summary="Using provided campaign parameters (no campaign_id)",
                details={
                    "has_cta": bool(state.get("cta")),
                    "has_style": bool(state.get("style_prompt")),
                    "has_target": bool(state.get("people_target")),
                }
            ))

            return {"communication_log": logs}

    async def _node_find_people(self, state: CampaignState) -> dict:
        """Find contacts using PeopleFinderAgent."""
        verbose = state.get("verbose", True)
        max_contacts = state.get("max_contacts", 5)

        if verbose:
            print("[LangGraph Manager] Node: find_people")
            print(f"  Target: {state.get('people_target', 'Not specified')[:100]}...")

        logs = []

        # Call PeopleFinderAgent
        contacts = await self.people_finder.find(
            user_id=state["user_id"],
            target_description=state.get("people_target", ""),
            limit=max_contacts,
        )

        # Determine which source was used
        source = "unknown"
        if contacts:
            source = contacts[0].get("source", "aviato")

        logs.append(self._log(
            from_agent="PeopleFinderAgent",
            to_agent="WriterAgent",
            action="find_contacts",
            summary=f"Found {len(contacts)} contacts via {source}",
            details={
                "contacts_found": len(contacts),
                "source": source,
                "target_description": state.get("people_target", "")[:200],
                "contacts_preview": [
                    {"name": c.get("name"), "company": c.get("company")}
                    for c in contacts[:3]
                ],
            }
        ))

        if verbose:
            print(f"  Found {len(contacts)} contacts")
            for c in contacts[:3]:
                print(f"    - {c.get('name', 'Unknown')} @ {c.get('company', 'N/A')}")

        return {
            "contacts": contacts,
            "communication_log": logs,
        }

    async def _node_write_emails(self, state: CampaignState) -> dict:
        """Write personalized emails using WriterAgent (with Debate)."""
        verbose = state.get("verbose", True)
        contacts = state.get("contacts", [])

        if verbose:
            print("[LangGraph Manager] Node: write_emails")
            print(f"  Writing emails for {len(contacts)} contacts...")

        logs = []
        emails = []
        debate_log = []

        # First, run the debate to get a template (if we have style/cta)
        if state.get("cta") and state.get("style_prompt"):
            if verbose:
                print("  Running multi-agent debate for template...")

            template, template_debate_log = await self.debate_orchestrator.run_debate(
                cta=state["cta"],
                style_prompt=state["style_prompt"],
                sample_emails=state.get("sample_emails", []),
                max_rounds=2,
                verbose=verbose,
            )

            debate_log = template_debate_log

            logs.append(self._log(
                from_agent="DebateOrchestrator",
                to_agent="WriterAgent",
                action="generate_template",
                summary=f"Generated template via 3-agent debate: '{template.subject[:50]}...'",
                details={
                    "template_subject": template.subject,
                    "placeholders": template.placeholders,
                    "debate_rounds": 2,
                    "debate_messages": len(template_debate_log),
                }
            ))

        # Write personalized email for each contact
        for i, contact in enumerate(contacts):
            if verbose:
                print(f"  Writing email {i+1}/{len(contacts)} to {contact.get('name', contact.get('email'))}")

            email = await self.writer.write(
                contact=contact,
                cta=state.get("cta", ""),
                style=state.get("style_prompt", ""),
                sample_emails=state.get("sample_emails", []),
            )
            emails.append(email)

        logs.append(self._log(
            from_agent="WriterAgent",
            to_agent="FollowupAgent",
            action="write_personalized_emails",
            summary=f"Wrote {len(emails)} personalized emails",
            details={
                "emails_written": len(emails),
                "recipients": [e.get("to") for e in emails],
            }
        ))

        if verbose:
            print(f"  Wrote {len(emails)} emails")

        return {
            "emails": emails,
            "debate_log": debate_log,
            "communication_log": logs,
        }

    async def _node_plan_followups(self, state: CampaignState) -> dict:
        """Plan follow-up sequences using FollowupAgent."""
        verbose = state.get("verbose", True)
        emails = state.get("emails", [])

        if verbose:
            print("[LangGraph Manager] Node: plan_followups")
            print(f"  Planning follow-ups for {len(emails)} emails...")

        logs = []

        # Call FollowupAgent
        followup_plan = await self.followup.plan(
            emails=emails,
            cta=state.get("cta", ""),
        )

        total_followups = sum(len(p.get("followups", [])) for p in followup_plan)

        logs.append(self._log(
            from_agent="FollowupAgent",
            to_agent="OutputGenerator",
            action="plan_followup_sequences",
            summary=f"Created {total_followups} follow-ups across {len(followup_plan)} email threads",
            details={
                "threads_planned": len(followup_plan),
                "total_followups": total_followups,
                "followup_schedule": [
                    {
                        "recipient": p.get("recipient"),
                        "followup_count": len(p.get("followups", [])),
                    }
                    for p in followup_plan[:3]
                ],
            }
        ))

        if verbose:
            print(f"  Created {total_followups} follow-ups")

        return {
            "followup_plan": followup_plan,
            "communication_log": logs,
        }

    async def _node_generate_output(self, state: CampaignState) -> dict:
        """Generate final output and save files."""
        verbose = state.get("verbose", True)

        if verbose:
            print("[LangGraph Manager] Node: generate_output")

        logs = []

        # Write output files
        result = {
            "contacts": state.get("contacts", []),
            "emails": state.get("emails", []),
            "followup_plan": state.get("followup_plan", []),
        }

        self._write_output_files(result)

        logs.append(self._log(
            from_agent="OutputGenerator",
            to_agent="END",
            action="generate_output_files",
            summary=f"Generated output: {len(result['emails'])} emails, {len(result['followup_plan'])} followup plans",
            details={
                "files_written": ["followup_plan.json", "email.txt"],
                "total_contacts": len(result["contacts"]),
                "total_emails": len(result["emails"]),
            }
        ))

        if verbose:
            print("  Output files written")

        return {"communication_log": logs}

    def _write_output_files(self, result: dict) -> None:
        """Write followup_plan.json and email.txt output files."""
        followup_plan = result.get("followup_plan", [])
        with open("followup_plan.json", "w", encoding="utf-8") as f:
            json.dump(followup_plan, f, indent=2, ensure_ascii=False, default=str)

        emails = result.get("emails", [])
        with open("email.txt", "w", encoding="utf-8") as f:
            for i, email in enumerate(emails):
                if i > 0:
                    f.write("\n" + "=" * 60 + "\n\n")
                f.write(f"To: {email.get('to', '')}\n")
                f.write(f"Subject: {email.get('subject', '')}\n")
                f.write(f"\n{email.get('body', '')}\n")

    async def execute(
        self,
        user_id: str,
        campaign_id: str = None,
        cta: str = "",
        people_target: str = "",
        style_prompt: str = "",
        sample_emails: list = None,
        max_contacts: int = 5,
        verbose: bool = True,
    ) -> dict:
        """
        Execute a campaign using LangGraph orchestration.

        Args:
            user_id: The user's ID
            campaign_id: Optional campaign ID to load from Supabase
            cta: Call-to-action (if not loading from campaign)
            people_target: Description of who to contact
            style_prompt: Writing style prompt
            sample_emails: Example emails for style reference
            max_contacts: Maximum contacts to find
            verbose: Print progress to console

        Returns:
            dict with contacts, emails, followup_plan, and communication_log
        """
        if verbose:
            print("=" * 60)
            print("LangGraph Manager - Multi-Agent Campaign Execution")
            print("=" * 60)
            print()

        initial_state: CampaignState = {
            "user_id": user_id,
            "campaign_id": campaign_id,
            "cta": cta,
            "style_prompt": style_prompt,
            "people_target": people_target,
            "sample_emails": sample_emails or [],
            "contacts": [],
            "emails": [],
            "followup_plan": [],
            "communication_log": [],
            "debate_log": [],
            "verbose": verbose,
            "max_contacts": max_contacts,
        }

        # Run the graph
        final_state = await self.app.ainvoke(initial_state)

        result = {
            "contacts": final_state.get("contacts", []),
            "emails": final_state.get("emails", []),
            "followup_plan": final_state.get("followup_plan", []),
            "communication_log": final_state.get("communication_log", []),
            "debate_log": final_state.get("debate_log", []),
        }

        if verbose:
            print()
            print("=" * 60)
            print("Execution Complete!")
            print(f"  Contacts found: {len(result['contacts'])}")
            print(f"  Emails written: {len(result['emails'])}")
            print(f"  Follow-ups planned: {len(result['followup_plan'])}")
            print(f"  Communication log: {len(result['communication_log'])} messages")
            print("=" * 60)

        return result

    def get_communication_log_summary(self, log: list) -> str:
        """Format the communication log for display/demo."""
        lines = [
            "=" * 70,
            "AGENT COMMUNICATION LOG",
            "=" * 70,
            ""
        ]

        for entry in log:
            lines.append(f"[{entry['timestamp'][:19]}]")
            lines.append(f"  {entry['from']} → {entry['to']}")
            lines.append(f"  Action: {entry['action']}")
            lines.append(f"  Summary: {entry['summary']}")
            if entry.get('details'):
                for key, value in entry['details'].items():
                    if isinstance(value, list) and len(value) > 3:
                        value = f"[{len(value)} items]"
                    lines.append(f"    {key}: {value}")
            lines.append("")

        lines.append("=" * 70)
        return "\n".join(lines)

    def get_graph_visualization(self) -> str:
        """Get a text representation of the workflow graph."""
        return """
LangGraph Manager Workflow:
===========================

    ┌──────────────────┐
    │  load_campaign   │ (DataLoaderAgent - Supabase)
    │                  │
    │  Loads CTA,      │
    │  style, target   │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │   find_people    │ (PeopleFinderAgent)
    │                  │
    │  Aviato DSL →    │
    │  Clado fallback  │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │  write_emails    │ (WriterAgent + DebateOrchestrator)
    │                  │
    │  ┌────────────┐  │
    │  │ StyleAgent │  │ ←── 3-agent debate
    │  │ CTAAgent   │  │     for template
    │  │ BPAgent    │  │
    │  └────────────┘  │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ plan_followups   │ (FollowupAgent)
    │                  │
    │  Day 3, 7, 14    │
    │  sequences       │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │ generate_output  │ (OutputGenerator)
    │                  │
    │  email.txt       │
    │  followup.json   │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │       END        │
    └──────────────────┘

Agents (6 total):
- DataLoaderAgent: Loads campaign data from Supabase
- PeopleFinderAgent: Finds contacts via Aviato/Clado APIs
- WriterAgent: Personalizes emails for each contact
- StyleDebateAgent: Drafts and revises templates (sub-agent)
- CTADebateAgent: Critiques CTA effectiveness (sub-agent)
- BestPracticeAgent: Checks cold email practices (sub-agent)
- FollowupAgent: Creates follow-up sequences
- OutputGenerator: Writes final output files
"""


# Quick test
if __name__ == "__main__":
    import asyncio

    async def main():
        manager = LangGraphManagerAgent()

        # Print the graph visualization
        print(manager.get_graph_visualization())

        # Get the first user and campaign
        users = manager.supabase.get_users()
        if not users:
            print("No users found")
            return

        user = users[0]
        print(f"Using user: {user.get('display_name', user['email'])}")

        campaigns = manager.supabase.get_user_campaigns(user["id"])
        if not campaigns:
            print("No campaigns found")
            return

        campaign = campaigns[0]
        print(f"Using campaign: {campaign['representative_subject']}")
        print()

        # Execute
        result = await manager.execute(
            user_id=user["id"],
            campaign_id=campaign["id"],
            verbose=True,
        )

        # Print communication log
        print()
        print(manager.get_communication_log_summary(result["communication_log"]))

        # Print debate log if available
        if result.get("debate_log"):
            print()
            print("DEBATE SUB-LOG:")
            print("-" * 40)
            for entry in result["debate_log"]:
                print(f"  {entry['from']} → {entry['to']}: {entry['type']}")

    asyncio.run(main())
